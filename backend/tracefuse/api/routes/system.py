"""Health, metadata, provider status, intel datasets, historical cases and challenges."""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from ... import __version__, historical
from ...analysis.metrics import METRIC_CATALOG
from ...analysis.scoring import scoring_spec
from ...chains import CHAINS
from ...challenge import engine
from ...domain.models import EvidenceKind
from ...pipeline.investigation import JobManager
from ...providers.base import FetchContext
from ...providers.errors import ProviderError
from ...services import Services
from ..deps import jobs, services

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "version": __version__, "time": time.time()}


@router.get("/ready")
def ready(s: Services = Depends(services)) -> dict[str, Any]:
    db_ok = s.db.healthy()
    if not db_ok:
        raise HTTPException(503, "database unavailable")
    return {"status": "ready", "database": "ok", "ofac_dataset": bool(s.ofac_repo.active_dataset())}


@router.get("/meta/chains")
def chains(s: Services = Depends(services)) -> list[dict[str, Any]]:
    return s.live.registry.chain_matrix()


@router.get("/meta/providers")
def providers(s: Services = Depends(services)) -> dict[str, Any]:
    gh = s.live.github
    return {
        "offline_mode": s.settings.tracefuse_offline,
        "credentials": s.settings.credential_status(),
        "health": {k: v.to_dict() for k, v in s.health.all().items()},
        "cache": s.cache.stats(),
        "sources": {
            "blockscout": {"configured": True, "note": "keyless public instances"},
            "etherscan": {"configured": s.settings.credential_status()["ETHERSCAN_API_KEY"]},
            "alchemy": {"configured": s.settings.credential_status()["ALCHEMY_API_KEY"]},
            "goplus": {"configured": True, "note": "keyless; GOPLUS_ACCESS_TOKEN optional"},
            "github": {"configured": True, "authenticated": gh.authenticated,
                       "endpoints": gh.endpoints(), "note": None if gh.authenticated else "code search requires GITHUB_TOKEN"},
            "ofac": s.ofac_repo.status(),
        },
    }


@router.post("/meta/providers/check")
async def check_providers(s: Services = Depends(services)) -> list[dict[str, Any]]:
    """Active, minimal live probe of each configured source (one cheap request each)."""
    out = []
    ctx = FetchContext()
    probe = "0x0000000000000000000000000000000000000001"
    for chain in CHAINS.values():
        for p in s.live.registry.candidates(chain):
            t0 = time.monotonic()
            try:
                await p.block_at_time(chain, __import__("datetime").datetime(2024, 1, 1, tzinfo=__import__("datetime").UTC), "before", ctx)
                out.append({"source": f"{p.name}:{chain.key}", "ok": True, "ms": round((time.monotonic() - t0) * 1000)})
            except ProviderError as exc:
                out.append({"source": f"{p.name}:{chain.key}", "ok": False, "kind": exc.kind, "message": exc.message})
    try:
        await s.live.goplus.address_security(CHAINS["ethereum"], probe, ctx)
        out.append({"source": "goplus", "ok": True})
    except ProviderError as exc:
        out.append({"source": "goplus", "ok": False, "kind": exc.kind, "message": exc.message})
    return out


@router.get("/meta/scoring")
def scoring_meta() -> dict[str, Any]:
    return scoring_spec()


@router.get("/meta/metrics")
def metrics_meta() -> dict[str, Any]:
    return METRIC_CATALOG


@router.get("/meta/evidence-kinds")
def evidence_kinds() -> list[str]:
    return [k.value for k in EvidenceKind]


# --- intel datasets ------------------------------------------------------------------------------
@router.get("/intel/ofac/status")
def ofac_status(s: Services = Depends(services)) -> dict[str, Any]:
    return s.ofac_repo.status()


@router.post("/intel/ofac/refresh")
async def ofac_refresh(s: Services = Depends(services)) -> dict[str, Any]:
    try:
        sdn = await s.ofac.import_sdn()
        actions = await s.ofac.import_actions()
    except ProviderError as exc:
        raise HTTPException(502, {"kind": exc.kind, "message": exc.message}) from exc
    return {"sdn": sdn, "actions": actions}


class AddressLookup(BaseModel):
    addresses: list[str] = Field(min_length=1, max_length=200)
    chain: str = "ethereum"


@router.post("/intel/ofac/match")
def ofac_match(body: AddressLookup, s: Services = Depends(services)) -> list[dict[str, Any]]:
    return [e.model_dump(mode="json") for e in s.ofac.evidence_for(body.chain, [a.lower() for a in body.addresses])]


# --- historical cases & challenge -----------------------------------------------------------------
@router.get("/historical-cases")
def historical_cases(s: Services = Depends(services)) -> list[dict[str, Any]]:
    return historical.list_cases(s)


@router.post("/historical-cases/{case_key}/open", status_code=202)
async def open_historical(case_key: str, s: Services = Depends(services), jm: JobManager = Depends(jobs)) -> dict[str, Any]:
    try:
        return await historical.open_case(s, jm, case_key)
    except FileNotFoundError as exc:
        raise HTTPException(409, str(exc)) from exc


class AnswerIn(BaseModel):
    answer: str = Field(min_length=1, max_length=300)


def _session(x_session_id: str | None) -> str:
    if not x_session_id or len(x_session_id) > 80:
        raise HTTPException(400, "X-Session-Id header required")
    return x_session_id


@router.get("/challenges")
def challenges(s: Services = Depends(services)) -> list[dict[str, Any]]:
    return engine.list_challenges(s)


@router.get("/challenges/{cid}")
def challenge(cid: str, x_session_id: str | None = Header(None), s: Services = Depends(services)) -> dict[str, Any]:
    ch, _ = engine.load(s, cid)
    return engine.public_view(ch, s.challenges.get(_session(x_session_id), cid))


@router.post("/challenges/{cid}/checkpoints/{cp}/answer")
def answer(cid: str, cp: str, body: AnswerIn, x_session_id: str | None = Header(None), s: Services = Depends(services)) -> dict[str, Any]:
    return engine.answer(s, _session(x_session_id), cid, cp, body.answer)


@router.post("/challenges/{cid}/checkpoints/{cp}/hint")
def hint(cid: str, cp: str, x_session_id: str | None = Header(None), s: Services = Depends(services)) -> dict[str, Any]:
    return engine.hint(s, _session(x_session_id), cid, cp)


@router.post("/challenges/{cid}/reset")
def reset(cid: str, x_session_id: str | None = Header(None), s: Services = Depends(services)) -> dict[str, Any]:
    sid = _session(x_session_id)
    s.challenges.reset(sid, cid)
    ch, _ = engine.load(s, cid)
    return engine.public_view(ch, {})
