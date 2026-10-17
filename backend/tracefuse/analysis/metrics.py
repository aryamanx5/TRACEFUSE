"""Quantitative metrics computed from deduplicated, normalised transfers.

All totals use exact integers per asset. Floats are used only for ratios, centralities and chart bins.
None of these metrics alone indicates malicious intent or common ownership.
"""

from __future__ import annotations

import math
import statistics
from collections import defaultdict
from decimal import Decimal
from typing import Any

import networkx as nx

from ..domain.amounts import format_decimal, relative_difference, to_display
from ..domain.models import Transfer
from .graph import components, hop_distances

METRIC_CATALOG: dict[str, dict[str, str]] = {
    "hop": {"unit": "hops", "description": "Shortest observed path length from the seed (forward / backward / undirected).",
            "requires": "seed + transfers", "limitations": "Only within the fetched, bounded neighbourhood."},
    "in_count": {"unit": "transfers", "description": "Value-bearing transfers received.", "requires": "transfers",
                 "limitations": "Counts only fetched records within the filter."},
    "out_count": {"unit": "transfers", "description": "Value-bearing transfers sent.", "requires": "transfers",
                  "limitations": "Counts only fetched records within the filter."},
    "fan_in": {"unit": "addresses", "description": "Distinct senders to this address.", "requires": "transfers",
               "limitations": "Unexpanded counterparties show partial degree."},
    "fan_out": {"unit": "addresses", "description": "Distinct recipients from this address.", "requires": "transfers",
                "limitations": "Unexpanded counterparties show partial degree."},
    "totals": {"unit": "asset units", "description": "Exact per-asset received / sent totals.", "requires": "decimals",
               "limitations": "Different assets are never summed; no USD conversion."},
    "frequency_per_day": {"unit": "transfers/day", "description": "Transfers divided by active span (min 1 day).",
                          "requires": "timestamps", "limitations": "Null when no timestamps."},
    "median_dwell_seconds": {"unit": "seconds", "description": "Median time between receiving an asset and the next "
                             "send of the same economic asset.", "requires": "in+out with timestamps",
                             "limitations": "Does not prove the same coins moved (fungibility)."},
    "pass_through_ratio": {"unit": "ratio", "description": "Sent / received for the dominant asset.",
                           "requires": "in and out of same asset", "limitations": "Pre-window balances are unknown."},
    "pagerank": {"unit": "score", "description": "PageRank on the transfer-count weighted digraph.",
                 "requires": "≥2 nodes", "limitations": "Reflects fetched topology only."},
    "betweenness": {"unit": "score", "description": "Normalised betweenness centrality (directed).",
                    "requires": "≥3 nodes; computed up to 600 nodes", "limitations": "Bounded graph; sampling avoided."},
    "community": {"unit": "id", "description": "Louvain community (undirected, seed=7) for layout grouping.",
                  "requires": "≥2 nodes", "limitations": "Communities are structural, not ownership clusters."},
    "component": {"unit": "id", "description": "Weakly connected component index.", "requires": "transfers",
                  "limitations": "Within the fetched data only."},
}


def _asset_display(raw: int, decimals: int | None) -> str | None:
    d = to_display(raw, decimals)
    return format_decimal(d) if d is not None else None


def node_metrics(transfers: list[Transfer], seeds: list[str]) -> dict[str, dict[str, Any]]:
    vt = [t for t in transfers if t.to_address and t.raw_int > 0 and t.success]
    nodes: set[str] = set(seeds)
    for t in transfers:
        nodes.add(t.from_address)
        if t.to_address:
            nodes.add(t.to_address)
    hops = hop_distances(transfers, seeds)
    comp_index = {a: i for i, c in enumerate(components(transfers)) for a in c}

    m: dict[str, dict[str, Any]] = {
        n: {"in_count": 0, "out_count": 0, "senders": set(), "recipients": set(), "in_raw": defaultdict(int),
            "out_raw": defaultdict(int), "assets": {}, "stamps": [], "ins": defaultdict(list), "outs": defaultdict(list)}
        for n in nodes
    }
    for t in vt:
        a, b = t.from_address, t.to_address
        assert b is not None
        if a == b:
            continue  # self-transfers don't change position; shown in edge list but excluded from flow metrics
        key = t.asset.key
        econ = t.asset.economic_asset or key
        m[a]["out_count"] += 1
        m[a]["recipients"].add(b)
        m[a]["out_raw"][key] += t.raw_int
        m[a]["assets"][key] = t.asset
        m[b]["in_count"] += 1
        m[b]["senders"].add(a)
        m[b]["in_raw"][key] += t.raw_int
        m[b]["assets"][key] = t.asset
        if t.ts is not None:
            m[a]["stamps"].append(t.ts)
            m[b]["stamps"].append(t.ts)
            m[a]["outs"][econ].append(t.ts)
            m[b]["ins"][econ].append(t.ts)

    # centralities
    g = nx.DiGraph()
    g.add_nodes_from(nodes)
    for t in vt:
        if t.to_address and t.to_address != t.from_address:
            w = g.get_edge_data(t.from_address, t.to_address, {}).get("weight", 0)
            g.add_edge(t.from_address, t.to_address, weight=w + 1)
    pr: dict[str, float] = {}
    bc: dict[str, float] = {}
    comm: dict[str, int] = {}
    if g.number_of_nodes() >= 2 and g.number_of_edges() > 0:
        try:
            pr = nx.pagerank(g, weight="weight")
        except (nx.PowerIterationFailedConvergence, ImportError):
            pr = {}
        if 3 <= g.number_of_nodes() <= 600:
            bc = nx.betweenness_centrality(g, normalized=True)
        try:
            for i, c in enumerate(nx.community.louvain_communities(g.to_undirected(), seed=7)):
                for n in c:
                    comm[n] = i
        except Exception:  # pragma: no cover - defensive; community is display-only
            comm = {}

    out: dict[str, dict[str, Any]] = {}
    for n, d in m.items():
        stamps = sorted(d["stamps"])
        span_days = ((stamps[-1] - stamps[0]) / 86400) if len(stamps) >= 2 else None
        totals = []
        for key, asset in d["assets"].items():
            totals.append({
                "asset_key": key, "symbol": asset.symbol, "recognised": asset.recognised,
                "in_raw": str(d["in_raw"][key]), "out_raw": str(d["out_raw"][key]),
                "in": _asset_display(d["in_raw"][key], asset.decimals),
                "out": _asset_display(d["out_raw"][key], asset.decimals),
            })
        totals.sort(key=lambda x: (not x["recognised"], x["symbol"]))
        # dwell: for each receipt, time until next send of the same economic asset
        dwells: list[float] = []
        for econ, ins in d["ins"].items():
            outs = sorted(d["outs"].get(econ, []))
            for tin in ins:
                nxt = next((o for o in outs if o >= tin), None)
                if nxt is not None:
                    dwells.append(nxt - tin)
        # pass-through for dominant recognised asset (by received raw relative share is not comparable
        # across decimals; choose asset with most transfers)
        ptr = None
        if d["assets"]:
            dom = max(d["assets"], key=lambda k: (d["assets"][k].recognised, d["in_raw"][k] > 0, d["out_raw"][k] > 0))
            if d["in_raw"][dom] > 0:
                ptr = float(Decimal(d["out_raw"][dom]) / Decimal(d["in_raw"][dom]))
        h = hops.get(n, {})
        out[n] = {
            "address": n,
            "hop": h,
            "in_count": d["in_count"],
            "out_count": d["out_count"],
            "fan_in": len(d["senders"]),
            "fan_out": len(d["recipients"]),
            "totals": totals,
            "first_seen": stamps[0] if stamps else None,
            "last_seen": stamps[-1] if stamps else None,
            "active_span_days": round(span_days, 4) if span_days is not None else None,
            "frequency_per_day": round((d["in_count"] + d["out_count"]) / max(span_days or 0, 1.0), 4) if stamps else None,
            "median_dwell_seconds": statistics.median(dwells) if dwells else None,
            "pass_through_ratio": round(ptr, 6) if ptr is not None else None,
            "pagerank": round(pr[n], 6) if n in pr else None,
            "betweenness": round(bc[n], 6) if n in bc else None,
            "community": comm.get(n),
            "component": comp_index.get(n),
        }
    return out


def graph_stats(transfers: list[Transfer]) -> dict[str, Any]:
    nodes: set[str] = set()
    edges: set[tuple[str, str]] = set()
    per_asset: dict[str, dict[str, Any]] = {}
    missing_ts = 0
    stamps: list[float] = []
    for t in transfers:
        nodes.add(t.from_address)
        if t.to_address:
            nodes.add(t.to_address)
            edges.add((t.from_address, t.to_address))
        if t.ts is None:
            missing_ts += 1
        else:
            stamps.append(t.ts)
        if t.raw_int > 0 and t.success:
            a = per_asset.setdefault(t.asset.key, {"asset_key": t.asset.key, "symbol": t.asset.symbol,
                                                   "decimals": t.asset.decimals, "recognised": t.asset.recognised,
                                                   "raw": 0, "count": 0})
            a["raw"] += t.raw_int
            a["count"] += 1
    for a in per_asset.values():
        a["amount"] = _asset_display(a["raw"], a["decimals"])
        a["raw"] = str(a["raw"])
    n = len(nodes)
    return {
        "nodes": n,
        "edges": len(edges),
        "transfers": len(transfers),
        "value_bearing_transfers": sum(1 for t in transfers if t.raw_int > 0 and t.success),
        "components": len(components(transfers)),
        "density": round(len(edges) / (n * (n - 1)), 6) if n > 1 else 0.0,
        "first_ts": min(stamps) if stamps else None,
        "last_ts": max(stamps) if stamps else None,
        "missing_timestamps": missing_ts,
        "asset_totals_note": "per-asset sums of value-bearing transfers inside the filter; assets never summed together",
        "assets": sorted(per_asset.values(), key=lambda x: (not x["recognised"], -x["count"])),
    }


def amount_distribution(transfers: list[Transfer], asset_key: str) -> dict[str, Any]:
    vals = [Decimal(t.amount) for t in transfers if t.asset.key == asset_key and t.amount and t.raw_int > 0 and t.success]
    if not vals:
        return {"asset_key": asset_key, "bins": [], "count": 0}
    logs = [math.log10(float(v)) for v in vals]
    lo, hi = math.floor(min(logs)), math.ceil(max(logs))
    hi = max(hi, lo + 1)
    bins = [{"from": f"1e{e}", "to": f"1e{e + 1}", "count": 0} for e in range(lo, hi)]
    for x in logs:
        idx = min(int(math.floor(x)) - lo, len(bins) - 1)
        bins[idx]["count"] += 1
    srt = sorted(vals)
    return {"asset_key": asset_key, "count": len(vals), "bins": bins, "scale": "log10",
            "min": format_decimal(srt[0]), "max": format_decimal(srt[-1]), "median": format_decimal(srt[len(srt) // 2])}


def split_sets(transfers: list[Transfer], tolerance: float = 0.01, min_size: int = 3) -> list[dict[str, Any]]:
    """Near-equal outgoing amounts from one sender (same asset) to ≥2 distinct recipients."""
    by: dict[tuple[str, str], list[Transfer]] = defaultdict(list)
    for t in transfers:
        if t.to_address and t.raw_int > 0 and t.success and not t.is_self_transfer:
            by[(t.from_address, t.asset.key)].append(t)
    out = []
    for (sender, asset), ts in by.items():
        ts.sort(key=lambda t: t.raw_int)
        group: list[Transfer] = []
        for t in ts + [None]:  # type: ignore[list-item]
            if t is not None and group and relative_difference(group[0].raw_int, t.raw_int) <= tolerance:
                group.append(t)
                continue
            if len(group) >= min_size and len({g.to_address for g in group}) >= 2:
                out.append({
                    "sender": sender, "asset_key": asset, "symbol": group[0].asset.symbol, "size": len(group),
                    "recipients": sorted({g.to_address for g in group if g.to_address}),
                    "amount_low": group[0].amount, "amount_high": group[-1].amount,
                    "transfer_ids": [g.id for g in group], "tolerance": tolerance,
                    "method": f"sorted amounts within {tolerance:.0%} relative difference of the group minimum",
                })
            group = [t] if t is not None else []
    return out


def fan_out_bursts(transfers: list[Transfer], window_seconds: int = 3600, min_recipients: int = 3) -> list[dict[str, Any]]:
    by: dict[str, list[Transfer]] = defaultdict(list)
    for t in transfers:
        if t.to_address and t.raw_int > 0 and t.success and t.ts is not None and not t.is_self_transfer:
            by[t.from_address].append(t)
    out = []
    for sender, ts in by.items():
        ts.sort(key=lambda t: t.ts or 0)
        i = 0
        best: list[Transfer] = []
        for j in range(len(ts)):
            while (ts[j].ts or 0) - (ts[i].ts or 0) > window_seconds:
                i += 1
            win = ts[i : j + 1]
            if len({w.to_address for w in win}) > len({b.to_address for b in best}):
                best = win
        if len({b.to_address for b in best}) >= min_recipients:
            out.append({"sender": sender, "recipients": sorted({b.to_address for b in best if b.to_address}),
                        "start_ts": best[0].ts, "end_ts": best[-1].ts, "transfer_ids": [b.id for b in best],
                        "window_seconds": window_seconds})
    return out


def pass_through_links(transfers: list[Transfer], max_delay_seconds: int = 6 * 3600, min_ratio: float = 0.9) -> list[dict[str, Any]]:
    """Receipts followed by a send of ≥min_ratio of the same economic asset within max_delay (relay behaviour)."""
    ins: dict[str, list[Transfer]] = defaultdict(list)
    outs: dict[str, list[Transfer]] = defaultdict(list)
    for t in transfers:
        if t.to_address and t.raw_int > 0 and t.success and t.ts is not None and not t.is_self_transfer:
            ins[t.to_address].append(t)
            outs[t.from_address].append(t)
    links = []
    for node, received in ins.items():
        sent = sorted(outs.get(node, []), key=lambda t: t.ts or 0)
        for r in received:
            econ = r.asset.economic_asset or r.asset.key
            window = [s for s in sent if (r.ts or 0) <= (s.ts or 0) <= (r.ts or 0) + max_delay_seconds
                      and (s.asset.economic_asset or s.asset.key) == econ and s.asset.decimals == r.asset.decimals]
            total = sum(s.raw_int for s in window)
            if window and total >= int(r.raw_int * min_ratio):
                links.append({"node": node, "in_transfer": r.id, "out_transfers": [s.id for s in window],
                              "delay_seconds": (window[0].ts or 0) - (r.ts or 0),
                              "forwarded_ratio": round(float(Decimal(total) / Decimal(r.raw_int)), 4)})
    return links


def temporal_deltas(transfers: list[Transfer]) -> dict[str, Any]:
    stamps = sorted(t.ts for t in transfers if t.ts is not None)
    deltas = [b - a for a, b in zip(stamps, stamps[1:], strict=False)]
    if not deltas:
        return {"count": 0}
    return {"count": len(deltas), "median_seconds": statistics.median(deltas), "min_seconds": min(deltas),
            "max_seconds": max(deltas), "mean_seconds": round(statistics.fmean(deltas), 3)}
