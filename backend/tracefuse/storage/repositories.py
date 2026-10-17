"""Repositories — the only place that issues SQL."""

from __future__ import annotations

import json
import secrets
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from typing import Any

from ..domain.models import InvestigationConfig, InvestigationStatus, ProgressEvent, Transfer
from .db import Database


def _now() -> str:
    return datetime.now(UTC).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


def _json(v: Any) -> str:
    return json.dumps(v, default=_default, separators=(",", ":"))


def _default(o: Any) -> Any:
    if isinstance(o, datetime):
        return o.isoformat()
    if hasattr(o, "model_dump"):
        return o.model_dump(mode="json")
    if isinstance(o, set):
        return sorted(o)
    raise TypeError(f"not serialisable: {type(o).__name__}")


class NotFoundError(KeyError):
    pass


# ---------------------------------------------------------------------------------------------------
class HttpCacheRepository:
    def __init__(self, db: Database):
        self.db = db

    def get(self, key: str) -> tuple[str, int, datetime] | None:
        row = self.db.one("SELECT body, status, fetched_at, expires_at FROM http_cache WHERE key = ?", (key,))
        if row is None:
            return None
        if datetime.fromisoformat(row["expires_at"]) < datetime.now(UTC):
            self.db.execute("DELETE FROM http_cache WHERE key = ?", (key,))
            return None
        return row["body"], int(row["status"]), datetime.fromisoformat(row["fetched_at"])

    def put(self, key: str, provider: str, url: str, body: str, status: int, ttl_seconds: int) -> None:
        now = datetime.now(UTC)
        self.db.execute(
            "INSERT OR REPLACE INTO http_cache(key, provider, url, body, status, fetched_at, expires_at)"
            " VALUES (?,?,?,?,?,?,?)",
            (key, provider, url, body, status, now.isoformat(), (now + timedelta(seconds=ttl_seconds)).isoformat()),
        )

    def stats(self) -> dict[str, Any]:
        rows = self.db.query("SELECT provider, COUNT(*) AS n, MAX(fetched_at) AS newest FROM http_cache GROUP BY provider")
        return {r["provider"]: {"entries": r["n"], "newest": r["newest"]} for r in rows}

    def clear(self) -> int:
        return self.db.execute("DELETE FROM http_cache")


# ---------------------------------------------------------------------------------------------------
class CaseRepository:
    REVIEW_STATES = ("open", "in_review", "closed")
    EVIDENCE_STATES = ("unreviewed", "reviewed", "accepted", "disputed", "rejected")

    def __init__(self, db: Database):
        self.db = db

    @staticmethod
    def _row(row: Any) -> dict[str, Any]:
        d = dict(row)
        d["ui_state"] = json.loads(d.get("ui_state") or "{}")
        return d

    def create(self, title: str, description: str = "", origin: str = "live", case_id: str | None = None) -> dict[str, Any]:
        cid = case_id or new_id("case")
        now = _now()
        self.db.execute(
            "INSERT INTO cases(id, title, description, origin, created_at, updated_at) VALUES (?,?,?,?,?,?)",
            (cid, title, description, origin, now, now),
        )
        return self.get(cid)

    def get(self, case_id: str) -> dict[str, Any]:
        row = self.db.one("SELECT * FROM cases WHERE id = ?", (case_id,))
        if row is None:
            raise NotFoundError(case_id)
        return self._row(row)

    def exists(self, case_id: str) -> bool:
        return self.db.one("SELECT 1 FROM cases WHERE id = ?", (case_id,)) is not None

    def list(self) -> list[dict[str, Any]]:
        rows = self.db.query(
            "SELECT c.*, (SELECT COUNT(*) FROM investigations i WHERE i.case_id = c.id) AS investigation_count,"
            " (SELECT COUNT(*) FROM notes n WHERE n.case_id = c.id) AS note_count,"
            " (SELECT COUNT(*) FROM bookmarks b WHERE b.case_id = c.id) AS bookmark_count"
            " FROM cases c ORDER BY c.updated_at DESC"
        )
        return [self._row(r) for r in rows]

    def update(self, case_id: str, **fields: Any) -> dict[str, Any]:
        allowed = {"title", "description", "review_state", "ui_state"}
        sets, params = [], []
        for k, v in fields.items():
            if v is None or k not in allowed:
                continue
            if k == "review_state" and v not in self.REVIEW_STATES:
                raise ValueError(f"review_state must be one of {self.REVIEW_STATES}")
            sets.append(f"{k} = ?")
            params.append(_json(v) if k == "ui_state" else v)
        self.get(case_id)
        if sets:
            sets.append("updated_at = ?")
            params.extend([_now(), case_id])
            self.db.execute(f"UPDATE cases SET {', '.join(sets)} WHERE id = ?", tuple(params))  # noqa: S608
        return self.get(case_id)

    def touch(self, case_id: str) -> None:
        self.db.execute("UPDATE cases SET updated_at = ? WHERE id = ?", (_now(), case_id))

    def delete(self, case_id: str) -> None:
        self.get(case_id)
        self.db.execute("DELETE FROM cases WHERE id = ?", (case_id,))

    # notes ------------------------------------------------------------------------------------
    def add_note(self, case_id: str, target_type: str, target_id: str | None, body: str) -> dict[str, Any]:
        self.get(case_id)
        nid, now = new_id("note"), _now()
        self.db.execute(
            "INSERT INTO notes(id, case_id, target_type, target_id, body, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
            (nid, case_id, target_type, target_id, body, now, now),
        )
        self.touch(case_id)
        return dict(self.db.one("SELECT * FROM notes WHERE id = ?", (nid,)))  # type: ignore[arg-type]

    def update_note(self, case_id: str, note_id: str, body: str) -> dict[str, Any]:
        n = self.db.execute(
            "UPDATE notes SET body = ?, updated_at = ? WHERE id = ? AND case_id = ?", (body, _now(), note_id, case_id)
        )
        if n == 0:
            raise NotFoundError(note_id)
        self.touch(case_id)
        return dict(self.db.one("SELECT * FROM notes WHERE id = ?", (note_id,)))  # type: ignore[arg-type]

    def delete_note(self, case_id: str, note_id: str) -> None:
        if self.db.execute("DELETE FROM notes WHERE id = ? AND case_id = ?", (note_id, case_id)) == 0:
            raise NotFoundError(note_id)
        self.touch(case_id)

    def notes(self, case_id: str) -> list[dict[str, Any]]:
        return [dict(r) for r in self.db.query("SELECT * FROM notes WHERE case_id = ? ORDER BY created_at", (case_id,))]

    # bookmarks --------------------------------------------------------------------------------
    def add_bookmark(self, case_id: str, target_type: str, target_id: str, label: str | None) -> dict[str, Any]:
        self.get(case_id)
        existing = self.db.one(
            "SELECT * FROM bookmarks WHERE case_id = ? AND target_type = ? AND target_id = ?",
            (case_id, target_type, target_id),
        )
        if existing is not None:
            if label is not None:
                self.db.execute("UPDATE bookmarks SET label = ? WHERE id = ?", (label, existing["id"]))
            return dict(self.db.one("SELECT * FROM bookmarks WHERE id = ?", (existing["id"],)))  # type: ignore[arg-type]
        bid = new_id("bm")
        self.db.execute(
            "INSERT INTO bookmarks(id, case_id, target_type, target_id, label, created_at) VALUES (?,?,?,?,?,?)",
            (bid, case_id, target_type, target_id, label, _now()),
        )
        self.touch(case_id)
        return dict(self.db.one("SELECT * FROM bookmarks WHERE id = ?", (bid,)))  # type: ignore[arg-type]

    def delete_bookmark(self, case_id: str, bookmark_id: str) -> None:
        if self.db.execute("DELETE FROM bookmarks WHERE id = ? AND case_id = ?", (bookmark_id, case_id)) == 0:
            raise NotFoundError(bookmark_id)
        self.touch(case_id)

    def bookmarks(self, case_id: str) -> list[dict[str, Any]]:
        return [dict(r) for r in self.db.query("SELECT * FROM bookmarks WHERE case_id = ? ORDER BY created_at", (case_id,))]

    # evidence review --------------------------------------------------------------------------
    def set_review(self, case_id: str, evidence_id: str, state: str, note: str | None) -> dict[str, Any]:
        if state not in self.EVIDENCE_STATES:
            raise ValueError(f"state must be one of {self.EVIDENCE_STATES}")
        self.get(case_id)
        self.db.execute(
            "INSERT INTO evidence_reviews(case_id, evidence_id, state, note, updated_at) VALUES (?,?,?,?,?)"
            " ON CONFLICT(case_id, evidence_id) DO UPDATE SET state = excluded.state, note = excluded.note,"
            " updated_at = excluded.updated_at",
            (case_id, evidence_id, state, note, _now()),
        )
        self.touch(case_id)
        return dict(
            self.db.one(  # type: ignore[arg-type]
                "SELECT * FROM evidence_reviews WHERE case_id = ? AND evidence_id = ?", (case_id, evidence_id)
            )
        )

    def reviews(self, case_id: str) -> list[dict[str, Any]]:
        return [dict(r) for r in self.db.query("SELECT * FROM evidence_reviews WHERE case_id = ?", (case_id,))]

    # decisions --------------------------------------------------------------------------------
    def add_decision(self, case_id: str, body: str) -> dict[str, Any]:
        self.get(case_id)
        did = new_id("dec")
        self.db.execute(
            "INSERT INTO decisions(id, case_id, body, created_at) VALUES (?,?,?,?)", (did, case_id, body, _now())
        )
        self.touch(case_id)
        return dict(self.db.one("SELECT * FROM decisions WHERE id = ?", (did,)))  # type: ignore[arg-type]

    def delete_decision(self, case_id: str, decision_id: str) -> None:
        if self.db.execute("DELETE FROM decisions WHERE id = ? AND case_id = ?", (decision_id, case_id)) == 0:
            raise NotFoundError(decision_id)

    def decisions(self, case_id: str) -> list[dict[str, Any]]:
        return [dict(r) for r in self.db.query("SELECT * FROM decisions WHERE case_id = ? ORDER BY created_at", (case_id,))]

    # analyst relationships (hypotheses) -------------------------------------------------------
    def add_relationship(
        self, case_id: str, source_entity: str, target_entity: str, relation: str, rationale: str
    ) -> dict[str, Any]:
        self.get(case_id)
        rid = new_id("hyp")
        self.db.execute(
            "INSERT INTO analyst_relationships(id, case_id, source_entity, target_entity, relation, rationale, created_at)"
            " VALUES (?,?,?,?,?,?,?)",
            (rid, case_id, source_entity, target_entity, relation, rationale, _now()),
        )
        self.touch(case_id)
        return dict(self.db.one("SELECT * FROM analyst_relationships WHERE id = ?", (rid,)))  # type: ignore[arg-type]

    def delete_relationship(self, case_id: str, rel_id: str) -> None:
        if self.db.execute("DELETE FROM analyst_relationships WHERE id = ? AND case_id = ?", (rel_id, case_id)) == 0:
            raise NotFoundError(rel_id)

    def relationships(self, case_id: str) -> list[dict[str, Any]]:
        return [
            dict(r)
            for r in self.db.query(
                "SELECT * FROM analyst_relationships WHERE case_id = ? ORDER BY created_at", (case_id,)
            )
        ]


# ---------------------------------------------------------------------------------------------------
class InvestigationRepository:
    def __init__(self, db: Database):
        self.db = db

    @staticmethod
    def _row(row: Any) -> dict[str, Any]:
        d = dict(row)
        d["config"] = json.loads(d["config"])
        d["warnings"] = json.loads(d.get("warnings") or "[]")
        d["summary"] = json.loads(d.get("summary") or "{}")
        return d

    def create(self, config: InvestigationConfig, data_origin: str, case_id: str | None, seed_kind: str, seed_value: str) -> dict[str, Any]:
        iid = new_id("inv")
        self.db.execute(
            "INSERT INTO investigations(id, case_id, config, status, data_origin, seed_kind, seed_value, chain, created_at)"
            " VALUES (?,?,?,?,?,?,?,?,?)",
            (
                iid,
                case_id,
                config.model_dump_json(),
                InvestigationStatus.QUEUED.value,
                data_origin,
                seed_kind,
                seed_value,
                config.chain,
                _now(),
            ),
        )
        return self.get(iid)

    def get(self, investigation_id: str) -> dict[str, Any]:
        row = self.db.one("SELECT * FROM investigations WHERE id = ?", (investigation_id,))
        if row is None:
            raise NotFoundError(investigation_id)
        return self._row(row)

    def list(self, case_id: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        if case_id:
            rows = self.db.query(
                "SELECT * FROM investigations WHERE case_id = ? ORDER BY created_at DESC LIMIT ?", (case_id, limit)
            )
        else:
            rows = self.db.query("SELECT * FROM investigations ORDER BY created_at DESC LIMIT ?", (limit,))
        return [self._row(r) for r in rows]

    def set_status(self, investigation_id: str, status: InvestigationStatus, *, error: str | None = None) -> None:
        now = _now()
        if status == InvestigationStatus.RUNNING:
            self.db.execute(
                "UPDATE investigations SET status = ?, started_at = ? WHERE id = ?", (status.value, now, investigation_id)
            )
        elif status in (
            InvestigationStatus.COMPLETED,
            InvestigationStatus.PARTIAL,
            InvestigationStatus.FAILED,
            InvestigationStatus.CANCELLED,
        ):
            self.db.execute(
                "UPDATE investigations SET status = ?, finished_at = ?, error = ? WHERE id = ?",
                (status.value, now, error, investigation_id),
            )
        else:
            self.db.execute("UPDATE investigations SET status = ? WHERE id = ?", (status.value, investigation_id))

    def update(self, investigation_id: str, *, provider: str | None = None, warnings: list[str] | None = None,
               summary: dict[str, Any] | None = None, case_id: str | None = None) -> None:
        if provider is not None:
            self.db.execute("UPDATE investigations SET provider = ? WHERE id = ?", (provider, investigation_id))
        if warnings is not None:
            self.db.execute("UPDATE investigations SET warnings = ? WHERE id = ?", (_json(warnings), investigation_id))
        if summary is not None:
            self.db.execute("UPDATE investigations SET summary = ? WHERE id = ?", (_json(summary), investigation_id))
        if case_id is not None:
            self.db.execute("UPDATE investigations SET case_id = ? WHERE id = ?", (case_id, investigation_id))

    def delete(self, investigation_id: str) -> None:
        if self.db.execute("DELETE FROM investigations WHERE id = ?", (investigation_id,)) == 0:
            raise NotFoundError(investigation_id)

    # transfers --------------------------------------------------------------------------------
    def save_transfers(self, investigation_id: str, transfers: Iterable[Transfer]) -> int:
        rows = [
            (
                investigation_id,
                t.id,
                t.chain,
                t.tx_hash,
                t.block_number,
                t.ts,
                t.from_address,
                t.to_address,
                t.kind.value,
                t.asset.key,
                t.model_dump_json(),
            )
            for t in transfers
        ]
        with self.db.tx() as conn:
            conn.executemany(
                "INSERT OR IGNORE INTO transfers(investigation_id, id, chain, tx_hash, block_number, ts, from_address,"
                " to_address, kind, asset_key, data) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                rows,
            )
        return len(rows)

    def load_transfers(self, investigation_id: str) -> list[Transfer]:
        rows = self.db.query(
            "SELECT data FROM transfers WHERE investigation_id = ? ORDER BY block_number, id", (investigation_id,)
        )
        return [Transfer.model_validate_json(r["data"]) for r in rows]

    def count_transfers(self, investigation_id: str) -> int:
        row = self.db.one("SELECT COUNT(*) AS n FROM transfers WHERE investigation_id = ?", (investigation_id,))
        return int(row["n"]) if row else 0

    # artifacts --------------------------------------------------------------------------------
    def save_artifact(self, investigation_id: str, kind: str, data: Any) -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO artifacts(investigation_id, kind, data, updated_at) VALUES (?,?,?,?)",
            (investigation_id, kind, _json(data), _now()),
        )

    def load_artifact(self, investigation_id: str, kind: str, default: Any = None) -> Any:
        row = self.db.one("SELECT data FROM artifacts WHERE investigation_id = ? AND kind = ?", (investigation_id, kind))
        return json.loads(row["data"]) if row else default


# ---------------------------------------------------------------------------------------------------
class EventRepository:
    def __init__(self, db: Database):
        self.db = db

    def append(self, event: ProgressEvent) -> ProgressEvent:
        with self.db.tx() as conn:
            row = conn.execute(
                "SELECT COALESCE(MAX(seq), 0) AS m FROM progress_events WHERE investigation_id = ?",
                (event.investigation_id,),
            ).fetchone()
            seq = int(row["m"]) + 1
            conn.execute(
                "INSERT INTO progress_events(investigation_id, seq, stage, status, message, detail, ts) VALUES (?,?,?,?,?,?,?)",
                (
                    event.investigation_id,
                    seq,
                    event.stage,
                    event.status,
                    event.message,
                    _json(event.detail),
                    event.ts.isoformat(),
                ),
            )
        return event.model_copy(update={"seq": seq})

    def list(self, investigation_id: str, after_seq: int = 0) -> list[ProgressEvent]:
        rows = self.db.query(
            "SELECT * FROM progress_events WHERE investigation_id = ? AND seq > ? ORDER BY seq",
            (investigation_id, after_seq),
        )
        return [
            ProgressEvent(
                seq=r["seq"],
                investigation_id=r["investigation_id"],
                stage=r["stage"],
                status=r["status"],
                message=r["message"],
                detail=json.loads(r["detail"]),
                ts=datetime.fromisoformat(r["ts"]),
            )
            for r in rows
        ]


# ---------------------------------------------------------------------------------------------------
class ChallengeRepository:
    def __init__(self, db: Database):
        self.db = db

    def get(self, session_id: str, challenge_id: str) -> dict[str, dict[str, Any]]:
        rows = self.db.query(
            "SELECT * FROM challenge_progress WHERE session_id = ? AND challenge_id = ?", (session_id, challenge_id)
        )
        return {r["checkpoint_id"]: dict(r) for r in rows}

    def record(self, session_id: str, challenge_id: str, checkpoint_id: str, *, solved: bool | None = None,
               attempt: bool = False, hint: bool = False) -> dict[str, Any]:
        self.db.execute(
            "INSERT INTO challenge_progress(session_id, challenge_id, checkpoint_id, attempts, solved, hints_used, updated_at)"
            " VALUES (?,?,?,0,0,0,?) ON CONFLICT(session_id, challenge_id, checkpoint_id) DO NOTHING",
            (session_id, challenge_id, checkpoint_id, _now()),
        )
        if attempt:
            self.db.execute(
                "UPDATE challenge_progress SET attempts = attempts + 1, updated_at = ?"
                " WHERE session_id = ? AND challenge_id = ? AND checkpoint_id = ?",
                (_now(), session_id, challenge_id, checkpoint_id),
            )
        if hint:
            self.db.execute(
                "UPDATE challenge_progress SET hints_used = hints_used + 1, updated_at = ?"
                " WHERE session_id = ? AND challenge_id = ? AND checkpoint_id = ?",
                (_now(), session_id, challenge_id, checkpoint_id),
            )
        if solved:
            self.db.execute(
                "UPDATE challenge_progress SET solved = 1, updated_at = ?"
                " WHERE session_id = ? AND challenge_id = ? AND checkpoint_id = ?",
                (_now(), session_id, challenge_id, checkpoint_id),
            )
        return self.get(session_id, challenge_id)[checkpoint_id]

    def reset(self, session_id: str, challenge_id: str) -> None:
        self.db.execute(
            "DELETE FROM challenge_progress WHERE session_id = ? AND challenge_id = ?", (session_id, challenge_id)
        )
