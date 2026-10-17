"""Provider error taxonomy. Every failure is explicit — nothing is converted into fake success."""

from __future__ import annotations


class ProviderError(Exception):
    kind = "error"

    def __init__(self, provider: str, message: str, *, status: int | None = None, retry_after: float | None = None):
        super().__init__(f"[{provider}] {message}")
        self.provider = provider
        self.message = message
        self.status = status
        self.retry_after = retry_after

    def to_dict(self) -> dict[str, object]:
        return {"provider": self.provider, "kind": self.kind, "message": self.message, "status": self.status}


class ProviderUnconfigured(ProviderError):
    kind = "unconfigured"


class ProviderRateLimited(ProviderError):
    kind = "rate_limited"


class ProviderAuthError(ProviderError):
    kind = "auth_error"


class ProviderBlocked(ProviderError):
    """Upstream refused scripted access (e.g. a browser challenge page)."""

    kind = "blocked"


class ProviderTimeout(ProviderError):
    kind = "timeout"


class ProviderNotFound(ProviderError):
    kind = "not_found"


class ProviderBadResponse(ProviderError):
    kind = "bad_response"


class ProviderUnsupported(ProviderError):
    kind = "unsupported"


class ReplayMiss(ProviderError):
    """Historical-case replay requested a response that was not recorded."""

    kind = "not_in_historical_dataset"


class BudgetExhausted(ProviderError):
    kind = "budget_exhausted"


class ProviderOffline(ProviderError):
    kind = "offline"
