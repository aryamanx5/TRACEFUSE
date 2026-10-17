"""Explainable heuristic suspicion score (0–100). NOT a probability; uncalibrated; never an identity claim.

score = 100 × Σ(weight_i × signal_i) / Σ(weight_i over enabled signals). Missing inputs contribute 0 and are
reported (``coverage``). Guards:
- correlated sources: GoPlus 'sanctioned' is ignored when an OFAC listing exists; threat-intel sources sharing
  an upstream are counted once; copied public mentions are de-duplicated by fingerprint/owner.
- behaviour-only cap: without corroboration (sanctions, threat intel, seed-flow ≥5 %, contextual mentions) the
  score is capped at 25 — proximity, activity or bridge use alone never produce a high rank.
- services (bridge / mixer / exchange / DEX contracts) are reported as infrastructure, not ranked as suspects.
"""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field

from ..domain.models import Evidence, EvidenceKind, Transfer
from ..intel.github import has_incident_context

SCORING_VERSION = "tf-heuristic-1.0"

SIGNALS: dict[str, dict[str, Any]] = {
    "sanctions": {"label": "Official sanctions listing (OFAC SDN exact match)", "weight": 0.25, "corroborating": True},
    "threat_intel": {"label": "Threat-intel / source-reported risk label", "weight": 0.20, "corroborating": True},
    "seed_flow": {"label": "Share of seed value reaching the address (flow attribution)", "weight": 0.20, "corroborating": True},
    "relay": {"label": "Relay behaviour (forwards ≥90% of a receipt within 6h)", "weight": 0.08, "corroborating": False},
    "structuring": {"label": "Near-equal split amounts (structuring pattern)", "weight": 0.05, "corroborating": False},
    "fan_out": {"label": "Fan-out burst (≥3 recipients within 1h)", "weight": 0.04, "corroborating": False},
    "privacy_exposure": {"label": "Sent value to mixer / bridge", "weight": 0.08, "corroborating": False},
    "public_mentions": {"label": "Independent public mentions with incident context", "weight": 0.05, "corroborating": True},
    "proximity": {"label": "Graph proximity to the seed", "weight": 0.05, "corroborating": False},
}
RISK_LABEL_CATEGORIES = {"exploit", "exploiter", "phish-hack", "phishing", "scam", "hack", "heist", "blocked", "sanctioned"}
BEHAVIOUR_CAP = 25.0


class ScoringConfig(BaseModel):
    weights: dict[str, float] = Field(default_factory=dict)
    disabled: list[str] = Field(default_factory=list)

    def weight(self, key: str) -> float:
        w = self.weights.get(key, SIGNALS[key]["weight"])
        return max(0.0, min(float(w), 1.0))


def band(score: float) -> str:
    return "high" if score >= 60 else "elevated" if score >= 40 else "moderate" if score >= 20 else "low"


def flow_shares(transfers: list[Transfer], seeds: list[str], direction: str) -> dict[str, float]:
    """Time-consistent proportional attribution of seed value along observed transfers (per economic asset).

    forward: share of the seed's outflow reaching each address; backward: share of the seed's inflow
    originating from each address. Fungibility means this is an attribution heuristic, not coin tracking.
    """
    vt = [t for t in transfers if t.to_address and t.raw_int > 0 and t.success and t.ts is not None
          and not t.is_self_transfer]
    result: dict[str, float] = defaultdict(float)
    dirs = ["forward", "backward"] if direction == "both" else [direction]
    for d in dirs:
        by_asset: dict[str, list[Transfer]] = defaultdict(list)
        for t in vt:
            by_asset[t.asset.economic_asset or t.asset.key].append(t)
        for _asset, ts in by_asset.items():
            share: dict[str, float] = {s: 1.0 for s in seeds}
            since: dict[str, float] = {s: float("-inf") if d == "forward" else float("inf") for s in seeds}
            totals: dict[str, int] = defaultdict(int)
            for t in ts:
                totals[t.from_address if d == "forward" else t.to_address or ""] += t.raw_int
            order = sorted(ts, key=lambda t: t.ts or 0, reverse=(d == "backward"))
            for t in order:
                u, v = (t.from_address, t.to_address or "") if d == "forward" else (t.to_address or "", t.from_address)
                if share.get(u, 0) <= 0:
                    continue
                tt = t.ts or 0
                if (d == "forward" and tt < since[u]) or (d == "backward" and tt > since[u]):
                    continue
                if totals[u] == 0:
                    continue
                contrib = share[u] * float(Decimal(t.raw_int) / Decimal(totals[u]))
                share[v] = min(1.0, max(share.get(v, 0.0), contrib))
                since[v] = min(since.get(v, float("inf")), tt) if d == "forward" else max(since.get(v, float("-inf")), tt)
            for n, s in share.items():
                if n not in seeds:
                    result[n] = max(result[n], s)
    return dict(result)


def score_addresses(
    *,
    addresses: list[str],
    seeds: list[str],
    node_meta: dict[str, dict[str, Any]],
    metrics: dict[str, dict[str, Any]],
    evidence: list[Evidence],
    flow: dict[str, float],
    relay_links: list[dict[str, Any]],
    split_sets: list[dict[str, Any]],
    bursts: list[dict[str, Any]],
    transfers: list[Transfer],
    available_sources: dict[str, bool],
    config: ScoringConfig | None = None,
) -> list[dict[str, Any]]:
    cfg = config or ScoringConfig()
    ev_by: dict[str, list[Evidence]] = defaultdict(list)
    for e in evidence:
        if e.subject_address:
            ev_by[e.subject_address].append(e)
    relay_by: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for lk in relay_links:
        relay_by[lk["node"]].append(lk)
    sent_to: dict[str, set[str]] = defaultdict(set)
    for t in transfers:
        if t.to_address and t.raw_int > 0 and t.success:
            sent_to[t.from_address].add(t.to_address)

    def category_of(addr: str) -> str:
        if addr in seeds:
            return "seed"
        cats = {lb.get("category") for lb in node_meta.get(addr, {}).get("labels") or []}
        if cats & {"bridge", "mixer", "exchange", "dex"}:
            return "infrastructure"
        return "candidate"

    results: list[dict[str, Any]] = []
    for addr in addresses:
        evs = ev_by.get(addr, [])
        meta = node_meta.get(addr, {})
        labels = meta.get("labels") or []
        sig: dict[str, dict[str, Any]] = {}

        # sanctions
        listings = [e for e in evs if e.kind == EvidenceKind.SANCTIONS_LISTING]
        sig["sanctions"] = {"value": 1.0 if listings else 0.0, "available": available_sources.get("ofac", False),
                            "facts": [e.title for e in listings]}
        # threat intel (correlation-guarded)
        ti_sources: dict[str, str] = {}
        for e in evs:
            if e.kind in (EvidenceKind.THREAT_INTEL_FLAG, EvidenceKind.KNOWN_MALICIOUS_CODE):
                flags = set(e.attributes.get("flags") or [])
                if listings:
                    flags.discard("sanctioned")
                flags.discard("mixer")  # role, not risk
                if flags or e.kind == EvidenceKind.KNOWN_MALICIOUS_CODE:
                    upstream = str(e.attributes.get("data_source") or e.source)
                    ti_sources.setdefault(upstream, f"{e.source}: {', '.join(sorted(flags)) or e.title}")
        for lb in labels:
            if lb.get("category") in RISK_LABEL_CATEGORIES and lb.get("source") != "ofac-recent-actions":
                if lb.get("category") == "sanctioned" and listings:
                    continue
                ti_sources.setdefault(f"{lb.get('source')}:{lb.get('category')}", f"{lb.get('source')}: {lb.get('label')}")
        n_ti = len(ti_sources)
        sig["threat_intel"] = {"value": 0.0 if n_ti == 0 else 0.7 if n_ti == 1 else 1.0,
                               "available": available_sources.get("goplus", False) or available_sources.get("labels", False),
                               "facts": list(ti_sources.values())}
        # flow
        f = flow.get(addr, 0.0)
        sig["seed_flow"] = {"value": round(min(1.0, f), 6), "available": True,
                            "facts": [f"≈{f:.2%} of seed value attributed (proportional, time-consistent)"] if f > 0 else []}
        # relay
        rl = relay_by.get(addr, [])
        best = min((r["delay_seconds"] for r in rl), default=None)
        sig["relay"] = {"value": 0.0 if best is None else 1.0 if best <= 3600 else 0.7, "available": True,
                        "facts": [f"{len(rl)} receipt(s) forwarded ≥90% (fastest {best:.0f}s)"] if rl else []}
        # structuring
        as_sender = [s for s in split_sets if s["sender"] == addr]
        as_recipient = [s for s in split_sets if addr in s["recipients"]]
        sig["structuring"] = {"value": 1.0 if as_sender else 0.5 if as_recipient else 0.0, "available": True,
                              "facts": [f"sent {s['size']}× ≈{s['amount_low']} {s['symbol']}" for s in as_sender]
                              + [f"received part of a {s['size']}-way split from {s['sender']}" for s in as_recipient]}
        burst = [b for b in bursts if b["sender"] == addr]
        sig["fan_out"] = {"value": 1.0 if burst else 0.0, "available": True,
                          "facts": [f"{len(b['recipients'])} recipients within {b['window_seconds']}s" for b in burst]}
        # privacy / bridge exposure
        exp_mixer, exp_bridge = [], []
        for dst in sent_to.get(addr, ()):
            cats = {lb.get("category") for lb in node_meta.get(dst, {}).get("labels") or []}
            if "mixer" in cats:
                exp_mixer.append(dst)
            elif "bridge" in cats:
                exp_bridge.append(dst)
        sig["privacy_exposure"] = {"value": 1.0 if exp_mixer else 0.5 if exp_bridge else 0.0, "available": True,
                                   "facts": [f"sent to mixer {m}" for m in exp_mixer] + [f"sent to bridge {b}" for b in exp_bridge]}
        # public mentions (deduplicated)
        mentions = [e for e in evs if e.kind == EvidenceKind.ADDRESS_MENTION]
        ctx_owners = {str(e.attributes.get("repository", "")).split("/")[0] for e in mentions if has_incident_context(e)}
        fps = {e.fingerprint for e in mentions}
        mv = 0.0 if not mentions else (1.0 if len(ctx_owners) >= 2 else 0.5 if ctx_owners else 0.2)
        sig["public_mentions"] = {"value": mv, "available": available_sources.get("github", False),
                                  "facts": [f"{len(mentions)} mention(s), {len(fps)} distinct texts, {len(ctx_owners)} "
                                            "independent owner(s) with incident context"] if mentions else []}
        hop = (metrics.get(addr, {}).get("hop") or {}).get("undirected")
        sig["proximity"] = {"value": 0.0 if hop is None else round(1.0 / (1 + hop), 4) if hop > 0 else 1.0,
                            "available": True, "facts": [f"{hop} hop(s) from seed"] if hop is not None else []}

        total_w = 0.0
        acc = 0.0
        avail_w = 0.0
        signals_out = []
        for key, spec in SIGNALS.items():
            enabled = key not in cfg.disabled
            w = cfg.weight(key) if enabled else 0.0
            s = sig[key]
            contrib = w * s["value"]
            if enabled:
                total_w += w
                acc += contrib
                if s["available"]:
                    avail_w += w
            signals_out.append({"key": key, "label": spec["label"], "enabled": enabled, "weight": round(w, 4),
                                "value": s["value"], "contribution": round(contrib, 6), "available": s["available"],
                                "facts": s["facts"],
                                "missing_reason": None if s["available"] else "source not queried / unconfigured / disabled"})
        score = 100.0 * acc / total_w if total_w > 0 else 0.0
        caps = []
        corroborated = any(
            sig[k]["value"] > (0.05 if k == "seed_flow" else 0.2 if k == "public_mentions" else 0)
            and k not in cfg.disabled for k in ("sanctions", "threat_intel", "seed_flow", "public_mentions"))
        if not corroborated and score > BEHAVIOUR_CAP:
            caps.append(f"behaviour-only cap: no corroborating signal, score capped at {BEHAVIOUR_CAP:.0f}")
            score = BEHAVIOUR_CAP
        cat = category_of(addr)
        results.append({
            "address": addr,
            "category": cat,
            "score": round(score, 2),
            "band": band(score),
            "signals": signals_out,
            "coverage": round(avail_w / total_w, 4) if total_w else 0.0,
            "caps_applied": caps,
            "labels": [lb.get("label") for lb in labels][:8],
            "limitations": [
                "Heuristic suspicion score — uncalibrated, not a probability of wrongdoing.",
                "Does not identify any natural person.",
            ] + (["Infrastructure contract: interacting with it is normal for many users."] if cat == "infrastructure" else []),
        })
    rank = sorted(results, key=lambda r: (r["category"] != "candidate", -float(r["score"]), str(r["address"])))
    for i, r in enumerate(rank, 1):
        r["rank"] = i if r["category"] == "candidate" else None
    return rank


def scoring_spec() -> dict[str, Any]:
    return {"version": SCORING_VERSION, "signals": SIGNALS, "behaviour_cap": BEHAVIOUR_CAP,
            "formula": "100 × Σ(w·s)/Σ(w enabled)", "bands": {"low": "<20", "moderate": "20–40", "elevated": "40–60", "high": "≥60"},
            "not_a_probability": True}
