"""Tests for AI notification analysis."""

import unittest
import json
import os
import tempfile
from unittest.mock import patch, MagicMock
from ai_notification_analyzer import AINotificationAnalyzer, NotificationAnalysis
from notification_system_ai import AISmartNotificationManager


class TestAINotificationAnalyzer(unittest.TestCase):
    """Test the AI analyzer (mocked to avoid API calls)."""

    def setUp(self):
        self.analyzer = AINotificationAnalyzer(api_key="test-key")

    @patch("anthropic.Anthropic")
    def test_analyze_notification_urgent(self, mock_anthropic_class):
        """Test analyzing an urgent notification."""
        mock_client = MagicMock()
        mock_anthropic_class.return_value = mock_client

        # Mock Claude's response
        mock_response = MagicMock()
        mock_response.content = [MagicMock()]
        mock_response.content[0].text = json.dumps({
            "severity_score": 0.95,
            "category": "urgent",
            "summary": "Critical system failure detected.",
            "suggested_action": "Contact support immediately.",
            "is_spam": False,
        })
        mock_client.messages.create.return_value = mock_response

        analyzer = AINotificationAnalyzer(api_key="test-key")
        analyzer.client = mock_client

        analysis = analyzer.analyze_notification(
            title="Database Connection Failed",
            message="Cannot connect to main database server.",
            entity_type="system",
            entity_id="db_001",
        )

        self.assertEqual(analysis.severity_score, 0.95)
        self.assertEqual(analysis.category, "urgent")
        self.assertFalse(analysis.is_spam)
        self.assertIn("Critical", analysis.summary)

    @patch("anthropic.Anthropic")
    def test_analyze_notification_spam(self, mock_anthropic_class):
        """Test analyzing a spam notification."""
        mock_client = MagicMock()
        mock_anthropic_class.return_value = mock_client

        mock_response = MagicMock()
        mock_response.content = [MagicMock()]
        mock_response.content[0].text = json.dumps({
            "severity_score": 0.1,
            "category": "informational",
            "summary": "Newsletter subscription update.",
            "suggested_action": None,
            "is_spam": True,
        })
        mock_client.messages.create.return_value = mock_response

        analyzer = AINotificationAnalyzer(api_key="test-key")
        analyzer.client = mock_client

        analysis = analyzer.analyze_notification(
            title="Weekly Newsletter",
            message="Check out this week's top stories.",
            entity_type="newsletter",
            entity_id="weekly_001",
        )

        self.assertTrue(analysis.is_spam)
        self.assertLess(analysis.severity_score, 0.5)

    @patch("anthropic.Anthropic")
    def test_batch_analyze(self, mock_anthropic_class):
        """Test analyzing multiple notifications."""
        mock_client = MagicMock()
        mock_anthropic_class.return_value = mock_client

        # Setup response for each batch call
        responses = [
            json.dumps({
                "severity_score": 0.85,
                "category": "action_required",
                "summary": "Deal needs review.",
                "suggested_action": "Review and approve.",
                "is_spam": False,
            }),
            json.dumps({
                "severity_score": 0.2,
                "category": "informational",
                "summary": "User profile update.",
                "suggested_action": None,
                "is_spam": False,
            }),
        ]

        def side_effect(*args, **kwargs):
            response = MagicMock()
            response.content = [MagicMock()]
            response.content[0].text = responses.pop(0)
            return response

        mock_client.messages.create.side_effect = side_effect

        analyzer = AINotificationAnalyzer(api_key="test-key")
        analyzer.client = mock_client

        notifications = [
            {
                "title": "New Deal",
                "message": "High-value deal requires approval.",
                "entity_type": "deals",
                "entity_id": "deal_123",
            },
            {
                "title": "Profile Updated",
                "message": "Your profile was updated successfully.",
                "entity_type": "users",
                "entity_id": "user_456",
            },
        ]

        results = analyzer.batch_analyze(notifications)

        self.assertEqual(len(results), 2)
        self.assertEqual(results[0][1].severity_score, 0.85)
        self.assertEqual(results[1][1].severity_score, 0.2)

    @patch("anthropic.Anthropic")
    def test_filter_high_priority(self, mock_anthropic_class):
        """Test filtering notifications by priority."""
        mock_client = MagicMock()
        mock_anthropic_class.return_value = mock_client

        # High priority response
        mock_response = MagicMock()
        mock_response.content = [MagicMock()]
        mock_response.content[0].text = json.dumps({
            "severity_score": 0.9,
            "category": "urgent",
            "summary": "Critical issue.",
            "suggested_action": "Act now.",
            "is_spam": False,
        })
        mock_client.messages.create.return_value = mock_response

        analyzer = AINotificationAnalyzer(api_key="test-key")
        analyzer.client = mock_client

        notifications = [
            {
                "title": "Critical Error",
                "message": "System down.",
                "entity_type": "system",
                "entity_id": "sys_001",
            }
        ]

        high_priority = analyzer.filter_high_priority(
            notifications, threshold=0.7
        )

        self.assertEqual(len(high_priority), 1)


class TestAISmartNotificationManager(unittest.TestCase):
    """Test the enhanced notification manager."""

    def setUp(self):
        self.temp_db = tempfile.NamedTemporaryFile(
            delete=False, suffix=".db"
        )
        self.temp_db.close()
        self.db_path = self.temp_db.name

    def tearDown(self):
        if os.path.exists(self.db_path):
            os.unlink(self.db_path)

    def test_manager_init_without_ai(self):
        """Test manager works without AI enabled."""
        manager = AISmartNotificationManager(
            db_path=self.db_path, enable_ai=False
        )
        self.assertIsNone(manager.analyzer)

    def test_manager_init_with_ai(self):
        """Test manager initialization with AI."""
        with patch("anthropic.Anthropic"):
            manager = AISmartNotificationManager(
                db_path=self.db_path, enable_ai=True
            )
            self.assertIsNotNone(manager.analyzer)

    def test_add_notification_without_ai(self):
        """Test adding notification without AI analysis."""
        manager = AISmartNotificationManager(
            db_path=self.db_path, enable_ai=False
        )
        manager.register_entity("deals", "deal_123")

        notif_id, analysis = manager.add_notification_with_ai_analysis(
            title="Test",
            message="Test message",
            severity="INFO",
            entity_type="deals",
            entity_id="deal_123",
        )

        self.assertIsNotNone(notif_id)
        self.assertIsNone(analysis)

    @patch("anthropic.Anthropic")
    def test_add_notification_with_ai(self, mock_anthropic_class):
        """Test adding notification with AI analysis."""
        mock_client = MagicMock()
        mock_anthropic_class.return_value = mock_client

        mock_response = MagicMock()
        mock_response.content = [MagicMock()]
        mock_response.content[0].text = json.dumps({
            "severity_score": 0.6,
            "category": "action_required",
            "summary": "Test summary.",
            "suggested_action": "Review.",
            "is_spam": False,
        })
        mock_client.messages.create.return_value = mock_response

        manager = AISmartNotificationManager(
            db_path=self.db_path, enable_ai=True
        )
        manager.analyzer.client = mock_client
        manager.register_entity("deals", "deal_123")

        notif_id, analysis = manager.add_notification_with_ai_analysis(
            title="Test",
            message="Test message",
            severity="INFO",
            entity_type="deals",
            entity_id="deal_123",
        )

        self.assertIsNotNone(notif_id)
        self.assertIsNotNone(analysis)
        self.assertEqual(analysis.severity_score, 0.6)

    def test_filter_noise(self):
        """Test filtering noise from important notifications."""
        manager = AISmartNotificationManager(
            db_path=self.db_path, enable_ai=False
        )
        manager.register_entity("deals", "deal_123")
        manager.add_notification(
            title="Important", message="Deal alert", severity="HIGH",
            entity_type="deals", entity_id="deal_123"
        )

        important, noise = manager.filter_noise()

        # Without AI, should return all as important
        self.assertEqual(len(important), 1)
        self.assertEqual(len(noise), 0)


if __name__ == "__main__":
    unittest.main()
