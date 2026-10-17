"""Directed adjacency matrix (sparse) for Matrix Mode. Rows = senders, columns = recipients."""

from __future__ import annotations

from collections import defaultdict
from typing import Any, Literal

from ..domain.amounts import format_decimal, to_display
from ..domain.models import Transfer

MAX_MATRIX_NODES = 200


def build_matrix(
    transfers: list[Transfer],
    *,
    measure: Literal["count", "value"] = "count",
    asset_key: str | None = None,
    limit: int = 60,
    order: Literal["volume", "hop", "community", "address"] = "volume",
    node_meta: dict[str, dict[str, Any]] | None = None,
    focus: list[str] | None = None,
) -> dict[str, Any]:
    if measure == "value" and not asset_key:
        raise ValueError("measure=value requires asset_key; different assets are never summed")
    limit = max(2, min(limit, MAX_MATRIX_NODES))
    rel = [t for t in transfers if t.to_address and (asset_key is None or t.asset.key == asset_key)]
    activity: dict[str, int] = defaultdict(int)
    for t in rel:
        activity[t.from_address] += 1
        activity[t.to_address or ""] += 1
    all_nodes = [n for n in activity if n]
    meta = node_meta or {}

    def sort_key(n: str) -> tuple:
        h = (meta.get(n, {}).get("hop") or {}).get("undirected")
        if order == "hop":
            return (h if h is not None else 99, -activity[n], n)
        if order == "community":
            return (meta.get(n, {}).get("community") if meta.get(n, {}).get("community") is not None else 999, -activity[n], n)
        if order == "address":
            return (n,)
        return (-activity[n], n)

    ranked = sorted(all_nodes, key=lambda n: (-activity[n], n))
    chosen = set(ranked[:limit])
    for f in focus or []:
        if f in activity:
            chosen.add(f)
    labels = sorted(chosen, key=sort_key)
    index = {n: i for i, n in enumerate(labels)}

    cells: dict[tuple[int, int], dict[str, Any]] = {}
    decimals = None
    symbol = None
    for t in rel:
        r, c = index.get(t.from_address), index.get(t.to_address or "")
        if r is None or c is None:
            continue
        cell = cells.setdefault((r, c), {"row": r, "col": c, "count": 0, "raw": 0, "transfer_ids": []})
        cell["count"] += 1
        cell["raw"] += t.raw_int
        cell["transfer_ids"].append(t.id)
        decimals, symbol = t.asset.decimals, t.asset.symbol
    out_cells = []
    for cell in cells.values():
        d = to_display(cell["raw"], decimals) if asset_key else None
        out_cells.append({**cell, "raw": str(cell["raw"]) if asset_key else None,
                          "amount": format_decimal(d) if d is not None else None,
                          "value": cell["count"] if measure == "count" else (float(d) if d is not None else 0.0)})
    out_cells.sort(key=lambda c: (c["row"], c["col"]))
    vals = [c["value"] for c in out_cells if c["value"]]
    return {
        "measure": measure,
        "asset_key": asset_key,
        "symbol": symbol if asset_key else None,
        "labels": labels,
        "cells": out_cells,
        "max": max(vals) if vals else 0,
        "min_nonzero": min(vals) if vals else 0,
        "scale": "log" if vals and max(vals) / max(min(vals), 1e-18) > 100 else "linear",
        "legend": "Cell colour intensity encodes the measure; empty cells mean no observed transfers in the window.",
        "truncated": {"total_nodes": len(all_nodes), "shown": len(labels), "limit": limit,
                      "is_truncated": len(all_nodes) > len(labels)},
        "ordering": order,
    }
