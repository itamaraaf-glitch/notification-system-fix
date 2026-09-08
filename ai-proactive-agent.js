#!/usr/bin/env node
/**Proactive AI Agent - initiates actions autonomously based on system state*/

const NotificationAIAgent = require('./ai-agent');
const sqlite3 = require('sqlite3');
const EventEmitter = require('events');
const { loadRules } = require('./ai-config');

class ProactiveAIAgent extends NotificationAIAgent {
  constructor(config = {}) {
    super(config);
    // הכללים שלפיהם הסוכן מחליט — ברירות מחדל, ai-config.json, משתני סביבה, ואז config
    this.rules = loadRules(config.rules || {});
    this.proactiveConfig = {
      escalationThreshold: config.escalationThreshold || 0.8,      // דרוג בעיות גבוהות
      autoResponseThreshold: config.autoResponseThreshold || 0.75,  // תגובה אוטומטית
      emergencyThreshold: config.emergencyThreshold || 0.9,         // חירום
      decisionInterval: config.decisionInterval || this.rules.decisionIntervalMs,
      ...config
    };

    this.decisions = [];
    this.actions = [];
    this.logs = [];
    this.maxLogs = 100;
    this.lastSituation = null;
    this.startTime = Date.now();
    // האם המצב היוזם הופעל במפורש. בלי זה כל הרצה בודדת של מחזור "מגלה" סוכן
    // שאינו רץ, מחליטה לשקם אותו, ומדליקה טיימרים שאיש לא ביקש.
    this.shouldBeRunning = false;
  }

  // Add log entry
  addLog(level, message) {
    const timestamp = new Date().toISOString();
    this.logs.push({ timestamp, level, message });
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    console.log(`[${level}] ${message}`);
  }

  // Get current status
  getStatus() {
    return {
      isRunning: this.isRunning,
      uptime: Date.now() - this.startTime,
      situation: this.lastSituation,
      recentDecisions: this.decisions.slice(-10),
      recentActions: this.actions.slice(-10),
      logs: this.logs.slice(-20),
      stats: this.stats
    };
  }

  // Phase 1: Analyze situation
  async analyzeSituation() {
    const situation = {
      timestamp: new Date().toISOString(),
      criticalCount: 0,
      highCount: 0,
      anomalies: [],
      accuracy: this.stats.accuracy,
      trend: 'stable',
      actions: []
    };

    let db;
    try {
      db = await this.getDb();

      // Get critical alerts
      const critical = await new Promise((resolve, reject) => {
        db.all(
          `SELECT COUNT(*) as count FROM notifications
           WHERE severity = 'HIGH' AND created_at > datetime('now', ?)`,
          [`-${this.rules.situationWindowHours} hours`],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows[0]?.count || 0);
          }
        );
      });

      situation.criticalCount = critical;

      // Get high priority
      const high = await new Promise((resolve, reject) => {
        db.all(
          `SELECT COUNT(*) as count FROM notifications
           WHERE severity = 'MEDIUM' AND created_at > datetime('now', ?)`,
          [`-${this.rules.situationWindowHours} hours`],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows[0]?.count || 0);
          }
        );
      });

      situation.highCount = high;

      return situation;
    } catch (error) {
      this.emit('error', { phase: 'situation-analysis', error: error.message });
      return situation;
    } finally {
      // חובה גם בנתיב השגיאה — אחרת נשאר חיבור פתוח בכל מחזור שנכשל
      if (db) db.close();
    }
  }

  // Phase 2: Make decisions
  async makeDecisions(situation) {
    const decisions = [];

    // Decision 1: Escalation needed?
    if (situation.criticalCount > this.rules.criticalEscalationCount) {
      decisions.push({
        type: 'escalate',
        priority: 'high',
        reason: `${situation.criticalCount} critical alerts in last ${this.rules.situationWindowHours}h`,
        action: 'escalate_to_management',
        recipients: this.rules.escalationRecipients
      });
    }

    // Decision 2: Anomaly response
    if (situation.anomalies.length > this.rules.anomalyInvestigationCount) {
      decisions.push({
        type: 'investigate',
        priority: 'medium',
        reason: `${situation.anomalies.length} anomalies detected`,
        action: 'generate_anomaly_report',
        scope: 'all_entities'
      });
    }

    // Decision 3: Accuracy improvement
    if (situation.accuracy < this.rules.minAccuracy) {
      decisions.push({
        type: 'retrain',
        priority: 'low',
        reason: `Accuracy below ${(this.rules.minAccuracy * 100).toFixed(0)}%: ${(situation.accuracy * 100).toFixed(1)}%`,
        action: 'request_feedback_loop'
      });
    }

    // Decision 4: Auto-categorize low-priority
    if (situation.criticalCount === 0 && situation.highCount < this.rules.stableHighCount) {
      decisions.push({
        type: 'auto_process',
        priority: 'low',
        reason: 'System stable - processing routine alerts',
        action: 'auto_categorize_low_priority'
      });
    }

    // Decision 5: Health check — רק אם המצב היוזם הופעל והטיימר נפל,
    // ולא כשמריצים מחזור יחיד ביודעין
    if (this.shouldBeRunning && !this.isRunning) {
      decisions.push({
        type: 'recovery',
        priority: 'critical',
        reason: 'Agent not running',
        action: 'restart_agent'
      });
    }

    return decisions;
  }

  // Phase 3: Execute decisions
  async executeDecisions(decisions) {
    const results = [];

    for (const decision of decisions) {
      try {
        let result;

        switch (decision.type) {
          case 'escalate':
            result = await this.escalateAlert(decision);
            break;

          case 'investigate':
            result = await this.investigateAnomalies(decision);
            break;

          case 'retrain':
            result = await this.requestFeedback(decision);
            break;

          case 'auto_process':
            result = await this.autoProcessAlerts(decision);
            break;

          case 'recovery':
            result = await this.recoverAgent(decision);
            break;

          default:
            result = { status: 'unknown', decision };
        }

        result.decision = decision;
        results.push(result);

        this.emit('action-taken', result);
      } catch (error) {
        this.emit('error', {
          phase: 'decision-execution',
          decision: decision.type,
          error: error.message
        });
      }
    }

    return results;
  }

  // Action: Escalate to management
  async escalateAlert(decision) {
    this.emit('notification', {
      level: 'URGENT',
      title: '🚨 Critical Alert Escalation',
      message: decision.reason,
      recipients: decision.recipients,
      timestamp: new Date().toISOString()
    });

    return {
      status: 'executed',
      action: 'escalation_sent',
      recipients: decision.recipients
    };
  }

  // Action: Investigate anomalies
  async investigateAnomalies(decision) {
    const db = await this.getDb();

    const entities = await new Promise((resolve, reject) => {
      db.all(
        'SELECT DISTINCT entity_type, entity_id FROM notifications',
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    }).finally(() => db.close());

    const report = {
      timestamp: new Date().toISOString(),
      anomalyCount: 0,
      entities: []
    };

    for (const { entity_type, entity_id } of entities) {
      const anomalies = await this.detect_anomalies(entity_type, entity_id);
      if (anomalies.length > 0) {
        report.entities.push({
          entity: `${entity_type}/${entity_id}`,
          anomalyCount: anomalies.length,
          anomalies
        });
        report.anomalyCount += anomalies.length;
      }
    }

    this.emit('report-generated', {
      type: 'anomaly-investigation',
      report
    });

    return {
      status: 'executed',
      action: 'investigation_completed',
      report
    };
  }

  // Action: Request user feedback
  async requestFeedback(decision) {
    this.emit('feedback-request', {
      title: '🧠 AI Accuracy Feedback Needed',
      message: 'System accuracy is below optimal. Please review and provide feedback on recent notifications.',
      priority: 'medium',
      timestamp: new Date().toISOString()
    });

    return {
      status: 'executed',
      action: 'feedback_requested'
    };
  }

  // Action: Auto-process routine alerts
  async autoProcessAlerts(decision) {
    const notifications = await this.getUnanalyzedNotifications(100);

    if (notifications.length === 0) {
      return {
        status: 'no_action',
        reason: 'No unanalyzed notifications'
      };
    }

    const results = await this.batch_analyze(notifications);
    let processed = 0;

    // חיבור אחד לכל האצווה, ונסגר פעם אחת — קודם נפתח חיבור לכל שורה
    const toMark = results
      .filter(([, analysis]) => !analysis.is_spam && analysis.severity_score < 0.5)
      .map(([notif]) => notif.id);
    if (toMark.length) {
      const db = await this.getDb();
      try {
        await Promise.all(toMark.map((id) => new Promise((resolve, reject) => {
          db.run('UPDATE notifications SET is_read = 1 WHERE id = ?', [id],
            (err) => (err ? reject(err) : resolve()));
        })));
        processed = toMark.length;
      } finally {
        db.close();
      }
    }

    return {
      status: 'executed',
      action: 'auto_processed',
      processedCount: processed
    };
  }

  // Action: Recover agent
  async recoverAgent(decision) {
    if (!this.isRunning) {
      this.start();
      return {
        status: 'executed',
        action: 'agent_restarted'
      };
    }

    return {
      status: 'no_action',
      reason: 'Agent already running'
    };
  }

  // Full proactive cycle
  async runProactiveCycle() {
    this.emit('proactive-cycle-start', { timestamp: new Date().toISOString() });
    this.addLog('info', '🔄 התחיל מחזור יוזם');

    try {
      // 1. Analyze current situation
      const situation = await this.analyzeSituation();
      this.lastSituation = situation;
      this.addLog('info', `📊 מצב: ${situation.criticalCount} קריטיים, ${situation.highCount} גבוהים`);
      this.emit('situation-analyzed', situation);

      // 2. Make autonomous decisions
      const decisions = await this.makeDecisions(situation);
      this.emit('decisions-made', { count: decisions.length, decisions });

      if (decisions.length > 0) {
        this.addLog('info', `🧠 ${decisions.length} החלטות: ${decisions.map(d => d.type).join(', ')}`);
        this.decisions.push(...decisions.map(d => ({ ...d, timestamp: new Date().toISOString() })));
        if (this.decisions.length > 50) {
          this.decisions = this.decisions.slice(-50);
        }
      }

      // 3. Execute decisions
      if (decisions.length > 0) {
        const results = await this.executeDecisions(decisions);
        this.emit('actions-executed', { count: results.length, results });
        this.actions.push(...results.map(r => ({ ...r, timestamp: new Date().toISOString() })));
        if (this.actions.length > 50) {
          this.actions = this.actions.slice(-50);
        }
      }

      // 4. Run standard cycle
      await this.runCycle();

      this.addLog('info', '✅ מחזור יוזם הושלם');
      this.emit('proactive-cycle-complete', {
        decisionsCount: decisions.length,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      this.addLog('error', `❌ שגיאה: ${error.message}`);
      this.emit('error', { phase: 'proactive-cycle', error: error.message });
    }
  }

  // Start proactive mode
  startProactive() {
    if (this.isRunning) {
      this.emit('warning', 'Agent already running');
      return;
    }

    this.isRunning = true;
    this.shouldBeRunning = true;
    this.emit('start-proactive', { config: this.proactiveConfig });

    // Initial run
    this.runProactiveCycle();

    // Scheduled proactive cycles
    this.proactiveInterval = setInterval(
      () => this.runProactiveCycle(),
      this.proactiveConfig.decisionInterval
    );
  }

  stopProactive() {
    this.shouldBeRunning = false;
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.proactiveInterval) {
      clearInterval(this.proactiveInterval);
      this.proactiveInterval = null;
    }
    // גם הטיימרים של סוכן הבסיס נעצרים, אחרת התהליך לא מסיים
    if (typeof this.stop === 'function') {
      try { this.stop(); } catch (e) { /* אין מה לעצור */ }
    }

    this.emit('stop-proactive', { stats: this.stats });
  }

  getProactiveStatus() {
    return {
      isRunning: this.isRunning,
      mode: 'proactive',
      stats: this.stats,
      config: this.proactiveConfig,
      recentDecisions: this.decisions.slice(-10)
    };
  }
}

// CLI
if (require.main === module) {
  const agent = new ProactiveAIAgent({
    decisionInterval: 30000, // 30 seconds for demo
    batchSize: 20
  });

  // Event listeners
  agent.on('start-proactive', (data) => {
    console.log('🤖 סוכן AI יוזם הופעל');
    console.log(`   ⚙️  מחזור החלטות: כל ${data.config.decisionInterval / 1000} שניות`);
  });

  agent.on('situation-analyzed', (situation) => {
    console.log(`\n📊 מצב המערכת:`);
    console.log(`   🔴 קריטיים: ${situation.criticalCount}`);
    console.log(`   🟠 גבוהים: ${situation.highCount}`);
    console.log(`   🧠 דיוק: ${(situation.accuracy * 100).toFixed(1)}%`);
  });

  agent.on('decisions-made', (data) => {
    console.log(`\n🧠 החלטות (${data.count}):`);
    data.decisions.forEach(d => {
      console.log(`   • ${d.type}: ${d.reason}`);
    });
  });

  agent.on('action-taken', (result) => {
    console.log(`✅ פעולה: ${result.decision.type}`);
  });

  agent.on('notification', (notif) => {
    console.log(`\n📢 ${notif.level}: ${notif.title}`);
    console.log(`   ${notif.message}`);
  });

  agent.on('report-generated', (data) => {
    console.log(`📋 דוח: ${data.type}`);
    console.log(`   חריגויות: ${data.report.anomalyCount}`);
  });

  agent.on('proactive-cycle-complete', () => {
    console.log('\n✅ מחזור יוזם הושלם\n');
  });

  agent.on('error', (error) => {
    console.error(`❌ שגיאה: ${error.error}`);
  });

  // Start agent
  agent.startProactive();

  // Graceful shutdown
  process.on('SIGINT', () => agent.stopProactive());
}

module.exports = ProactiveAIAgent;
