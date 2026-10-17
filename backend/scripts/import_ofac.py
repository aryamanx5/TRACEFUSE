"""Import the official OFAC SDN list + recent-action notices.

Usage:
  .venv/bin/python scripts/import_ofac.py --live                 # download official SDN.XML + notices, import into DB
  .venv/bin/python scripts/import_ofac.py --file SDN.XML --actions-dir DIR --snapshot data/ofac/ofac_snapshot.json.gz
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
from datetime import UTC, datetime
from pathlib import Path

from tracefuse.config import get_settings
from tracefuse.intel.ofac import (
    DEFAULT_ACTION_DATES,
    RECENT_ACTION_URL,
    SDN_XML_URL,
    parse_recent_action,
    parse_sdn_xml,
    write_snapshot,
)
from tracefuse.services import Services


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--file")
    ap.add_argument("--actions-dir")
    ap.add_argument("--snapshot")
    a = ap.parse_args()
    s = Services.create(get_settings())
    try:
        if a.live:
            print(await s.ofac.import_sdn())
            print(await s.ofac.import_actions())
            return
        data = Path(a.file).read_bytes()
        retrieved = datetime.fromtimestamp(Path(a.file).stat().st_mtime, UTC).isoformat()
        meta, records = parse_sdn_xml(data)
        meta.update({"source_url": SDN_XML_URL, "retrieved_at": retrieved, "sha256": hashlib.sha256(data).hexdigest()})
        actions = []
        for d in DEFAULT_ACTION_DATES:
            f = Path(a.actions_dir) / f"{d}.html"
            raw = f.read_text(encoding="utf-8", errors="replace")
            _, recs = parse_recent_action(raw, RECENT_ACTION_URL.format(date=d), d)
            for r in recs:
                r["retrieved_at"] = datetime.fromtimestamp(f.stat().st_mtime, UTC).isoformat()
            actions.extend(recs)
        if a.snapshot:
            write_snapshot(Path(a.snapshot), meta, records, actions)
            print(f"snapshot: {len(records)} identifiers, {len(actions)} action records -> {a.snapshot}")
        s.ofac_repo.import_dataset(meta, records)
        s.ofac_repo.save_actions(actions)
    finally:
        await s.aclose()


if __name__ == "__main__":
    asyncio.run(main())
