"""Investigation lifecycle, SSE progress, analytics and exports."""

from __future__ import annotations

import asyncio
import json
from typing import Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel

from ...analysis.filters import AnalysisFilter
from ...analysis.scoring import ScoringConfig
from ...analysis.service import AnalysisService
from ...chains import CHAINS
from ...domain.models import DataOrigin, InvestigationConfig
from ...domain.validation import InvalidSeedError, classify_seed
from ...pipeline.investigation import InvestigationRunner, JobManager
from ...providers.errors import ProviderError
from ...reports.builder import build_report, evidence_csv, render_html, scores_csv, transfers_csv
from ...services import Services
from ..deps import analysis_filter, jobs, services

router = APIRouter(prefix="/api", tags=["investigations"])
TERMINAL = {"completed", "partial", "failed", "cancelled"}


class ValidateRequest(BaseModel):
    seed: str
    chain: str = "ethereum"


class StartRequest(BaseModel):
    config: InvestigationConfig
    case_id: str | None = None
    case_title: str | None = None


@router.post("/validate")
def validate(req: ValidateRequest, s: Services = Depends(services)) -> dict[str, Any]:
    if req.chain not in CHAINS:
        return {"valid": False, "error": f"Unsupported chain '{req.chain}'. Supported: {', '.join(CHAINS)}"}
    try:
        c = classify_seed(req.seed)
    except InvalidSeedError as exc:
        return {"valid": False, "error": str(exc)}
    reg = s.live.registry
    chain = CHAINS[req.chain]
    ready = bool(reg.candidates(chain))
    return {"valid": True, "kind": c.kind, "normalized": c.value, "chain": req.chain, "chain_ready": ready,
            "warning": None if ready else f"No configured provider can serve {chain.name}; set ALCHEMY_API_KEY or ETHERSCAN_API_KEY."}


@router.post("/investigations", status_code=202)
def start(req: StartRequest, s: Services = Depends(services), jm: JobManager = Depends(jobs)) -> dict[str, Any]:
    cfg = req.config
    if cfg.chain not in CHAINS:
        raise HTTPException(422, f"Unsupported chain '{cfg.chain}'")
    try:
        seed = classify_seed(cfg.seed)
    except InvalidSeedError as exc:
        raise HTTPException(422, str(exc)) from exc
    st = s.settings
    if cfg.max_hops > st.max_hops_limit or cfg.max_branching > st.max_branching_limit or cfg.max_nodes > st.max_nodes_limit:
        raise HTTPException(422, "traversal bounds exceed server limits")
    try:
        s.live.registry.select(CHAINS[cfg.chain], cfg.provider)
    except ProviderError as exc:
        raise HTTPException(409, {"kind": exc.kind, "message": exc.message}) from exc
    case_id = req.case_id
    if case_id and not s.cases.exists(case_id):
        raise HTTPException(404, "case not found")
    if not case_id:
        case_id = s.cases.create(title=req.case_title or f"Investigation {seed.value[:10]}… on {cfg.chain}")["id"]
    inv = s.investigations.create(cfg, DataOrigin.LIVE.value, case_id, seed.kind, seed.value)
    jm.start(InvestigationRunner(s, jm.bus, inv["id"], cfg, s.live))
    s.cases.touch(case_id)
    return inv


@router.get("/investigations")
def list_investigations(case_id: str | None = None, s: Services = Depends(services)) -> list[dict[str, Any]]:
    return s.investigations.list(case_id)


@router.get("/investigations/{inv_id}")
def get_investigation(inv_id: str, s: Services = Depends(services), jm: JobManager = Depends(jobs)) -> dict[str, Any]:
    inv = s.investigations.get(inv_id)
    inv["running"] = inv_id in jm.tasks
    inv["transfer_count"] = s.investigations.count_transfers(inv_id)
    inv["source_status"] = s.investigations.load_artifact(inv_id, "source_status", [])
    inv["seed"] = s.investigations.load_artifact(inv_id, "seed", {})
    return inv


@router.post("/investigations/{inv_id}/cancel")
def cancel(inv_id: str, s: Services = Depends(services), jm: JobManager = Depends(jobs)) -> dict[str, Any]:
    s.investigations.get(inv_id)
    return {"cancelled": jm.cancel(inv_id)}


@router.post("/investigations/{inv_id}/retry", status_code=202)
def retry(inv_id: str, s: Services = Depends(services), jm: JobManager = Depends(jobs)) -> dict[str, Any]:
    old = s.investigations.get(inv_id)
    if old["data_origin"] != DataOrigin.LIVE.value:
        raise HTTPException(409, "historical investigations are re-opened from the historical case, not retried live")
    return start(StartRequest(config=InvestigationConfig.model_validate(old["config"]), case_id=old["case_id"]), s, jm)


@router.delete("/investigations/{inv_id}", status_code=204)
def delete(inv_id: str, s: Services = Depends(services), jm: JobManager = Depends(jobs)) -> Response:
    jm.cancel(inv_id)
    s.investigations.delete(inv_id)
    return Response(status_code=204)


@router.get("/investigations/{inv_id}/events.json")
def events_json(inv_id: str, after: int = 0, s: Services = Depends(services)) -> list[dict[str, Any]]:
    s.investigations.get(inv_id)
    return [e.model_dump(mode="json") for e in s.events.list(inv_id, after)]


@router.get("/investigations/{inv_id}/events")
async def events_sse(inv_id: str, after: int = 0, last_event_id: str | None = Header(None),
                     s: Services = Depends(services), jm: JobManager = Depends(jobs)) -> StreamingResponse:
    s.investigations.get(inv_id)
    start_seq = int(last_event_id) if last_event_id and last_event_id.isdigit() else after

    async def gen():
        seq = start_seq
        yield "retry: 3000\n\n"
        while True:
            waiter = jm.bus.waiter(inv_id)
            evs = s.events.list(inv_id, seq)
            for e in evs:
                seq = e.seq
                yield f"id: {e.seq}\nevent: progress\ndata: {e.model_dump_json()}\n\n"
            status = s.investigations.get(inv_id)["status"]
            if status in TERMINAL and inv_id not in jm.tasks:
                yield f"event: end\ndata: {json.dumps({'status': status})}\n\n"
                return
            try:
                await asyncio.wait_for(waiter.wait(), timeout=15)
            except TimeoutError:
                yield ": keepalive\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------------------------------------------
def _svc(s: Services, inv_id: str) -> AnalysisService:
    s.investigations.get(inv_id)
    return AnalysisService(s)


@router.get("/investigations/{inv_id}/graph")
def graph(inv_id: str, f: AnalysisFilter = Depends(analysis_filter), s: Services = Depends(services)) -> dict[str, Any]:
    return _svc(s, inv_id).graph(inv_id, f)


@router.get("/investigations/{inv_id}/nodes/{address}")
def node(inv_id: str, address: str, f: AnalysisFilter = Depends(analysis_filter), s: Services = Depends(services)) -> dict[str, Any]:
    return _svc(s, inv_id).node_detail(inv_id, address, f)


@router.get("/investigations/{inv_id}/edges/{src}/{dst}")
def edge(inv_id: str, src: str, dst: str, f: AnalysisFilter = Depends(analysis_filter), s: Services = Depends(services)) -> dict[str, Any]:
    return _svc(s, inv_id).edge_detail(inv_id, src, dst, f)


@router.get("/investigations/{inv_id}/transfers")
def transfers(inv_id: str, ids: str | None = None, address: str | None = None, tx_hash: str | None = None,
              limit: int = Query(500, ge=1, le=5000), offset: int = Query(0, ge=0), s: Services = Depends(services)) -> dict[str, Any]:
    id_list = [i for i in ids.split(",") if i][:2000] if ids else None
    return _svc(s, inv_id).transfers(inv_id, id_list, address, tx_hash, limit, offset)


@router.get("/investigations/{inv_id}/metrics")
def metrics(inv_id: str, asset: str | None = None, f: AnalysisFilter = Depends(analysis_filter), s: Services = Depends(services)) -> dict[str, Any]:
    return _svc(s, inv_id).metrics(inv_id, f, asset)


@router.get("/investigations/{inv_id}/matrix")
def matrix(inv_id: str, measure: Literal["count", "value"] = "count", asset: str | None = None,
           limit: int = Query(60, ge=2, le=200), order: Literal["volume", "hop", "community", "address"] = "volume",
           f: AnalysisFilter = Depends(analysis_filter), s: Services = Depends(services)) -> dict[str, Any]:
    try:
        return _svc(s, inv_id).matrix(inv_id, f, measure=measure, asset_key=asset.lower() if asset else None,
                                      limit=limit, order=order)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/investigations/{inv_id}/timeline")
def tl(inv_id: str, buckets: int = Query(60, ge=5, le=500), f: AnalysisFilter = Depends(analysis_filter),
       s: Services = Depends(services)) -> dict[str, Any]:
    return _svc(s, inv_id).timeline(inv_id, f, buckets)


@router.get("/investigations/{inv_id}/snapshot")
def snap(inv_id: str, at: float, window_start: float | None = None, f: AnalysisFilter = Depends(analysis_filter),
         s: Services = Depends(services)) -> dict[str, Any]:
    return _svc(s, inv_id).snapshot(inv_id, f, at, window_start)


@router.get("/investigations/{inv_id}/evidence")
def evidence(inv_id: str, kind: str | None = None, address: str | None = None, s: Services = Depends(services)) -> dict[str, Any]:
    b = _svc(s, inv_id).load(inv_id)
    evs = [e for e in b.evidence if (not kind or e.kind.value == kind) and (not address or e.subject_address == address.lower())]
    return {"items": [e.model_dump(mode="json") for e in evs], "source_status": b.source_status}


@router.get("/investigations/{inv_id}/fusion")
def fusion(inv_id: str, f: AnalysisFilter = Depends(analysis_filter), s: Services = Depends(services)) -> dict[str, Any]:
    inv = s.investigations.get(inv_id)
    analyst = s.cases.relationships(inv["case_id"]) if inv.get("case_id") else []
    return _svc(s, inv_id).fusion(inv_id, f, analyst)


@router.get("/investigations/{inv_id}/scores")
def scores(inv_id: str, f: AnalysisFilter = Depends(analysis_filter), s: Services = Depends(services)) -> dict[str, Any]:
    from ...analysis.scoring import scoring_spec
    return {"spec": scoring_spec(), "scores": _svc(s, inv_id).scores(inv_id, f)}


@router.post("/investigations/{inv_id}/scores")
def rescore(inv_id: str, cfg: ScoringConfig, f: AnalysisFilter = Depends(analysis_filter), s: Services = Depends(services)) -> dict[str, Any]:
    from ...analysis.scoring import SIGNALS, scoring_spec
    unknown = (set(cfg.weights) | set(cfg.disabled)) - set(SIGNALS)
    if unknown:
        raise HTTPException(422, f"unknown signals: {sorted(unknown)}")
    return {"spec": scoring_spec(), "config": cfg.model_dump(), "scores": _svc(s, inv_id).scores(inv_id, f, cfg)}


@router.get("/investigations/{inv_id}/crosschain")
def crosschain(inv_id: str, s: Services = Depends(services)) -> dict[str, Any]:
    b = _svc(s, inv_id).load(inv_id)
    return {"links": b.crosschain, "privacy_gaps": b.privacy_gaps}


@router.get("/investigations/{inv_id}/report.json")
def report_json(inv_id: str, s: Services = Depends(services)) -> Response:
    _svc(s, inv_id)
    body = json.dumps(build_report(s, inv_id), indent=2, default=str)
    return Response(body, media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="tracefuse-{inv_id}.json"'})


@router.get("/investigations/{inv_id}/report.html")
def report_html(inv_id: str, download: bool = False, s: Services = Depends(services)) -> HTMLResponse:
    _svc(s, inv_id)
    headers = {"Content-Disposition": f'attachment; filename="tracefuse-{inv_id}.html"'} if download else {}
    return HTMLResponse(render_html(build_report(s, inv_id)), headers=headers)


@router.get("/investigations/{inv_id}/export/{kind}.csv")
def export_csv(inv_id: str, kind: Literal["transfers", "scores", "evidence"], s: Services = Depends(services)) -> Response:
    _svc(s, inv_id)
    r = build_report(s, inv_id)
    body = {"transfers": transfers_csv, "scores": scores_csv, "evidence": evidence_csv}[kind](r)
    return Response(body, media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="tracefuse-{inv_id}-{kind}.csv"'})
