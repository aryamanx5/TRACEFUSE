"""HTTP resilience + provider adapter behaviour against mocked transports (no network)."""

from __future__ import annotations

import json

import httpx
import pytest

from tracefuse.chains import CHAINS
from tracefuse.domain.models import DataOrigin, TransferKind
from tracefuse.providers.base import BlockRange, FetchContext
from tracefuse.providers.blockscout import BlockscoutProvider, parse_blockscout_tags
from tracefuse.providers.errors import (
    BudgetExhausted,
    ProviderAuthError,
    ProviderBlocked,
    ProviderRateLimited,
    ProviderTimeout,
    ProviderUnconfigured,
    ReplayMiss,
)
from tracefuse.providers.etherscan import EtherscanV2Provider
from tracefuse.providers.etherscan_compat import etherscan_json_check, parse_tokentx, parse_txlist, parse_txlistinternal
from tracefuse.providers.http import CallBudget, Cassette, Interaction, ResilientHttp
from tracefuse.storage.repositories import HttpCacheRepository

ETH = CHAINS["ethereum"]


def client(settings, handler, **kw):
    return ResilientHttp(settings, transport=httpx.MockTransport(handler), **kw)


async def test_retry_then_success(settings):
    calls = {"n": 0}

    def h(req):
        calls["n"] += 1
        return httpx.Response(429) if calls["n"] < 2 else httpx.Response(200, json={"ok": 1})

    http = client(settings, h)
    r = await http.request("blockscout:ethereum", "GET", "https://x.test/a")
    assert r.data == {"ok": 1} and calls["n"] == 2
    assert http.health.get("blockscout").rate_limited == 1


async def test_rate_limit_exhausts_retries(settings):
    http = client(settings, lambda req: httpx.Response(429, headers={"retry-after": "0"}))
    with pytest.raises(ProviderRateLimited):
        await http.request("goplus", "GET", "https://x.test/a")
    assert http.health.get("goplus").last_error_kind == "rate_limited"


async def test_timeout_maps_to_provider_timeout(settings):
    def h(req):
        raise httpx.ReadTimeout("slow", request=req)

    with pytest.raises(ProviderTimeout):
        await client(settings, h).request("github", "GET", "https://x.test/a")


async def test_challenge_page_is_blocked_not_retried(settings):
    calls = {"n": 0}

    def h(req):
        calls["n"] += 1
        return httpx.Response(403, text="<title>Just a moment...</title>")

    with pytest.raises(ProviderBlocked):
        await client(settings, h).request("blockscout:base", "GET", "https://x.test/a")
    assert calls["n"] == 1


async def test_auth_error(settings):
    with pytest.raises(ProviderAuthError):
        await client(settings, lambda r: httpx.Response(401)).request("etherscan", "GET", "https://x.test")


async def test_budget(settings):
    http = client(settings, lambda r: httpx.Response(200, json={}))
    b = CallBudget(limit=1)
    await http.request("blockscout", "GET", "https://x.test/1", budget=b)
    with pytest.raises(BudgetExhausted):
        await http.request("blockscout", "GET", "https://x.test/2", budget=b)


async def test_cache_marks_from_cache_and_strips_secrets(settings, services):
    seen = []

    def h(req):
        seen.append(str(req.url))
        return httpx.Response(200, json={"v": 1})

    http = client(settings, h, cache=HttpCacheRepository(services.db))
    r1 = await http.request("etherscan", "GET", "https://x.test/api", params={"apikey": "SECRET", "a": 1}, cache_ttl=60)
    r2 = await http.request("etherscan", "GET", "https://x.test/api", params={"apikey": "SECRET", "a": 1}, cache_ttl=60)
    assert not r1.from_cache and r2.from_cache and len(seen) == 1
    assert "SECRET" not in r1.url
    rows = services.db.query("SELECT url, body FROM http_cache")
    assert all("SECRET" not in r["url"] for r in rows)


async def test_replay_and_miss(settings):
    cas = Cassette([Interaction("GET", "https://x.test/a", "", 200, "application/json", '{"k": 2}', "2026-10-17T00:00:00+00:00")])
    http = ResilientHttp(settings, mode="replay", cassette=cas)
    r = await http.request("blockscout", "GET", "https://x.test/a")
    assert r.data == {"k": 2} and r.replayed and r.retrieved_at.year == 2026
    with pytest.raises(ReplayMiss):
        await http.request("blockscout", "GET", "https://x.test/other")


def test_etherscan_json_check():
    chk = etherscan_json_check("etherscan")
    assert chk({"status": "0", "message": "No transactions found", "result": []}) is None
    assert isinstance(chk({"status": "0", "message": "NOTOK", "result": "Max rate limit reached"}), ProviderRateLimited)
    assert isinstance(chk({"status": "0", "message": "NOTOK", "result": "Invalid API Key"}), ProviderAuthError)


PROV = None


def _prov():
    from datetime import UTC, datetime

    from tracefuse.domain.models import Provenance
    return Provenance(provider="t", endpoint="e", retrieved_at=datetime(2026, 1, 1, tzinfo=UTC), data_origin=DataOrigin.LIVE)


def test_etherscan_format_parsers_normalise_and_dedupe():
    txs = [{"hash": "0xAA", "blockNumber": "10", "timeStamp": "1648041417", "from": "0xA1", "to": "0xB2",
            "value": "1056900000000000000", "isError": "0", "txreceipt_status": "1", "functionName": "", "methodId": "0x"},
           {"hash": "0xbb", "blockNumber": "11", "timeStamp": "1648041418", "from": "0xa1", "to": "", "contractAddress": "0xc3",
            "value": "0", "isError": "1"}]
    out = parse_txlist(ETH, txs, _prov())
    assert out[0].amount == "1.0569" and out[0].tx_hash == "0xaa" and out[0].from_address == "0xa1"
    assert out[1].to_address == "0xc3" and out[1].success is False
    internal = [{"hash": "0xcc", "blockNumber": "12", "timeStamp": "1", "from": "0xd", "to": "0xe", "value": "5", "index": "18"},
                {"hash": "0xcc", "blockNumber": "12", "timeStamp": "1", "from": "0xd", "to": "0xe", "value": "0", "index": "19"}]
    it = parse_txlistinternal(ETH, internal, _prov())
    assert len(it) == 1 and it[0].kind == TransferKind.INTERNAL and it[0].id.endswith(":18")
    tok = {"hash": "0xdd", "blockNumber": "13", "timeStamp": "2", "from": "0x1", "to": "0x2",
           "contractAddress": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "value": "25500000000000",
           "tokenSymbol": "FAKE", "tokenDecimal": "6"}
    t = parse_tokentx(ETH, [tok, dict(tok)], _prov())
    assert t[0].asset.symbol == "USDC" and t[0].asset.recognised and t[0].amount == "25500000"
    assert t[0].id != t[1].id  # identical records without logIndex get distinct ordinals within a tx
    spam = parse_tokentx(ETH, [{**tok, "contractAddress": "0x9999999999999999999999999999999999999999", "tokenSymbol": "USDC"}], _prov())
    assert spam[0].asset.recognised is False  # symbol spoofing does not make a token canonical


def test_blockscout_tags_categories():
    from datetime import UTC, datetime
    obj = {"metadata": {"tags": [{"name": "Ronin Bridge Exploiter", "slug": "ronin-bridge-exploiter", "tagType": "name", "meta": {}},
                                 {"name": "Bridge", "slug": "bridge", "tagType": "generic", "meta": {}},
                                 {"name": "SANCTIONED", "slug": "sanctioned", "tagType": "generic", "meta": {"info": ["OFAC Sanctioned"]}}]}}
    labels = parse_blockscout_tags(obj, "https://eth.blockscout.com/address/0x1", datetime.now(UTC))
    cats = {lb.label: lb.category for lb in labels}
    assert cats["Ronin Bridge Exploiter"] == "name"  # not mis-classified as a bridge by substring
    assert cats["Bridge"] == "bridge" and cats["SANCTIONED"] == "sanctioned"


def _v2_tx(h, bn, frm, to, value, ts="2022-03-28T02:30:38Z"):
    return {"hash": h, "block_number": bn, "timestamp": ts, "from": {"hash": frm, "is_contract": False},
            "to": {"hash": to, "is_contract": False, "metadata": {"tags": [{"name": "Exchange", "slug": "exchange", "tagType": "generic"}]}},
            "value": str(value), "status": "ok", "method": None}


async def test_blockscout_v2_window_paging(settings):
    seen = []

    def h(req: httpx.Request):
        seen.append(str(req.url))
        path = req.url.path
        q = dict(req.url.params)
        if path.endswith("/transactions"):
            if q.get("block_number") == "201":  # seeded cursor at end_block + 1
                return httpx.Response(200, json={"items": [_v2_tx("0x01", 200, "0xaa", "0xbb", 5), _v2_tx("0x02", 150, "0xaa", "0xcc", 6)],
                                                 "next_page_params": {"block_number": 150, "index": 1, "items_count": 50}})
            return httpx.Response(200, json={"items": [_v2_tx("0x03", 120, "0xaa", "0xdd", 7), _v2_tx("0x04", 90, "0xaa", "0xee", 8)],
                                             "next_page_params": {"block_number": 90, "index": 0, "items_count": 100}})
        return httpx.Response(200, json={"items": [], "next_page_params": None})

    p = BlockscoutProvider(ResilientHttp(settings, transport=httpx.MockTransport(h)), settings)
    res = await p.address_transfers(ETH, "0xaa", BlockRange(100, 200), include_internal=True, include_tokens=True,
                                    limit=1000, ctx=FetchContext())
    assert [t.tx_hash for t in res.transfers] == ["0x03", "0x02", "0x01"]  # block 90 is outside the window
    assert not res.truncated
    assert res.counterparty_info["0xbb"].labels[0].category == "exchange"
    assert any("block_number=201" in u for u in seen)


async def test_etherscan_unconfigured(settings):
    p = EtherscanV2Provider(ResilientHttp(settings, transport=httpx.MockTransport(lambda r: httpx.Response(200))), settings)
    assert not p.is_configured()
    with pytest.raises(ProviderUnconfigured):
        await p.address_info(ETH, "0x1", FetchContext())


async def test_etherscan_configured_sends_key_server_side(settings):
    settings.etherscan_api_key = __import__("pydantic").SecretStr("KEY123")
    got = {}

    def h(req):
        got["url"] = str(req.url)
        return httpx.Response(200, json={"status": "1", "message": "OK", "result": [
            {"hash": "0xab", "blockNumber": "1", "timeStamp": "1", "from": "0x1", "to": "0x2", "value": "7", "isError": "0"}]})

    http = ResilientHttp(settings, transport=httpx.MockTransport(h))
    p = EtherscanV2Provider(http, settings)
    res = await p.address_transfers(ETH, "0x1", BlockRange(), include_internal=False, include_tokens=False, limit=50, ctx=FetchContext())
    assert "chainid=1" in got["url"] and len(res.transfers) == 1
    assert all("KEY123" not in e for e in res.endpoints)
    assert json.dumps(res.transfers[0].model_dump(mode="json")).find("KEY123") == -1


def test_sanitize_keeps_filter_params_distinct():
    from tracefuse.providers.http import sanitize_url
    a = sanitize_url("https://eth.blockscout.com/api/v2/addresses/0x1/token-transfers", {"token": "0xaaa"})
    b = sanitize_url("https://eth.blockscout.com/api/v2/addresses/0x1/token-transfers", {"token": "0xbbb"})
    assert a != b and "token=0xaaa" in a  # cache / cassette keys must not collapse different filters


def test_chain_readiness_is_honest_without_keys(settings):
    from tracefuse.providers.registry import ProviderRegistry
    reg = ProviderRegistry(ResilientHttp(settings), settings)
    rows = {r["key"]: r for r in reg.chain_matrix()}
    assert rows["ethereum"]["ready"] and rows["optimism"]["ready"]
    assert not rows["base"]["ready"] and not rows["arbitrum"]["ready"]  # no keyless provider that works for scripts


async def test_replay_reproduces_recorded_timeout_distinct_from_missing(settings):
    from tracefuse.providers.errors import ProviderError

    def slow(req):
        raise httpx.ReadTimeout("slow upstream", request=req)

    cas = Cassette()
    rec = ResilientHttp(settings, mode="record", cassette=cas, transport=httpx.MockTransport(slow))
    with pytest.raises(ProviderTimeout):
        await rec.request("blockscout", "GET", "https://x.test/slow")
    recorded = [cas.lookup("GET", "https://x.test/slow", "")]
    assert recorded[0] is not None and recorded[0].error == "timeout"
    # a later success for the same request wins; a later failure never overwrites a success
    ok = Interaction("GET", "https://x.test/slow", "", 200, "application/json", "{}", "t")
    cas.add(ok)
    cas.add(Interaction("GET", "https://x.test/slow", "", 0, "", "", "t2", error="timeout"))
    assert cas.lookup("GET", "https://x.test/slow", "").error is None
    timeout_only = Cassette([Interaction("GET", "https://x.test/t", "", 0, "", "", "2026-10-17T00:00:00+00:00", error="timeout")])
    rep = ResilientHttp(settings, mode="replay", cassette=timeout_only)
    with pytest.raises(ProviderTimeout) as ei:
        await rep.request("blockscout", "GET", "https://x.test/t")
    assert "historical collection" in ei.value.message
    with pytest.raises(ReplayMiss):
        await rep.request("blockscout", "GET", "https://x.test/never")
    assert not isinstance(ei.value, ReplayMiss) and isinstance(ei.value, ProviderError)


async def test_offline_mode_fails_live_calls_but_not_replay(settings):
    from tracefuse.providers.errors import ProviderOffline
    settings.tracefuse_offline = True
    calls = []
    live = ResilientHttp(settings, transport=httpx.MockTransport(lambda r: calls.append(r) or httpx.Response(200, json={})))
    with pytest.raises(ProviderOffline):
        await live.request("blockscout", "GET", "https://x.test/a")
    assert calls == []  # no outbound request attempted
    cas = Cassette([Interaction("GET", "https://x.test/a", "", 200, "application/json", '{"ok": 1}', "2026-10-17T00:00:00+00:00")])
    rep = ResilientHttp(settings, mode="replay", cassette=cas)
    assert (await rep.request("blockscout", "GET", "https://x.test/a")).data == {"ok": 1}
