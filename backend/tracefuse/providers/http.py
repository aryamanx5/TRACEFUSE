"""Resilient HTTP client shared by every external adapter.

Features
- per-provider token-bucket rate limiting (process-wide)
- timeouts, bounded retries with exponential backoff + jitter, ``Retry-After`` support
- response cache (SQLite via :class:`CacheStore`) with explicit ``from_cache`` provenance
- secret-free URL sanitisation for logs, cache keys, provenance and recorded cassettes
- record / replay transports so a historical case re-runs the *same* adapter + analysis code
- per-investigation call budgets so user input cannot trigger unbounded crawling
- provider health tracking (last success/error, rate-limit headers, cache hits)
"""

from __future__ import annotations

import asyncio
import gzip
import hashlib
import json
import logging
import random
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal, Protocol
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx

from ..config import Settings
from ..logging_setup import redact
from .errors import (
    BudgetExhausted,
    ProviderAuthError,
    ProviderBadResponse,
    ProviderBlocked,
    ProviderError,
    ProviderNotFound,
    ProviderOffline,
    ProviderRateLimited,
    ProviderTimeout,
    ReplayMiss,
)

log = logging.getLogger(__name__)

# Only credential-bearing parameters; NOT generic names like "token" (Blockscout uses token=<contract> as a filter).
SECRET_PARAMS = {"apikey", "api_key", "key", "access_token"}


def sanitize_url(url: str, params: dict[str, Any] | None = None) -> str:
    """Return the URL (with params merged) stripped of credentials, with params sorted for stable keys."""
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    if params:
        query.update({k: str(v) for k, v in params.items() if v is not None})
    clean = sorted((k, v) for k, v in query.items() if k.lower() not in SECRET_PARAMS)
    path = parts.path
    if "alchemy.com" in parts.netloc and path.startswith("/v2/"):
        path = "/v2/[key]"
    return urlunsplit((parts.scheme, parts.netloc, path, urlencode(clean), ""))


def _body_hash(body: Any) -> str:
    if body is None:
        return ""
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:24]


# ---------------------------------------------------------------------------------------------------
# Cache protocol (implemented in storage.repositories.HttpCacheRepository)
# ---------------------------------------------------------------------------------------------------


class CacheStore(Protocol):
    def get(self, key: str) -> tuple[str, int, datetime] | None: ...

    def put(self, key: str, provider: str, url: str, body: str, status: int, ttl_seconds: int) -> None: ...


# ---------------------------------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------------------------------


@dataclass
class ProviderHealth:
    provider: str
    calls: int = 0
    cache_hits: int = 0
    errors: int = 0
    rate_limited: int = 0
    last_success_at: datetime | None = None
    last_error_at: datetime | None = None
    last_error_kind: str | None = None
    last_error_message: str | None = None
    rate_limit_limit: str | None = None
    rate_limit_remaining: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "calls": self.calls,
            "cache_hits": self.cache_hits,
            "errors": self.errors,
            "rate_limited": self.rate_limited,
            "last_success_at": self.last_success_at.isoformat() if self.last_success_at else None,
            "last_error_at": self.last_error_at.isoformat() if self.last_error_at else None,
            "last_error_kind": self.last_error_kind,
            "last_error_message": self.last_error_message,
            "rate_limit_limit": self.rate_limit_limit,
            "rate_limit_remaining": self.rate_limit_remaining,
            "scope": "since process start",
        }


class HealthRegistry:
    def __init__(self) -> None:
        self._h: dict[str, ProviderHealth] = {}

    def get(self, provider: str) -> ProviderHealth:
        if provider not in self._h:
            self._h[provider] = ProviderHealth(provider)
        return self._h[provider]

    def all(self) -> dict[str, ProviderHealth]:
        return dict(self._h)


# ---------------------------------------------------------------------------------------------------
# Rate limiting / budgets
# ---------------------------------------------------------------------------------------------------


class TokenBucket:
    def __init__(self, rate_per_sec: float, burst: int = 1):
        self.rate = max(rate_per_sec, 0.01)
        self.capacity = max(burst, 1)
        self.tokens = float(self.capacity)
        self.updated = time.monotonic()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            while True:
                now = time.monotonic()
                self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)
                self.updated = now
                if self.tokens >= 1:
                    self.tokens -= 1
                    return
                await asyncio.sleep((1 - self.tokens) / self.rate)


@dataclass
class CallBudget:
    """Per-investigation upper bound on non-cached provider calls."""

    limit: int
    used: int = 0
    per_provider: dict[str, int] = field(default_factory=dict)

    def consume(self, provider: str) -> None:
        if self.used >= self.limit:
            raise BudgetExhausted(provider, f"investigation call budget of {self.limit} requests exhausted")
        self.used += 1
        self.per_provider[provider] = self.per_provider.get(provider, 0) + 1


# ---------------------------------------------------------------------------------------------------
# Record / replay
# ---------------------------------------------------------------------------------------------------


@dataclass
class Interaction:
    method: str
    url: str  # sanitised
    body_hash: str
    status: int
    content_type: str
    text: str
    recorded_at: str
    # Transport-level failure observed while recording ("timeout" | "network_error"); None for HTTP responses.
    error: str | None = None

    def key(self) -> str:
        return f"{self.method} {self.url} {self.body_hash}"


class Cassette:
    """A set of recorded HTTP interactions (credential-free)."""

    def __init__(self, interactions: list[Interaction] | None = None, meta: dict[str, Any] | None = None):
        self.meta = meta or {}
        self._by_key: dict[str, Interaction] = {}
        self.order: list[str] = []
        for it in interactions or []:
            self.add(it)

    def add(self, it: Interaction) -> None:
        k = it.key()
        if k not in self._by_key:
            self.order.append(k)
        elif it.error is not None and self._by_key[k].error is None:
            return  # never let a later transport failure overwrite a recorded response
        self._by_key[k] = it

    def lookup(self, method: str, url: str, body_hash: str) -> Interaction | None:
        return self._by_key.get(f"{method} {url} {body_hash}")

    def __len__(self) -> int:
        return len(self._by_key)

    def to_json(self) -> dict[str, Any]:
        return {
            "meta": self.meta,
            "interactions": [self._by_key[k].__dict__ for k in self.order],
        }

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        raw = json.dumps(self.to_json(), separators=(",", ":"), sort_keys=False).encode()
        with gzip.open(path, "wb", compresslevel=9) as fh:
            fh.write(raw)

    @classmethod
    def load(cls, path: Path) -> Cassette:
        with gzip.open(path, "rb") as fh:
            data = json.loads(fh.read().decode())
        return cls([Interaction(**it) for it in data["interactions"]], meta=data.get("meta"))


class _ReplayMissError(httpx.TransportError):
    pass


class RecordingTransport(httpx.AsyncBaseTransport):
    def __init__(self, inner: httpx.AsyncBaseTransport, cassette: Cassette):
        self.inner = inner
        self.cassette = cassette

    def _record_failure(self, request: httpx.Request, kind: str) -> None:
        body = json.loads(request.content.decode()) if request.content else None
        self.cassette.add(
            Interaction(
                method=request.method,
                url=sanitize_url(str(request.url)),
                body_hash=_body_hash(body),
                status=0,
                content_type="",
                text="",
                recorded_at=datetime.now(UTC).isoformat(),
                error=kind,
            )
        )

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        try:
            response = await self.inner.handle_async_request(request)
            content = await response.aread()
        except httpx.TimeoutException:
            self._record_failure(request, "timeout")
            raise
        except httpx.TransportError:
            self._record_failure(request, "network_error")
            raise
        body = json.loads(request.content.decode()) if request.content else None
        text = content.decode(response.encoding or "utf-8", errors="replace")
        if response.status_code < 500:  # 2xx and client errors (e.g. 429) so replays follow the same path
            self.cassette.add(
                Interaction(
                    method=request.method,
                    url=sanitize_url(str(request.url)),
                    body_hash=_body_hash(body),
                    status=response.status_code,
                    content_type=response.headers.get("content-type", "application/json"),
                    text=text,
                    recorded_at=datetime.now(UTC).isoformat(),
                )
            )
        headers = [(k, v) for k, v in response.headers.multi_items()
                   if k.lower() not in ("content-encoding", "content-length", "transfer-encoding")]
        return httpx.Response(status_code=response.status_code, headers=headers, content=content, request=request)


class ReplayTransport(httpx.AsyncBaseTransport):
    def __init__(self, cassette: Cassette):
        self.cassette = cassette
        self.misses: list[str] = []

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode()) if request.content else None
        url = sanitize_url(str(request.url))
        it = self.cassette.lookup(request.method, url, _body_hash(body))
        if it is None:
            self.misses.append(f"{request.method} {url}")
            raise _ReplayMissError(f"not recorded: {request.method} {url}")
        # Reproduce recorded transport failures as the same failure class — a recorded timeout is a
        # timeout, distinct from a request that was never recorded (ReplayMiss).
        if it.error == "timeout":
            raise httpx.ReadTimeout(f"recorded timeout at {it.recorded_at}", request=request)
        if it.error is not None:
            raise httpx.ConnectError(f"recorded {it.error} at {it.recorded_at}", request=request)
        return httpx.Response(
            status_code=it.status,
            headers={"content-type": it.content_type, "x-tracefuse-recorded-at": it.recorded_at},
            content=it.text.encode(),
            request=request,
        )


# ---------------------------------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------------------------------


@dataclass
class HttpResult:
    data: Any
    status: int
    url: str
    retrieved_at: datetime
    from_cache: bool = False
    replayed: bool = False
    headers: dict[str, str] = field(default_factory=dict)


JsonCheck = Callable[[Any], ProviderError | None]

_RETRY_STATUSES = {429, 500, 502, 503, 504, 520, 522, 524}


def _looks_like_challenge(resp: httpx.Response) -> bool:
    if resp.status_code not in (403, 503):
        return False
    t = resp.text[:2000].lower()
    return "just a moment" in t or "cf-chl" in t or "challenge-platform" in t


class ResilientHttp:
    def __init__(
        self,
        settings: Settings,
        *,
        cache: CacheStore | None = None,
        health: HealthRegistry | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        mode: Literal["live", "record", "replay"] = "live",
        cassette: Cassette | None = None,
        sleep: Callable[[float], Any] | None = None,
    ):
        self.settings = settings
        self.cache = cache if mode == "live" else None
        self.health = health or HealthRegistry()
        self.mode = mode
        self.cassette = cassette
        self._sleep = sleep or asyncio.sleep
        if mode == "replay":
            if cassette is None:
                raise ValueError("replay mode requires a cassette")
            self.replay_transport: ReplayTransport | None = ReplayTransport(cassette)
            transport = self.replay_transport
        else:
            self.replay_transport = None
            base = transport or httpx.AsyncHTTPTransport(retries=0)
            if mode == "record":
                if cassette is None:
                    raise ValueError("record mode requires a cassette")
                transport = RecordingTransport(base, cassette)
            else:
                transport = base
        self._client = httpx.AsyncClient(
            transport=transport,
            timeout=httpx.Timeout(settings.http_timeout_seconds, connect=min(10.0, settings.http_timeout_seconds)),
            headers={"User-Agent": settings.http_user_agent, "Accept": "application/json"},
            follow_redirects=True,
        )
        self._buckets: dict[str, TokenBucket] = {}
        self._pause_until: dict[str, float] = {}
        self._rates = {
            "blockscout": settings.rate_blockscout_rps,
            "blockscout-rpc": 0.08,  # public Etherscan-compatible RPC: ~10 requests / 2 minutes observed
            "etherscan": settings.rate_etherscan_rps,
            "alchemy": settings.rate_alchemy_rps,
            "goplus": settings.rate_goplus_rps,
            "github": settings.rate_github_auth_rps if settings.github_token else settings.rate_github_rps,
        }

    async def aclose(self) -> None:
        await self._client.aclose()

    def paused(self, family: str) -> bool:
        """True while an upstream told us its rate window for this provider family is exhausted."""
        return self.mode != "replay" and self._pause_until.get(family, 0) > time.monotonic()

    def _bucket(self, provider: str) -> TokenBucket:
        family = provider.split(":")[0]
        if family not in self._buckets:
            self._buckets[family] = TokenBucket(self._rates.get(family, 2.0), burst=2)
        return self._buckets[family]

    async def request(
        self,
        provider: str,
        method: str,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: Any = None,
        headers: dict[str, str] | None = None,
        cache_ttl: int | None = None,
        json_check: JsonCheck | None = None,
        budget: CallBudget | None = None,
        expect: Literal["json", "text"] = "json",
        timeout: float | None = None,
        retries: int | None = None,
    ) -> HttpResult:
        family = provider.split(":")[0]
        health = self.health.get(family)
        safe_url = sanitize_url(url, params)
        cache_key = hashlib.sha256(f"{method} {safe_url} {_body_hash(json_body)}".encode()).hexdigest()

        if self.cache is not None and cache_ttl:
            hit = self.cache.get(cache_key)
            if hit is not None:
                text, status, fetched_at = hit
                health.cache_hits += 1
                data = json.loads(text) if expect == "json" else text
                return HttpResult(data, status, safe_url, fetched_at, from_cache=True)

        if self.settings.tracefuse_offline and self.mode != "replay":
            offline = ProviderOffline(family, "network access disabled (TRACEFUSE_OFFLINE=1); live providers unavailable")
            self._note_error(health, offline)
            raise offline
        if budget is not None and self.mode != "replay":
            budget.consume(family)

        attempt = 0
        last_exc: ProviderError | None = None
        max_retries = 0 if self.mode == "replay" else (self.settings.http_max_retries if retries is None else retries)
        while attempt <= max_retries:
            if self.mode != "replay":
                await self._bucket(provider).acquire()
                wait = self._pause_until.get(family, 0) - time.monotonic()
                if wait > 0:
                    await self._sleep(min(wait, 130.0))
            health.calls += 1
            try:
                resp = await self._client.request(
                    method,
                    url,
                    params=params,
                    json=json_body,
                    headers=headers,
                    timeout=timeout if timeout is not None else httpx.USE_CLIENT_DEFAULT,
                )
            except _ReplayMissError as exc:
                health.errors += 1
                raise ReplayMiss(family, str(exc)) from exc
            except httpx.TimeoutException as exc:
                last_exc = ProviderTimeout(
                    family,
                    f"timed out ({exc}) during historical collection"
                    if self.mode == "replay"
                    else f"timed out after {self.settings.http_timeout_seconds}s",
                )
            except httpx.TransportError as exc:
                last_exc = ProviderError(family, f"network error: {type(exc).__name__}")
            else:
                self._record_rate_headers(health, resp)
                self._respect_remaining(family, resp)
                if _looks_like_challenge(resp):
                    err: ProviderError = ProviderBlocked(
                        family,
                        "upstream returned a browser challenge page (scripted access blocked); "
                        "configure an API-key provider for this chain",
                        status=resp.status_code,
                    )
                    self._note_error(health, err)
                    raise err
                if resp.status_code in _RETRY_STATUSES:
                    retry_after = _parse_retry_after(resp.headers.get("retry-after"))
                    if retry_after is None and resp.status_code == 429 and resp.headers.get("x-ratelimit-reset"):
                        r = _parse_retry_after(resp.headers.get("x-ratelimit-reset")) or 0.0
                        retry_after = min(r / 1000.0 if r > 1000 else r, 65.0)
                    if resp.status_code == 429:
                        health.rate_limited += 1
                        last_exc = ProviderRateLimited(family, "HTTP 429 rate limited", status=429, retry_after=retry_after)
                    else:
                        last_exc = ProviderError(family, f"HTTP {resp.status_code}", status=resp.status_code)
                    if attempt < max_retries:
                        await self._backoff(attempt, retry_after)
                        attempt += 1
                        continue
                    self._note_error(health, last_exc)
                    raise last_exc
                if resp.status_code in (401, 403):
                    err = ProviderAuthError(family, f"HTTP {resp.status_code}: credentials rejected or missing", status=resp.status_code)
                    self._note_error(health, err)
                    raise err
                if resp.status_code == 404:
                    err = ProviderNotFound(family, "HTTP 404 not found", status=404)
                    self._note_error(health, err)
                    raise err
                if resp.status_code >= 400:
                    err = ProviderBadResponse(family, f"HTTP {resp.status_code}", status=resp.status_code)
                    self._note_error(health, err)
                    raise err
                try:
                    data = resp.json() if expect == "json" else resp.text
                except ValueError as exc:
                    err = ProviderBadResponse(family, "response was not valid JSON")
                    self._note_error(health, err)
                    raise err from exc
                if json_check is not None:
                    problem = json_check(data)
                    if problem is not None:
                        if isinstance(problem, ProviderRateLimited):
                            health.rate_limited += 1
                            last_exc = problem
                            if attempt < max_retries:
                                await self._backoff(attempt, None)
                                attempt += 1
                                continue
                        self._note_error(health, problem)
                        raise problem
                recorded = resp.headers.get("x-tracefuse-recorded-at")
                retrieved_at = datetime.fromisoformat(recorded) if recorded else datetime.now(UTC)
                health.last_success_at = datetime.now(UTC)
                if self.cache is not None and cache_ttl:
                    self.cache.put(cache_key, family, safe_url, resp.text, resp.status_code, cache_ttl)
                return HttpResult(
                    data,
                    resp.status_code,
                    safe_url,
                    retrieved_at,
                    from_cache=False,
                    replayed=self.mode == "replay",
                    headers={k: v for k, v in resp.headers.items() if k.lower().startswith("x-ratelimit")},
                )
            # timeout / transport error path
            if attempt < max_retries:
                await self._backoff(attempt, None)
                attempt += 1
                continue
            break
        assert last_exc is not None
        self._note_error(health, last_exc)
        log.warning("provider %s failed for %s: %s", family, redact(safe_url), last_exc.message)
        raise last_exc

    async def _backoff(self, attempt: int, retry_after: float | None) -> None:
        delay = (
            min(retry_after, 65.0)
            if retry_after is not None
            else min(self.settings.http_backoff_max_seconds, self.settings.http_backoff_base_seconds * (2**attempt))
        )
        delay += random.uniform(0, delay * 0.25)  # noqa: S311 - jitter, not crypto
        await self._sleep(delay)

    def _respect_remaining(self, family: str, resp: httpx.Response) -> None:
        """When the upstream says the window is exhausted, pause that provider family until reset."""
        rem, reset = resp.headers.get("x-ratelimit-remaining"), resp.headers.get("x-ratelimit-reset")
        if rem is None or reset is None:
            return
        try:
            if int(rem) <= 1:
                r = float(reset)
                secs = r / 1000.0 if r > 1000 else r  # Blockscout reports milliseconds
                self._pause_until[family] = time.monotonic() + min(secs, 130.0)
        except ValueError:
            return

    @staticmethod
    def _record_rate_headers(health: ProviderHealth, resp: httpx.Response) -> None:
        lim = resp.headers.get("x-ratelimit-limit")
        rem = resp.headers.get("x-ratelimit-remaining")
        if lim is not None:
            health.rate_limit_limit = lim
        if rem is not None:
            health.rate_limit_remaining = rem

    @staticmethod
    def _note_error(health: ProviderHealth, err: ProviderError) -> None:
        health.errors += 1
        health.last_error_at = datetime.now(UTC)
        health.last_error_kind = err.kind
        health.last_error_message = err.message[:300]


def _parse_retry_after(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        return None
