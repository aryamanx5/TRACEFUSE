"""Evidence Fusion Graph: typed entities + typed relationships with assertion status and provenance."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from ..domain.models import Evidence, EvidenceKind
from .graph import aggregate_edges

RELATIONSHIP_TYPES = {
    "observed_transfer": "verified_onchain",
    "documented_bridge_event": "verified_onchain",
    "exact_public_source_match": "external_assertion",
    "source_reported_label": "external_assertion",
    "sanctions_listing": "external_assertion",
    "sanctions_history": "external_assertion",
    "threat_intel_flag": "external_assertion",
    "public_report": "external_assertion",
    "heuristic_candidate": "algorithmic_inference",
    "coordinated_split": "algorithmic_inference",
    "analyst_note": "analyst_hypothesis",
}

_EV_REL = {
    EvidenceKind.ADDRESS_MENTION: ("document", "exact_public_source_match", "weak"),
    EvidenceKind.SOURCE_REPORTED_LABEL: ("label", "source_reported_label", "moderate"),
    EvidenceKind.SANCTIONS_LISTING: ("sanctions_entry", "sanctions_listing", "confirmed"),
    EvidenceKind.SANCTIONS_HISTORY: ("sanctions_notice", "sanctions_history", "confirmed"),
    EvidenceKind.THREAT_INTEL_FLAG: ("intel_indicator", "threat_intel_flag", "moderate"),
    EvidenceKind.KNOWN_MALICIOUS_CODE: ("intel_indicator", "threat_intel_flag", "moderate"),
    EvidenceKind.PUBLIC_REPORT: ("public_report", "public_report", "strong"),
}


def wallet_id(chain: str, addr: str) -> str:
    return f"wallet:{chain}:{addr}"


def build_fusion(
    *,
    chain: str,
    transfers: list[Any],
    node_meta: dict[str, dict[str, Any]],
    evidence: list[Evidence],
    crosschain: list[dict[str, Any]],
    split_sets: list[dict[str, Any]],
    scores: dict[str, dict[str, Any]],
    analyst_relationships: list[dict[str, Any]] | None = None,
    seeds: list[str] | None = None,
    privacy_gaps: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    entities: dict[str, dict[str, Any]] = {}
    rels: list[dict[str, Any]] = []
    seeds = seeds or []

    def wallet(addr: str, ch: str = chain) -> str:
        eid = wallet_id(ch, addr)
        if eid not in entities:
            m = node_meta.get(addr, {}) if ch == chain else {}
            entities[eid] = {"id": eid, "type": "contract" if m.get("is_contract") else "wallet", "chain": ch,
                             "address": addr, "labels": [lb.get("label") for lb in m.get("labels") or []][:6],
                             "is_seed": addr in seeds and ch == chain,
                             "score": (scores.get(addr) or {}).get("score"), "band": (scores.get(addr) or {}).get("band"),
                             "expansion_status": m.get("expansion_status")}
        return eid

    for e in aggregate_edges([t for t in transfers if t.success]):
        rels.append({"id": f"rel:transfer:{e['id']}", "type": "observed_transfer", "assertion_status": "verified_onchain",
                     "source": wallet(e["source"]), "target": wallet(e["target"]), "confidence": "confirmed",
                     "evidence": {"tx_hashes": e["tx_hashes"][:50], "transfer_ids": e["transfer_ids"][:200],
                                  "totals": e["totals"], "first_ts": e["first_ts"], "last_ts": e["last_ts"]},
                     "method": "normalised provider transfer records", "caveats": [], "first_ts": e["first_ts"]})

    # evidence-derived relationships (dedup entities by source item)
    for ev in evidence:
        etype, rtype, _conf = _EV_REL.get(ev.kind, ("source", "public_report", "weak"))
        src_key = ev.source_item_id or ev.source_url or ev.id
        sid = f"{etype}:{src_key}"
        if sid not in entities:
            entities[sid] = {"id": sid, "type": etype, "title": ev.title, "source": ev.source, "url": ev.source_url,
                             "published_at": ev.published_at.isoformat() if ev.published_at else None}
        target = wallet(ev.subject_address, ev.subject_chain or chain) if ev.subject_address else None
        if target is None and ev.subject_tx:
            target = f"tx:{ev.subject_chain or chain}:{ev.subject_tx}"
            entities.setdefault(target, {"id": target, "type": "transaction", "chain": ev.subject_chain or chain,
                                         "tx_hash": ev.subject_tx})
        if target is None:
            continue
        rels.append({"id": f"rel:{ev.id}", "type": rtype, "assertion_status": RELATIONSHIP_TYPES[rtype],
                     "source": sid, "target": target, "confidence": ev.confidence.value, "evidence_id": ev.id,
                     "evidence": {"url": ev.source_url, "snippet": ev.snippet, "match_criteria": ev.match_criteria,
                                  "match_location": ev.match_location, "published_at": ev.published_at.isoformat()
                                  if ev.published_at else None, "collected_at": ev.collected_at.isoformat(),
                                  "provider": ev.source, "data_origin": ev.data_origin.value},
                     "method": ev.match_criteria, "caveats": ev.caveats, "first_ts": ev.published_at.timestamp()
                     if ev.published_at else None})
        # co-mentioned addresses that are in the graph get their own (weak) match edge from the same document
        for co in (ev.attributes.get("co_mentioned_indicators") or []) if ev.kind == EvidenceKind.ADDRESS_MENTION else []:
            if co in node_meta:
                rels.append({"id": f"rel:{ev.id}:co:{co}", "type": "exact_public_source_match",
                             "assertion_status": "external_assertion", "source": sid, "target": wallet(co),
                             "confidence": "weak", "evidence_id": ev.id,
                             "evidence": {"url": ev.source_url, "snippet": ev.snippet, "match_criteria": "co-mentioned in same document"},
                             "method": "co-mention", "caveats": ["Co-mention in one document does not link the addresses' owners."],
                             "first_ts": None})

    # registry / explorer labels without separate evidence objects
    for addr, m in node_meta.items():
        for lb in m.get("labels") or []:
            if lb.get("source") not in ("tracefuse-registry", "blockscout-metadata", "blockscout-public-tags", "ofac-recent-actions"):
                continue
            lid = f"label:{lb.get('source')}:{lb.get('label')}"
            entities.setdefault(lid, {"id": lid, "type": "label", "title": lb.get("label"), "source": lb.get("source"),
                                      "url": lb.get("source_url"), "category": lb.get("category")})
            rels.append({"id": f"rel:label:{addr}:{lid}", "type": "source_reported_label",
                         "assertion_status": "external_assertion", "source": lid, "target": wallet(addr),
                         "confidence": "strong" if lb.get("source") == "tracefuse-registry" else "moderate",
                         "evidence": {"url": lb.get("source_url"), "snippet": lb.get("note"), "provider": lb.get("source")},
                         "method": "label lookup by exact address", "caveats": [
                             "Label asserted by the named source; not independently verified by TRACEFUSE."], "first_ts": None})

    for cc in crosschain:
        bid = f"bridge_event:{cc['source_chain']}:{cc['source_tx']}"
        entities[bid] = {"id": bid, "type": "bridge_event", "title": f"{cc['bridge_label']} ({cc['status']})",
                         "chain": cc["source_chain"], "tx_hash": cc["source_tx"], "status": cc["status"]}
        rels.append({"id": f"rel:{bid}:in", "type": "observed_transfer", "assertion_status": "verified_onchain",
                     "source": wallet(cc["sender"]), "target": bid, "confidence": "confirmed",
                     "evidence": {"tx_hashes": [cc["source_tx"]]}, "method": "transfer into bridge contract",
                     "caveats": [], "first_ts": cc.get("source_timestamp")})
        for lk in cc.get("links") or []:
            dest_chain = lk.get("destination_chain")
            tgt = wallet(lk["recipient"], dest_chain) if lk.get("recipient") else f"tx:{dest_chain}:{lk['destination_tx']}"
            if not lk.get("recipient"):
                entities.setdefault(tgt, {"id": tgt, "type": "transaction", "chain": dest_chain, "tx_hash": lk["destination_tx"]})
            deterministic = lk.get("status") in ("confirmed", "derived")
            rels.append({"id": f"rel:{bid}:{lk['destination_tx']}", "type": "documented_bridge_event" if deterministic else "heuristic_candidate",
                         "assertion_status": "verified_onchain" if deterministic else "algorithmic_inference",
                         "source": bid, "target": tgt,
                         "confidence": "confirmed" if lk.get("status") == "confirmed" else "strong" if deterministic else "weak",
                         "evidence": {"for": cc["evidence_for"], "against": cc["evidence_against"], "link": lk},
                         "method": cc.get("method"), "caveats": [cc.get("uncertainty")] if cc.get("uncertainty") else [],
                         "first_ts": cc.get("source_timestamp")})

    for si, s in enumerate(split_sets):
        for r in s["recipients"]:
            # one sender can have several split sets (e.g. 500 ETH and 750 ETH tranches) to the same recipient
            rels.append({"id": f"rel:split:{si}:{s['sender']}:{r}:{s['asset_key']}", "type": "coordinated_split",
                         "assertion_status": "algorithmic_inference", "source": wallet(s["sender"]), "target": wallet(r),
                         "confidence": "weak", "evidence": {"transfer_ids": s["transfer_ids"], "amount_low": s["amount_low"],
                                                            "amount_high": s["amount_high"], "symbol": s["symbol"]},
                         "method": s["method"], "caveats": ["Equal splits are common in legitimate treasury operations too."],
                         "first_ts": None})

    for g in privacy_gaps or []:
        entities.setdefault(wallet(g["address"]), {})
        entities[wallet(g["address"])]["privacy_gap"] = g["explanation"]

    for a in analyst_relationships or []:
        for side in ("source_entity", "target_entity"):
            entities.setdefault(a[side], {"id": a[side], "type": "analyst_entity", "title": a[side]})
        rels.append({"id": f"rel:{a['id']}", "type": "analyst_note", "assertion_status": "analyst_hypothesis",
                     "source": a["source_entity"], "target": a["target_entity"], "confidence": "unverified",
                     "evidence": {"rationale": a["rationale"], "relation": a["relation"], "created_at": a["created_at"]},
                     "method": "analyst-entered hypothesis", "caveats": ["Unverified analyst hypothesis."], "first_ts": None})

    unique: dict[str, dict[str, Any]] = {}
    for rel in rels:
        unique.setdefault(rel["id"], rel)  # identical assertions repeated by a source collapse to one edge
    rels = list(unique.values())
    return {"entities": list(entities.values()), "relationships": rels, "conflicts": detect_conflicts(evidence, node_meta),
            "relationship_types": RELATIONSHIP_TYPES}


def detect_conflicts(evidence: list[Evidence], node_meta: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Surface competing evidence instead of forcing one story."""
    by: dict[str, list[Evidence]] = defaultdict(list)
    for e in evidence:
        if e.subject_address:
            by[e.subject_address].append(e)
    out = []
    for addr, evs in by.items():
        listed = any(e.kind == EvidenceKind.SANCTIONS_LISTING for e in evs)
        history = sorted((e for e in evs if e.kind == EvidenceKind.SANCTIONS_HISTORY),
                         key=lambda e: e.published_at.timestamp() if e.published_at else 0)
        goplus_sanctioned = any("sanctioned" in (e.attributes.get("flags") or []) for e in evs)
        label_sanctioned = any(lb.get("category") == "sanctioned" for lb in node_meta.get(addr, {}).get("labels") or [])
        if history and history[-1].attributes.get("action") == "removal" and (goplus_sanctioned or label_sanctioned):
            out.append({"address": addr, "type": "sanctions_status_changed",
                        "summary": "A third-party source still flags the address as sanctioned, but the latest official "
                                   "OFAC notice in the dataset is a removal.",
                        "evidence_ids": [e.id for e in evs if e.kind in (EvidenceKind.SANCTIONS_HISTORY, EvidenceKind.THREAT_INTEL_FLAG)]})
        elif (goplus_sanctioned or label_sanctioned) and not listed and not history:
            out.append({"address": addr, "type": "unconfirmed_sanctions_claim",
                        "summary": "A third-party source flags the address as sanctioned, but no match exists in the "
                                   "imported OFAC SDN dataset (could be a different list/jurisdiction or a stale flag).",
                        "evidence_ids": [e.id for e in evs if e.kind == EvidenceKind.THREAT_INTEL_FLAG]})
        if len({e.attributes.get("action") for e in history}) > 1:
            out.append({"address": addr, "type": "sanctions_history",
                        "summary": "Official notices show both designation and removal actions over time: "
                                   + "; ".join(f"{e.attributes.get('action_date')} {e.attributes.get('action')}" for e in history),
                        "evidence_ids": [e.id for e in history]})
    return out
