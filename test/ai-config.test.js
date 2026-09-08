const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { DEFAULTS, loadRules, readEnvConfig, coerce } = require('../ai-config');

const NO_FILE = path.join(os.tmpdir(), 'ai-config-does-not-exist.json');

test('defaults are used when nothing overrides them', () => {
  const rules = loadRules({}, { env: {}, file: NO_FILE });
  assert.strictEqual(rules.criticalEscalationCount, 5);
  assert.strictEqual(rules.minAccuracy, 0.7);
  assert.deepStrictEqual(rules.escalationRecipients, []);
});

test('escalation has no default recipient — an unaddressed escalation is a visible gap', () => {
  assert.deepStrictEqual(DEFAULTS.escalationRecipients, []);
});

test('environment overrides defaults, and numbers arrive as numbers', () => {
  const rules = loadRules({}, {
    env: { AI_CRITICAL_ESCALATION_COUNT: '12', AI_MIN_ACCURACY: '0.9' },
    file: NO_FILE,
  });
  assert.strictEqual(rules.criticalEscalationCount, 12);
  assert.strictEqual(rules.minAccuracy, 0.9);
});

test('recipients come through as a list, however they are written', () => {
  const fromEnv = readEnvConfig({ AI_ESCALATION_RECIPIENTS: 'a@x.com, b@x.com ,' });
  assert.deepStrictEqual(fromEnv.escalationRecipients, ['a@x.com', 'b@x.com']);
  const coerced = coerce({ escalationRecipients: 'solo@x.com' });
  assert.deepStrictEqual(coerced.escalationRecipients, ['solo@x.com']);
});

test('a config file is read, and an instance override still wins over it', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aicfg-')), 'ai-config.json');
  fs.writeFileSync(file, JSON.stringify({ criticalEscalationCount: 2, stableHighCount: 1 }));
  const fromFile = loadRules({}, { env: {}, file });
  assert.strictEqual(fromFile.criticalEscalationCount, 2);
  assert.strictEqual(fromFile.stableHighCount, 1);

  const overridden = loadRules({ criticalEscalationCount: 99 }, { env: {}, file });
  assert.strictEqual(overridden.criticalEscalationCount, 99, 'the caller has the last word');
  assert.strictEqual(overridden.stableHighCount, 1, 'the rest of the file still applies');
});

test('a nonsense value falls back instead of silently disabling the rule', () => {
  const rules = loadRules({}, { env: { AI_CRITICAL_ESCALATION_COUNT: 'many' }, file: NO_FILE });
  assert.strictEqual(rules.criticalEscalationCount, DEFAULTS.criticalEscalationCount);
  assert.ok(Number.isFinite(rules.criticalEscalationCount));
});

test('a negative threshold is refused — it would fire on every cycle', () => {
  const rules = loadRules({}, { env: { AI_CRITICAL_ESCALATION_COUNT: '-1' }, file: NO_FILE });
  assert.strictEqual(rules.criticalEscalationCount, DEFAULTS.criticalEscalationCount);
});

test('a malformed config file does not stop the agent from starting', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aicfg-')), 'ai-config.json');
  fs.writeFileSync(file, '{ this is not json');
  const rules = loadRules({}, { env: {}, file });
  assert.deepStrictEqual(rules.criticalEscalationCount, DEFAULTS.criticalEscalationCount);
});
