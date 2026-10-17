"""ChronoReplay: chronological event stream, buckets, gaps and point-in-time graph snapshots."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from ..domain.models import Transfer
from .graph import aggregate_edges
from .metrics import graph_stats


def timeline(transfers: list[Transfer], buckets: int = 60, gap_factor: float = 10.0) -> dict[str, Any]:
    timed = sorted((t for t in transfers if t.ts is not None), key=lambda t: (t.ts or 0, t.id))
    missing = [t.id for t in transfers if t.ts is None]
    events = [{
        "id": t.id, "ts": t.ts, "time": t.timestamp.isoformat() if t.timestamp else None, "tx_hash": t.tx_hash,
        "from": t.from_address, "to": t.to_address, "amount": t.amount, "symbol": t.asset.symbol,
        "asset_key": t.asset.key, "kind": t.kind.value, "explorer_url": t.explorer_url,
    } for t in timed]
    if not timed:
        return {"events": [], "buckets": [], "gaps": [], "missing_timestamps": len(missing),
                "missing_timestamp_ids": missing[:100], "range": None}
    t0, t1 = timed[0].ts or 0.0, timed[-1].ts or 0.0
    span = max(t1 - t0, 1.0)
    width = span / buckets
    bks = [{"start": t0 + i * width, "end": t0 + (i + 1) * width, "count": 0} for i in range(buckets)]
    for t in timed:
        idx = min(int(((t.ts or 0) - t0) / width), buckets - 1)
        bks[idx]["count"] += 1
    deltas = [(b.ts or 0) - (a.ts or 0) for a, b in zip(timed, timed[1:], strict=False)]
    gaps = []
    if deltas:
        med = sorted(deltas)[len(deltas) // 2]
        threshold = max(med * gap_factor, 3600.0)
        for a, b in zip(timed, timed[1:], strict=False):
            d = (b.ts or 0) - (a.ts or 0)
            if d >= threshold:
                gaps.append({"start": a.ts, "end": b.ts, "seconds": d})
    return {
        "events": events,
        "buckets": bks,
        "gaps": gaps,
        "gap_threshold_note": "gap = inter-event interval ≥ max(10× median interval, 1 hour); no data, not necessarily no activity",
        "missing_timestamps": len(missing),
        "missing_timestamp_ids": missing[:100],
        "range": {"start": t0, "end": t1,
                  "start_iso": datetime.fromtimestamp(t0, UTC).isoformat(), "end_iso": datetime.fromtimestamp(t1, UTC).isoformat()},
        "timestamp_quality": "block timestamps (seconds); ordering within a block follows log/trace order where known",
    }


def snapshot(transfers: list[Transfer], at: float, start: float | None = None) -> dict[str, Any]:
    """State of the graph as of time ``at`` (inclusive), optionally from ``start``."""
    visible = [t for t in transfers if t.ts is not None and t.ts <= at and (start is None or t.ts >= start)]
    edges = aggregate_edges(visible)
    nodes = sorted({t.from_address for t in visible} | {t.to_address for t in visible if t.to_address})
    return {
        "at": at,
        "at_iso": datetime.fromtimestamp(at, UTC).isoformat(),
        "start": start,
        "visible_transfer_ids": [t.id for t in visible],
        "visible_nodes": nodes,
        "edges": edges,
        "stats": graph_stats(visible),
        "latest": [t.id for t in sorted(visible, key=lambda t: t.ts or 0)[-5:]],
    }
