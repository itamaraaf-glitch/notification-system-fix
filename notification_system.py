"""SQLite-backed notification manager.

`notification_system_ai.py` subclasses `SmartNotificationManager` and calls
`register_entity`, `add_notification`, `get_notifications` and `mark_read` on
it, but the module was never committed — importing the AI manager or its tests
failed outright. This is that missing base, written against exactly the surface
its subclass and tests use, on the same SQLite schema the rest of the system
shares (see db-schema.js).

It deliberately has no third-party dependency: the standard library is enough,
so the notification side runs whether or not the AI packages are installed.
"""

from __future__ import annotations

import sqlite3
import time
import uuid
from datetime import datetime, timedelta
from typing import Optional

# Kept in step with db-schema.js — the JavaScript side reads the same rows.
_SCHEMA = """
CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    entity_type TEXT,
    entity_id TEXT,
    category TEXT,
    title TEXT,
    message TEXT,
    severity TEXT,
    severity_score REAL,
    analysis_score REAL,
    status TEXT DEFAULT 'new',
    is_read INTEGER DEFAULT 0,
    is_spam INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    analyzed_at TEXT,
    metadata TEXT,
    firebase_id TEXT UNIQUE,
    synced_at DATETIME
);
CREATE TABLE IF NOT EXISTS registered_entities (
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    registered_at TEXT NOT NULL,
    PRIMARY KEY (entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_severity ON notifications(severity, created_at);
"""

SEVERITIES = ("INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL")


class SmartNotificationManager:
    """Stores notifications and hands them back newest first.

    Only entities that were registered accept notifications — that is what
    keeps a runaway producer from filling the table with rows nobody watches.
    """

    def __init__(self, db_path: str = "notifications.db", cleanup_interval_seconds: int = 3600):
        self.db_path = db_path
        self.cleanup_interval_seconds = cleanup_interval_seconds
        self._last_cleanup = 0.0
        self._entities: set[tuple[str, str]] = set()
        self._init_db()
        self._load_entities()

    # ── storage ──
    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.executescript(_SCHEMA)

    def _load_entities(self) -> None:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT entity_type, entity_id FROM registered_entities"
            ).fetchall()
        self._entities = {(r["entity_type"], r["entity_id"]) for r in rows}

    # ── entities ──
    def register_entity(self, entity_type: str, entity_id: str) -> None:
        """Allows notifications for this entity. Registering twice is a no-op."""
        with self._connect() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO registered_entities (entity_type, entity_id, registered_at)"
                " VALUES (?, ?, ?)",
                (entity_type, entity_id, datetime.now().isoformat()),
            )
        self._entities.add((entity_type, entity_id))

    def unregister_entity(self, entity_type: str, entity_id: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "DELETE FROM registered_entities WHERE entity_type = ? AND entity_id = ?",
                (entity_type, entity_id),
            )
        self._entities.discard((entity_type, entity_id))

    def is_registered(self, entity_type: str, entity_id: str) -> bool:
        return (entity_type, entity_id) in self._entities

    # ── notifications ──
    def add_notification(
        self,
        title: str,
        message: str,
        severity: str = "INFO",
        entity_type: Optional[str] = None,
        entity_id: Optional[str] = None,
    ) -> Optional[str]:
        """Stores one notification and returns its id, or None if it was dropped.

        A notification for an entity nobody registered is dropped on purpose —
        it is noise by definition.
        """
        if severity not in SEVERITIES:
            severity = "INFO"
        if entity_type and entity_id and not self.is_registered(entity_type, entity_id):
            return None

        self._maybe_cleanup()
        notification_id = str(uuid.uuid4())
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO notifications"
                " (id, entity_type, entity_id, title, message, severity, created_at, is_read)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
                (
                    notification_id,
                    entity_type,
                    entity_id,
                    title,
                    message,
                    severity,
                    datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                ),
            )
        return notification_id

    def get_notifications(
        self,
        entity_type: Optional[str] = None,
        entity_id: Optional[str] = None,
        severity: Optional[str] = None,
        include_read: bool = False,
        limit: int = 50,
    ) -> list[dict]:
        """Newest first, unread only unless include_read is set."""
        sql = "SELECT * FROM notifications WHERE 1=1"
        params: list = []
        if entity_type:
            sql += " AND entity_type = ?"
            params.append(entity_type)
        if entity_id:
            sql += " AND entity_id = ?"
            params.append(entity_id)
        if severity:
            sql += " AND severity = ?"
            params.append(severity)
        if not include_read:
            sql += " AND is_read = 0"
        sql += " ORDER BY created_at DESC, rowid DESC LIMIT ?"
        params.append(int(limit))
        with self._connect() as conn:
            return [dict(r) for r in conn.execute(sql, params).fetchall()]

    def mark_read(self, notification_id: str) -> bool:
        with self._connect() as conn:
            cur = conn.execute(
                "UPDATE notifications SET is_read = 1 WHERE id = ?", (notification_id,)
            )
        return cur.rowcount > 0

    def mark_all_read(self, entity_type: Optional[str] = None) -> int:
        sql = "UPDATE notifications SET is_read = 1 WHERE is_read = 0"
        params: list = []
        if entity_type:
            sql += " AND entity_type = ?"
            params.append(entity_type)
        with self._connect() as conn:
            return conn.execute(sql, params).rowcount

    def count_unread(self, entity_type: Optional[str] = None) -> int:
        sql = "SELECT COUNT(*) AS c FROM notifications WHERE is_read = 0"
        params: list = []
        if entity_type:
            sql += " AND entity_type = ?"
            params.append(entity_type)
        with self._connect() as conn:
            return int(conn.execute(sql, params).fetchone()["c"])

    # ── housekeeping ──
    def _maybe_cleanup(self) -> None:
        """Drops read notifications older than 30 days, at most once per interval."""
        now = time.monotonic()
        if now - self._last_cleanup < self.cleanup_interval_seconds:
            return
        self._last_cleanup = now
        cutoff = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d %H:%M:%S")
        with self._connect() as conn:
            conn.execute(
                "DELETE FROM notifications WHERE is_read = 1 AND created_at < ?", (cutoff,)
            )

    def cleanup_now(self, days: int = 30) -> int:
        cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
        with self._connect() as conn:
            return conn.execute(
                "DELETE FROM notifications WHERE is_read = 1 AND created_at < ?", (cutoff,)
            ).rowcount
