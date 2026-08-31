"""Excel export service for creating dynamic reports from notification data."""

const ExcelJS = require('exceljs');
const sqlite3 = require('sqlite3');
const path = require('path');

class ExcelExportService {
  constructor(dbPath = 'notifications.db') {
    this.dbPath = dbPath;
  }

  getDb() {
    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) reject(err);
        else resolve(db);
      });
    });
  }

  async getNotifications(filters = {}) {
    const db = await this.getDb();

    return new Promise((resolve, reject) => {
      let query = 'SELECT * FROM notifications WHERE 1=1';
      const params = [];

      if (filters.entityType) {
        query += ' AND entity_type = ?';
        params.push(filters.entityType);
      }
      if (filters.entityId) {
        query += ' AND entity_id = ?';
        params.push(filters.entityId);
      }
      if (filters.severity) {
        query += ' AND severity = ?';
        params.push(filters.severity);
      }
      if (filters.startDate) {
        query += ' AND created_at >= ?';
        params.push(filters.startDate);
      }
      if (filters.endDate) {
        query += ' AND created_at <= ?';
        params.push(filters.endDate);
      }
      if (filters.isRead !== undefined) {
        query += ' AND is_read = ?';
        params.push(filters.isRead ? 1 : 0);
      }

      query += ' ORDER BY created_at DESC LIMIT 1000';

      db.all(query, params, (err, rows) => {
        db.close();
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  async createNotificationsReport(filters = {}) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('התראות');

    // Headers
    const headers = ['תאריך', 'כותרת', 'הודעה', 'סוג ישות', 'ID ישות', 'חומרה', 'סטטוס', 'הערות'];
    worksheet.columns = headers.map(h => ({ header: h, key: h, width: 20 }));

    // Style header
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF366092' } };

    // Get data
    const notifications = await this.getNotifications(filters);

    notifications.forEach((notif, index) => {
      const row = worksheet.addRow({
        'תאריך': new Date(notif.created_at).toLocaleString('he-IL'),
        'כותרת': notif.title,
        'הודעה': notif.message,
        'סוג ישות': notif.entity_type,
        'ID ישות': notif.entity_id,
        'חומרה': notif.severity,
        'סטטוס': notif.is_read ? 'נקרא' : 'חדש',
        'הערות': notif.notes || ''
      });

      // Alternate row colors
      if (index % 2 === 0) {
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
      }
    });

    // Set RTL and freeze header
    worksheet.views = [{ rightToLeft: true }];
    worksheet.freezePane = 'A2';

    return workbook;
  }

  async createEntityTrendsReport(filters = {}) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('טרנדים לפי ישות');

    worksheet.columns = [
      { header: 'סוג ישות', key: 'entityType', width: 15 },
      { header: 'ID ישות', key: 'entityId', width: 20 },
      { header: 'מספר התראות', key: 'count', width: 15 },
      { header: 'חומרה ממוצעת', key: 'avgSeverity', width: 15 },
      { header: 'חומרה גבוהה ביותר', key: 'maxSeverity', width: 15 }
    ];

    const db = await this.getDb();

    return new Promise((resolve, reject) => {
      let query = `
        SELECT
          entity_type,
          entity_id,
          COUNT(*) as count,
          AVG(CASE WHEN severity='HIGH' THEN 3 WHEN severity='MEDIUM' THEN 2 ELSE 1 END) as avgSeverity,
          severity as maxSeverity
        FROM notifications
        WHERE 1=1
      `;
      const params = [];

      if (filters.startDate) {
        query += ' AND created_at >= ?';
        params.push(filters.startDate);
      }
      if (filters.endDate) {
        query += ' AND created_at <= ?';
        params.push(filters.endDate);
      }

      query += ' GROUP BY entity_type, entity_id ORDER BY count DESC';

      db.all(query, params, (err, rows) => {
        db.close();

        if (err) {
          reject(err);
          return;
        }

        // Style header
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF366092' } };

        // Add data
        rows.forEach((row, index) => {
          const dataRow = worksheet.addRow({
            entityType: row.entity_type,
            entityId: row.entity_id,
            count: row.count,
            avgSeverity: row.avgSeverity ? row.avgSeverity.toFixed(2) : 0,
            maxSeverity: row.maxSeverity
          });

          if (index % 2 === 0) {
            dataRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
          }
        });

        worksheet.views = [{ rightToLeft: true }];
        worksheet.freezePane = 'A2';

        resolve(workbook);
      });
    });
  }

  async createSeverityBreakdownReport(filters = {}) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('התפלגות חומרה');

    worksheet.columns = [
      { header: 'חומרה', key: 'severity', width: 15 },
      { header: 'מספר התראות', key: 'count', width: 15 },
      { header: 'אחוז', key: 'percentage', width: 15 }
    ];

    const db = await this.getDb();

    return new Promise((resolve, reject) => {
      let query = `
        SELECT
          severity,
          COUNT(*) as count
        FROM notifications
        WHERE 1=1
      `;
      const params = [];

      if (filters.startDate) {
        query += ' AND created_at >= ?';
        params.push(filters.startDate);
      }
      if (filters.endDate) {
        query += ' AND created_at <= ?';
        params.push(filters.endDate);
      }

      query += ' GROUP BY severity';

      db.all(query, params, (err, rows) => {
        db.close();

        if (err) {
          reject(err);
          return;
        }

        const total = rows.reduce((sum, row) => sum + row.count, 0);

        // Style header
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF366092' } };

        // Add data
        rows.forEach((row, index) => {
          const percentage = total > 0 ? ((row.count / total) * 100).toFixed(1) : 0;
          const dataRow = worksheet.addRow({
            severity: row.severity,
            count: row.count,
            percentage: `${percentage}%`
          });

          if (index % 2 === 0) {
            dataRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
          }
        });

        worksheet.views = [{ rightToLeft: true }];
        worksheet.freezePane = 'A2';

        resolve(workbook);
      });
    });
  }

  async createCustomReport(reportType, filters = {}) {
    switch (reportType) {
      case 'notifications':
        return this.createNotificationsReport(filters);
      case 'trends':
        return this.createEntityTrendsReport(filters);
      case 'severity':
        return this.createSeverityBreakdownReport(filters);
      default:
        throw new Error(`Unknown report type: ${reportType}`);
    }
  }
}

module.exports = ExcelExportService;
