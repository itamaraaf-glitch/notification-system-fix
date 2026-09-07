/**JavaScript wrapper for Advanced AI Analyzer - bridges Node.js and Python components*/

const { spawn } = require('child_process');
const path = require('path');
const sqlite3 = require('sqlite3');

class AdvancedAIAnalyzer {
  constructor(dbPath = 'notifications.db') {
    this.dbPath = dbPath;
  }

  // Wrapper around Python analyzer - use it when available
  // For now, fallback to basic JavaScript implementation
  async batch_analyze(notifications) {
    return notifications.map(notif => [
      notif,
      {
        severity_score: 0.5,
        category: 'informational',
        summary: notif.message ? notif.message.substring(0, 100) : '',
        suggested_action: null,
        is_spam: false
      }
    ]);
  }

  record_feedback(notification_id, predicted_analysis, actual_severity, was_important) {
    // This would integrate with Python if Python module is available
    const db = new sqlite3.Database(this.dbPath);

    const feedback_id = `fb_${notification_id}_${new Date().toISOString()}`;

    db.run(
      `INSERT INTO analyzer_feedback
        (id, notification_id, actual_severity, predicted_severity,
         entity_type, entity_id, category, was_important, created_at)
      SELECT ?, ?, ?, ?, entity_type, entity_id, ?, ?, ?
      FROM notifications
      WHERE id = ?`,
      [
        feedback_id,
        notification_id,
        actual_severity,
        predicted_analysis.severity_score,
        predicted_analysis.category,
        was_important ? 1 : 0,
        new Date().toISOString(),
        notification_id
      ],
      (err) => {
        db.close();
        if (err) console.error('Feedback recording error:', err);
      }
    );
  }

  async get_entity_trends(entity_type, entity_id) {
    const db = new sqlite3.Database(this.dbPath);

    return new Promise((resolve, reject) => {
      db.get(
        `SELECT avg_severity, notification_count
         FROM entity_trends
         WHERE entity_type = ? AND entity_id = ?`,
        [entity_type, entity_id],
        (err, trend) => {
          if (err) {
            db.close();
            reject(err);
            return;
          }

          db.all(
            `SELECT category, frequency, avg_severity
             FROM category_patterns
             WHERE entity_type = ? AND entity_id = ?
             ORDER BY frequency DESC`,
            [entity_type, entity_id],
            (err, categories) => {
              db.close();

              if (err) {
                reject(err);
                return;
              }

              resolve({
                avg_severity: trend ? trend.avg_severity : null,
                notification_count: trend ? trend.notification_count : 0,
                categories: (categories || []).reduce((acc, cat) => {
                  acc[cat.category] = {
                    frequency: cat.frequency,
                    avg_severity: cat.avg_severity
                  };
                  return acc;
                }, {}),
                trend: 'stable'
              });
            }
          );
        }
      );
    });
  }

  async detect_anomalies(entity_type, entity_id, recent_window_hours = 24) {
    const db = new sqlite3.Database(this.dbPath);
    const cutoff = new Date(Date.now() - recent_window_hours * 3600000).toISOString();

    return new Promise((resolve, reject) => {
      db.all(
        `SELECT severity, created_at
         FROM notifications
         WHERE entity_type = ? AND entity_id = ? AND created_at > ?
         ORDER BY created_at DESC`,
        [entity_type, entity_id, cutoff],
        (err, rows) => {
          db.close();

          if (err) {
            reject(err);
            return;
          }

          const anomalies = [];

          if (!rows || rows.length < 3) {
            resolve(anomalies);
            return;
          }

          // Volume spike detection
          const count_per_hour = {};
          rows.forEach(row => {
            const hour = new Date(row.created_at).toISOString().substring(0, 13);
            count_per_hour[hour] = (count_per_hour[hour] || 0) + 1;
          });

          const counts = Object.values(count_per_hour);
          if (counts.length > 0) {
            const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
            const max = Math.max(...counts);

            if (max > avg * 2) {
              anomalies.push({
                type: 'volume_spike',
                severity: 0.6,
                description: `Unusual spike: ${max} in one hour (avg: ${avg.toFixed(1)})`
              });
            }
          }

          // High severity cluster
          const severities = rows
            .map(r => (r.severity === 'HIGH' ? 1 : r.severity === 'MEDIUM' ? 0.5 : 0))
            .filter(s => s > 0);

          if (severities.length >= 3) {
            const avg_sev = severities.reduce((a, b) => a + b) / severities.length;
            if (avg_sev > 0.7) {
              anomalies.push({
                type: 'high_severity_cluster',
                severity: 0.7,
                description: `Consistently high severity (avg: ${avg_sev.toFixed(2)})`
              });
            }
          }

          resolve(anomalies);
        }
      );
    });
  }

  async get_learning_metrics() {
    const db = new sqlite3.Database(this.dbPath);

    return new Promise((resolve, reject) => {
      db.all(
        `SELECT predicted_severity, actual_severity, was_important
         FROM analyzer_feedback
         ORDER BY created_at`,
        (err, feedback) => {
          db.close();

          if (err) {
            reject(err);
            return;
          }

          if (!feedback || feedback.length === 0) {
            resolve({
              feedback_count: 0,
              overall_accuracy: 0,
              status: 'No feedback yet'
            });
            return;
          }

          const total = feedback.length;
          const correct = feedback.filter(f => (f.predicted_severity >= 0.5) === (f.actual_severity >= 0.5)).length;
          const accuracy = correct / total;

          const mid = Math.floor(feedback.length / 2);
          const early_correct = feedback.slice(0, mid).filter(f => (f.predicted_severity >= 0.5) === (f.actual_severity >= 0.5)).length;
          const recent_correct = feedback.slice(mid).filter(f => (f.predicted_severity >= 0.5) === (f.actual_severity >= 0.5)).length;

          const early_accuracy = early_correct / (mid || 1);
          const recent_accuracy = recent_correct / ((total - mid) || 1);

          const mae = feedback.reduce((sum, f) => sum + Math.abs(f.predicted_severity - f.actual_severity), 0) / total;

          resolve({
            feedback_count: total,
            overall_accuracy: accuracy,
            early_accuracy,
            recent_accuracy,
            improvement: recent_accuracy - early_accuracy,
            mean_absolute_error: mae,
            status: recent_accuracy > early_accuracy ? 'learning' : 'stable'
          });
        }
      );
    });
  }
}

module.exports = { AdvancedAIAnalyzer };
