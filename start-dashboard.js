#!/usr/bin/env node
/**Dashboard & Agent Startup Script*/

const express = require('express');
const ExcelExportService = require('./excel-export-service');
const ProactiveAIAgent = require('./ai-proactive-agent');
const path = require('path');

const app = express();
const exportService = new ExcelExportService();
let agent = new ProactiveAIAgent({
  decisionInterval: 30000,
  batchSize: 20
});

app.use(express.json());
app.use(express.static('.'));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// ============ EXPORT ENDPOINTS ============
app.post('/api/export', async (req, res) => {
  try {
    const { reportType, filters } = req.body;
    if (!reportType) {
      return res.status(400).json({ error: 'reportType is required' });
    }

    const workbook = await exportService.createCustomReport(reportType, filters || {});
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="report-${reportType}-${Date.now()}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/export/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const filters = {
      entityType: req.query.entityType,
      entityId: req.query.entityId,
      severity: req.query.severity,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      isRead: req.query.isRead === 'true' ? true : req.query.isRead === 'false' ? false : undefined
    };

    const workbook = await exportService.createCustomReport(type, filters);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="report-${type}-${Date.now()}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ AGENT ENDPOINTS ============
app.get('/api/agent/status', (req, res) => {
  try {
    const status = agent.getStatus();
    res.json(status);
  } catch (error) {
    console.error('Status error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/agent/start', (req, res) => {
  try {
    if (!agent.isRunning) {
      agent.startProactive();
      res.json({ success: true, message: 'Agent started' });
    } else {
      res.json({ success: false, message: 'Agent already running' });
    }
  } catch (error) {
    console.error('Start error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/agent/stop', (req, res) => {
  try {
    if (agent.isRunning) {
      agent.stopProactive();
      res.json({ success: true, message: 'Agent stopped' });
    } else {
      res.json({ success: false, message: 'Agent not running' });
    }
  } catch (error) {
    console.error('Stop error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/agent/metrics', (req, res) => {
  try {
    const status = agent.getStatus();
    res.json({
      analyzed: status.stats?.analyzed || 0,
      learned: status.stats?.learned || 0,
      anomalies: status.stats?.anomalies || 0,
      accuracy: status.stats?.accuracy || 0,
      feedbackCount: 0,
      overallAccuracy: status.stats?.accuracy || 0,
      improvement: 0,
      mae: 0,
      criticalCount: status.situation?.criticalCount || 0,
      highCount: status.situation?.highCount || 0,
      systemAnomalies: status.situation?.anomalies?.length || 0,
      isRunning: status.isRunning
    });
  } catch (error) {
    console.error('Metrics error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/agent/decisions', (req, res) => {
  try {
    const status = agent.getStatus();
    res.json(status.recentDecisions || []);
  } catch (error) {
    console.error('Decisions error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/agent/actions', (req, res) => {
  try {
    const status = agent.getStatus();
    res.json(status.recentActions || []);
  } catch (error) {
    console.error('Actions error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/agent/logs', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const status = agent.getStatus();
    const logs = status.logs || [];
    res.json(logs.slice(-limit));
  } catch (error) {
    console.error('Logs error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>סוכן AI</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          max-width: 600px;
          margin: 50px auto;
          padding: 20px;
          text-align: center;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          color: white;
        }
        h1 { font-size: 2.5em; margin-bottom: 10px; }
        .links {
          display: flex;
          flex-direction: column;
          gap: 15px;
          margin-top: 30px;
        }
        a {
          padding: 15px 20px;
          background: white;
          color: #667eea;
          text-decoration: none;
          border-radius: 8px;
          font-weight: 600;
          transition: transform 0.2s;
        }
        a:hover { transform: scale(1.05); }
        .status {
          background: rgba(255,255,255,0.2);
          padding: 20px;
          border-radius: 8px;
          margin: 20px 0;
          font-size: 1.1em;
        }
      </style>
    </head>
    <body>
      <h1>🤖 סוכן AI</h1>
      <div class="status">
        <p>שרת API פעיל ודשבורד זמין</p>
      </div>
      <div class="links">
        <a href="/ai-dashboard.html">📊 דשבורד בזמן אמת</a>
        <a href="/export.html">📁 ייצוא דוחות</a>
        <a href="/api/agent/status">📋 API Status</a>
      </div>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════╗
║           🤖 סוכן AI - דשבורד              ║
╚════════════════════════════════════════════╝

🌐 שרת דשבורד: http://localhost:${PORT}
📊 דשבורד:     http://localhost:${PORT}/ai-dashboard.html
📁 ייצוא:      http://localhost:${PORT}/export.html

API Endpoints:
  GET  /api/agent/status    - מצב המערכת המלא
  GET  /api/agent/metrics   - מדדים עיקריים
  GET  /api/agent/decisions - החלטות אחרונות
  GET  /api/agent/actions   - פעולות שבוצעו
  GET  /api/agent/logs      - לוגים
  POST /api/agent/start     - הפעלת סוכן
  POST /api/agent/stop      - עצירת סוכן

Press Ctrl+C to stop server
`);
  // הדשבורד מציג את הסוכן שהוא עצמו מריץ. בלי הפעלה אוטומטית הדף נראה ריק גם
  // כשסוכן אחר רץ בטרמינל אחר — שני תהליכים נפרדים. AUTO_START=0 מבטל.
  if (process.env.AUTO_START !== '0') {
    try {
      agent.startProactive();
      console.log('🟢 הסוכן הופעל אוטומטית — הדשבורד יציג נתונים חיים');
    } catch (e) {
      console.error('⚠️ הפעלת הסוכן נכשלה:', e.message);
    }
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  if (agent.isRunning) {
    agent.stopProactive();
  }
  process.exit(0);
});
