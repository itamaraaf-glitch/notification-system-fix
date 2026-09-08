/**
 * The rules the proactive agent decides by.
 *
 * These used to be literals inside makeDecisions() — "> 5", "< 0.7", and a pair
 * of example addresses — so changing when the agent escalates meant editing the
 * decision engine. They are data now: defaults here, overridable per instance,
 * by environment variable, or by an ai-config.json next to this file.
 *
 * Precedence, lowest to highest: defaults → ai-config.json → environment →
 * whatever is passed to the agent constructor.
 */

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  // Escalate when this many severe alerts land inside the window
  criticalEscalationCount: 5,
  // Investigate when this many anomalies are open
  anomalyInvestigationCount: 3,
  // Ask for feedback when scoring accuracy drops below this
  minAccuracy: 0.7,
  // "Stable" enough to process routine alerts unattended
  stableHighCount: 3,
  // How far back the situation query looks
  situationWindowHours: 1,
  // Seconds between proactive cycles
  decisionIntervalMs: 30000,
  // Who an escalation goes to. Empty by default — an escalation with nowhere to
  // go should be visible as a gap, not silently sent to a placeholder address.
  escalationRecipients: [],
};

const NUMERIC = new Set([
  'criticalEscalationCount',
  'anomalyInvestigationCount',
  'minAccuracy',
  'stableHighCount',
  'situationWindowHours',
  'decisionIntervalMs',
]);

const ENV_KEYS = {
  AI_CRITICAL_ESCALATION_COUNT: 'criticalEscalationCount',
  AI_ANOMALY_INVESTIGATION_COUNT: 'anomalyInvestigationCount',
  AI_MIN_ACCURACY: 'minAccuracy',
  AI_STABLE_HIGH_COUNT: 'stableHighCount',
  AI_SITUATION_WINDOW_HOURS: 'situationWindowHours',
  AI_DECISION_INTERVAL_MS: 'decisionIntervalMs',
  AI_ESCALATION_RECIPIENTS: 'escalationRecipients',
};

const CONFIG_FILE = path.join(__dirname, 'ai-config.json');

function readFileConfig(file = CONFIG_FILE) {
  try {
    if (!fs.existsSync(file)) return {};
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    console.warn(`⚠️  ai-config.json unreadable, using defaults: ${err.message}`);
    return {};
  }
}

function readEnvConfig(env = process.env) {
  const out = {};
  for (const [envKey, key] of Object.entries(ENV_KEYS)) {
    const raw = env[envKey];
    if (raw === undefined || raw === '') continue;
    out[key] = key === 'escalationRecipients'
      ? String(raw).split(',').map((s) => s.trim()).filter(Boolean)
      : raw;
  }
  return out;
}

/** Keeps a bad value from silently becoming NaN and disabling a rule. */
function coerce(config) {
  const out = { ...config };
  for (const key of NUMERIC) {
    if (out[key] === undefined) continue;
    const n = Number(out[key]);
    if (Number.isFinite(n) && n >= 0) {
      out[key] = n;
    } else {
      console.warn(`⚠️  ${key}="${out[key]}" is not a usable number — keeping ${DEFAULTS[key]}`);
      out[key] = DEFAULTS[key];
    }
  }
  if (out.escalationRecipients !== undefined && !Array.isArray(out.escalationRecipients)) {
    out.escalationRecipients = String(out.escalationRecipients)
      .split(',').map((s) => s.trim()).filter(Boolean);
  }
  return out;
}

/** Resolves the rules for one agent instance. */
function loadRules(overrides = {}, { env = process.env, file = CONFIG_FILE } = {}) {
  return coerce({
    ...DEFAULTS,
    ...readFileConfig(file),
    ...readEnvConfig(env),
    ...overrides,
  });
}

module.exports = { DEFAULTS, loadRules, readFileConfig, readEnvConfig, coerce, ENV_KEYS };
