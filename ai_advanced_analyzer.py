"""Advanced AI features: learning, trends, anomaly detection."""

import sqlite3
from datetime import datetime, timedelta
from typing import Optional
from collections import defaultdict
import statistics
from ai_notification_analyzer import AINotificationAnalyzer, NotificationAnalysis


class AdvancedAIAnalyzer(AINotificationAnalyzer):
    """Extended analyzer with feedback learning, trends, and anomaly detection."""

    def __init__(self, db_path: str = "notifications.db", api_key: Optional[str] = None):
        super().__init__(api_key=api_key)
        self.db_path = db_path
        self._init_learning_db()

    def _init_learning_db(self):
        """Create tables for learning feedback and trend data."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS analyzer_feedback (
                    id TEXT PRIMARY KEY,
                    notification_id TEXT NOT NULL,
                    actual_severity REAL NOT NULL,
                    predicted_severity REAL NOT NULL,
                    entity_type TEXT NOT NULL,
                    entity_id TEXT NOT NULL,
                    category TEXT NOT NULL,
                    was_important INTEGER NOT NULL,
                    created_at TEXT NOT NULL
                )
            """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS entity_trends (
                    entity_type TEXT NOT NULL,
                    entity_id TEXT NOT NULL,
                    avg_severity REAL,
                    notification_count INTEGER,
                    last_updated TEXT NOT NULL,
                    PRIMARY KEY (entity_type, entity_id)
                )
            """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS category_patterns (
                    entity_type TEXT NOT NULL,
                    entity_id TEXT NOT NULL,
                    category TEXT NOT NULL,
                    frequency INTEGER NOT NULL,
                    avg_severity REAL,
                    last_updated TEXT NOT NULL,
                    PRIMARY KEY (entity_type, entity_id, category)
                )
            """
            )

    def record_feedback(
        self,
        notification_id: str,
        predicted_analysis: NotificationAnalysis,
        actual_severity: float,
        was_important: bool,
    ) -> None:
        """Record user feedback on notification analysis.

        Args:
            notification_id: ID of the notification
            predicted_analysis: The original AI prediction
            actual_severity: User's assessment of actual severity (0-1)
            was_important: Whether user marked as important
        """
        feedback_id = f"fb_{notification_id}_{datetime.utcnow().isoformat()}"

        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO analyzer_feedback
                    (id, notification_id, actual_severity, predicted_severity,
                     entity_type, entity_id, category, was_important, created_at)
                SELECT ?, ?, ?, ?, entity_type, entity_id, ?, ?, ?
                FROM notifications
                WHERE id = ?
                """,
                (
                    feedback_id,
                    notification_id,
                    actual_severity,
                    predicted_analysis.severity_score,
                    predicted_analysis.category,
                    was_important,
                    datetime.utcnow().isoformat(),
                    notification_id,
                ),
            )

    def get_entity_trends(
        self, entity_type: str, entity_id: str
    ) -> dict:
        """Get historical trends for an entity.

        Returns dict with:
            - avg_severity: Average severity of notifications
            - notification_count: Total notifications
            - categories: Dict of category -> frequency
            - trend: "increasing" / "stable" / "decreasing" severity
        """
        with sqlite3.connect(self.db_path) as conn:
            # Get entity trend stats
            trend = conn.execute(
                """
                SELECT avg_severity, notification_count
                FROM entity_trends
                WHERE entity_type = ? AND entity_id = ?
                """,
                (entity_type, entity_id),
            ).fetchone()

            # Get category patterns
            categories = conn.execute(
                """
                SELECT category, frequency, avg_severity
                FROM category_patterns
                WHERE entity_type = ? AND entity_id = ?
                ORDER BY frequency DESC
                """,
                (entity_type, entity_id),
            ).fetchall()

            # Calculate trend direction (comparing recent vs older)
            seven_days_ago = (datetime.utcnow() - timedelta(days=7)).isoformat()
            recent = conn.execute(
                """
                SELECT AVG(CAST(severity AS FLOAT))
                FROM notifications
                WHERE entity_type = ? AND entity_id = ? AND created_at > ?
                """,
                (entity_type, entity_id, seven_days_ago),
            ).fetchone()[0]

            older = conn.execute(
                """
                SELECT AVG(CAST(severity AS FLOAT))
                FROM notifications
                WHERE entity_type = ? AND entity_id = ? AND created_at <= ?
                """,
                (entity_type, entity_id, seven_days_ago),
            ).fetchone()[0]

            trend_direction = "stable"
            if recent and older:
                if recent > older * 1.1:
                    trend_direction = "increasing"
                elif recent < older * 0.9:
                    trend_direction = "decreasing"

        return {
            "avg_severity": trend[0] if trend else None,
            "notification_count": trend[1] if trend else 0,
            "categories": {cat[0]: {"frequency": cat[1], "avg_severity": cat[2]} for cat in categories},
            "trend": trend_direction,
        }

    def detect_anomalies(
        self, entity_type: str, entity_id: str, recent_window_hours: int = 24
    ) -> list[dict]:
        """Detect unusual notification patterns.

        Returns list of detected anomalies with severity and description.
        """
        anomalies = []
        cutoff = (datetime.utcnow() - timedelta(hours=recent_window_hours)).isoformat()

        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row

            # Get recent notifications
            recent = conn.execute(
                """
                SELECT severity, created_at
                FROM notifications
                WHERE entity_type = ? AND entity_id = ? AND created_at > ?
                ORDER BY created_at DESC
                """,
                (entity_type, entity_id, cutoff),
            ).fetchall()

            if len(recent) < 3:
                return anomalies

            # Check for spike in notification volume
            count_per_hour = defaultdict(int)
            for notif in recent:
                hour = notif["created_at"][:13]  # YYYY-MM-DDTHH
                count_per_hour[hour] += 1

            if count_per_hour:
                avg_per_hour = sum(count_per_hour.values()) / len(count_per_hour)
                max_per_hour = max(count_per_hour.values())
                if max_per_hour > avg_per_hour * 2:
                    anomalies.append({
                        "type": "volume_spike",
                        "severity": 0.6,
                        "description": f"Unusual spike in notifications: {max_per_hour} in one hour (avg: {avg_per_hour:.1f})",
                    })

            # Check for consistent high severity
            severities = [float(n["severity"]) for n in recent]
            if len(severities) >= 3:
                avg_severity = statistics.mean(severities)
                stdev = statistics.stdev(severities) if len(severities) > 1 else 0

                if avg_severity > 0.7:
                    anomalies.append({
                        "type": "high_severity_cluster",
                        "severity": 0.7,
                        "description": f"Consistently high severity notifications (avg: {avg_severity:.2f})",
                    })

                # Check for unusual variance
                if stdev > 0.5:
                    anomalies.append({
                        "type": "severity_volatility",
                        "severity": 0.5,
                        "description": f"Highly variable severity (std: {stdev:.2f}) - check for classification issues",
                    })

        return anomalies

    def analyze_with_context(
        self,
        title: str,
        message: str,
        entity_type: str,
        entity_id: str,
    ) -> NotificationAnalysis:
        """Analyze notification with historical context and trends.

        Adjusts AI scoring based on entity history and patterns.
        """
        # Get base analysis
        base_analysis = self.analyze_notification(
            title=title,
            message=message,
            entity_type=entity_type,
            entity_id=entity_id,
        )

        # Get entity trends
        trends = self.get_entity_trends(entity_type, entity_id)
        anomalies = self.detect_anomalies(entity_type, entity_id)

        # Adjust severity based on context
        adjusted_severity = base_analysis.severity_score

        # If entity usually has low severity but this is high, it's more significant
        if trends["avg_severity"] and trends["avg_severity"] < 0.3:
            if base_analysis.severity_score > 0.6:
                adjusted_severity = min(1.0, base_analysis.severity_score * 1.15)

        # If entity usually has high severity, slightly discount
        if trends["avg_severity"] and trends["avg_severity"] > 0.7:
            if base_analysis.severity_score < 0.8:
                adjusted_severity = max(0.0, base_analysis.severity_score * 0.9)

        # Boost severity if anomalies detected
        if anomalies:
            adjusted_severity = min(1.0, adjusted_severity + 0.1 * len(anomalies))

        # Return adjusted analysis
        return NotificationAnalysis(
            severity_score=adjusted_severity,
            category=base_analysis.category,
            summary=base_analysis.summary,
            suggested_action=base_analysis.suggested_action,
            is_spam=base_analysis.is_spam,
        )

    def get_learning_metrics(self) -> dict:
        """Get metrics on analyzer learning and accuracy.

        Returns:
            Dict with accuracy, precision, and improvement over time.
        """
        with sqlite3.connect(self.db_path) as conn:
            # Get feedback records
            feedback = conn.execute(
                """
                SELECT predicted_severity, actual_severity, was_important
                FROM analyzer_feedback
                ORDER BY created_at
                """
            ).fetchall()

            if not feedback:
                return {"feedback_count": 0, "status": "No feedback yet"}

            # Calculate metrics
            total = len(feedback)
            correct_direction = sum(
                1 for pred, actual, _ in feedback
                if (pred >= 0.5) == (actual >= 0.5)  # Correct binary prediction
            )
            accuracy = correct_direction / total if total > 0 else 0

            # Split into early and recent for trend
            mid = len(feedback) // 2
            early_accuracy = sum(
                1 for pred, actual, _ in feedback[:mid]
                if (pred >= 0.5) == (actual >= 0.5)
            ) / (mid or 1)

            recent_accuracy = sum(
                1 for pred, actual, _ in feedback[mid:]
                if (pred >= 0.5) == (actual >= 0.5)
            ) / ((total - mid) or 1)

            # Calculate MAE (Mean Absolute Error)
            mae = sum(abs(pred - actual) for pred, actual, _ in feedback) / total

            return {
                "feedback_count": total,
                "overall_accuracy": accuracy,
                "early_accuracy": early_accuracy,
                "recent_accuracy": recent_accuracy,
                "improvement": recent_accuracy - early_accuracy,
                "mean_absolute_error": mae,
                "status": "learning" if recent_accuracy > early_accuracy else "stable",
            }
