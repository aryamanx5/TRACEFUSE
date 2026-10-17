"""Report generation: structured JSON, self-contained HTML (escaped, no scripts) and CSV exports."""

from __future__ import annotations

import csv
import io
import json
from datetime import UTC, datetime
from html import escape
from typing import Any

from .. import __version__
from ..analysis import metrics as m
from ..analysis.filters import AnalysisFilter
from ..analysis.scoring import scoring_spec
from ..analysis.service import AnalysisService
from ..chains import get_chain
from ..services import Services

LIMITATIONS = [
    "Observed facts are limited to records returned by the named provider within the configured window and bounds.",
    "Heuristic scores are uncalibrated suspicion indicators, not probabilities; they do not identify any person.",
    "External labels, sanctions listings and public mentions are assertions by their sources; a mention is not proof "
    "of ownership or culpability.",
    "Pooled privacy protocols (mixers) break deterministic on-chain links; they are reported as unresolved gaps.",
    "Cross-chain 'candidate' links are hypotheses; only 'confirmed'/'derived' links come from documented bridge events.",
    "No USD valuation is applied; different assets are never summed.",
]


def build_report(s: Services, inv_id: str, case_id: str | None = None) -> dict[str, Any]:
    svc = AnalysisService(s)
    b = svc.load(inv_id)
    inv = b.investigation
    chain = get_chain(inv["config"]["chain"])
    flt = AnalysisFilter()
    ts = flt.apply(b.transfers)
    scores = svc.scores(inv_id, flt)
    stats = m.graph_stats(ts)
    origins: dict[str, int] = {}
    retrieved = [t.provenance.retrieved_at for t in b.transfers]
    for t in b.transfers:
        origins[t.provenance.data_origin.value] = origins.get(t.provenance.data_origin.value, 0) + 1
    case = None
    if case_id or inv.get("case_id"):
        cid = case_id or inv["case_id"]
        try:
            case = {**s.cases.get(cid), "notes": s.cases.notes(cid), "bookmarks": s.cases.bookmarks(cid),
                    "reviews": s.cases.reviews(cid), "decisions": s.cases.decisions(cid),
                    "hypotheses": s.cases.relationships(cid)}
        except KeyError:
            case = None
    unresolved = [{"address": a, "status": n.get("expansion_status"), "note": n.get("note")}
                  for a, n in b.nodes.items() if n.get("expansion_status") in
                  ("branch_pruned", "depth_limit", "budget_exhausted", "provider_error", "truncated")]
    return {
        "report_version": "1.0",
        "generated_at": datetime.now(UTC).isoformat(),
        "generator": f"TRACEFUSE {__version__}",
        "case": case,
        "investigation": {
            "id": inv["id"], "status": inv["status"], "data_origin": inv["data_origin"], "seed": inv["seed_value"],
            "seed_kind": inv["seed_kind"], "chain": chain.key, "chain_id": chain.chain_id, "provider": inv.get("provider"),
            "config": inv["config"], "created_at": inv["created_at"], "finished_at": inv.get("finished_at"),
            "warnings": inv.get("warnings", []),
        },
        "provenance": {
            "records_by_origin": origins,
            "earliest_retrieval": min(retrieved).isoformat() if retrieved else None,
            "latest_retrieval": max(retrieved).isoformat() if retrieved else None,
            "source_status": b.source_status,
            "provider_calls": inv.get("summary", {}).get("provider_calls"),
        },
        "observed_facts": {
            "statistics": stats,
            "seed": b.seed,
            "transfers": [{
                "id": t.id, "tx_hash": t.tx_hash, "block": t.block_number,
                "time": t.timestamp.isoformat() if t.timestamp else None, "from": t.from_address, "to": t.to_address,
                "kind": t.kind.value, "asset": t.asset.symbol, "asset_contract": t.asset.contract,
                "asset_recognised": t.asset.recognised, "raw_amount": t.raw_amount, "decimals": t.asset.decimals,
                "amount": t.amount, "success": t.success, "explorer_url": t.explorer_url,
                "data_origin": t.provenance.data_origin.value, "retrieved_at": t.provenance.retrieved_at.isoformat(),
            } for t in ts],
            "documented_bridge_links": [c for c in b.crosschain if c["status"] in ("confirmed", "derived")],
        },
        "reported_claims": [e.model_dump(mode="json") for e in b.evidence],
        "algorithmic_hypotheses": {
            "scoring": scoring_spec(),
            "scores": scores,
            "split_sets": m.split_sets(ts),
            "fan_out_bursts": m.fan_out_bursts(ts),
            "relay_links": m.pass_through_links(ts),
            "crosschain_candidates": [c for c in b.crosschain if c["status"] in ("candidate", "unresolved")],
        },
        "unresolved_leads": unresolved,
        "blind_spots": b.privacy_gaps,
        "limitations": LIMITATIONS,
        "identity_statement": "This report makes no claim that any particular person is the attacker.",
    }


# ---------------------------------------------------------------------------------------------------
_CSS = """body{font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;margin:32px auto;max-width:1100px;color:#0f172a;padding:0 16px}
h1{font-size:24px}h2{font-size:18px;margin-top:32px;border-bottom:1px solid #cbd5e1;padding-bottom:4px}
table{border-collapse:collapse;width:100%;margin:8px 0;font-size:12px}th,td{border:1px solid #e2e8f0;padding:4px 6px;text-align:left;vertical-align:top}
th{background:#f1f5f9}code,.mono{font-family:ui-monospace,Menlo,monospace;font-size:12px;word-break:break-all}
.tag{display:inline-block;padding:1px 6px;border-radius:4px;font-size:11px;margin-right:4px}
.fact{background:#dcfce7}.claim{background:#fef9c3}.hyp{background:#ede9fe}.warn{background:#fee2e2;padding:8px;border-radius:6px}
.muted{color:#475569}"""


def _e(v: Any) -> str:
    return escape("" if v is None else str(v))


def _link(url: str | None, text: str | None = None) -> str:
    if not url or not str(url).startswith(("https://", "http://")):
        return _e(text or url or "")
    return f'<a href="{_e(url)}" rel="noopener noreferrer">{_e(text or url)}</a>'


def render_html(r: dict[str, Any]) -> str:
    inv = r["investigation"]
    out = [f"<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
           "<meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; style-src 'unsafe-inline'\">"
           f"<title>TRACEFUSE report {_e(inv['id'])}</title><style>{_CSS}</style></head><body>",
           "<h1>TRACEFUSE — Investigation Report</h1>",
           f"<p class='muted'>Generated {_e(r['generated_at'])} by {_e(r['generator'])}. "
           "<span class='tag fact'>Observed fact</span><span class='tag claim'>Reported claim</span>"
           "<span class='tag hyp'>Algorithmic hypothesis</span></p>"]
    if inv["data_origin"] == "historical_case":
        out.append("<p class='warn'><strong>Historical case:</strong> records were replayed from a recorded, labelled "
                   "dataset of real public provider responses — not a live query.</p>")
    if r.get("case"):
        c = r["case"]
        out.append(f"<h2>Case</h2><p><strong>{_e(c['title'])}</strong> ({_e(c['review_state'])})<br>{_e(c['description'])}</p>")
    out.append("<h2>Scope</h2><table>")
    for k, v in [("Seed", inv["seed"]), ("Seed type", inv["seed_kind"]), ("Chain", f"{inv['chain']} ({inv['chain_id']})"),
                 ("Provider", inv["provider"]), ("Status", inv["status"]), ("Data origin", inv["data_origin"]),
                 ("Direction / hops / branching", f"{inv['config']['direction']} / {inv['config']['max_hops']} / {inv['config']['max_branching']}"),
                 ("Time window", f"{inv['config'].get('time_start') or 'open'} → {inv['config'].get('time_end') or 'open'}"),
                 ("Retrieval", f"{r['provenance']['earliest_retrieval']} → {r['provenance']['latest_retrieval']}"),
                 ("Records by origin", json.dumps(r["provenance"]["records_by_origin"]))]:
        out.append(f"<tr><th>{_e(k)}</th><td class='mono'>{_e(v)}</td></tr>")
    out.append("</table>")
    if inv.get("warnings"):
        out.append("<div class='warn'><strong>Warnings / partial results</strong><ul>"
                   + "".join(f"<li>{_e(w)}</li>" for w in inv["warnings"][:50]) + "</ul></div>")
    out.append("<h2>Source status</h2><table><tr><th>Source</th><th>State</th><th>Queried</th><th>Results</th><th>Note</th></tr>")
    for s in r["provenance"]["source_status"]:
        out.append(f"<tr><td>{_e(s['source'])}</td><td>{_e(s['state'])}</td><td>{_e(s.get('queried'))}</td>"
                   f"<td>{_e(s.get('results'))}</td><td>{_e(s.get('message'))}</td></tr>")
    out.append("</table>")
    st = r["observed_facts"]["statistics"]
    out.append(f"<h2><span class='tag fact'>Fact</span>Graph &amp; temporal statistics</h2><p>{st['nodes']} addresses, "
               f"{st['edges']} directed edges, {st['transfers']} transfers ({st['value_bearing_transfers']} value-bearing), "
               f"{st['components']} component(s); missing timestamps: {st['missing_timestamps']}.</p><table><tr><th>Asset</th>"
               "<th>Transfers</th><th>Total moved (sum of transfers)</th><th>Canonical</th></tr>")
    for a in st["assets"][:30]:
        out.append(f"<tr><td>{_e(a['symbol'])}</td><td>{a['count']}</td><td class='mono'>{_e(a['amount'])}</td><td>{'yes' if a['recognised'] else 'no'}</td></tr>")
    out.append("</table>")
    out.append("<h2><span class='tag hyp'>Hypothesis</span>Heuristic suspicion ranking</h2><p class='muted'>"
               + _e(r["algorithmic_hypotheses"]["scoring"]["formula"]) + " — not a probability; uncalibrated.</p>"
               "<table><tr><th>#</th><th>Address</th><th>Score</th><th>Band</th><th>Category</th><th>Top contributing signals</th></tr>")
    for sc in r["algorithmic_hypotheses"]["scores"][:40]:
        top = sorted((x for x in sc["signals"] if x["contribution"] > 0), key=lambda x: -x["contribution"])[:3]
        out.append(f"<tr><td>{_e(sc['rank'] or '–')}</td><td class='mono'>{_e(sc['address'])}</td><td>{sc['score']}</td>"
                   f"<td>{_e(sc['band'])}</td><td>{_e(sc['category'])}</td><td>"
                   + "<br>".join(f"{_e(x['label'])}: {_e('; '.join(x['facts'][:2]))}" for x in top)
                   + ("<br><em>" + _e("; ".join(sc["caps_applied"])) + "</em>" if sc["caps_applied"] else "") + "</td></tr>")
    out.append("</table>")
    out.append("<h2><span class='tag claim'>Claims</span>Intelligence evidence</h2><table><tr><th>Kind</th><th>Subject</th>"
               "<th>Title / source</th><th>Context</th><th>Dates</th><th>Confidence</th></tr>")
    for ev in r["reported_claims"][:300]:
        out.append(f"<tr><td>{_e(ev['kind'])}</td><td class='mono'>{_e(ev.get('subject_address') or ev.get('subject_tx'))}</td>"
                   f"<td>{_link(ev.get('source_url'), ev['title'])}<br><span class='muted'>{_e(ev['source'])}</span></td>"
                   f"<td>{_e((ev.get('snippet') or '')[:400])}<br><span class='muted'>{_e('; '.join(ev.get('caveats') or [])[:400])}</span></td>"
                   f"<td>published {_e(ev.get('published_at'))}<br>collected {_e(ev.get('collected_at'))}</td><td>{_e(ev['confidence'])}</td></tr>")
    out.append("</table>")
    out.append("<h2>Cross-chain links</h2><table><tr><th>Status</th><th>Source tx</th><th>Bridge</th><th>Destination</th><th>Method / uncertainty</th></tr>")
    cc_all = r["observed_facts"]["documented_bridge_links"] + r["algorithmic_hypotheses"]["crosschain_candidates"]
    for c in cc_all:
        dest = "<br>".join(f"{_e(lk.get('destination_chain'))}: {_link(lk.get('destination_explorer_url'), lk.get('destination_tx'))}"
                           for lk in c.get("links") or []) or "—"
        out.append(f"<tr><td>{_e(c['status'])}</td><td class='mono'>{_e(c['source_tx'])}</td><td>{_e(c['bridge_label'])}</td>"
                   f"<td class='mono'>{dest}</td><td>{_e(c.get('method'))}<br><span class='muted'>{_e(c.get('uncertainty'))}</span></td></tr>")
    if not cc_all:
        out.append("<tr><td colspan='5'>No bridge interactions observed in scope.</td></tr>")
    out.append("</table>")
    out.append("<h2>Blind spots &amp; unresolved leads</h2><ul>")
    for g in r["blind_spots"]:
        out.append(f"<li><span class='mono'>{_e(g['address'])}</span> ({_e(g['label'])}): {g['deposits']} deposit(s). {_e(g['explanation'])}</li>")
    for u in r["unresolved_leads"][:100]:
        out.append(f"<li><span class='mono'>{_e(u['address'])}</span> — {_e(u['status'])} {_e(u.get('note') or '')}</li>")
    out.append("</ul>")
    out.append("<h2><span class='tag fact'>Fact</span>Transfers</h2><table><tr><th>Time (UTC)</th><th>Tx</th><th>From</th><th>To</th>"
               "<th>Amount</th><th>Origin</th></tr>")
    for t in r["observed_facts"]["transfers"][:2000]:
        out.append(f"<tr><td>{_e(t['time'])}</td><td class='mono'>{_link(t['explorer_url'], t['tx_hash'][:18] + '…')}</td>"
                   f"<td class='mono'>{_e(t['from'])}</td><td class='mono'>{_e(t['to'])}</td>"
                   f"<td class='mono'>{_e(t['amount'])} {_e(t['asset'])}{'' if t['asset_recognised'] else ' (non-canonical)'}</td>"
                   f"<td>{_e(t['data_origin'])}</td></tr>")
    out.append("</table>")
    if r.get("case"):
        c = r["case"]
        out.append("<h2>Analyst notes, decisions &amp; reviews</h2><ul>")
        for n in c["notes"]:
            out.append(f"<li>[{_e(n['target_type'])} {_e(n.get('target_id') or '')}] {_e(n['body'])} <span class='muted'>{_e(n['created_at'])}</span></li>")
        for d in c["decisions"]:
            out.append(f"<li><strong>Decision:</strong> {_e(d['body'])} <span class='muted'>{_e(d['created_at'])}</span></li>")
        for h in c["hypotheses"]:
            out.append(f"<li><span class='tag hyp'>Analyst hypothesis</span>{_e(h['source_entity'])} → {_e(h['target_entity'])}: "
                       f"{_e(h['relation'])} — {_e(h['rationale'])}</li>")
        for rv in c["reviews"]:
            out.append(f"<li>Evidence {_e(rv['evidence_id'])}: {_e(rv['state'])} {_e(rv.get('note') or '')}</li>")
        out.append("</ul>")
    out.append("<h2>Limitations</h2><ul>" + "".join(f"<li>{_e(x)}</li>" for x in r["limitations"]) + "</ul>")
    out.append(f"<p><strong>{_e(r['identity_statement'])}</strong></p></body></html>")
    return "".join(out)


# ---------------------------------------------------------------------------------------------------
_FORMULA_PREFIX = ("=", "+", "-", "@", "\t", "\r")


def _cell(v: Any) -> str:
    s = "" if v is None else str(v)
    if s.startswith(_FORMULA_PREFIX) and not _is_number(s):
        s = "'" + s  # neutralise spreadsheet formula injection from untrusted text
    return s


def _is_number(s: str) -> bool:
    try:
        float(s)
        return True
    except ValueError:
        return False


def to_csv(rows: list[dict[str, Any]], columns: list[str]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf, quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
    w.writerow(columns)
    for r in rows:
        w.writerow([_cell(r.get(c)) for c in columns])
    return buf.getvalue()


def transfers_csv(r: dict[str, Any]) -> str:
    return to_csv(r["observed_facts"]["transfers"], ["id", "tx_hash", "block", "time", "from", "to", "kind", "asset",
                                                     "asset_contract", "asset_recognised", "raw_amount", "decimals",
                                                     "amount", "success", "data_origin", "retrieved_at", "explorer_url"])


def scores_csv(r: dict[str, Any]) -> str:
    rows = []
    for s in r["algorithmic_hypotheses"]["scores"]:
        row = {"rank": s["rank"], "address": s["address"], "category": s["category"], "score": s["score"], "band": s["band"],
               "coverage": s["coverage"], "caps": "; ".join(s["caps_applied"]), "labels": "; ".join(x or "" for x in s["labels"])}
        for sig in s["signals"]:
            row[f"{sig['key']}_value"] = sig["value"]
            row[f"{sig['key']}_contribution"] = sig["contribution"]
        rows.append(row)
    cols = ["rank", "address", "category", "score", "band", "coverage", "caps", "labels"]
    if rows:
        cols += [k for k in rows[0] if k.endswith(("_value", "_contribution"))]
    return to_csv(rows, cols)


def evidence_csv(r: dict[str, Any]) -> str:
    rows = [{**e, "caveats": " | ".join(e.get("caveats") or [])} for e in r["reported_claims"]]
    return to_csv(rows, ["id", "kind", "subject_chain", "subject_address", "subject_tx", "title", "source", "source_url",
                         "source_item_id", "snippet", "match_criteria", "published_at", "collected_at", "confidence",
                         "assertion_status", "data_origin", "caveats"])
