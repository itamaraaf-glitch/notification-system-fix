const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');

const ExcelExportService = require('../excel-export-service');
const { ensureSchema } = require('../db-schema');

const run = (db, sql, params = []) => new Promise((res, rej) => {
  db.run(sql, params, function (e) { return e ? rej(e) : res(this); });
});

async function seed(rows = []) {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aiexp-')), 'notifications.db');
  const db = await new Promise((res, rej) => {
    const d = new sqlite3.Database(p, (e) => (e ? rej(e) : res(d)));
  });
  await ensureSchema(db);
  for (const r of rows) {
    await run(db,
      `INSERT INTO notifications (id, entity_type, entity_id, severity, title, message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [r.id, r.entity_type || 'deals', r.entity_id || 'd1', r.severity,
       r.title || 't', r.message || 'm', r.created_at || '2026-01-15 10:00:00']);
  }
  await new Promise((res) => db.close(res));
  return p;
}

const service = (p) => new ExcelExportService(p);

test('reads back what is in the database', async () => {
  const svc = service(await seed([
    { id: 'a', severity: 'HIGH' },
    { id: 'b', severity: 'LOW' },
  ]));
  const rows = await svc.getNotifications();
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows.map((r) => r.id).sort(), ['a', 'b']);
});

test('an empty database exports nothing rather than failing', async () => {
  const svc = service(await seed([]));
  const rows = await svc.getNotifications();
  assert.deepStrictEqual(rows, []);
});

test('filtering by severity returns only that severity', async () => {
  const svc = service(await seed([
    { id: 'a', severity: 'HIGH' },
    { id: 'b', severity: 'LOW' },
    { id: 'c', severity: 'HIGH' },
  ]));
  const rows = await svc.getNotifications({ severity: 'HIGH' });
  assert.strictEqual(rows.length, 2);
  assert.ok(rows.every((r) => r.severity === 'HIGH'));
});

test('every report type the API offers actually builds', async () => {
  const svc = service(await seed([{ id: 'a', severity: 'HIGH' }, { id: 'b', severity: 'LOW' }]));
  for (const kind of ['notifications', 'trends', 'severity']) {
    const wb = await svc.createCustomReport(kind);
    const buf = await wb.xlsx.writeBuffer();
    assert.strictEqual(Buffer.from(buf).slice(0, 2).toString('latin1'), 'PK', `${kind} is not a workbook`);
  }
});

test('an unknown report type is refused rather than returning something broken', async () => {
  const svc = service(await seed([]));
  await assert.rejects(() => svc.createCustomReport('nope'), /Unknown report type/);
});

test('produces a real workbook, not an empty file', async () => {
  const svc = service(await seed([
    { id: 'a', severity: 'HIGH', title: 'עסקה בסיכון' },
    { id: 'b', severity: 'MEDIUM', title: 'תזכורת' },
  ]));
  const wb = await svc.createNotificationsReport();
  const sheet = wb.getWorksheet('התראות');
  assert.ok(sheet, 'the report has its sheet');
  assert.strictEqual(sheet.rowCount, 3, 'a header row and one row per notification');
  assert.ok(sheet.views && sheet.views[0].rightToLeft, 'and it opens right-to-left');
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  assert.ok(buffer.length > 1000, `workbook looks empty: ${buffer.length} bytes`);
  // xlsx is a zip — every real one starts with the local file header
  assert.strictEqual(buffer.slice(0, 2).toString('latin1'), 'PK');
});

test('exports even when there is nothing to export', async () => {
  const svc = service(await seed([]));
  const wb = await svc.createNotificationsReport();
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  assert.strictEqual(buffer.slice(0, 2).toString('latin1'), 'PK',
    'a header-only workbook is still a valid workbook');
});

test('Hebrew survives the round trip into the workbook', async () => {
  const svc = service(await seed([{ id: 'a', severity: 'HIGH', title: 'התראה קריטית' }]));
  const rows = await svc.getNotifications();
  assert.strictEqual(rows[0].title, 'התראה קריטית');
  const wb = await svc.createNotificationsReport();
  const cells = [];
  wb.getWorksheet('התראות').eachRow((row) => row.eachCell((c) => cells.push(String(c.value))));
  assert.ok(cells.some((v) => v.includes('התראה קריטית')), 'the Hebrew title is in the sheet');
});

test('repeated exports do not exhaust the database connections', async () => {
  const svc = service(await seed([{ id: 'a', severity: 'HIGH' }]));
  for (let i = 0; i < 12; i++) {
    const rows = await svc.getNotifications();
    assert.strictEqual(rows.length, 1, `read ${i} came back wrong`);
  }
});
