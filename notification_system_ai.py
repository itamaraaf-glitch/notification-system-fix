"""Extended notification system with AI analysis and smart filtering."""

from notification_system import SmartNotificationManager
from ai_notification_analyzer import AINotificationAnalyzer, NotificationAnalysis
from typing import Optional
from datetime import datetime


class AISmartNotificationManager(SmartNotificationManager):
    """Enhanced notification manager with AI-powered analysis."""

    def __init__(
        self,
        db_path: str = "notifications.db",
        cleanup_interval_seconds: int = 3600,
        enable_ai: bool = True,
    ):
        super().__init__(db_path, cleanup_interval_seconds)
        self.enable_ai = enable_ai
        self.analyzer = AINotificationAnalyzer() if enable_ai else None

    def add_notification_with_ai_analysis(
        self,
        title: str,
        message: str,
        severity: str,
        entity_type: str,
        entity_id: str,
    ) -> tuple[str, Optional[NotificationAnalysis]]:
        """Add a notification and analyze it with AI.

        Returns:
            Tuple of (notification_id, analysis_result or None if AI disabled)
        """
        notification_id = self.add_notification(
            title=title,
            message=message,
            severity=severity,
            entity_type=entity_type,
            entity_id=entity_id,
        )

        if self.enable_ai and self.analyzer:
            analysis = self.analyzer.analyze_notification(
                title=title,
                message=message,
                entity_type=entity_type,
                entity_id=entity_id,
            )
            return notification_id, analysis
        return notification_id, None

    def get_high_priority_notifications(
        self,
        severity_threshold: float = 0.7,
        limit: int = 50,
    ) -> list[dict]:
        """Get high-priority notifications only (AI-scored).

        Combines the database query with AI analysis to surface critical alerts.
        """
        if not self.enable_ai or not self.analyzer:
            # Fallback: return recent notifications if AI is disabled
            return self.get_notifications(limit=limit)

        # Fetch recent notifications
        all_notifs = self.get_notifications(
            include_read=True, limit=limit * 2
        )  # Over-fetch to account for filtering

        # Filter by AI priority score
        high_priority = []
        for notif in all_notifs:
            try:
                analysis = self.analyzer.analyze_notification(
                    title=notif["title"],
                    message=notif["message"],
                    entity_type=notif["entity_type"],
                    entity_id=notif["entity_id"],
                )
                if analysis.severity_score >= severity_threshold:
                    notif["ai_analysis"] = {
                        "severity_score": analysis.severity_score,
                        "category": analysis.category,
                        "summary": analysis.summary,
                        "suggested_action": analysis.suggested_action,
                    }
                    high_priority.append(notif)
            except Exception as e:
                # If analysis fails, skip this notification
                print(f"Failed to analyze notification {notif.get('id')}: {e}")

        return high_priority[:limit]

    def get_notifications_by_category(
        self,
        limit: int = 100,
    ) -> dict[str, list[dict]]:
        """Get notifications grouped and sorted by AI-determined category.

        Returns:
            Dict mapping category names to sorted lists of notifications
        """
        if not self.enable_ai or not self.analyzer:
            # Fallback: return by creation time
            return {"notifications": self.get_notifications(limit=limit)}

        all_notifs = self.get_notifications(include_read=True, limit=limit)
        grouped = self.analyzer.group_by_category(all_notifs)

        # Attach AI analysis to each notification
        result = {}
        for category, notif_analysis_pairs in grouped.items():
            result[category] = [
                {
                    **notif,
                    "ai_analysis": {
                        "severity_score": analysis.severity_score,
                        "summary": analysis.summary,
                        "suggested_action": analysis.suggested_action,
                    },
                }
                for notif, analysis in notif_analysis_pairs
            ]

        return result

    def filter_noise(self, limit: int = 100) -> tuple[list[dict], list[dict]]:
        """Separate signal from noise.

        Returns:
            Tuple of (important_notifications, noise_notifications)
        """
        if not self.enable_ai or not self.analyzer:
            return self.get_notifications(limit=limit), []

        all_notifs = self.get_notifications(include_read=True, limit=limit)
        analyzed = self.analyzer.batch_analyze(all_notifs)

        important = []
        noise = []

        for notif, analysis in analyzed:
            notif_with_analysis = {
                **notif,
                "ai_analysis": {
                    "severity_score": analysis.severity_score,
                    "category": analysis.category,
                    "summary": analysis.summary,
                },
            }
            if analysis.is_spam:
                noise.append(notif_with_analysis)
            else:
                important.append(notif_with_analysis)

        return important, noise
