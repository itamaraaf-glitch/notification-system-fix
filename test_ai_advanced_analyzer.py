"""Tests for advanced AI analyzer with learning, trends, and anomalies."""

import unittest
import os
import tempfile
import sqlite3
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock
import json
from ai_advanced_analyzer import AdvancedAIAnalyzer
from ai_notification_analyzer import NotificationAnalysis


class TestAdvancedAIAnalyzer(unittest.TestCase):
    """Test the advanced analyzer with learning and trend detection."""

    def setUp(self):
        self.temp_db = tempfile.NamedTemporaryFile(delete=False, suffix=".db")
        self.temp_db.close()
        self.db_path = self.temp_db.name
        self.analyzer = AdvancedAIAnalyzer(db_path=self.db_path)

    def tearDown(self):
        if os.path.exists(self.db_path):
            os.unlink(self.db_path)

    def test_init_creates_learning_tables(self):
        """Test that initialization creates required database tables."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        tables = cursor.execute(
            """
            SELECT name FROM sqlite_master
            WHERE type='table' AND name IN
            ('analyzer_feedback', 'entity_trends', 'category_patterns')
            """
        ).fetchall()

        conn.close()
        self.assertEqual(len(tables), 3)

    def test_record_feedback_stores_data(self):
        """Test that feedback recording stores predictions vs actual severity."""
        # Create a mock notification in the database first
        conn = sqlite3.connect(self.db_path)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY,
                entity_type TEXT,
                entity_id TEXT,
                title TEXT,
                message TEXT,
                severity TEXT,
                created_at TEXT
            )
            """
        )
        conn.execute(
            """
            INSERT INTO notifications (id, entity_type, entity_id, title, message, severity, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            ("notif_123", "deals", "deal_001", "Test", "Message", "HIGH", datetime.utcnow().isoformat()),
        )
        conn.commit()
        conn.close()

        # Record feedback
        analysis = NotificationAnalysis(
            severity_score=0.8,
            category="urgent",
            summary="Test summary",
            suggested_action="Act now",
            is_spam=False,
        )
        self.analyzer.record_feedback(
            notification_id="notif_123",
            predicted_analysis=analysis,
            actual_severity=0.9,
            was_important=True,
        )

        # Verify feedback was stored
        conn = sqlite3.connect(self.db_path)
        feedback = conn.execute(
            "SELECT predicted_severity, actual_severity, was_important FROM analyzer_feedback LIMIT 1"
        ).fetchone()
        conn.close()

        self.assertIsNotNone(feedback)
        self.assertEqual(feedback[0], 0.8)  # predicted_severity
        self.assertEqual(feedback[1], 0.9)  # actual_severity
        self.assertEqual(feedback[2], 1)    # was_important

    @patch("anthropic.Anthropic")
    def test_analyze_with_context_adjusts_severity(self, mock_anthropic_class):
        """Test that context-aware analysis adjusts severity based on history."""
        # Setup mock Claude response
        mock_client = MagicMock()
        mock_anthropic_class.return_value = mock_client

        mock_response = MagicMock()
        mock_response.content = [MagicMock()]
        mock_response.content[0].text = json.dumps({
            "severity_score": 0.65,
            "category": "action_required",
            "summary": "Test notification",
            "suggested_action": "Review",
            "is_spam": False,
        })
        mock_client.messages.create.return_value = mock_response

        analyzer = AdvancedAIAnalyzer(db_path=self.db_path)
        analyzer.client = mock_client

        # Create notifications table and insert entity trends
        conn = sqlite3.connect(self.db_path)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY,
                entity_type TEXT,
                entity_id TEXT,
                severity REAL,
                created_at TEXT
            )
            """
        )
        conn.execute(
            """
            INSERT INTO entity_trends (entity_type, entity_id, avg_severity, notification_count, last_updated)
            VALUES (?, ?, ?, ?, ?)
            """,
            ("deals", "deal_001", 0.2, 5, datetime.utcnow().isoformat()),
        )
        conn.commit()
        conn.close()

        # Analyze with context - should boost severity since entity usually has low severity
        result = analyzer.analyze_with_context(
            title="High Alert",
            message="Something unusual happened",
            entity_type="deals",
            entity_id="deal_001",
        )

        # Severity should be boosted (0.65 * 1.15 = 0.7475, capped at 1.0)
        self.assertGreater(result.severity_score, 0.65)

    def test_detect_anomalies_volume_spike(self):
        """Test anomaly detection for notification volume spikes."""
        # Create notifications table
        conn = sqlite3.connect(self.db_path)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY,
                entity_type TEXT,
                entity_id TEXT,
                severity REAL,
                created_at TEXT
            )
            """
        )

        # Insert recent notifications with a spike
        base_time = datetime.utcnow()
        notif_id = 0
        # Add baseline notifications (1-2 per hour for older hours)
        for hours_back in range(24, 2, -2):
            for j in range(1):
                created = (base_time - timedelta(hours=hours_back)).isoformat()
                conn.execute(
                    """
                    INSERT INTO notifications (id, entity_type, entity_id, severity, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (f"notif_{notif_id}", "deals", "deal_001", 0.5, created),
                )
                notif_id += 1

        # Add spike in last 2 hours (8+ per hour)
        for hours_back in range(2, 0, -1):
            for j in range(8):
                created = (base_time - timedelta(hours=hours_back, minutes=j*5)).isoformat()
                conn.execute(
                    """
                    INSERT INTO notifications (id, entity_type, entity_id, severity, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (f"notif_{notif_id}", "deals", "deal_001", 0.5, created),
                )
                notif_id += 1

        conn.commit()
        conn.close()

        # Detect anomalies
        anomalies = self.analyzer.detect_anomalies("deals", "deal_001", recent_window_hours=24)

        # Should detect volume spike
        spike_found = any(a["type"] == "volume_spike" for a in anomalies)
        self.assertTrue(spike_found)

    def test_detect_anomalies_high_severity_cluster(self):
        """Test anomaly detection for consistently high severity."""
        conn = sqlite3.connect(self.db_path)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY,
                entity_type TEXT,
                entity_id TEXT,
                severity REAL,
                created_at TEXT
            )
            """
        )

        # Insert high severity notifications
        base_time = datetime.utcnow()
        for i in range(5):
            conn.execute(
                """
                INSERT INTO notifications (id, entity_type, entity_id, severity, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (f"notif_{i}", "deals", "deal_001", 0.85, (base_time - timedelta(hours=i)).isoformat()),
            )

        conn.commit()
        conn.close()

        anomalies = self.analyzer.detect_anomalies("deals", "deal_001", recent_window_hours=24)

        # Should detect high severity cluster
        high_sev_found = any(a["type"] == "high_severity_cluster" for a in anomalies)
        self.assertTrue(high_sev_found)

    def test_detect_anomalies_severity_volatility(self):
        """Test anomaly detection for high variance in severity."""
        conn = sqlite3.connect(self.db_path)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY,
                entity_type TEXT,
                entity_id TEXT,
                severity REAL,
                created_at TEXT
            )
            """
        )

        # Insert highly variable severity notifications (alternating between 0.05 and 0.99)
        severities = [0.05, 0.99, 0.05, 0.99, 0.05, 0.99, 0.05, 0.99]
        base_time = datetime.utcnow()
        for i, sev in enumerate(severities):
            conn.execute(
                """
                INSERT INTO notifications (id, entity_type, entity_id, severity, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (f"notif_{i}", "deals", "deal_001", sev, (base_time - timedelta(hours=i)).isoformat()),
            )

        conn.commit()
        conn.close()

        anomalies = self.analyzer.detect_anomalies("deals", "deal_001", recent_window_hours=24)

        # Should detect severity volatility (std dev should be high with 0.05 vs 0.99)
        volatility_found = any(a["type"] == "severity_volatility" for a in anomalies)
        self.assertTrue(volatility_found)

    def test_get_entity_trends_returns_stats(self):
        """Test entity trends calculation."""
        conn = sqlite3.connect(self.db_path)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY,
                entity_type TEXT,
                entity_id TEXT,
                severity REAL,
                created_at TEXT
            )
            """
        )

        # Insert trend data
        conn.execute(
            """
            INSERT INTO entity_trends (entity_type, entity_id, avg_severity, notification_count, last_updated)
            VALUES (?, ?, ?, ?, ?)
            """,
            ("deals", "deal_001", 0.6, 10, datetime.utcnow().isoformat()),
        )

        conn.execute(
            """
            INSERT INTO category_patterns (entity_type, entity_id, category, frequency, avg_severity, last_updated)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            ("deals", "deal_001", "urgent", 7, 0.8, datetime.utcnow().isoformat()),
        )

        conn.commit()
        conn.close()

        trends = self.analyzer.get_entity_trends("deals", "deal_001")

        self.assertEqual(trends["avg_severity"], 0.6)
        self.assertEqual(trends["notification_count"], 10)
        self.assertIn("urgent", trends["categories"])
        self.assertEqual(trends["categories"]["urgent"]["frequency"], 7)

    def test_get_learning_metrics_calculates_accuracy(self):
        """Test learning metrics calculation."""
        conn = sqlite3.connect(self.db_path)

        # Insert feedback records
        for i in range(10):
            # First 5: correct predictions (pred >= 0.5, actual >= 0.5)
            pred = 0.7 if i < 5 else 0.2
            actual = 0.8 if i < 5 else 0.1
            conn.execute(
                """
                INSERT INTO analyzer_feedback
                    (id, notification_id, actual_severity, predicted_severity,
                     entity_type, entity_id, category, was_important, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"fb_{i}",
                    f"notif_{i}",
                    actual,
                    pred,
                    "deals",
                    "deal_001",
                    "urgent",
                    1,
                    datetime.utcnow().isoformat(),
                ),
            )

        conn.commit()
        conn.close()

        metrics = self.analyzer.get_learning_metrics()

        self.assertEqual(metrics["feedback_count"], 10)
        self.assertGreater(metrics["overall_accuracy"], 0.8)
        self.assertIn("mean_absolute_error", metrics)
        self.assertIn("improvement", metrics)


if __name__ == "__main__":
    unittest.main()
