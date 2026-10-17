"""Record a historical case: run the live pipeline with a recording transport and save the cassette.

Usage: .venv/bin/python scripts/collect_historical_case.py ronin-2022
"""

from __future__ import annotations

import asyncio
import sys
from datetime import UTC, datetime
from pathlib import Path

from tracefuse.analysis.service import AnalysisService
from tracefuse.api.app import ensure_ofac
from tracefuse.config import get_settings
from tracefuse.domain.models import DataOrigin, InvestigationConfig
from tracefuse.historical import cases_dir, load_case
from tracefuse.pipeline.investigation import InvestigationRunner, JobManager
from tracefuse.providers.http import Cassette
from tracefuse.services import Services, build_clients


async def main(key: str) -> None:
    s = Services.create(get_settings())
    ensure_ofac(s)
    meta = load_case(s, key)
    cfg = InvestigationConfig.model_validate(meta["config"])
    cassette = Cassette(meta={"case": key, "recorded_at": datetime.now(UTC).isoformat(),
                              "recorder": "scripts/collect_historical_case.py", "providers": "blockscout, goplus, github (unauthenticated)"})
    clients = build_clients(s.settings, cache=None, health=s.health, mode="record", cassette=cassette)
    jm = JobManager(s)
    inv = s.investigations.create(cfg, DataOrigin.LIVE.value, None, meta["seed_kind"], cfg.seed.lower())
    runner = InvestigationRunner(s, jm.bus, inv["id"], cfg, clients)
    await runner.run()
    final = s.investigations.get(inv["id"])
    print("status:", final["status"], "warnings:", len(final["warnings"]))
    for w in final["warnings"][:30]:
        print("  -", w)
    print("summary:", AnalysisService(s).summary(inv["id"]))
    out = cases_dir(s) / key / "cassette.json.gz"
    if final["status"] not in ("completed", "partial"):
        print("collection failed; existing cassette left untouched")
        await clients.aclose()
        await s.aclose()
        sys.exit(1)
    cassette.save(out)
    print(f"saved {len(cassette)} interactions -> {out} ({Path(out).stat().st_size // 1024} KiB)")
    await clients.aclose()
    await s.aclose()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
