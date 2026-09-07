// Express server for Excel export API + Proactive Agent status
const express = require('express');
const ExcelExportService = require('./excel-export-service');
const ProactiveAIAgent = require('./ai-proactive-agent');
const path = require('path');

const app = express();
const exportService = new ExcelExportService();

// Initialize proactive agent (not started by default, can be started via API)
let agent = new ProactiveAIAgent({
  decisionInterval: 30000, // 30 seconds
  batchSize: 20
});

app.use(express.json());
app.use(express.static('.'));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Parse filters from query params
function parseFilters(query) {
  return {
    entityType: query.entityType,
    entityId: query.entityId,
    severity: query.severity,
    startDate: query.startDate,
    endDate: query.endDate,
    isRead: query.isRead === 'true' ? true : query.isRead === 'false' ? false : undefined
  };
}

// ============ EXPORT ENDPOINTS ============

// Export to Excel endpoint
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

// Export with query params (GET version for links)
app.get('/api/export/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const filters = parseFilters(req.query);

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

// Get agent status
app.get('/api/agent/status', (req, res) => {
  try {
    const status = agent.getStatus();
    res.json(status);
  } catch (error) {
    console.error('Status error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start agent
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

// Stop agent
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

// Get agent metrics
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

// Get recent decisions
app.get('/api/agent/decisions', (req, res) => {
  try {
    const status = agent.getStatus();
    res.json(status.recentDecisions || []);
  } catch (error) {
    console.error('Decisions error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get recent actions
app.get('/api/agent/actions', (req, res) => {
  try {
    const status = agent.getStatus();
    res.json(status.recentActions || []);
  } catch (error) {
    console.error('Actions error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get logs
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`\nExport endpoints:`);
  console.log(`  POST /api/export - create custom report`);
  console.log(`  GET  /api/export/:type - quick export (type: notifications|trends|severity)`);
  console.log(`\nAgent endpoints:`);
  console.log(`  GET  /api/agent/status - full agent status`);
  console.log(`  GET  /api/agent/metrics - key metrics`);
  console.log(`  GET  /api/agent/decisions - recent decisions`);
  console.log(`  GET  /api/agent/actions - recent actions`);
  console.log(`  GET  /api/agent/logs - recent logs`);
  console.log(`  POST /api/agent/start - start agent`);
  console.log(`  POST /api/agent/stop - stop agent\n`);
});
