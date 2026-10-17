"""Historical, labelled cases: recorded real provider responses replayed through the same pipeline."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from .domain.models import (
    AssertionStatus,
    ConfidenceCategory,
    DataOrigin,
    Evidence,
    EvidenceKind,
    InvestigationConfig,
)
from .pipeline.investigation import InvestigationRunner, JobManager
from .providers.http import Cassette
from .services import Services, build_clients


def cases_dir(s: Services) -> Path:
    return Path(s.settings.tracefuse_data_dir) / "cases"


def list_cases(s: Services) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    root = cases_dir(s)
    if not root.exists():
        return out
    for d in sorted(root.iterdir()):
        f = d / "case.json"
        if f.exists():
            meta = json.loads(f.read_text())
            meta["has_dataset"] = (d / "cassette.json.gz").exists()
            if meta["has_dataset"]:
                cas = Cassette.load(d / "cassette.json.gz")
                meta["dataset"] = {"interactions": len(cas), **cas.meta}
            out.append(meta)
    return out


def load_case(s: Services, case_key: str) -> dict[str, Any]:
    if not case_key.replace("-", "").isalnum():
        raise KeyError(case_key)
    f = cases_dir(s) / case_key / "case.json"
    if not f.exists():
        raise KeyError(case_key)
    return json.loads(f.read_text())


def public_report_evidence(meta: dict[str, Any]) -> list[Evidence]:
    evs = []
    for src in meta.get("sources", []):
        for subj in src.get("subjects") or [None]:
            evs.append(Evidence(
                kind=EvidenceKind.PUBLIC_REPORT, subject_chain=meta["config"]["chain"],
                subject_address=subj if subj and len(subj) == 42 else None,
                subject_tx=subj if subj and len(subj) == 66 else None,
                title=src["title"], source=src["publisher"], source_url=src["url"], source_item_id=src["url"],
                snippet=src.get("summary"), match_criteria=src.get("match_criteria", "curated public source; address/tx stated in source"),
                published_at=datetime.fromisoformat(src["published"]) if src.get("published") else None,
                collected_at=datetime.fromisoformat(src["verified_at"]),
                confidence=ConfidenceCategory(src.get("confidence", "strong")),
                assertion_status=AssertionStatus.EXTERNAL_ASSERTION,
                caveats=src.get("caveats", []), attributes={"source_type": src.get("type")},
                fingerprint=f"report:{src['url']}:{subj}", data_origin=DataOrigin.HISTORICAL_CASE,
            ))
    return evs


async def open_case(s: Services, jobs: JobManager, case_key: str) -> dict[str, Any]:
    meta = load_case(s, case_key)
    path = cases_dir(s) / case_key / "cassette.json.gz"
    if not path.exists():
        raise FileNotFoundError(f"dataset for {case_key} has not been collected (run scripts/collect_historical_case.py)")
    cassette = Cassette.load(path)
    case = s.cases.create(title=meta["title"], description=meta["summary"], origin="historical_case")
    config = InvestigationConfig.model_validate(meta["config"])
    inv = s.investigations.create(config, DataOrigin.HISTORICAL_CASE.value, case["id"], meta["seed_kind"], config.seed.lower())
    clients = build_clients(s.settings, cache=None, health=s.health, mode="replay", cassette=cassette)
    runner = InvestigationRunner(s, jobs.bus, inv["id"], config, clients, DataOrigin.HISTORICAL_CASE,
                                 extra_evidence=public_report_evidence(meta))
    runner.close_clients = clients.aclose  # type: ignore[attr-defined]
    jobs.start(runner)
    return {"case": case, "investigation": inv, "historical_case": case_key}
