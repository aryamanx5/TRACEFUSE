"""Shared API dependencies and parameter parsing."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException, Query, Request

from ..analysis.filters import AnalysisFilter
from ..domain.models import TransferKind
from ..pipeline.investigation import JobManager
from ..services import Services


def services(request: Request) -> Services:
    return request.app.state.services


def jobs(request: Request) -> JobManager:
    return request.app.state.jobs


def parse_time(v: str | None, name: str) -> datetime | None:
    if v is None or v == "":
        return None
    try:
        if v.replace(".", "", 1).isdigit():
            return datetime.fromtimestamp(float(v), UTC)
        dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=UTC)
    except (ValueError, OverflowError) as exc:
        raise HTTPException(422, f"{name}: expected ISO-8601 or unix seconds") from exc


def analysis_filter(
    start: str | None = Query(None, description="ISO-8601 or unix seconds"),
    end: str | None = Query(None),
    assets: str | None = Query(None, description="comma-separated asset keys ('native' or token contract)"),
    kinds: str | None = Query(None, description="comma-separated: native,internal,erc20,erc721,erc1155"),
    min_amount: str | None = Query(None),
    include_zero_value: bool = False,
    include_failed: bool = False,
    include_unrecognised: bool = True,
    hide: str | None = Query(None, description="comma-separated addresses to hide"),
) -> AnalysisFilter:
    try:
        ks = [TransferKind(k.strip()) for k in kinds.split(",") if k.strip()] if kinds else None
    except ValueError as exc:
        raise HTTPException(422, f"invalid kind: {exc}") from exc
    try:
        ma = Decimal(min_amount) if min_amount else None
    except InvalidOperation as exc:
        raise HTTPException(422, "min_amount must be a decimal number") from exc
    s, e = parse_time(start, "start"), parse_time(end, "end")
    if s and e and s > e:
        raise HTTPException(422, "start must be before end")
    return AnalysisFilter(
        start=s, end=e, assets=[a.strip().lower() for a in assets.split(",") if a.strip()] if assets else None,
        kinds=ks, min_amount=ma, include_failed=include_failed, include_zero_value=include_zero_value,
        include_unrecognised_tokens=include_unrecognised,
        hidden_addresses=[h.strip().lower() for h in hide.split(",") if h.strip()] if hide else [],
    )
