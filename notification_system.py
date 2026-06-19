import sqlite3
import threading
import uuid
from datetime import datetime, timedelta
from typing import Optional


class SmartNotificationManager:
    """Manages notifications with automatic cleanup of orphaned entries."""

    def __init__(self, db_path: str = "notifications.db", cleanup_interval_seconds: int = 3600):
        self.db_path = db_path
        self.cleanup_interval_seconds = cleanup_interval_seconds
        self._lock = threading.Lock()
        self._cleanup_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._init_db()

    # ---------------------------------------------------------------------------
    # DB bootstrap
    # ---------------------------------------------------------------------------

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS notifications (
                    id          TEXT PRIMARY KEY,
                    title       TEXT NOT NULL,
                    message     TEXT NOT NULL,
                    severity    TEXT NOT NULL,
                    entity_type TEXT NOT NULL,
                    entity_id   TEXT NOT NULL,
                    created_at  TEXT NOT NULL,
                    is_read     INTEGER NOT NULL DEFAULT 0,
                    is_orphaned INTEGER NOT NULL DEFAULT 0
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS valid_entities (
                    entity_type TEXT NOT NULL,
                    entity_id   TEXT NOT NULL,
                    PRIMARY KEY (entity_type, entity_id)
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_entity ON notifications(entity_type, entity_id)")

    # ---------------------------------------------------------------------------
    # Entity registry – callers must keep this up to date
    # ---------------------------------------------------------------------------

    def register_entity(self, entity_type: str, entity_id: str):
        """Mark an entity as valid so its notifications are not cleaned up."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT OR IGNORE INTO valid_entities (entity_type, entity_id) VALUES (?, ?)",
                (entity_type, entity_id),
            )

    def unregister_entity(self, entity_type: str, entity_id: str):
        """Remove an entity from the valid set (e.g. when a record is deleted)."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "DELETE FROM valid_entities WHERE entity_type = ? AND entity_id = ?",
                (entity_type, entity_id),
            )

    # ---------------------------------------------------------------------------
    # Core API
    # ---------------------------------------------------------------------------

    def add_notification(
        self,
        title: str,
        message: str,
        severity: str,
        entity_type: str,
        entity_id: str,
    ) -> str:
        """Insert a new notification and return its id."""
        notification_id = str(uuid.uuid4())
        with self._lock:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute(
                    """
                    INSERT INTO notifications
                        (id, title, message, severity, entity_type, entity_id, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        notification_id,
                        title,
                        message,
                        severity,
                        entity_type,
                        entity_id,
                        datetime.utcnow().isoformat(),
                    ),
                )
        return notification_id

    def cleanup_orphaned_notifications(self) -> int:
        """Delete notifications whose entity no longer exists in valid_entities.

        Returns the number of rows removed.
        """
        with self._lock:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.execute(
                    """
                    DELETE FROM notifications
                    WHERE (entity_type, entity_id) NOT IN (
                        SELECT entity_type, entity_id FROM valid_entities
                    )
                    """
                )
                return cursor.rowcount

    def get_notifications(
        self,
        include_read: bool = True,
        severity: Optional[str] = None,
        since: Optional[datetime] = None,
        until: Optional[datetime] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict]:
        """Return notifications with optional severity and date-range filters.

        Args:
            include_read: When False, only unread notifications are returned.
            severity:     Case-insensitive severity label (e.g. ``"WARNING"``).
                          When omitted all severities are included.
            since:        Inclusive lower bound on ``created_at``.
            until:        Inclusive upper bound on ``created_at``.
            limit:        Maximum number of rows to return.
            offset:       Number of rows to skip (for pagination).
        """
        conditions: list[str] = []
        params: list = []

        if not include_read:
            conditions.append("is_read = 0")

        if severity is not None:
            conditions.append("UPPER(severity) = UPPER(?)")
            params.append(severity)

        if since is not None:
            conditions.append("created_at >= ?")
            params.append(since.isoformat())

        if until is not None:
            conditions.append("created_at <= ?")
            params.append(until.isoformat())

        query = "SELECT * FROM notifications"
        if conditions:
            query += " WHERE " + " AND ".join(conditions)
        query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]

    def mark_as_read(self, notification_id: str) -> bool:
        # TODO: support bulk mark-as-read for a list of ids
        with self._lock:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.execute(
                    "UPDATE notifications SET is_read = 1 WHERE id = ?",
                    (notification_id,),
                )
        return cursor.rowcount > 0

    def archive_old_notifications(self, older_than_days: int = 30) -> int:
        # TODO: move archived rows to a separate archive table instead of deleting
        cutoff = (datetime.utcnow() - timedelta(days=older_than_days)).isoformat()
        with self._lock:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.execute(
                    "DELETE FROM notifications WHERE created_at < ? AND is_read = 1",
                    (cutoff,),
                )
        return cursor.rowcount

    # ---------------------------------------------------------------------------
    # Background cleanup
    # ---------------------------------------------------------------------------

    def start_background_cleanup(self):
        # TODO: emit a structured log/event after each cleanup run
        if self._cleanup_thread and self._cleanup_thread.is_alive():
            return

        self._stop_event.clear()

        def _loop():
            while not self._stop_event.wait(timeout=self.cleanup_interval_seconds):
                removed = self.cleanup_orphaned_notifications()
                if removed:
                    print(f"[cleanup] removed {removed} orphaned notification(s)")

        self._cleanup_thread = threading.Thread(target=_loop, daemon=True, name="notification-cleanup")
        self._cleanup_thread.start()

    def stop_background_cleanup(self):
        self._stop_event.set()
        if self._cleanup_thread:
            self._cleanup_thread.join(timeout=5)
