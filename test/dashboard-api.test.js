const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const sqlite3 = require('sqlite3');

const { ensureSchema } = require('../db-schema');

const PORT = 3987;                       // out of the way of a dashboard someone is using
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, '..');

let server;
let dbPath;

const run = (db, sql, params = []) => new Promise((res, rej) => {
  db.run(sql, params, function (e) { return e ? rej(e) : res(this); });
});

async function seedDb() {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aidash-')), 'notifications.db');
  const db = await new Promise((res, rej) => {
    const d = new sqlite3.Database(p, (e) => (e ? rej(e) : res(d)));
  });
  await ensureSchema(db);
  for (let i = 0; i < 7; i++) {
    await run(db, `INSERT INTO notifications (id, entity_type, entity_id, severity, title, message, created_at)
                   VALUES (?, 'deals', ?, ?, ?, 'm', datetime('now'))`,
      [`n${i}`, `d${i}`, i < 4 ? 'HIGH' : 'MEDIUM', `כותרת ${i}`]);
  }
  await new Promise((res) => db.close(res));
  return p;
}

const get = async (p) => {
  const res = await fetch(BASE + p);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* not json */ }
  return { status: res.status, json, text, type: res.headers.get('content-type') || '' };
};
const post = async (p) => {
  const res = await fetch(BASE + p, { method: 'POST' });
  return { status: res.status, json: await res.json().catch(() => null) };
};

before(async () => {
  dbPath = await seedDb();
  server = spawn(process.execPath, ['start-dashboard.js'], {
    cwd: ROOT,
    // AUTO_START off so the tests drive the agent themselves
    env: { ...process.env, PORT: String(PORT), AI_DB_PATH: dbPath, AUTO_START: '0' },
    stdio: 'ignore',
  });
  // wait for it to answer
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/agent/status`);
      if (r.ok) return;
    } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('dashboard did not start');
});

after(() => { if (server) server.kill('SIGKILL'); });

test('the dashboard page is served', async () => {
  const r = await get('/ai-dashboard.html');
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /דשבורד/);
});

test('every endpoint the page calls exists', async () => {
  // taken from the fetch() calls in ai-dashboard.html — a rename there must fail here
  for (const p of ['/api/agent/status', '/api/agent/metrics', '/api/agent/decisions',
                   '/api/agent/actions', '/api/agent/logs?limit=5']) {
    const r = await get(p);
    assert.strictEqual(r.status, 200, `${p} answered ${r.status}`);
    assert.match(r.type, /json/, `${p} did not return JSON`);
  }
});

test('the page and the server agree on the endpoint names', () => {
  const html = fs.readFileSync(path.join(ROOT, 'ai-dashboard.html'), 'utf8');
  const server = fs.readFileSync(path.join(ROOT, 'start-dashboard.js'), 'utf8');
  const called = [...html.matchAll(/\$\{API_URL\}(\/api\/[a-z/]+)/g)].map((m) => m[1]);
  assert.ok(called.length >= 5, 'the page calls the API');
  for (const p of new Set(called)) {
    assert.ok(server.includes(`'${p}'`), `the page calls ${p} but the server does not serve it`);
  }
});

test('status reports whether the agent is running', async () => {
  const r = await get('/api/agent/status');
  assert.strictEqual(typeof r.json.isRunning, 'boolean');
  assert.ok(Array.isArray(r.json.recentDecisions));
  assert.ok(Array.isArray(r.json.logs));
});

test('metrics are numbers, so the dashboard can render them', async () => {
  const r = await get('/api/agent/metrics');
  for (const k of ['analyzed', 'criticalCount', 'highCount', 'accuracy']) {
    assert.strictEqual(typeof r.json[k], 'number', `${k} is ${typeof r.json[k]}`);
  }
});

test('starting the agent through the API makes it report live figures', async () => {
  const started = await post('/api/agent/start');
  assert.strictEqual(started.status, 200);
  assert.strictEqual(started.json.success, true);

  let metrics;
  for (let i = 0; i < 40; i++) {
    metrics = (await get('/api/agent/metrics')).json;
    if (metrics.criticalCount > 0) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.strictEqual(metrics.criticalCount, 4, 'it counted the four HIGH rows we seeded');
  assert.strictEqual(metrics.highCount, 3);
  assert.strictEqual(metrics.isRunning, true);
});

test('the cycle leaves decisions and logs behind for the page to show', async () => {
  const decisions = (await get('/api/agent/decisions')).json;
  const logs = (await get('/api/agent/logs?limit=10')).json;
  assert.ok(decisions.length > 0, 'the agent decided something');
  assert.ok(decisions.every((d) => d.type && d.reason), 'each decision explains itself');
  assert.ok(logs.length > 0 && logs[0].timestamp, 'and the log is timestamped');
});

test('stopping the agent is reflected in the status', async () => {
  const stopped = await post('/api/agent/stop');
  assert.strictEqual(stopped.status, 200);
  const status = (await get('/api/agent/status')).json;
  assert.strictEqual(status.isRunning, false);
});

test('the export endpoint returns a workbook, not an error page', async () => {
  const res = await fetch(`${BASE}/api/export/notifications`);
  assert.strictEqual(res.status, 200);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.strictEqual(buf.slice(0, 2).toString('latin1'), 'PK', 'not an xlsx');
  assert.ok(buf.length > 1000);
});

test('an unknown path answers rather than hanging', async () => {
  const r = await get('/api/does-not-exist');
  assert.ok(r.status >= 400, `unknown route returned ${r.status}`);
});
