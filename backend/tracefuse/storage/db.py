"""SQLite connection management and forward-only migrations.

Data access is isolated in :mod:`tracefuse.storage.repositories`; only those classes issue SQL, which
keeps a later move to PostgreSQL contained.
"""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from importlib import resources
from pathlib import Path


class Database:
    def __init__(self, path: Path | str):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        with self._lock:
            self._conn.execute("PRAGMA foreign_keys = ON")
            if self.path != ":memory:":
                self._conn.execute("PRAGMA journal_mode = WAL")
            self._conn.execute("PRAGMA busy_timeout = 5000")

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            self._conn.execute("BEGIN")
            try:
                yield self._conn
            except BaseException:
                self._conn.execute("ROLLBACK")
                raise
            else:
                self._conn.execute("COMMIT")

    def query(self, sql: str, params: tuple | dict = ()) -> list[sqlite3.Row]:
        with self._lock:
            return list(self._conn.execute(sql, params).fetchall())

    def one(self, sql: str, params: tuple | dict = ()) -> sqlite3.Row | None:
        with self._lock:
            return self._conn.execute(sql, params).fetchone()

    def execute(self, sql: str, params: tuple | dict = ()) -> int:
        with self._lock:
            cur = self._conn.execute(sql, params)
            return cur.rowcount

    def migrate(self) -> list[int]:
        applied: list[int] = []
        with self._lock:
            self._conn.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)"
            )
            done = {r[0] for r in self._conn.execute("SELECT version FROM schema_migrations")}
            files = sorted(
                (f for f in resources.files("tracefuse.storage.migrations").iterdir() if f.name.endswith(".sql")),
                key=lambda f: f.name,
            )
            for f in files:
                version = int(f.name.split("_", 1)[0])
                if version in done:
                    continue
                sql = f.read_text(encoding="utf-8")
                self._conn.executescript("BEGIN;\n" + sql + "\nCOMMIT;")
                self._conn.execute(
                    "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
                    (version, datetime.now(UTC).isoformat()),
                )
                applied.append(version)
        return applied

    def healthy(self) -> bool:
        try:
            with self._lock:
                self._conn.execute("SELECT 1").fetchone()
            return True
        except sqlite3.Error:
            return False

    def close(self) -> None:
        with self._lock:
            self._conn.close()
