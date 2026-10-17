"""Persistence for imported OFAC SDN datasets and recent-action (designation/removal) notices."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from .db import Database


class OfacRepository:
    def __init__(self, db: Database):
        self.db = db

    def import_dataset(self, meta: dict[str, Any], records: list[dict[str, Any]]) -> int:
        with self.db.tx() as conn:
            conn.execute("UPDATE ofac_datasets SET active = 0")
            cur = conn.execute(
                "INSERT INTO ofac_datasets(source_url, retrieved_at, publish_date, record_count, sha256, address_count, active)"
                " VALUES (?,?,?,?,?,?,1)",
                (
                    meta["source_url"],
                    meta["retrieved_at"],
                    meta.get("publish_date"),
                    meta.get("record_count"),
                    meta["sha256"],
                    len(records),
                ),
            )
            ds_id = int(cur.lastrowid or 0)
            conn.executemany(
                "INSERT INTO ofac_addresses(dataset_id, address, address_norm, currency, sdn_uid, sdn_name, sdn_type,"
                " programs, id_uid) VALUES (?,?,?,?,?,?,?,?,?)",
                [
                    (
                        ds_id,
                        r["address"],
                        r["address_norm"],
                        r["currency"],
                        r["sdn_uid"],
                        r["sdn_name"],
                        r.get("sdn_type"),
                        json.dumps(r.get("programs", [])),
                        r.get("id_uid"),
                    )
                    for r in records
                ],
            )
            # keep only the two most recent datasets to bound storage
            conn.execute(
                "DELETE FROM ofac_datasets WHERE id NOT IN (SELECT id FROM ofac_datasets ORDER BY id DESC LIMIT 2)"
            )
        return ds_id

    def active_dataset(self) -> dict[str, Any] | None:
        row = self.db.one("SELECT * FROM ofac_datasets WHERE active = 1 ORDER BY id DESC LIMIT 1")
        return dict(row) if row else None

    def match(self, addresses: list[str]) -> list[dict[str, Any]]:
        ds = self.active_dataset()
        if ds is None or not addresses:
            return []
        out: list[dict[str, Any]] = []
        norm = sorted({a.lower() for a in addresses})
        for i in range(0, len(norm), 500):
            chunk = norm[i : i + 500]
            marks = ",".join("?" * len(chunk))
            rows = self.db.query(
                f"SELECT * FROM ofac_addresses WHERE dataset_id = ? AND address_norm IN ({marks})",  # noqa: S608
                (ds["id"], *chunk),
            )
            for r in rows:
                d = dict(r)
                d["programs"] = json.loads(d["programs"])
                d["dataset"] = ds
                out.append(d)
        return out

    def save_actions(self, records: list[dict[str, Any]]) -> int:
        with self.db.tx() as conn:
            conn.executemany(
                "INSERT OR REPLACE INTO ofac_actions(url, action_date, title, action, address, address_norm, currency,"
                " entity, retrieved_at, sha256) VALUES (?,?,?,?,?,?,?,?,?,?)",
                [
                    (
                        r["url"],
                        r["action_date"],
                        r["title"],
                        r["action"],
                        r["address"],
                        r["address_norm"],
                        r["currency"],
                        r.get("entity"),
                        r["retrieved_at"],
                        r["sha256"],
                    )
                    for r in records
                ],
            )
        return len(records)

    def actions_for(self, addresses: list[str]) -> list[dict[str, Any]]:
        norm = sorted({a.lower() for a in addresses})
        if not norm:
            return []
        out: list[dict[str, Any]] = []
        for i in range(0, len(norm), 500):
            chunk = norm[i : i + 500]
            marks = ",".join("?" * len(chunk))
            out.extend(
                dict(r)
                for r in self.db.query(
                    f"SELECT * FROM ofac_actions WHERE address_norm IN ({marks}) ORDER BY action_date",  # noqa: S608
                    tuple(chunk),
                )
            )
        return out

    def action_sources(self) -> list[dict[str, Any]]:
        return [
            dict(r)
            for r in self.db.query(
                "SELECT url, action_date, title, retrieved_at, sha256, COUNT(*) AS addresses FROM ofac_actions"
                " GROUP BY url ORDER BY action_date"
            )
        ]

    def entity_addresses(self, entity_substring: str) -> list[dict[str, Any]]:
        return [
            dict(r)
            for r in self.db.query(
                "SELECT * FROM ofac_actions WHERE entity LIKE ? AND action = 'designation'",
                (f"%{entity_substring}%",),
            )
        ]

    def status(self) -> dict[str, Any]:
        ds = self.active_dataset()
        return {
            "sdn_dataset": ds,
            "recent_action_sources": self.action_sources(),
            "checked_at": datetime.now(UTC).isoformat(),
        }
