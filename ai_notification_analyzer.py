"""AI-powered notification analysis and classification using Claude."""

import anthropic
import json
from dataclasses import dataclass
from typing import Optional


@dataclass
class NotificationAnalysis:
    """Result of AI analysis on a notification."""
    severity_score: float  # 0.0-1.0 where 1.0 is highest priority
    category: str  # e.g., "urgent", "informational", "action_required"
    summary: str  # Short human-readable summary
    suggested_action: Optional[str]  # What the user should do
    is_spam: bool  # True if detected as spam/noise


class AINotificationAnalyzer:
    """Analyzes and classifies notifications using Claude."""

    def __init__(self, api_key: Optional[str] = None):
        """Initialize with Anthropic API key (defaults to ANTHROPIC_API_KEY env var)."""
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = "claude-opus-4-1-20250805"

    def analyze_notification(
        self,
        title: str,
        message: str,
        entity_type: str,
        entity_id: str,
    ) -> NotificationAnalysis:
        """Analyze a single notification and return structured insights.

        Uses Claude to:
        - Score urgency/priority (0-1)
        - Classify into semantic categories
        - Generate concise summary
        - Suggest next action
        - Detect if it's likely spam/noise
        """
        prompt = f"""Analyze this notification and provide structured insights:

Title: {title}
Message: {message}
Entity Type: {entity_type}
Entity ID: {entity_id}

Respond with valid JSON (no markdown, no code blocks) matching this schema:
{{
  "severity_score": <float 0-1, where 1.0 is most urgent>,
  "category": "<one of: urgent, action_required, informational, alert, status>",
  "summary": "<2-3 sentence summary of what happened>",
  "suggested_action": "<what should the user do, or null if none>",
  "is_spam": <boolean true if this looks like noise or duplicate>
}}

Be conservative with severity: only 0.8+ if truly time-critical."""

        response = self.client.messages.create(
            model=self.model,
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}],
        )

        response_text = response.content[0].text.strip()

        # Remove markdown code blocks if present
        if response_text.startswith("```"):
            response_text = response_text.split("```")[1].strip()
            if response_text.startswith("json"):
                response_text = response_text[4:].strip()

        result = json.loads(response_text)

        return NotificationAnalysis(
            severity_score=result["severity_score"],
            category=result["category"],
            summary=result["summary"],
            suggested_action=result["suggested_action"],
            is_spam=result["is_spam"],
        )

    def batch_analyze(
        self,
        notifications: list[dict],
    ) -> list[tuple[dict, NotificationAnalysis]]:
        """Analyze multiple notifications efficiently.

        Args:
            notifications: List of dicts with keys: title, message, entity_type, entity_id

        Returns:
            List of (original_notification, analysis) tuples
        """
        results = []
        for notif in notifications:
            try:
                analysis = self.analyze_notification(
                    title=notif["title"],
                    message=notif["message"],
                    entity_type=notif["entity_type"],
                    entity_id=notif["entity_id"],
                )
                results.append((notif, analysis))
            except (json.JSONDecodeError, KeyError, anthropic.APIError) as e:
                # On error, return a neutral analysis
                print(f"Error analyzing notification {notif.get('id', '?')}: {e}")
                results.append(
                    (
                        notif,
                        NotificationAnalysis(
                            severity_score=0.5,
                            category="informational",
                            summary=notif.get("message", "")[:100],
                            suggested_action=None,
                            is_spam=False,
                        ),
                    )
                )
        return results

    def filter_high_priority(
        self,
        notifications: list[dict],
        threshold: float = 0.7,
    ) -> list[tuple[dict, NotificationAnalysis]]:
        """Get only high-priority notifications (score >= threshold).

        Useful for dashboards that show only critical alerts.
        """
        analyzed = self.batch_analyze(notifications)
        return [
            (notif, analysis)
            for notif, analysis in analyzed
            if analysis.severity_score >= threshold and not analysis.is_spam
        ]

    def group_by_category(
        self,
        notifications: list[dict],
    ) -> dict[str, list[tuple[dict, NotificationAnalysis]]]:
        """Analyze and group notifications by semantic category.

        Returns dict mapping category name to list of (notification, analysis) pairs.
        """
        analyzed = self.batch_analyze(notifications)
        grouped: dict[str, list[tuple[dict, NotificationAnalysis]]] = {}

        for notif, analysis in analyzed:
            category = analysis.category
            if category not in grouped:
                grouped[category] = []
            grouped[category].append((notif, analysis))

        # Sort each group by severity descending
        for category in grouped:
            grouped[category].sort(
                key=lambda x: x[1].severity_score, reverse=True
            )

        return grouped
