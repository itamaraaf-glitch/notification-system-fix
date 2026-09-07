#!/usr/bin/env node
/**AI autonomous agent - analyzes, learns, and improves over time*/

const sqlite3 = require('sqlite3');
const { ensureSchema } = require('./db-schema');
const path = require('path');
const { AdvancedAIAnalyzer } = require('./ai_advanced_analyzer_wrapper');
const EventEmitter = require('events');

class NotificationAIAgent extends EventEmitter {
  constructor(config = {}) {
    super();
    this.dbPath = config.dbPath || 'notifications.db';
    this.analyzer = new AdvancedAIAnalyzer(this.dbPath);
    this.config = {
      autoAnalyzeInterval: config.autoAnalyzeInterval || 300000, // 5 minutes
      feedbackThreshold: config.feedbackThreshold || 0.7,
      anomalyCheckInterval: config.anomalyCheckInterval || 600000, // 10 minutes
      batchSize: config.batchSize || 50,
      ...config
    };
    this.isRunning = false;
    this.stats = {
      analyzed: 0,
      learned: 0,
      anomaliesDetected: 0,
      accuracy: 0
    };
  }

  // Get unanalyzed notifications
  async getUnanalyzedNotifications(limit = 50) {
    const db = await this.getDb();

    return new Promise((resolve, reject) => {
      const query = `
        SELECT n.* FROM notifications n
        WHERE NOT EXISTS (
          SELECT 1 FROM analyzer_feedback af
          WHERE af.notification_id = n.id
        )
        LIMIT ?
      `;

      db.all(query, [limit], (err, rows) => {
        db.close();
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  // Analyze batch of notifications
  async analyzeBatch() {
    try {
      const notifications = await this.getUnanalyzedNotifications(this.config.batchSize);

      if (notifications.length === 0) {
        this.emit('batch-complete', { analyzed: 0, message: 'No new notifications to analyze' });
        return;
      }

      const results = await this.analyzer.batch_analyze(notifications);

      // Auto-record predictions for learning
      for (const [notif, analysis] of results) {
        // Assume high confidence = probably correct
        if (analysis.severity_score >= 0.8) {
          // Record as learned feedback
          this.analyzer.record_feedback(
            notif.id,
            analysis,
            analysis.severity_score, // Use prediction as actual (confidence-based)
            !analysis.is_spam
          );
          this.stats.learned++;
        }
      }

      this.stats.analyzed += notifications.length;

      this.emit('batch-analyzed', {
        count: notifications.length,
        predictions: results.map(([n, a]) => ({
          id: n.id,
          severity: a.severity_score,
          category: a.category,
          isSpam: a.is_spam
        }))
      });

    } catch (error) {
      this.emit('error', { phase: 'batch-analysis', error: error.message });
    }
  }

  // Detect anomalies across all entities
  async detectAnomalies() {
    try {
      const db = await this.getDb();

      const entities = await new Promise((resolve, reject) => {
        db.all(
          'SELECT DISTINCT entity_type, entity_id FROM notifications',
          (err, rows) => {
            db.close();
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });

      const allAnomalies = [];

      for (const { entity_type, entity_id } of entities) {
        const anomalies = await this.analyzer.detect_anomalies(entity_type, entity_id);
        if (anomalies.length > 0) {
          allAnomalies.push({
            entity: `${entity_type}/${entity_id}`,
            anomalies
          });
        }
      }

      this.stats.anomaliesDetected += allAnomalies.length;

      if (allAnomalies.length > 0) {
        this.emit('anomalies-detected', allAnomalies);
      }

    } catch (error) {
      this.emit('error', { phase: 'anomaly-detection', error: error.message });
    }
  }

  // Calculate learning progress
  async updateLearningMetrics() {
    try {
      const metrics = await this.analyzer.get_learning_metrics();

      this.stats.accuracy = metrics.overall_accuracy;

      const improvement = metrics.improvement;
      if (improvement > 0.05) {
        this.emit('improvement-detected', {
          message: `AI improving! ${(improvement * 100).toFixed(1)}% better`,
          metrics
        });
      }

      return metrics;
    } catch (error) {
      this.emit('error', { phase: 'metrics-update', error: error.message });
    }
  }

  // Get high-priority alerts
  async checkCriticalAlerts() {
    try {
      const db = await this.getDb();

      const critical = await new Promise((resolve, reject) => {
        const query = `
          SELECT * FROM notifications
          WHERE severity = 'HIGH'
          AND created_at > datetime('now', '-1 hour')
          ORDER BY created_at DESC
          LIMIT 10
        `;

        db.all(query, (err, rows) => {
          db.close();
          if (err) reject(err);
          else resolve(rows || []);
        });
      });

      if (critical.length > 0) {
        this.emit('critical-alerts', {
          count: critical.length,
          alerts: critical
        });
      }

    } catch (error) {
      this.emit('error', { phase: 'critical-check', error: error.message });
    }
  }

  // Full agent cycle
  async runCycle() {
    this.emit('cycle-start', { timestamp: new Date().toISOString() });

    try {
      // Phase 1: Analyze new notifications
      await this.analyzeBatch();

      // Phase 2: Detect anomalies
      await this.detectAnomalies();

      // Phase 3: Update learning metrics
      const metrics = await this.updateLearningMetrics();

      // Phase 4: Check critical alerts
      await this.checkCriticalAlerts();

      this.emit('cycle-complete', {
        stats: this.stats,
        metrics,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      this.emit('error', { phase: 'cycle', error: error.message });
    }
  }

  // Start agent loop
  start() {
    if (this.isRunning) {
      this.emit('warning', 'Agent already running');
      return;
    }

    this.isRunning = true;
    this.emit('start', { config: this.config });

    // Initial run
    this.runCycle();

    // Scheduled runs
    this.analyzeInterval = setInterval(() => this.runCycle(), this.config.autoAnalyzeInterval);
  }

  // Stop agent
  stop() {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.analyzeInterval) {
      clearInterval(this.analyzeInterval);
    }

    this.emit('stop', { stats: this.stats });
  }

  // Get current status
  getStatus() {
    return {
      isRunning: this.isRunning,
      stats: this.stats,
      config: this.config
    };
  }

  // Database helper. The schema is ensured on every open so a JavaScript-only
  // run never hits a missing learning table (see db-schema.js).
  getDb() {
    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) { reject(err); return; }
        ensureSchema(db).then(() => resolve(db)).catch(reject);
      });
    });
  }

  // CLI reporting
  reportCycle(result) {
    const timestamp = result.timestamp || new Date().toISOString();
    const timePart = new Date(timestamp).toLocaleTimeString('he-IL');

    console.log(`\n${'='.repeat(60)}`);
    console.log(`⚙️ סוכן AI - מחזור עדכון (${timePart})`);
    console.log(`${'='.repeat(60)}`);

    if (result.stats) {
      console.log(`\n📊 סטטיסטיקות:`);
      console.log(`   • התראות שנותחו: ${result.stats.analyzed}`);
      console.log(`   • משובים שנלמדו: ${result.stats.learned}`);
      console.log(`   • חריגויות שהתגלו: ${result.stats.anomaliesDetected}`);
      console.log(`   • דיוק עדכני: ${(result.stats.accuracy * 100).toFixed(1)}%`);
    }

    if (result.metrics) {
      console.log(`\n🧠 מדדי למידה:`);
      console.log(`   • משובים כוללים: ${result.metrics.feedback_count}`);
      console.log(`   • דיוק כללי: ${(result.metrics.overall_accuracy * 100).toFixed(1)}%`);
      if (result.metrics.improvement > 0) {
        console.log(`   • ✅ שיפור: +${(result.metrics.improvement * 100).toFixed(1)}%`);
      }
      console.log(`   • Mean Absolute Error: ${result.metrics.mean_absolute_error.toFixed(3)}`);
    }

    console.log(`${'='.repeat(60)}\n`);
  }
}

// CLI Usage
if (require.main === module) {
  const agent = new NotificationAIAgent({
    autoAnalyzeInterval: 30000, // 30 seconds for demo
    batchSize: 20
  });

  // Event listeners for CLI
  agent.on('start', (data) => {
    console.log('🤖 סוכן AI הופעל');
    console.log(`   ⏱️  מחזור: כל ${data.config.autoAnalyzeInterval / 1000} שניות`);
  });

  agent.on('batch-analyzed', (data) => {
    console.log(`✅ ניתחנו ${data.count} התראות חדשות`);
  });

  agent.on('anomalies-detected', (data) => {
    console.log(`⚠️ התגלו ${data.length} חריגויות:`);
    data.forEach(item => {
      console.log(`   • ${item.entity}: ${item.anomalies.length} חריגויות`);
    });
  });

  agent.on('critical-alerts', (data) => {
    console.log(`🔴 ${data.count} התראות קריטיות בשעה האחרונה`);
  });

  agent.on('improvement-detected', (data) => {
    console.log(`📈 ${data.message}`);
  });

  agent.on('cycle-complete', (data) => {
    agent.reportCycle(data);
  });

  agent.on('error', (error) => {
    console.error(`❌ שגיאה בשלב "${error.phase}": ${error.error}`);
  });

  agent.on('stop', (data) => {
    console.log('🛑 סוכן AI עוצר');
    console.log(`\n📊 סיכום התוכן:`);
    console.log(`   • סך הכל שנותחו: ${data.stats.analyzed}`);
    console.log(`   • סך הכל למדו: ${data.stats.learned}`);
    console.log(`   • דיוק סופי: ${(data.stats.accuracy * 100).toFixed(1)}%`);
    process.exit(0);
  });

  // Start agent
  agent.start();

  // Graceful shutdown
  process.on('SIGINT', () => agent.stop());
}

module.exports = NotificationAIAgent;
