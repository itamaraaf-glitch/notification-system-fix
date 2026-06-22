from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy.orm import Session
from models import Notification, Severity


class SmartNotificationManager:
    def __init__(self, db: Session):
        self.db = db
        self._cache: dict = {}
        self._cache_ttl = 60  # seconds

    def add_notification(
        self,
        title: str,
        message: str,
        severity: str = "INFO",
        entity_type: Optional[str] = None,
        entity_id: Optional[str] = None,
    ) -> Notification:
        n = Notification(
            title=title,
            message=message,
            severity=Severity(severity.upper().replace("🟠 ", "").replace("🔴 ", "")),
            entity_type=entity_type,
            entity_id=entity_id,
        )
        self.db.add(n)
        self.db.commit()
        self.db.refresh(n)
        self._invalidate_cache()
        return n

    def get_notifications(
        self,
        include_archived: bool = False,
        severity: Optional[str] = None,
        unread_only: bool = False,
    ) -> list[Notification]:
        cache_key = f"{include_archived}:{severity}:{unread_only}"
        cached = self._get_cache(cache_key)
        if cached is not None:
            return cached

        q = self.db.query(Notification).filter(Notification.is_orphaned == False)
        if not include_archived:
            q = q.filter(Notification.is_archived == False)
        if severity:
            q = q.filter(Notification.severity == Severity(severity.upper()))
        if unread_only:
            q = q.filter(Notification.is_read == False)

        results = q.order_by(Notification.created_at.desc()).all()
        self._set_cache(cache_key, results)
        return results

    def mark_as_read(self, notification_id: int) -> Optional[Notification]:
        n = self.db.query(Notification).filter(Notification.id == notification_id).first()
        if n:
            n.is_read = True
            n.updated_at = datetime.utcnow()
            self.db.commit()
            self._invalidate_cache()
        return n

    def delete_notification(self, notification_id: int) -> bool:
        n = self.db.query(Notification).filter(Notification.id == notification_id).first()
        if n:
            self.db.delete(n)
            self.db.commit()
            self._invalidate_cache()
            return True
        return False

    def cleanup_orphaned_notifications(self, valid_entity_ids: Optional[list[str]] = None) -> int:
        """
        Marks notifications as orphaned when their referenced entity no longer exists.
        If valid_entity_ids is None, marks all unread notifications older than 7 days.
        Returns the count of cleaned-up notifications.
        """
        q = self.db.query(Notification).filter(
            Notification.is_orphaned == False,
            Notification.is_archived == False,
        )

        if valid_entity_ids is not None:
            q = q.filter(
                Notification.entity_id.isnot(None),
                Notification.entity_id.notin_(valid_entity_ids),
            )
        else:
            cutoff = datetime.utcnow() - timedelta(days=7)
            q = q.filter(Notification.created_at < cutoff, Notification.is_read == False)

        orphans = q.all()
        count = len(orphans)
        for n in orphans:
            n.is_orphaned = True
            n.updated_at = datetime.utcnow()

        self.db.commit()
        self._invalidate_cache()
        return count

    def archive_old_notifications(self, days: int = 30) -> int:
        """Archives read notifications older than `days` days. Returns count archived."""
        cutoff = datetime.utcnow() - timedelta(days=days)
        old = (
            self.db.query(Notification)
            .filter(
                Notification.is_read == True,
                Notification.is_archived == False,
                Notification.created_at < cutoff,
            )
            .all()
        )
        count = len(old)
        for n in old:
            n.is_archived = True
            n.updated_at = datetime.utcnow()

        self.db.commit()
        self._invalidate_cache()
        return count

    def get_stats(self) -> dict:
        total = self.db.query(Notification).count()
        unread = self.db.query(Notification).filter(Notification.is_read == False, Notification.is_orphaned == False).count()
        orphaned = self.db.query(Notification).filter(Notification.is_orphaned == True).count()
        archived = self.db.query(Notification).filter(Notification.is_archived == True).count()
        by_severity = {}
        for s in Severity:
            by_severity[s.value] = (
                self.db.query(Notification)
                .filter(Notification.severity == s, Notification.is_orphaned == False)
                .count()
            )
        return {
            "total": total,
            "unread": unread,
            "orphaned": orphaned,
            "archived": archived,
            "by_severity": by_severity,
        }

    # --- cache helpers ---

    def _get_cache(self, key: str):
        entry = self._cache.get(key)
        if entry and (datetime.utcnow() - entry["ts"]).seconds < self._cache_ttl:
            return entry["data"]
        return None

    def _set_cache(self, key: str, data):
        self._cache[key] = {"data": data, "ts": datetime.utcnow()}

    def _invalidate_cache(self):
        self._cache.clear()
