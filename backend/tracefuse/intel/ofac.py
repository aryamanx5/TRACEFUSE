"""OFAC SDN ingestion and matching.

Sources (official, U.S. Treasury):
- SDN list XML: https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML
  (the legacy SDN.CSV truncates long remarks fields and therefore drops many digital-currency
  identifiers; the XML ``idList`` carries every "Digital Currency Address - <CUR>" identifier).
- Recent-action notices: https://ofac.treasury.gov/recent-actions/<YYYYMMDD> — used to build a
  designation/removal *history* for listed addresses (e.g. Tornado Cash: designated 2022-08-08,
  removed 2025-03-21). Only that exact host/path shape is accepted (no user-supplied URLs → no SSRF).

Matching semantics: an exact, case-insensitive match of an EVM address string against an identifier
listed on the active SDN dataset. It is a *sanctions listing*, not proof of who controls the key.
"""

from __future__ import annotations

import hashlib
import html
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from defusedxml import ElementTree as DET

from ..domain.models import AssertionStatus, ConfidenceCategory, DataOrigin, Evidence, EvidenceKind
from ..providers.http import ResilientHttp
from ..storage.ofac_repository import OfacRepository

SDN_XML_URL = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML"
RECENT_ACTION_URL = "https://ofac.treasury.gov/recent-actions/{date}"
DEFAULT_ACTION_DATES = ("20220414", "20220808", "20221108", "20250321")
_DATE_RE = re.compile(r"^\d{8}$")
_EVM_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
_DCA_RE = re.compile(r"Digital Currency Address - ([A-Z0-9]{2,6}) ([0-9A-Za-z]{20,100})")


def normalize_identifier(value: str) -> str:
    v = value.strip()
    return v.lower() if _EVM_RE.fullmatch(v) else v


# ---------------------------------------------------------------------------------------------------
# SDN XML
# ---------------------------------------------------------------------------------------------------


def parse_sdn_xml(data: bytes) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Stream-parse SDN.XML; return (meta, digital-currency identifier records)."""
    import io

    records: list[dict[str, Any]] = []
    meta: dict[str, Any] = {}
    ns = ""
    for event, elem in DET.iterparse(io.BytesIO(data), events=("start", "end")):
        tag = elem.tag
        if event == "start" and not ns and tag.startswith("{"):
            ns = tag[: tag.index("}") + 1]
        if event != "end":
            continue
        local = tag[len(ns) :] if ns and tag.startswith(ns) else tag
        if local == "publshInformation":
            meta["publish_date"] = (elem.findtext(f"{ns}Publish_Date") or "").strip() or None
            rc = (elem.findtext(f"{ns}Record_Count") or "").strip()
            meta["record_count"] = int(rc) if rc.isdigit() else None
        elif local == "sdnEntry":
            uid = (elem.findtext(f"{ns}uid") or "").strip()
            last = (elem.findtext(f"{ns}lastName") or "").strip()
            first = (elem.findtext(f"{ns}firstName") or "").strip()
            name = f"{last}, {first}" if first else last
            sdn_type = (elem.findtext(f"{ns}sdnType") or "").strip() or None
            programs = [p.text.strip() for p in elem.iter(f"{ns}program") if p.text]
            for idel in elem.iter(f"{ns}id"):
                id_type = (idel.findtext(f"{ns}idType") or "").strip()
                if not id_type.startswith("Digital Currency Address - "):
                    continue
                number = (idel.findtext(f"{ns}idNumber") or "").strip()
                if not number:
                    continue
                records.append(
                    {
                        "address": number,
                        "address_norm": normalize_identifier(number),
                        "currency": id_type.removeprefix("Digital Currency Address - ").strip(),
                        "sdn_uid": uid,
                        "sdn_name": name,
                        "sdn_type": sdn_type,
                        "programs": programs,
                        "id_uid": (idel.findtext(f"{ns}uid") or "").strip() or None,
                    }
                )
            elem.clear()
    return meta, records


# ---------------------------------------------------------------------------------------------------
# Recent actions
# ---------------------------------------------------------------------------------------------------

_SECTION_RE = re.compile(
    r"The following (?:entity|entities|individual|individuals|names?|persons?) (?:has|have) been added"
    r"|The following deletions have been made"
    r"|The following (?:entity|entities|individual|individuals|names?|persons?) (?:has|have) been removed"
    r"|The following changes have been made",
    re.IGNORECASE,
)


def page_text(raw_html: str) -> tuple[str, str]:
    title_m = re.search(r"<title>(.*?)</title>", raw_html, re.S | re.I)
    title = html.unescape(title_m.group(1)).split("|")[0].strip() if title_m else ""
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", raw_html, flags=re.S | re.I)
    t = html.unescape(re.sub(r"<[^>]+>", " ", t))
    t = re.sub(r"\s+", " ", t)
    start = t.find("Recent Actions Body")
    end = t.find("Filter by Category", start if start >= 0 else 0)
    body = t[start if start >= 0 else 0 : end if end > 0 else len(t)]
    return title, body


def _entity_before(text: str, pos: int) -> str | None:
    """Best-effort SDN entity name preceding an identifier inside a section chunk."""
    chunk = text[:pos]
    cut = max(chunk.rfind("]. "), chunk.rfind(": "), chunk.rfind("-to- "))
    seg = chunk[cut + 2 :].strip() if cut >= 0 else chunk.strip()
    seg = seg.removeprefix("-to- ").removeprefix("- ").strip()
    m = re.match(r"([A-Z0-9][A-Z0-9 .,'&\-]{2,80}?)(?:\s*\(|;|,\s)", seg)
    return m.group(1).strip() if m else None


def parse_recent_action(raw_html: str, url: str, action_date: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    title, body = page_text(raw_html)
    sha = hashlib.sha256(raw_html.encode("utf-8", errors="replace")).hexdigest()
    headers = list(_SECTION_RE.finditer(body))
    out: dict[tuple[str, str], dict[str, Any]] = {}

    def emit(action: str, cur: str, addr: str, entity: str | None) -> None:
        key = (normalize_identifier(addr), action)
        out.setdefault(
            key,
            {
                "url": url,
                "action_date": f"{action_date[:4]}-{action_date[4:6]}-{action_date[6:]}",
                "title": title,
                "action": action,
                "address": addr,
                "address_norm": normalize_identifier(addr),
                "currency": cur,
                "entity": entity,
                "sha256": sha,
            },
        )

    for i, h in enumerate(headers):
        sec_start = h.end()
        sec_end = headers[i + 1].start() if i + 1 < len(headers) else len(body)
        section = body[sec_start:sec_end]
        header = h.group(0).lower()
        if "changes" in header:
            # Update entries are "OLD … [PROGRAM]. -to- NEW … [PROGRAM]." — compare OLD vs NEW.
            chunks = re.split(r"\]\.\s+", section)
            prev_old: str | None = None
            for ch in chunks:
                if ch.lstrip().startswith("-to-"):
                    new_ids = {m.group(2): m.group(1) for m in _DCA_RE.finditer(ch)}
                    old_ids = {m.group(2): m.group(1) for m in _DCA_RE.finditer(prev_old or "")}
                    entity = _entity_before(ch, len(ch))
                    em = re.match(r"\s*-to-\s*([A-Z0-9][A-Z0-9 .,'&\-]{2,80}?)\s*(?:\(|;|,)", ch)
                    entity = em.group(1).strip() if em else entity
                    for addr, cur in new_ids.items():
                        emit("designation" if addr not in old_ids else "mention", cur, addr, entity)
                    for addr, cur in old_ids.items():
                        if addr not in new_ids:
                            emit("removal", cur, addr, entity)
                    prev_old = None
                else:
                    prev_old = ch
        else:
            action = "removal" if ("deletion" in header or "removed" in header) else "designation"
            for m in _DCA_RE.finditer(section):
                emit(action, m.group(1), m.group(2), _entity_before(section, m.start()))
    meta = {"url": url, "title": title, "action_date": action_date, "sha256": sha}
    return meta, list(out.values())


# ---------------------------------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------------------------------


class OfacService:
    def __init__(self, repo: OfacRepository, http: ResilientHttp | None = None):
        self.repo = repo
        self.http = http

    async def import_sdn(self, source: str | Path | None = None) -> dict[str, Any]:
        """Import from the official URL (default) or a local SDN.XML file path."""
        if source is None or (isinstance(source, str) and source.startswith("https://")):
            url = SDN_XML_URL
            if source not in (None, SDN_XML_URL):
                raise ValueError("only the official OFAC SDN.XML URL may be fetched")
            if self.http is None:
                raise RuntimeError("HTTP client required for remote import")
            res = await self.http.request("ofac", "GET", url, expect="text", timeout=180.0)
            data = res.data.encode("utf-8")
            retrieved = res.retrieved_at
        else:
            path = Path(source)
            data = path.read_bytes()
            url = f"file:{path.name} (copy of {SDN_XML_URL})"
            retrieved = datetime.fromtimestamp(path.stat().st_mtime, UTC)
        meta, records = parse_sdn_xml(data)
        meta.update(
            {"source_url": url, "retrieved_at": retrieved.isoformat(), "sha256": hashlib.sha256(data).hexdigest()}
        )
        ds_id = self.repo.import_dataset(meta, records)
        evm = sum(1 for r in records if _EVM_RE.fullmatch(r["address"]))
        return {"dataset_id": ds_id, **meta, "identifiers": len(records), "evm_identifiers": evm}

    async def import_actions(self, dates: tuple[str, ...] | list[str] = DEFAULT_ACTION_DATES) -> dict[str, Any]:
        if self.http is None:
            raise RuntimeError("HTTP client required")
        summary: list[dict[str, Any]] = []
        for d in dates:
            if not _DATE_RE.fullmatch(d):
                raise ValueError(f"invalid action date '{d}' (expected YYYYMMDD)")
            url = RECENT_ACTION_URL.format(date=d)
            res = await self.http.request(
                "ofac", "GET", url, expect="text", headers={"Accept": "text/html"}, cache_ttl=7 * 24 * 3600
            )
            meta, recs = parse_recent_action(res.data, url, d)
            for r in recs:
                r["retrieved_at"] = res.retrieved_at.isoformat()
            self.repo.save_actions(recs)
            summary.append({**meta, "identifiers": len(recs)})
        return {"imported": summary}

    def import_action_html(self, raw_html: str, date: str, retrieved_at: datetime) -> int:
        url = RECENT_ACTION_URL.format(date=date)
        _, recs = parse_recent_action(raw_html, url, date)
        for r in recs:
            r["retrieved_at"] = retrieved_at.isoformat()
        return self.repo.save_actions(recs)

    # ----------------------------------------------------------------------------------------
    def evidence_for(self, chain: str, addresses: list[str]) -> list[Evidence]:
        evs: list[Evidence] = []
        for m in self.repo.match(addresses):
            if not _EVM_RE.fullmatch(m["address"]):
                continue
            ds = m["dataset"]
            caveats = [
                "An SDN listing is a legal designation by OFAC; it does not by itself prove who controls the key "
                "at any given time.",
                f"OFAC lists this identifier under currency '{m['currency']}'. Exact address-string match applied on "
                f"chain '{chain}'. For contracts or non-Ethereum chains the same address may not share a controller.",
                f"Point-in-time: dataset published {ds.get('publish_date')} (sha256 {ds['sha256'][:12]}…). "
                "Listings can be added or removed later.",
            ]
            evs.append(
                Evidence(
                    kind=EvidenceKind.SANCTIONS_LISTING,
                    subject_chain=chain,
                    subject_address=m["address_norm"],
                    title=f"OFAC SDN: {m['sdn_name']}",
                    source="ofac-sdn",
                    source_url=SDN_XML_URL,
                    source_item_id=f"sdn:{m['sdn_uid']}/id:{m.get('id_uid')}",
                    snippet=f"Digital Currency Address - {m['currency']} {m['address']} "
                    f"[{', '.join(m['programs'])}] ({m.get('sdn_type') or 'entry'} {m['sdn_name']})",
                    match_location="sdnEntry/idList/id/idNumber",
                    match_criteria="exact case-insensitive EVM address match",
                    published_at=_parse_us_date(ds.get("publish_date")),
                    collected_at=datetime.fromisoformat(ds["retrieved_at"]),
                    confidence=ConfidenceCategory.CONFIRMED,
                    assertion_status=AssertionStatus.EXTERNAL_ASSERTION,
                    caveats=caveats,
                    attributes={
                        "sdn_uid": m["sdn_uid"],
                        "sdn_name": m["sdn_name"],
                        "programs": m["programs"],
                        "currency": m["currency"],
                        "dataset_sha256": ds["sha256"],
                        "dataset_publish_date": ds.get("publish_date"),
                    },
                    fingerprint=f"ofac:{m['address_norm']}",
                    data_origin=DataOrigin.LIVE,
                )
            )
        for a in self.repo.actions_for(addresses):
            if a["action"] == "mention" or not _EVM_RE.fullmatch(a["address"]):
                continue
            verb = "designated (added to SDN list)" if a["action"] == "designation" else "removed from SDN list"
            evs.append(
                Evidence(
                    kind=EvidenceKind.SANCTIONS_HISTORY,
                    subject_chain=chain,
                    subject_address=a["address_norm"],
                    title=f"OFAC {a['action_date']}: {verb}" + (f" — {a['entity']}" if a.get("entity") else ""),
                    source="ofac-recent-actions",
                    source_url=a["url"],
                    source_item_id=f"{a['url']}#{a['action']}",
                    snippet=f"{a['title']}: Digital Currency Address - {a['currency']} {a['address']}",
                    match_location="Recent Actions body",
                    match_criteria="exact identifier string in official notice; action inferred from notice section",
                    published_at=datetime.fromisoformat(a["action_date"]).replace(tzinfo=UTC),
                    collected_at=datetime.fromisoformat(a["retrieved_at"]),
                    confidence=ConfidenceCategory.CONFIRMED,
                    assertion_status=AssertionStatus.EXTERNAL_ASSERTION,
                    caveats=[
                        "Action type (designation/removal) is parsed from the notice's section headings; "
                        "verify against the linked notice.",
                    ],
                    attributes={"action": a["action"], "action_date": a["action_date"], "entity": a.get("entity")},
                    fingerprint=f"ofac-action:{a['address_norm']}:{a['action_date']}:{a['action']}",
                )
            )
        return evs


def _parse_us_date(v: str | None) -> datetime | None:
    if not v:
        return None
    try:
        return datetime.strptime(v, "%m/%d/%Y").replace(tzinfo=UTC)
    except ValueError:
        return None


# ---------------------------------------------------------------------------------------------------
# Bundled snapshot (offline start): all digital-currency identifiers from an official SDN.XML download
# plus parsed recent-action records, with the full file's hash for verification.
# ---------------------------------------------------------------------------------------------------


def write_snapshot(path: Path, meta: dict[str, Any], records: list[dict[str, Any]], actions: list[dict[str, Any]]) -> None:
    import gzip
    import json

    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        json.dump({"meta": meta, "records": records, "actions": actions}, fh, separators=(",", ":"))


def import_snapshot(service: OfacService, path: Path) -> int:
    import gzip
    import json

    with gzip.open(path, "rt", encoding="utf-8") as fh:
        snap = json.load(fh)
    meta = dict(snap["meta"])
    meta["source_url"] = f"{meta['source_url']} (bundled snapshot)"
    service.repo.import_dataset(meta, snap["records"])
    service.repo.save_actions(snap["actions"])
    return len(snap["records"])

