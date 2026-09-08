const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');

const { ensureSchema, STATEMENTS } = require('../db-schema');

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidb-'));
  return path.join(dir, 'notifications.db');
}
const open = (p) => new Promise((res, rej) => {
  const db = new sqlite3.Database(p, (e) => (e ? rej(e) : res(db)));
});
const all = (db, sql, params = []) => new Promise((res, rej) => {
  db.all(sql, params, (e, r) => (e ? rej(e) : res(r)));
});
const run = (db, sql, params = []) => new Promise((res, rej) => {
  db.run(sql, params, function (e) { return e ? rej(e) : res(this); });
});
const tables = async (db) =>
  (await all(db, "SELECT name FROM sqlite_master WHERE type='table'")).map((r) => r.name);
const columns = async (db, t) =>
  (await all(db, `PRAGMA table_info(${t})`)).map((r) => r.name);

test('every table the system reads is created', async () => {
  const db = await open(tmpDb());
  await ensureSchema(db);
  const names = await tables(db);
  for (const t of ['notifications', 'analyzer_feedback', 'entity_trends',
                   'category_patterns', 'firebase_sync']) {
    assert.ok(names.includes(t), `missing table: ${t}`);
  }
  db.close();
});

test('the notifications table carries the columns all three writers use', async () => {
  const db = await open(tmpDb());
  await ensureSchema(db);
  const cols = await columns(db, 'notifications');
  // analyzer / firebase sync / data generator — one table has to satisfy all of them
  for (const c of ['id', 'entity_type', 'entity_id', 'category', 'title', 'message',
                   'severity', 'severity_score', 'analysis_score', 'status',
                   'is_read', 'is_spam', 'created_at', 'analyzed_at', 'metadata',
                   'firebase_id', 'synced_at']) {
    assert.ok(cols.includes(c), `missing column: ${c}`);
  }
  db.close();
});

test('an insert from the data generator fits — the shape that used to fail silently', async () => {
  const db = await open(tmpDb());
  await ensureSchema(db);
  await run(db,
    `INSERT INTO notifications (id, entity_type, entity_id, severity, title, message, firebase_id, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ['n1', 'deals', 'd1', 'HIGH', 't', 'm', 'fb1', '2026-01-01']);
  const rows = await all(db, 'SELECT id, severity FROM notifications');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].severity, 'HIGH');
  db.close();
});

test('an insert from the analyzer fits too', async () => {
  const db = await open(tmpDb());
  await ensureSchema(db);
  await run(db,
    `INSERT INTO notifications (id, entity_type, entity_id, category, title, message,
       severity, severity_score, status, created_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['n2', 'deals', 'd1', 'action_required', 't', 'm', 'MEDIUM', 0.55, 'new',
     '2026-01-01 10:00:00', '{}']);
  const rows = await all(db, 'SELECT severity_score FROM notifications WHERE id = ?', ['n2']);
  assert.strictEqual(rows[0].severity_score, 0.55);
  db.close();
});

test('the learning table the agent retrains against exists before it is needed', async () => {
  // the original failure: "SQLITE_ERROR: no such table: analyzer_feedback"
  const db = await open(tmpDb());
  await ensureSchema(db);
  await run(db,
    `INSERT INTO analyzer_feedback (id, notification_id, actual_severity, predicted_severity,
       entity_type, entity_id, category, was_important, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['f1', 'n1', 0.8, 0.6, 'deals', 'd1', 'action_required', 1, '2026-01-01']);
  const rows = await all(db, 'SELECT COUNT(*) c FROM analyzer_feedback');
  assert.strictEqual(rows[0].c, 1);
  db.close();
});

test('running it twice changes nothing and loses nothing', async () => {
  const p = tmpDb();
  const db = await open(p);
  await ensureSchema(db);
  await run(db, `INSERT INTO notifications (id, severity, title, created_at)
                 VALUES ('keep', 'LOW', 't', '2026-01-01 00:00:00')`);
  await ensureSchema(db);
  await ensureSchema(db);
  const rows = await all(db, 'SELECT id FROM notifications');
  assert.deepStrictEqual(rows.map((r) => r.id), ['keep']);
  db.close();
});

test('the indexes the situation query leans on are there', async () => {
  const db = await open(tmpDb());
  await ensureSchema(db);
  const idx = (await all(db, "SELECT name FROM sqlite_master WHERE type='index'")).map((r) => r.name);
  assert.ok(idx.includes('idx_notifications_severity'));
  assert.ok(idx.includes('idx_notifications_created'));
  db.close();
});

test('the JavaScript and Python schemas agree on the learning tables', () => {
  const py = fs.readFileSync(path.join(__dirname, '..', 'ai_advanced_analyzer.py'), 'utf8');
  const js = STATEMENTS.join('\n');
  for (const t of ['analyzer_feedback', 'entity_trends', 'category_patterns']) {
    assert.ok(py.includes(t), `python side lost ${t}`);
    assert.ok(js.includes(t), `javascript side lost ${t}`);
  }
  // a column the two sides exchange rows through
  assert.ok(py.includes('predicted_severity') && js.includes('predicted_severity'));
});
