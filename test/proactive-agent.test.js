const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');

const ProactiveAIAgent = require('../ai-proactive-agent');
const { ensureSchema } = require('../db-schema');

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiagent-'));
  return path.join(dir, 'notifications.db');
}
const run = (db, sql, params = []) => new Promise((res, rej) => {
  db.run(sql, params, function (e) { return e ? rej(e) : res(this); });
});

/** A database holding `counts` notifications per severity, all dated now. */
async function seed(counts = {}) {
  const p = tmpDb();
  const db = await new Promise((res, rej) => {
    const d = new sqlite3.Database(p, (e) => (e ? rej(e) : res(d)));
  });
  await ensureSchema(db);
  let i = 0;
  for (const [severity, n] of Object.entries(counts)) {
    for (let k = 0; k < n; k++) {
      await run(db, `INSERT INTO notifications (id, entity_type, entity_id, severity, title, message, created_at)
                     VALUES (?, 'deals', ?, ?, ?, 'm', datetime('now'))`,
        [`n${i++}`, `d${k}`, severity, `t${i}`]);
    }
  }
  await new Promise((res) => db.close(res));
  return p;
}

const agentOn = (dbPath, rules = {}) =>
  new ProactiveAIAgent({ dbPath, rules: { escalationRecipients: [], ...rules } });

const types = (decisions) => decisions.map((d) => d.type).sort();

// ── reading the situation ──

test('the situation reflects what is actually in the database', async () => {
  const agent = agentOn(await seed({ HIGH: 4, MEDIUM: 2, LOW: 7 }));
  const s = await agent.analyzeSituation();
  assert.strictEqual(s.criticalCount, 4);
  assert.strictEqual(s.highCount, 2);
});

test('only the recent window counts — old alerts do not keep the agent escalating', async () => {
  const p = await seed({ HIGH: 2 });
  const db = await new Promise((res, rej) => {
    const d = new sqlite3.Database(p, (e) => (e ? rej(e) : res(d)));
  });
  await run(db, `INSERT INTO notifications (id, severity, title, message, created_at)
                 VALUES ('old1','HIGH','t','m', datetime('now','-5 hours'))`);
  await new Promise((res) => db.close(res));

  const agent = agentOn(p, { situationWindowHours: 1 });
  assert.strictEqual((await agent.analyzeSituation()).criticalCount, 2, 'the old one is outside the window');

  const wide = agentOn(p, { situationWindowHours: 24 });
  assert.strictEqual((await wide.analyzeSituation()).criticalCount, 3, 'a wider window includes it');
});

test('an empty database reads as quiet, not as an error', async () => {
  const agent = agentOn(await seed({}));
  const s = await agent.analyzeSituation();
  assert.strictEqual(s.criticalCount, 0);
  assert.strictEqual(s.highCount, 0);
});

// ── the decisions themselves ──

test('escalates once the count passes the threshold, not when it merely reaches it', async () => {
  const agent = agentOn(await seed({}), { criticalEscalationCount: 5 });
  const at = await agent.makeDecisions({ criticalCount: 5, highCount: 0, anomalies: [], accuracy: 1 });
  assert.ok(!types(at).includes('escalate'), 'five is the limit, not a breach');

  const over = await agent.makeDecisions({ criticalCount: 6, highCount: 0, anomalies: [], accuracy: 1 });
  assert.ok(types(over).includes('escalate'));
});

test('the escalation threshold is configurable', async () => {
  const agent = agentOn(await seed({}), { criticalEscalationCount: 1 });
  const d = await agent.makeDecisions({ criticalCount: 2, highCount: 0, anomalies: [], accuracy: 1 });
  const esc = d.find((x) => x.type === 'escalate');
  assert.ok(esc, 'a lower threshold escalates sooner');
  assert.match(esc.reason, /2 critical/);
});

test('an escalation carries the configured recipients and no invented ones', async () => {
  const none = agentOn(await seed({}), { criticalEscalationCount: 0 });
  const d1 = await none.makeDecisions({ criticalCount: 1, highCount: 0, anomalies: [], accuracy: 1 });
  assert.deepStrictEqual(d1.find((x) => x.type === 'escalate').recipients, []);

  const to = agentOn(await seed({}), { criticalEscalationCount: 0, escalationRecipients: ['ops@x.co.il'] });
  const d2 = await to.makeDecisions({ criticalCount: 1, highCount: 0, anomalies: [], accuracy: 1 });
  assert.deepStrictEqual(d2.find((x) => x.type === 'escalate').recipients, ['ops@x.co.il']);
});

test('asks for feedback while accuracy is below the bar, and stops once it is met', async () => {
  const agent = agentOn(await seed({}), { minAccuracy: 0.7 });
  const low = await agent.makeDecisions({ criticalCount: 1, highCount: 0, anomalies: [], accuracy: 0.5 });
  assert.ok(types(low).includes('retrain'));
  const ok = await agent.makeDecisions({ criticalCount: 1, highCount: 0, anomalies: [], accuracy: 0.7 });
  assert.ok(!types(ok).includes('retrain'), 'exactly at the bar is good enough');
});

test('investigates only once anomalies pass the threshold', async () => {
  const agent = agentOn(await seed({}), { anomalyInvestigationCount: 3 });
  const few = await agent.makeDecisions({ criticalCount: 1, highCount: 0, anomalies: [1, 2, 3], accuracy: 1 });
  assert.ok(!types(few).includes('investigate'));
  const many = await agent.makeDecisions({ criticalCount: 1, highCount: 0, anomalies: [1, 2, 3, 4], accuracy: 1 });
  assert.ok(types(many).includes('investigate'));
});

test('processes routine alerts only while nothing is on fire', async () => {
  const agent = agentOn(await seed({}), { stableHighCount: 3 });
  const quiet = await agent.makeDecisions({ criticalCount: 0, highCount: 2, anomalies: [], accuracy: 1 });
  assert.ok(types(quiet).includes('auto_process'));

  const busy = await agent.makeDecisions({ criticalCount: 0, highCount: 3, anomalies: [], accuracy: 1 });
  assert.ok(!types(busy).includes('auto_process'), 'too much traffic to act unattended');

  const critical = await agent.makeDecisions({ criticalCount: 1, highCount: 0, anomalies: [], accuracy: 1 });
  assert.ok(!types(critical).includes('auto_process'), 'never while something is critical');
});

test('every decision says what it is, why, and what it will do', async () => {
  const agent = agentOn(await seed({}), { criticalEscalationCount: 0, anomalyInvestigationCount: 0 });
  const decisions = await agent.makeDecisions({ criticalCount: 9, highCount: 1, anomalies: [1, 2], accuracy: 0.1 });
  assert.ok(decisions.length >= 3);
  for (const d of decisions) {
    assert.ok(d.type && d.reason && d.action, `incomplete decision: ${JSON.stringify(d)}`);
    assert.ok(['critical', 'high', 'medium', 'low'].includes(d.priority), `odd priority: ${d.priority}`);
  }
});

// ── a full cycle ──

test('a full cycle completes on a real database without an error', async () => {
  const agent = agentOn(await seed({ HIGH: 6, MEDIUM: 1 }), { criticalEscalationCount: 5 });
  const errors = [];
  agent.on('error', (e) => errors.push(e));

  await agent.runProactiveCycle();

  assert.deepStrictEqual(errors, [], `cycle raised: ${JSON.stringify(errors)}`);
  const status = agent.getStatus();
  assert.ok(status.recentDecisions.length > 0, 'the cycle decided something');
  assert.ok(status.recentActions.length > 0, 'and acted on it');
  assert.ok(status.logs.some((l) => /מצב/.test(l.message)), 'and said so in the log');
});

test('retraining does not fall over on the learning table — the original crash', async () => {
  const agent = agentOn(await seed({ HIGH: 1 }), { minAccuracy: 1 });
  const errors = [];
  agent.on('error', (e) => errors.push(e));
  await agent.runProactiveCycle();
  const sqlErrors = errors.filter((e) => /no such table|SQLITE/.test(e.error || ''));
  assert.deepStrictEqual(sqlErrors, [], 'the schema is ensured before the agent reads it');
});

test('the log is capped so a long-running agent cannot grow without bound', async () => {
  const agent = agentOn(await seed({}));
  for (let i = 0; i < 250; i++) agent.addLog('info', `entry ${i}`);
  assert.ok(agent.logs.length <= agent.maxLogs, `log grew to ${agent.logs.length}`);
  assert.match(agent.logs[agent.logs.length - 1].message, /entry 249/, 'the newest is kept');
});

test('status is serialisable — the dashboard sends it over the wire', async () => {
  const agent = agentOn(await seed({ HIGH: 2 }));
  await agent.runProactiveCycle();
  const json = JSON.stringify(agent.getStatus());
  const parsed = JSON.parse(json);
  assert.strictEqual(typeof parsed.uptime, 'number');
  assert.ok(Array.isArray(parsed.recentDecisions));
});

// ── running a cycle is an operation, not a subscription ──

test('a single cycle does not quietly turn the agent into a daemon', async () => {
  const agent = agentOn(await seed({}));
  assert.strictEqual(agent.isRunning, false);
  await agent.runProactiveCycle();
  assert.strictEqual(agent.isRunning, false, 'one cycle must not start timers nobody asked for');
  assert.ok(!agent.proactiveInterval, 'and must not leave an interval behind');
  const kinds = agent.getStatus().recentDecisions.map((d) => d.type);
  assert.ok(!kinds.includes('recovery'), 'nor decide to "recover" an agent that was never started');
});

test('self-healing still works once proactive mode was actually started', async () => {
  const agent = agentOn(await seed({}));
  agent.shouldBeRunning = true;          // started, then the timer died
  agent.isRunning = false;
  const decisions = await agent.makeDecisions({ criticalCount: 0, highCount: 0, anomalies: [], accuracy: 1 });
  assert.ok(decisions.some((d) => d.type === 'recovery'), 'a genuinely dead agent is still recovered');
});

test('stopping clears the timers so the process can exit', async () => {
  const agent = agentOn(await seed({}), { decisionIntervalMs: 60000 });
  agent.startProactive();
  assert.strictEqual(agent.isRunning, true);
  assert.ok(agent.proactiveInterval, 'an interval is running');
  agent.stopProactive();
  assert.strictEqual(agent.isRunning, false);
  assert.strictEqual(agent.shouldBeRunning, false);
  assert.ok(!agent.proactiveInterval, 'and it is cleared, not just flagged');
});
