"""Analysis façade: loads stored investigation data and computes filter-dependent analytics on demand."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..domain.models import Evidence, Transfer
from ..services import Services
from ..storage.repositories import NotFoundError
from . import matrix as matrix_mod
from . import metrics as m
from . import scoring, timeline
from .filters import AnalysisFilter
from .fusion import build_fusion
from .graph import aggregate_edges, components


@dataclass
class Bundle:
    investigation: dict[str, Any]
    transfers: list[Transfer]
    nodes: dict[str, dict[str, Any]]
    evidence: list[Evidence]
    crosschain: list[dict[str, Any]]
    privacy_gaps: list[dict[str, Any]]
    seed: dict[str, Any]
    source_status: list[dict[str, Any]]

    @property
    def seeds(self) -> list[str]:
        return list(self.seed.get("seed_addresses") or [])


_CACHE: dict[str, tuple[str, Bundle]] = {}


class AnalysisService:
    def __init__(self, services: Services):
        self.s = services

    def load(self, inv_id: str, force: bool = False) -> Bundle:
        inv = self.s.investigations.get(inv_id)
        stamp = f"{inv['status']}:{inv.get('finished_at')}"
        hit = _CACHE.get(inv_id)
        if hit and hit[0] == stamp and not force:
            return hit[1]
        repo = self.s.investigations
        b = Bundle(
            investigation=inv,
            transfers=repo.load_transfers(inv_id),
            nodes=repo.load_artifact(inv_id, "nodes", {}) or {},
            evidence=[Evidence.model_validate(e) for e in repo.load_artifact(inv_id, "evidence", []) or []],
            crosschain=repo.load_artifact(inv_id, "crosschain", []) or [],
            privacy_gaps=repo.load_artifact(inv_id, "privacy_gaps", []) or [],
            seed=repo.load_artifact(inv_id, "seed", {}) or {},
            source_status=repo.load_artifact(inv_id, "source_status", []) or [],
        )
        if len(_CACHE) > 16:
            _CACHE.pop(next(iter(_CACHE)))
        _CACHE[inv_id] = (stamp, b)
        return b

    # ------------------------------------------------------------------------------------------
    def _available(self, b: Bundle) -> dict[str, bool]:
        st = {s["source"]: s["state"] for s in b.source_status}
        return {"ofac": st.get("ofac") == "ok", "goplus": st.get("goplus") in ("ok", "partial"),
                "github": st.get("github") in ("ok", "partial"), "labels": st.get("explorer_labels") == "ok"}

    def scores(self, inv_id: str, flt: AnalysisFilter | None = None, cfg: scoring.ScoringConfig | None = None) -> list[dict[str, Any]]:
        b = self.load(inv_id)
        ts = (flt or AnalysisFilter()).apply(b.transfers)
        nm = m.node_metrics(ts, b.seeds)
        direction = b.investigation["config"].get("direction", "forward")
        addrs = sorted(set(nm) | {a for a in b.nodes if a in nm})
        return scoring.score_addresses(
            addresses=addrs, seeds=b.seeds, node_meta=b.nodes, metrics=nm, evidence=b.evidence,
            flow=scoring.flow_shares(ts, b.seeds, direction), relay_links=m.pass_through_links(ts),
            split_sets=m.split_sets(ts), bursts=m.fan_out_bursts(ts), transfers=ts,
            available_sources=self._available(b), config=cfg)

    def summary(self, inv_id: str, force: bool = False) -> dict[str, Any]:
        b = self.load(inv_id, force=force)
        sc = self.scores(inv_id)
        self.s.investigations.save_artifact(inv_id, "scores_default", {"version": scoring.SCORING_VERSION, "scores": sc})
        cands = [r for r in sc if r["category"] == "candidate"]
        stats = m.graph_stats(b.transfers)
        return {"scored": len(sc), "top": [{"address": r["address"], "score": r["score"], "band": r["band"]} for r in cands[:10]],
                "top_band": cands[0]["band"] if cands else None, "stats": {k: stats[k] for k in
                ("nodes", "edges", "transfers", "value_bearing_transfers", "components", "first_ts", "last_ts", "missing_timestamps")},
                "evidence": len(b.evidence), "crosschain": len(b.crosschain)}

    def graph(self, inv_id: str, flt: AnalysisFilter, layout_hint: str | None = None) -> dict[str, Any]:
        b = self.load(inv_id)
        ts = flt.apply(b.transfers)
        nm = m.node_metrics(ts, b.seeds)
        score_by = {r["address"]: r for r in self.scores(inv_id, flt)}
        nodes = []
        for addr, met in nm.items():
            meta = b.nodes.get(addr, {})
            sc = score_by.get(addr, {})
            nodes.append({
                "id": addr, "address": addr, "is_seed": addr in b.seeds, "is_contract": meta.get("is_contract"),
                "name": meta.get("name"), "labels": meta.get("labels") or [],
                "expansion_status": meta.get("expansion_status", "not_expanded"), "expansion_note": meta.get("note"),
                "hop": met["hop"], "in_count": met["in_count"], "out_count": met["out_count"], "fan_in": met["fan_in"],
                "fan_out": met["fan_out"], "community": met["community"], "component": met["component"],
                "pagerank": met["pagerank"], "score": sc.get("score"), "band": sc.get("band"), "category": sc.get("category"),
                "evidence_count": sum(1 for e in b.evidence if e.subject_address == addr),
            })
        nodes.sort(key=lambda n: (not n["is_seed"], (n["hop"] or {}).get("undirected") or 99, n["id"]))
        return {"nodes": nodes, "edges": aggregate_edges(ts), "stats": m.graph_stats(ts), "components": components(ts),
                "seeds": b.seeds, "filter": flt.model_dump(mode="json"),
                "caveat": "Edges are observed transfers. Graph proximity or shared components do not imply common ownership."}

    def node_detail(self, inv_id: str, addr: str, flt: AnalysisFilter) -> dict[str, Any]:
        b = self.load(inv_id)
        addr = addr.lower()
        if addr not in b.nodes and not any(t.from_address == addr or t.to_address == addr for t in b.transfers):
            raise NotFoundError(addr)
        ts = flt.apply(b.transfers)
        nm = m.node_metrics(ts, b.seeds)
        related = [t for t in ts if t.from_address == addr or t.to_address == addr]
        sc = next((r for r in self.scores(inv_id, flt) if r["address"] == addr), None)
        meta = b.nodes.get(addr, {})
        limitations = []
        status = meta.get("expansion_status", "not_expanded")
        if status != "expanded" and status != "seed":
            limitations.append(f"expansion status '{status}': only transfers with expanded neighbours are shown"
                               + (f" ({meta.get('note')})" if meta.get("note") else ""))
        if any(not t.asset.recognised for t in related):
            limitations.append("includes tokens outside the canonical registry (possible spam; symbols unverified)")
        chain = b.investigation["config"]["chain"]
        from ..chains import get_chain
        return {"address": addr, "chain": chain, "explorer_url": get_chain(chain).explorer_address_url(addr),
                "meta": meta, "metrics": nm.get(addr), "score": sc,
                "transfers": [t.model_dump(mode="json") for t in related[:500]], "transfer_count": len(related),
                "evidence": [e.model_dump(mode="json") for e in b.evidence if e.subject_address == addr],
                "crosschain": [c for c in b.crosschain if c["sender"] == addr],
                "privacy_gaps": [g for g in b.privacy_gaps if g["address"] == addr or addr in g.get("senders", [])],
                "limitations": limitations}

    def edge_detail(self, inv_id: str, src: str, dst: str, flt: AnalysisFilter) -> dict[str, Any]:
        b = self.load(inv_id)
        ts = [t for t in flt.apply(b.transfers) if t.from_address == src.lower() and t.to_address == dst.lower()]
        agg = aggregate_edges(ts)
        return {"edge": agg[0] if agg else None, "transfers": [t.model_dump(mode="json") for t in ts]}

    def transfers(self, inv_id: str, ids: list[str] | None = None, address: str | None = None,
                  tx_hash: str | None = None, limit: int = 1000, offset: int = 0) -> dict[str, Any]:
        b = self.load(inv_id)
        ts = b.transfers
        if ids:
            want = set(ids)
            ts = [t for t in ts if t.id in want]
        if address:
            a = address.lower()
            ts = [t for t in ts if t.from_address == a or t.to_address == a]
        if tx_hash:
            ts = [t for t in ts if t.tx_hash == tx_hash.lower()]
        return {"total": len(ts), "items": [t.model_dump(mode="json") for t in ts[offset: offset + limit]]}

    def metrics(self, inv_id: str, flt: AnalysisFilter, asset_key: str | None = None) -> dict[str, Any]:
        b = self.load(inv_id)
        ts = flt.apply(b.transfers)
        stats = m.graph_stats(ts)
        akey = asset_key or (stats["assets"][0]["asset_key"] if stats["assets"] else None)
        return {"stats": stats, "nodes": m.node_metrics(ts, b.seeds), "split_sets": m.split_sets(ts),
                "fan_out_bursts": m.fan_out_bursts(ts), "relay_links": m.pass_through_links(ts),
                "temporal_deltas": m.temporal_deltas(ts),
                "amount_distribution": m.amount_distribution(ts, akey) if akey else None,
                "catalog": m.METRIC_CATALOG,
                "disclaimer": "Splitting, velocity, common destinations or proximity alone do not prove malicious "
                              "intent or common wallet ownership."}

    def matrix(self, inv_id: str, flt: AnalysisFilter, **kw: Any) -> dict[str, Any]:
        b = self.load(inv_id)
        ts = [t for t in flt.apply(b.transfers) if t.raw_int > 0 or flt.include_zero_value]
        nm = m.node_metrics(ts, b.seeds)
        return matrix_mod.build_matrix(ts, node_meta=nm, focus=b.seeds, **kw)

    def timeline(self, inv_id: str, flt: AnalysisFilter, buckets: int = 60) -> dict[str, Any]:
        b = self.load(inv_id)
        return timeline.timeline(flt.apply(b.transfers), buckets=buckets)

    def snapshot(self, inv_id: str, flt: AnalysisFilter, at: float, start: float | None) -> dict[str, Any]:
        b = self.load(inv_id)
        return timeline.snapshot(flt.apply(b.transfers), at, start)

    def fusion(self, inv_id: str, flt: AnalysisFilter, analyst: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        b = self.load(inv_id)
        ts = flt.apply(b.transfers)
        sc = {r["address"]: r for r in self.scores(inv_id, flt)}
        nm_split = m.split_sets(ts)
        return build_fusion(chain=b.investigation["config"]["chain"], transfers=ts, node_meta=b.nodes, evidence=b.evidence,
                            crosschain=b.crosschain, split_sets=nm_split, scores=sc, analyst_relationships=analyst,
                            seeds=b.seeds, privacy_gaps=b.privacy_gaps)
