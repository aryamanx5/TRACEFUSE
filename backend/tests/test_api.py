"""End-to-end API tests: casebook, validation, honest failure, and the historical case replayed through the
same pipeline (real recorded provider responses — no network)."""

from __future__ import annotations

import asyncio
import csv
import io
import json
from pathlib import Path

import httpx
import pytest

from tracefuse.api.app import create_app
from tracefuse.services import Services
from tracefuse.storage.db import Database

RONIN = "0x098b716b8aaf21512996dc57eb0615e2383e2f96"
CASSETTE = Path(__file__).resolve().parents[1] / "data" / "cases" / "ronin-2022" / "cassette.json.gz"


async def _client(settings, transport=None):
    svc = Services.create(settings, db=Database(settings.tracefuse_db_path), transport=transport)
    app = create_app(settings, svc)
    ctx = app.router.lifespan_context(app)
    await ctx.__aenter__()
    c = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")
    return c, ctx, app


async def _wait(c, inv_id, timeout=120):
    for _ in range(int(timeout * 10)):
        r = (await c.get(f"/api/investigations/{inv_id}")).json()
        if r["status"] in ("completed", "partial", "failed", "cancelled") and not r["running"]:
            return r
        await asyncio.sleep(0.1)
    raise AssertionError("investigation did not finish")


@pytest.fixture
async def api(settings):
    c, ctx, _app = await _client(settings)
    yield c
    await c.aclose()
    await ctx.__aexit__(None, None, None)


async def test_health_meta(api):
    assert (await api.get("/api/health")).json()["status"] == "ok"
    ready = (await api.get("/api/ready")).json()
    assert ready["ofac_dataset"] is True  # bundled official snapshot imported at startup
    chains = {c["key"]: c for c in (await api.get("/api/meta/chains")).json()}
    assert chains["ethereum"]["ready"] and chains["optimism"]["ready"]
    prov = (await api.get("/api/meta/providers")).json()
    assert prov["credentials"]["ETHERSCAN_API_KEY"] is False
    assert "SECRET" not in json.dumps(prov)
    assert (await api.get("/api/meta/scoring")).json()["not_a_probability"] is True


async def test_validation_errors(api):
    r = (await api.post("/api/validate", json={"seed": "0x1234", "chain": "ethereum"})).json()
    assert r["valid"] is False and "40" in r["error"]
    r = (await api.post("/api/validate", json={"seed": RONIN, "chain": "solana"})).json()
    assert r["valid"] is False and "Unsupported" in r["error"]
    r = await api.post("/api/investigations", json={"config": {"seed": "nope"}})
    assert r.status_code == 422
    r = await api.post("/api/investigations", json={"config": {"seed": RONIN, "max_hops": 9}})
    assert r.status_code == 422
    r = await api.post("/api/investigations", json={"config": {"seed": RONIN, "provider": "alchemy"}})
    assert r.status_code == 409 and r.json()["detail"]["kind"] == "unconfigured"


async def test_casebook_crud(api):
    c = (await api.post("/api/cases", json={"title": "Case A", "description": "d"})).json()
    cid = c["id"]
    assert (await api.patch(f"/api/cases/{cid}", json={"title": "Renamed", "review_state": "in_review",
                                                       "ui_state": {"view": "matrix"}})).json()["title"] == "Renamed"
    n = (await api.post(f"/api/cases/{cid}/notes", json={"target_type": "address", "target_id": RONIN, "body": "check"})).json()
    await api.patch(f"/api/cases/{cid}/notes/{n['id']}", json={"body": "checked"})
    b = (await api.post(f"/api/cases/{cid}/bookmarks", json={"target_type": "address", "target_id": RONIN, "label": "seed"})).json()
    again = (await api.post(f"/api/cases/{cid}/bookmarks", json={"target_type": "address", "target_id": RONIN})).json()
    assert again["id"] == b["id"]
    await api.put(f"/api/cases/{cid}/reviews/ev_1", json={"state": "disputed", "note": "copied text"})
    await api.post(f"/api/cases/{cid}/decisions", json={"body": "escalate"})
    await api.post(f"/api/cases/{cid}/hypotheses", json={"source_entity": "a", "target_entity": "b", "relation": "r", "rationale": "x"})
    full = (await api.get(f"/api/cases/{cid}")).json()
    assert full["ui_state"] == {"view": "matrix"} and full["review_state"] == "in_review"
    assert full["notes"][0]["body"] == "checked" and len(full["bookmarks"]) == 1
    assert full["reviews"][0]["state"] == "disputed" and len(full["decisions"]) == 1 and len(full["hypotheses"]) == 1
    assert (await api.put(f"/api/cases/{cid}/reviews/ev_1", json={"state": "bogus"})).status_code == 422
    assert (await api.delete(f"/api/cases/{cid}")).status_code == 204
    assert (await api.get(f"/api/cases/{cid}")).status_code == 404
    assert (await api.delete(f"/api/cases/{cid}/notes/{n['id']}")).status_code == 404


async def test_provider_failure_is_reported_not_faked(settings):
    transport = httpx.MockTransport(lambda req: httpx.Response(429, headers={"retry-after": "0"}))
    c, ctx, _ = await _client(settings, transport)
    try:
        inv = (await c.post("/api/investigations", json={"config": {"seed": RONIN, "osint": {"github": False, "goplus": False}}})).json()
        done = await _wait(c, inv["id"])
        assert done["status"] == "failed"  # no data for the seed is a failure, never an empty "success"
        assert done["transfer_count"] == 0 and "rate_limited" in (done["error"] or "")
        events = (await c.get(f"/api/investigations/{inv['id']}/events.json")).json()
        assert any("rate" in e["message"].lower() for e in events)
        graph = (await c.get(f"/api/investigations/{inv['id']}/graph")).json()
        assert graph["stats"]["transfers"] == 0
    finally:
        await c.aclose()
        await ctx.__aexit__(None, None, None)


@pytest.mark.skipif(not CASSETTE.exists(), reason="historical dataset not collected")
async def test_historical_case_full_journey(api):
    cases = (await api.get("/api/historical-cases")).json()
    assert cases[0]["key"] == "ronin-2022" and cases[0]["has_dataset"]
    opened = (await api.post("/api/historical-cases/ronin-2022/open")).json()
    inv_id = opened["investigation"]["id"]
    done = await _wait(api, inv_id)
    assert done["status"] in ("completed", "partial"), done
    assert done["data_origin"] == "historical_case" and done["transfer_count"] > 100

    # SSE replays persisted events and ends
    sse = await api.get(f"/api/investigations/{inv_id}/events")
    assert "event: progress" in sse.text and "event: end" in sse.text
    stages = [e["stage"] for e in (await api.get(f"/api/investigations/{inv_id}/events.json")).json()]
    for st in ("validate", "acquire", "normalize", "osint", "score", "lifecycle"):
        assert st in stages

    g = (await api.get(f"/api/investigations/{inv_id}/graph")).json()
    assert RONIN in g["seeds"] and any(n["id"] == RONIN and n["is_seed"] for n in g["nodes"])
    bridge = "0x1a2a1c938ce3ec39b6d47113c7955baa9dd454f2"
    edge = next(e for e in g["edges"] if e["source"] == bridge and e["target"] == RONIN)
    assert any(t["amount"] == "173600" for t in edge["totals"])

    node = (await api.get(f"/api/investigations/{inv_id}/nodes/{RONIN}")).json()
    kinds = {e["kind"] for e in node["evidence"]}
    assert {"sanctions_listing", "public_report"} <= kinds
    assert all(t["provenance"]["data_origin"] == "historical_case" for t in node["transfers"])

    ed = (await api.get(f"/api/investigations/{inv_id}/edges/{bridge}/{RONIN}")).json()
    assert any(t["tx_hash"] == "0xc28fad5e8d5e0ce6a2eaf67b6687be5d58113e16be590824d6cfa1a94467d0b7" for t in ed["transfers"])

    # time window changes graph/timeline/matrix consistently
    full_tl = (await api.get(f"/api/investigations/{inv_id}/timeline")).json()
    win = {"start": "2022-03-23T00:00:00Z", "end": "2022-03-24T00:00:00Z"}
    tl = (await api.get(f"/api/investigations/{inv_id}/timeline", params=win)).json()
    gw = (await api.get(f"/api/investigations/{inv_id}/graph", params=win)).json()
    assert 0 < len(tl["events"]) < len(full_tl["events"]) and gw["stats"]["transfers"] == len(tl["events"])
    mx = (await api.get(f"/api/investigations/{inv_id}/matrix", params={**win, "measure": "value", "asset": "native"})).json()
    cell = max(mx["cells"], key=lambda c: c["value"])
    drill = (await api.get(f"/api/investigations/{inv_id}/transfers", params={"ids": ",".join(cell["transfer_ids"])})).json()
    assert drill["total"] == cell["count"]
    snap = (await api.get(f"/api/investigations/{inv_id}/snapshot", params={"at": 1648042200})).json()
    assert snap["stats"]["transfers"] >= 1

    sc = (await api.get(f"/api/investigations/{inv_id}/scores")).json()["scores"]
    top = next(s for s in sc if s["category"] == "candidate")
    assert top["signals"] and "not a probability" in top["limitations"][0]
    re = (await api.post(f"/api/investigations/{inv_id}/scores", json={"disabled": ["sanctions", "threat_intel"]})).json()
    assert re["config"]["disabled"] == ["sanctions", "threat_intel"]
    assert (await api.post(f"/api/investigations/{inv_id}/scores", json={"disabled": ["nope"]})).status_code == 422

    fu = (await api.get(f"/api/investigations/{inv_id}/fusion")).json()
    rel_ids = [r["id"] for r in fu["relationships"]]
    assert len(rel_ids) == len(set(rel_ids))  # stable unique ids (UI keys / selection)
    assert len({e["id"] for e in fu["entities"]}) == len(fu["entities"])
    rel_types = {r["type"] for r in fu["relationships"]}
    assert {"observed_transfer", "sanctions_listing", "source_reported_label", "public_report"} <= rel_types

    cc = (await api.get(f"/api/investigations/{inv_id}/crosschain")).json()
    assert cc["privacy_gaps"] and all(g["status"] == "unresolved" for g in cc["privacy_gaps"])

    html = (await api.get(f"/api/investigations/{inv_id}/report.html")).text
    assert "Historical case" in html and "<script" not in html and "makes no claim" in html
    rj = json.loads((await api.get(f"/api/investigations/{inv_id}/report.json")).text)
    assert rj["investigation"]["data_origin"] == "historical_case" and rj["observed_facts"]["transfers"]
    for kind in ("transfers", "scores", "evidence"):
        body = (await api.get(f"/api/investigations/{inv_id}/export/{kind}.csv")).text
        rows = list(csv.reader(io.StringIO(body)))
        assert len(rows) > 1 and all(len(r) == len(rows[0]) for r in rows)

    # Casebook keeps it after reopen
    case = (await api.get(f"/api/cases/{opened['case']['id']}")).json()
    assert case["origin"] == "historical_case" and case["investigations"][0]["id"] == inv_id
    assert "Historical case" in (await api.get(f"/api/cases/{case['id']}/report.html")).text


@pytest.mark.skipif(not CASSETTE.exists(), reason="historical dataset not collected")
async def test_challenge_flow(api):
    chs = (await api.get("/api/challenges")).json()
    cid = chs[0]["id"]
    h = {"X-Session-Id": "s1"}
    view = (await api.get(f"/api/challenges/{cid}", headers=h)).json()
    assert view["total"] == 8 and view["checkpoints"][0]["explanation"] is None  # no answer leakage
    assert "answer" not in json.dumps(view["checkpoints"][0]).replace("answered", "")
    assert "0xc28fad5e8d5e0ce6a2eaf67b6687be5d58113e16be590824d6cfa1a94467d0b7" not in json.dumps(view)  # no leakage via hints
    hint = (await api.post(f"/api/challenges/{cid}/checkpoints/c1/hint", headers=h)).json()
    assert len(hint["checkpoints"][0]["hints"]) == 1
    wrong = (await api.post(f"/api/challenges/{cid}/checkpoints/c1/answer", headers=h, json={"answer": "0x" + "1" * 64})).json()
    assert wrong["correct"] is False
    right = (await api.post(f"/api/challenges/{cid}/checkpoints/c1/answer", headers=h,
                            json={"answer": "0xC28FAD5E8D5E0CE6A2EAF67B6687BE5D58113E16BE590824D6CFA1A94467D0B7"})).json()
    assert right["correct"] and right["challenge"]["checkpoints"][0]["explanation"]
    num = (await api.post(f"/api/challenges/{cid}/checkpoints/c3/answer", headers=h, json={"answer": "25,500,000"})).json()
    assert num["correct"]
    torn = (await api.post(f"/api/challenges/{cid}/checkpoints/c7/answer", headers=h,
                           json={"answer": "0xd90e2f925DA726b50C4Ed8D0Fb90Ad053324F31b"})).json()
    assert torn["correct"]
    assert (await api.get(f"/api/challenges/{cid}")).status_code == 400  # session required
