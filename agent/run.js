#!/usr/bin/env node
'use strict';
/**
 * סוכן רשת — מריץ משימת מעקב (watch) על קבוצת מקורות ושומר את הממצאים.
 *
 * הרצה:
 *   node agent/run.js --list                     מציג את המשימות המוגדרות
 *   node agent/run.js --watch=<id>               סריקה מלאה + שמירה
 *   node agent/run.js --watch=<id> --dry-run     הדפסה בלבד, בלי לכתוב לקבצים
 *   node agent/run.js --watch=<id> --source=<id> מקור בודד
 *   node agent/run.js --watch=<id> --probe       מדידת נגישות בלבד
 *   node agent/run.js --watch=<id> --audit       ביקורת משפך: איפה נפל כל פריט
 *
 * ללא תלויות חיצוניות — משתמש ב-fetch המובנה של Node 18+.
 */

const fs = require('fs');
const path = require('path');

const { ymd } = require('./core/text');
const { createClient, withDeadline, mapLimit, sleep } = require('./core/net');
const { compileVocab } = require('./core/discover');
const { runAdapter } = require('./core/adapters');
const { classify } = require('./core/match');
const {
  compileGate, compileDateHints, buildRecord, passesGate, isNavTitle,
  sortRecords, summarize, DROP_LABELS
} = require('./core/pipeline');
const { mergeWithHistory, withHealth } = require('./core/history');

const ROOT = path.resolve(__dirname, '..');
const WATCH_DIR = path.join(__dirname, 'watches');

const ARGS = process.argv.slice(2);
const flag = name => ARGS.includes('--' + name);
const opt = name => (ARGS.find(a => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=') || '';

const today = ymd(new Date());

/* ───────────────────────── טעינת המשימה ───────────────────────── */

function listWatches() {
  if (!fs.existsSync(WATCH_DIR)) return [];
  return fs.readdirSync(WATCH_DIR)
    .filter(f => f.endsWith('.watch.json'))
    .map(f => {
      const w = JSON.parse(fs.readFileSync(path.join(WATCH_DIR, f), 'utf8'));
      return { file: f, id: w.id, name: w.name, description: w.description || '', enabled: w.enabled !== false };
    });
}

function loadWatch(idOrPath) {
  const direct = path.resolve(process.cwd(), idOrPath);
  const byId = path.join(WATCH_DIR, `${idOrPath}.watch.json`);
  const file = fs.existsSync(byId) ? byId : (fs.existsSync(direct) ? direct : '');
  if (!file) throw new Error(`לא נמצאה משימה בשם "${idOrPath}". ל-רשימה: node agent/run.js --list`);

  const watch = JSON.parse(fs.readFileSync(file, 'utf8'));
  watch.__file = file;

  // הטקסונומיה יכולה לשבת בקובץ נפרד (כדי לשתף אותה בין משימות) או בתוך המשימה
  if (typeof watch.taxonomy === 'string') {
    const taxFile = path.resolve(ROOT, watch.taxonomy);
    if (!fs.existsSync(taxFile)) throw new Error(`קובץ הטקסונומיה לא נמצא: ${watch.taxonomy}`);
    watch.taxonomy = JSON.parse(fs.readFileSync(taxFile, 'utf8'));
  }
  if (!watch.taxonomy || !watch.taxonomy.topics) {
    throw new Error('למשימה אין טקסונומיה עם topics');
  }

  // המקורות יכולים לשבת בקובץ נפרד, כדי שכמה משימות יחלקו רשימת מקורות אחת
  // במקום להעתיק אותה. `sourcesKey` הוא השדה שבתוכו יושב המערך.
  if (watch.sourcesFile) {
    const srcFile = path.resolve(ROOT, watch.sourcesFile);
    if (!fs.existsSync(srcFile)) throw new Error(`קובץ המקורות לא נמצא: ${watch.sourcesFile}`);
    const loaded = JSON.parse(fs.readFileSync(srcFile, 'utf8'));
    watch.sources = (watch.sourcesKey ? loaded[watch.sourcesKey] : loaded) || [];
  }
  watch.sources = normalizeSources(watch.sources || []);

  // שער שמפנה לשדה בטקסונומיה, במקום להעתיק את הרשימה לשני מקומות שיסטו זה מזה
  const gate = watch.gate || (watch.gate = {});
  if (gate.phrases && gate.phrases.from) {
    gate.phrases = watch.taxonomy[gate.phrases.from] || [];
  }
  return watch;
}

/**
 * מיישר שמות שדות ישנים. ראדאר המכרזים קורא לדגל `allTenders`; בסוכן הגנרי
 * השם הוא `allItems`, ושניהם מתקבלים כדי שקובץ מקורות קיים יעבוד כמו שהוא.
 */
function normalizeSources(sources) {
  return sources.map(s => ({
    ...s,
    allItems: s.allItems != null ? s.allItems : !!s.allTenders,
    hintUrls: s.hintUrls || s.tendersUrls || []
  }));
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/* ───────────────────────── הקשר הריצה ───────────────────────── */

function buildContext(watch) {
  const limits = watch.limits || {};
  const client = createClient({
    timeoutMs: limits.timeoutMs || 15000,
    retries: limits.retries != null ? limits.retries : 1,
    userAgent: limits.userAgent
  });
  return {
    client,
    politeDelayMs: limits.politeDelayMs != null ? limits.politeDelayMs : 900,
    vocab: compileVocab(watch.discovery || {}),
    gate: compileGate(watch.gate || {}),
    hints: compileDateHints(watch.dates || {}),
    taxonomy: watch.taxonomy,
    today
  };
}

/** תקרת הזמן של מקור בודד — גדלה עם מספר הכתובות שלו, אבל חסומה מלמעלה */
function sourceBudget(source, limits) {
  if (limits.sourceMaxMs) return limits.sourceMaxMs;
  const urls = Math.max(1, (source.urls || []).length + (source.hintUrls || []).length);
  return Math.min(300000, 60000 + 20000 * urls);
}

function activeSourcesOf(watch, onlySource) {
  return (watch.sources || [])
    .filter(s => s.enabled !== false)
    .filter(s => !onlySource || s.id === onlySource);
}

/* ───────────────────────── סריקה ───────────────────────── */

async function scanSource(source, watch, ctx, dropped) {
  const started = Date.now();
  const entry = {
    id: source.id, name: source.name || source.id, category: source.category || '',
    ok: false, count: 0, error: '', warnings: [], discovered: []
  };
  let records = [];

  try {
    const items = await withDeadline(
      runAdapter(source, ctx),
      sourceBudget(source, watch.limits || {}),
      `המקור חרג מתקרת הזמן שלו`
    );
    entry.ok = true;
    entry.warnings = items.warnings || [];
    entry.discovered = items.discovered || [];

    const maxPerSource = (watch.limits || {}).maxPerSource || 60;
    const seen = new Set();
    for (const item of items) {
      const { record, drop } = buildRecord(item, source, watch, ctx);
      if (drop) { dropped[drop] = (dropped[drop] || 0) + 1; continue; }
      if (seen.has(record.id)) continue;
      seen.add(record.id);
      records.push(record);
      if (records.length >= maxPerSource) break;
    }
    entry.count = records.length;
    entry.harvested = items.length;
  } catch (e) {
    entry.error = (e && e.message) || String(e);
  }
  entry.ms = Date.now() - started;
  return { entry, records };
}

/**
 * בדיקה חוזרת של רשומה שמורה מול התצורה הנוכחית.
 * החזרת null מורידה אותה מהמאגר.
 */
function recheckSaved(watch, ctx) {
  return (saved, activeSources) => {
    const srcCfg = (activeSources instanceof Map ? activeSources.get(saved.source) : null) || {};
    // הבדיקה החוזרת חייבת להשתמש באותו טקסט שהסיווג המקורי השתמש בו — כותרת
    // ותקציר שהמפרסם כתב, בלי חלון ההקשר. אחרת רשומה תקינה הייתה נופלת בבדיקה
    // החוזרת (או להפך) רק בגלל מה שהיה סביבה בדף.
    const text = `${saved.title} ${saved.abstract || ''}`.trim();
    const item = { title: saved.title, url: saved.url, summary: saved.abstract || '' };
    if (isNavTitle(saved.title, ctx.gate)) return null;
    if (!passesGate(item, srcCfg, ctx.gate)) return null;
    const cls = classify(text, ctx.taxonomy);
    if (!cls.topics.length) return null;
    return { ...saved, topics: cls.topics, score: cls.score, matched: cls.matched };
  };
}

async function runWatch(watch, { onlySource, dryRun }) {
  const ctx = buildContext(watch);
  const limits = watch.limits || {};
  const sources = activeSourcesOf(watch, onlySource);
  if (!sources.length) throw new Error(onlySource ? `אין מקור פעיל בשם "${onlySource}"` : 'למשימה אין מקורות פעילים');

  console.log(`\n🔎 ${watch.name} — ${sources.length} מקורות, ${today}\n`);

  const dropped = {};
  const results = await mapLimit(sources, limits.parallel || 4, async source => {
    const r = await scanSource(source, watch, ctx, dropped);
    const mark = r.entry.ok ? '✔' : '✖';
    const detail = r.entry.ok
      ? `${r.entry.count} רשומות מתוך ${r.entry.harvested} קישורים`
      : r.entry.error;
    console.log(`  ${mark} ${r.entry.name} — ${detail}`);
    for (const w of r.entry.warnings) console.log(`      ⚠ ${w}`);
    await sleep(ctx.politeDelayMs);
    return r;
  });

  const current = results.flatMap(r => r.records);
  const status = withHealth(results.map(r => r.entry), (readJson(statusFile(watch), {}).sources || []), today);

  const prev = readJson(dataFile(watch), { items: [] });
  const prevById = new Map((prev.items || []).map(r => [r.id, r]));
  const activeMap = new Map(sources.map(s => [s.id, s]));
  const merged = sortRecords(
    mergeWithHistory(current, prevById, activeMap, watch, today, recheckSaved(watch, ctx)),
    today
  );

  const counts = summarize(merged, today);
  counts.dropped = dropped;

  report(watch, merged, status, counts, dropped);

  if (dryRun) {
    console.log('\n(--dry-run — לא נכתב דבר)\n');
    return { items: merged, status, counts };
  }

  writeJson(dataFile(watch), {
    watch: watch.id, name: watch.name, updatedAt: new Date().toISOString(),
    counts, items: merged
  });
  writeJson(statusFile(watch), { watch: watch.id, updatedAt: new Date().toISOString(), sources: status });
  console.log(`\n💾 נשמר: ${path.relative(ROOT, dataFile(watch))}\n`);
  return { items: merged, status, counts };
}

const dataFile = watch => path.resolve(ROOT, (watch.output && watch.output.data) || `agent/data/${watch.id}.json`);
const statusFile = watch => path.resolve(ROOT, (watch.output && watch.output.status) || `agent/data/${watch.id}.status.json`);

/* ───────────────────────── דיווח ───────────────────────── */

function report(watch, items, status, counts, dropped) {
  const labels = Object.fromEntries(Object.entries(watch.taxonomy.topics).map(([id, t]) => [id, t.label || id]));
  console.log(`\n📊 ${counts.total} רשומות (${counts.new} חדשות, ${counts.open} פתוחות, ${counts.closingSoon} נסגרות בשבוע)`);
  for (const [topic, n] of Object.entries(counts.byTopic).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${labels[topic] || topic}: ${n}`);
  }

  const dropList = Object.entries(dropped).sort((a, b) => b[1] - a[1]);
  if (dropList.length) {
    console.log('\n🚪 מה לא נכנס ולמה:');
    for (const [reason, n] of dropList) console.log(`   ${DROP_LABELS[reason] || reason}: ${n}`);
  }

  const failing = status.filter(s => !s.ok);
  if (failing.length) {
    console.log(`\n⚠ ${failing.length} מקורות נכשלו:`);
    for (const s of failing) {
      const hint = s.likelyTransient ? ' (עבד לאחרונה — כנראה הגבלה זמנית)' : '';
      console.log(`   ${s.name} — ${s.error}${hint}`);
    }
  }

  const top = items.slice(0, 10);
  if (top.length) {
    console.log('\n🔝 העשרה הראשונות:');
    for (const r of top) {
      const when = r.deadlineAt ? `עד ${r.deadlineAt}` : (r.publishedAt || 'בלי תאריך');
      console.log(`   [${r.topics.map(t => labels[t] || t).join(', ')}] ${r.title.slice(0, 80)} — ${when}`);
    }
  }
}

/* ───────────────────────── מדידת נגישות וביקורת ───────────────────────── */

async function probe(watch, onlySource) {
  const ctx = buildContext(watch);
  const sources = activeSourcesOf(watch, onlySource);
  console.log(`\n📡 מדידת נגישות — ${sources.length} מקורות\n`);
  let ok = 0;
  for (const s of sources) {
    const url = s.home || (s.urls || [])[0];
    try {
      const html = await ctx.client.fetchText(url, { retries: 0 });
      ok++;
      console.log(`  ✔ ${s.name || s.id} — ${html.length.toLocaleString('he-IL')} תווים`);
    } catch (e) {
      console.log(`  ✖ ${s.name || s.id} — ${(e && e.message) || e}`);
    }
    await sleep(ctx.politeDelayMs);
  }
  console.log(`\n${ok} מתוך ${sources.length} נענו. לא נשמר דבר.\n`);
}

async function audit(watch, onlySource) {
  const ctx = buildContext(watch);
  const sources = activeSourcesOf(watch, onlySource);
  const dropped = {};
  let harvested = 0, kept = 0;
  console.log(`\n🔬 ביקורת משפך — ${sources.length} מקורות\n`);
  for (const s of sources) {
    const r = await scanSource(s, watch, ctx, dropped);
    harvested += r.entry.harvested || 0;
    kept += r.records.length;
    await sleep(ctx.politeDelayMs);
  }
  console.log(`\nקישורים שנקצרו: ${harvested}`);
  for (const [reason, n] of Object.entries(dropped).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${DROP_LABELS[reason] || reason}: ${n}`);
  }
  console.log(`  ✅ נכנסו: ${kept}\n(לא נשמר דבר)\n`);
}

/* ───────────────────────── ראשי ───────────────────────── */

async function main() {
  if (flag('list') || (!opt('watch') && !ARGS.length)) {
    const all = listWatches();
    if (!all.length) { console.log('אין משימות מוגדרות ב-agent/watches/'); return; }
    console.log('\nמשימות מוגדרות:\n');
    for (const w of all) {
      console.log(`  ${w.enabled ? '●' : '○'} ${w.id.padEnd(16)} ${w.name}`);
      if (w.description) console.log(`    ${w.description}`);
    }
    console.log('\nהרצה: node agent/run.js --watch=<id>\n');
    return;
  }

  const watch = loadWatch(opt('watch'));
  const onlySource = opt('source');

  if (flag('probe') || opt('probe')) return probe(watch, opt('probe') || onlySource);
  if (flag('audit') || opt('audit')) return audit(watch, opt('audit') || onlySource);
  await runWatch(watch, { onlySource, dryRun: flag('dry-run') });
}

if (require.main === module) {
  main()
    .then(() => setTimeout(() => process.exit(0), 500))
    .catch(e => { console.error('✖ הריצה נכשלה:', (e && e.stack) || e); process.exit(1); });
}

module.exports = { loadWatch, listWatches, runWatch, buildContext, scanSource, recheckSaved, sourceBudget };
