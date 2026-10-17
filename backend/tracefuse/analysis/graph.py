"""Directed wallet graph: addresses are nodes, observed transfers are (aggregated) edges.

No edge or grouping here implies common ownership — co-location in a component only means observed
value movement connects the addresses within the fetched, bounded neighbourhood.
"""

from __future__ import annotations

from collections import defaultdict, deque
from typing import Any

import networkx as nx

from ..domain.amounts import format_decimal, to_display
from ..domain.models import Transfer


def edge_id(src: str, dst: str) -> str:
    return f"{src}->{dst}"


def build_multigraph(transfers: list[Transfer]) -> nx.MultiDiGraph:
    g = nx.MultiDiGraph()
    for t in transfers:
        if not t.to_address:
            continue
        g.add_edge(t.from_address, t.to_address, key=t.id, transfer=t)
    return g


def aggregate_edges(transfers: list[Transfer]) -> list[dict[str, Any]]:
    groups: dict[tuple[str, str], list[Transfer]] = defaultdict(list)
    for t in transfers:
        if t.to_address:
            groups[(t.from_address, t.to_address)].append(t)
    out = []
    for (src, dst), ts in groups.items():
        totals: dict[str, dict[str, Any]] = {}
        for t in ts:
            a = totals.setdefault(t.asset.key, {"asset_key": t.asset.key, "symbol": t.asset.symbol,
                                                "decimals": t.asset.decimals, "recognised": t.asset.recognised,
                                                "raw": 0, "count": 0})
            a["raw"] += t.raw_int
            a["count"] += 1
        for a in totals.values():
            d = to_display(a["raw"], a["decimals"])
            a["amount"] = format_decimal(d) if d is not None else None
            a["raw"] = str(a["raw"])
        stamps = [t.ts for t in ts if t.ts is not None]
        out.append({
            "id": edge_id(src, dst),
            "source": src,
            "target": dst,
            "count": len(ts),
            "transfer_ids": [t.id for t in ts],
            "tx_hashes": sorted({t.tx_hash for t in ts}),
            "totals": sorted(totals.values(), key=lambda x: (not x["recognised"], x["symbol"])),
            "kinds": sorted({t.kind.value for t in ts}),
            "value_bearing": any(t.raw_int > 0 for t in ts),
            "self_transfer": src == dst,
            "first_ts": min(stamps) if stamps else None,
            "last_ts": max(stamps) if stamps else None,
            "relationship": "observed_transfer",
            "assertion_status": "verified_onchain",
        })
    out.sort(key=lambda e: (e["first_ts"] or 0, e["id"]))
    return out


def hop_distances(transfers: list[Transfer], seeds: list[str]) -> dict[str, dict[str, int | None]]:
    """Shortest hop counts from the seed set: forward (following transfer direction), backward, undirected."""
    succ: dict[str, set[str]] = defaultdict(set)
    pred: dict[str, set[str]] = defaultdict(set)
    nodes: set[str] = set()
    for t in transfers:
        if not t.to_address or t.is_self_transfer:
            continue
        succ[t.from_address].add(t.to_address)
        pred[t.to_address].add(t.from_address)
        nodes.update((t.from_address, t.to_address))
    nodes.update(seeds)

    def bfs(adj_fns: list[dict[str, set[str]]]) -> dict[str, int]:
        dist = {s: 0 for s in seeds}
        q = deque(seeds)
        while q:
            u = q.popleft()
            for adj in adj_fns:
                for v in adj.get(u, ()):
                    if v not in dist:
                        dist[v] = dist[u] + 1
                        q.append(v)
        return dist

    fwd, bwd, und = bfs([succ]), bfs([pred]), bfs([succ, pred])
    return {n: {"forward": fwd.get(n), "backward": bwd.get(n), "undirected": und.get(n)} for n in nodes}


def components(transfers: list[Transfer]) -> list[list[str]]:
    g = nx.DiGraph()
    for t in transfers:
        if t.to_address:
            g.add_edge(t.from_address, t.to_address)
    comps = [sorted(c) for c in nx.weakly_connected_components(g)]
    comps.sort(key=lambda c: (-len(c), c[0]))
    return comps


def paths_between(transfers: list[Transfer], source: str, target: str, max_len: int = 5, limit: int = 20) -> list[list[str]]:
    g = nx.DiGraph()
    for t in transfers:
        if t.to_address and not t.is_self_transfer:
            g.add_edge(t.from_address, t.to_address)
    if source not in g or target not in g:
        return []
    out = []
    for p in nx.all_simple_paths(g, source, target, cutoff=max_len):
        out.append(p)
        if len(out) >= limit:
            break
    return out
