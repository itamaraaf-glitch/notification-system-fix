"""Express server for Excel export API."""

const express = require('express');
const ExcelExportService = require('./excel-export-service');
const path = require('path');

const app = express();
const exportService = new ExcelExportService();

app.use(express.json());
app.use(express.static('.'));

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Export server running on port ${PORT}`);
  console.log(`Available endpoints:`);
  console.log(`  POST /api/export - create custom report`);
  console.log(`  GET  /api/export/:type - quick export (type: notifications|trends|severity)`);
});
