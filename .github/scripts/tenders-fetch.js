#!/usr/bin/env node
'use strict';
/**
 * ראדאר מכרזים — סורק מקורות מכרזים ציבוריים בישראל ומסנן את הרלוונטיים
 * לתחומי תקשורת, ציוד תקשורת, אבטחת מידע ו-IT.
 *
 * הרצה:  node .github/scripts/tenders-fetch.js [--source=<id>] [--dry-run]
 * פלט:   tenders/data/tenders.json  (ממצאים + היסטוריה)
 *        tenders/data/status.json   (בריאות המקורות בריצה האחרונה)
 *
 * ללא תלויות חיצוניות — משתמש ב-fetch המובנה של Node 18+.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CFG_DIR = path.join(ROOT, 'tenders', 'config');
const DATA_DIR = path.join(ROOT, 'tenders', 'data');

const ARGS = process.argv.slice(2);
const ONLY_SOURCE = (ARGS.find(a => a.startsWith('--source=')) || '').split('=')[1] || '';
const DRY_RUN = ARGS.includes('--dry-run');
// --debug=<id> מדפיס את הקישורים שנקצרו מהמקור יחד עם חלון ההקשר שלהם,
// כדי לאבחן חילוץ תאריכים בלי לנחש את מבנה הדף
const DEBUG_SOURCE = (ARGS.find(a => a.startsWith('--debug=')) || '').split('=')[1] || '';

const TIMEOUT_MS = +(process.env.TENDERS_TIMEOUT_MS || 25000);
const KEEP_DAYS = +(process.env.TENDERS_KEEP_DAYS || 45);
const MAX_PER_SOURCE = +(process.env.TENDERS_MAX_PER_SOURCE || 60);
const POLITE_DELAY_MS = +(process.env.TENDERS_DELAY_MS || 1200);
const UA = 'Mozilla/5.0 (compatible; TendersRadar/1.0; +https://github.com/itamaraaf-glitch/notification-system-fix)';

const today = ymd(new Date());

/* ───────────────────────── עזרי תאריך ומחרוזת ───────────────────────── */

function ymd(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function daysBetween(fromYmd, toYmd) {
  const a = Date.parse(fromYmd + 'T00:00:00Z'), b = Date.parse(toYmd + 'T00:00:00Z');
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', shy: ''
};
function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => {
      const v = ENTITIES[name.toLowerCase()];
      return v === undefined ? m : v;
    });
}
function safeCodePoint(n) {
  try { return String.fromCodePoint(n); } catch (_) { return ''; }
}
function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}
/** מפתח נרמול להשוואת כפילויות — מסיר ניקוד, סימני פיסוק וגרשיים */
function normKey(s) {
  return String(s)
    .replace(/[\u0591-\u05C7]/g, '')
    .replace(/["'׳״`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();
}
function hashId(s) {
  // FNV-1a 64 ביט (מיוצג כ-hex) — יציב בין ריצות, בלי תלות ב-crypto
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'));
}

/* ───────────────────────── התאמת מילות מפתח ───────────────────────── */

const RX_CACHE = new Map();

/** מונח עברי/כללי: מתיר תחיליות (ו/ה/ב/ל/מ/ש/כ/ד) וסיומות נטייה קצרות */
function termRegex(term) {
  const key = 't:' + term;
  if (RX_CACHE.has(key)) return RX_CACHE.get(key);
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s\u2010-\u2015-]+/g, '[\\s\\-]+');
  const rx = new RegExp('(?:^|[^\\p{L}\\p{N}])[והבלמשכד]{0,2}' + esc + '\\p{L}{0,3}(?:$|[^\\p{L}\\p{N}])', 'iu');
  RX_CACHE.set(key, rx);
  return rx;
}
/** ראשי תיבות: מילה שלמה. אם המונח כולו אותיות גדולות/ספרות — התאמה רגישה לאותיות */
function acronymRegex(term) {
  const key = 'a:' + term;
  if (RX_CACHE.has(key)) return RX_CACHE.get(key);
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s\u2010-\u2015-]+/g, '[\\s\\-]+');
  const caseSensitive = /^[A-Z0-9\s-]+$/.test(term);
  const rx = new RegExp('(?:^|[^\\p{L}\\p{N}])' + esc + '(?:$|[^\\p{L}\\p{N}])', caseSensitive ? 'u' : 'iu');
  RX_CACHE.set(key, rx);
  return rx;
}

/**
 * מסווג טקסט לנושאים ומחזיר ניקוד.
 * @returns {{topics:string[], score:number, matched:string[], byTopic:Object, blocked:boolean}}
 */
function classify(text, kw) {
  const byTopic = {};
  const matched = [];
  let total = 0;

  for (const [topicId, topic] of Object.entries(kw.topics)) {
    let score = 0;
    for (const [term, weight] of (topic.terms || [])) {
      if (termRegex(term).test(text)) { score += weight; matched.push(term); }
    }
    for (const [term, weight] of (topic.acronyms || [])) {
      if (acronymRegex(term).test(text)) { score += weight; matched.push(term); }
    }
    if (score > 0) byTopic[topicId] = score;
    total += score;
  }

  let penalty = 0;
  const negHits = [];
  for (const [term, weight] of (kw.negative || [])) {
    if (termRegex(term).test(text)) { penalty += weight; negHits.push(term); }
  }

  // מונחי השלילה אינם משויכים לנושא מסוים, ולכן הם מקזזים את הניקוד של כל נושא.
  // כך "מכרז לשירותי קלינאי תקשורת" אינו נכנס לנושא תקשורת, אף שהמונח "תקשורת" מופיע בו.
  const min = kw.minScore || 3;
  const topics = Object.entries(byTopic)
    .filter(([, s]) => s - penalty >= min)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  return {
    topics,
    score: Math.max(0, total - penalty),
    rawScore: total,
    penalty,
    matched: [...new Set(matched)].slice(0, 12),
    negative: negHits,
    blocked: penalty >= total
  };
}

function looksLikeTender(text, kw) {
  return (kw.tenderGate || []).some(g => termRegex(g).test(text));
}

/* ───────────────────────── חילוץ תאריכים ומספרי מכרז ───────────────────────── */

const DATE_ISO = /(\d{4})-(\d{1,2})-(\d{1,2})/;
const DATE_DMY = /(\d{1,2})[./](\d{1,2})[./](\d{2,4})/;

function parseDateNear(text) {
  const iso = text.match(DATE_ISO);
  if (iso) return normalizeParts(+iso[1], +iso[2], +iso[3]);
  const dmy = text.match(DATE_DMY);
  if (dmy) {
    let y = +dmy[3];
    if (y < 100) y += 2000;
    return normalizeParts(y, +dmy[2], +dmy[1]);
  }
  return '';
}
function normalizeParts(y, m, d) {
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return '';
  if (y < 2000 || y > 2100) return '';
  const p = n => String(n).padStart(2, '0');
  return `${y}-${p(m)}-${p(d)}`;
}

const DEADLINE_HINTS = /(מועד\s*אחרון|תאריך\s*אחרון|להגשה\s*עד|מועד\s*ההגשה|מועד\s*הגשה|תום\s*המועד|נעילת|סגירת\s*המכרז|הגשה\s*עד)/;
const PUBLISH_HINTS = /(תאריך\s*פרסום|פורסם\s*ב|מועד\s*פרסום|תאריך\s*הפרסום)/;

/** מחפש תאריך שמופיע אחרי ביטוי רמז, בתוך חלון טקסט */
function dateAfterHint(context, hintRe) {
  const m = context.match(hintRe);
  if (!m) return '';
  const after = context.slice(m.index, m.index + 140);
  return parseDateNear(after);
}

const TENDER_NUM = /(?:מכרז|הליך|פנייה|פניה)[^\d\n]{0,25}(\d{1,4}\s*[\/\-]\s*\d{2,4})/;
function extractTenderNumber(text) {
  const m = text.match(TENDER_NUM);
  return m ? m[1].replace(/\s+/g, '') : '';
}

/* ───────────────────────── שכבת רשת ───────────────────────── */

async function fetchText(url, { retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: ctl.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8',
          'Accept-Language': 'he-IL,he;q=0.9,en;q=0.8'
        }
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(1500 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/* ───────────────────────── מתאמים (adapters) ───────────────────────── */

const ANCHOR_RE = /<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))[^>]*>([\s\S]*?)<\/a>/gi;

/** קוצר קישורים מדף רשימה. מחזיר גם חלון הקשר סביב כל קישור לצורך חילוץ תאריכים. */
function harvestAnchors(html, baseUrl) {
  const out = [];
  const seen = new Set();
  let m;
  ANCHOR_RE.lastIndex = 0;
  while ((m = ANCHOR_RE.exec(html)) !== null) {
    const href = decodeEntities(m[1] || m[2] || m[3] || '').trim();
    const title = stripTags(m[4] || '');
    if (!href || !title) continue;
    if (/^(javascript:|mailto:|tel:|#)/i.test(href)) continue;
    if (title.length < 10 || title.length > 300) continue;

    let abs;
    try { abs = new URL(href, baseUrl).toString(); } catch (_) { continue; }
    if (!/^https?:/i.test(abs)) continue;

    const dedupe = normKey(title) + '|' + abs;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    // חלון הקשר: מעט לפני הקישור והרבה אחריו (תאריכים מופיעים בדרך כלל בהמשך השורה/הכרטיס)
    const start = Math.max(0, m.index - 250);
    const context = stripTags(html.slice(start, m.index + m[0].length + 450));

    out.push({ title, url: abs, context });
  }
  return out;
}

async function adapterHtml(source) {
  const items = [];
  for (const url of (source.urls || [])) {
    const html = await fetchText(url);
    for (const a of harvestAnchors(html, url)) {
      items.push({
        title: a.title,
        url: a.url,
        context: a.context,
        publishedAt: dateAfterHint(a.context, PUBLISH_HINTS),
        deadlineAt: dateAfterHint(a.context, DEADLINE_HINTS)
      });
    }
    await sleep(POLITE_DELAY_MS);
  }
  return items;
}

const RSS_ITEM_RE = /<(item|entry)\b[\s\S]*?<\/\1>/gi;
function pickTag(xml, tag) {
  const m = xml.match(new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
  return m ? stripTags(m[1]) : '';
}
function pickLink(xml) {
  const href = xml.match(/<link\b[^>]*href\s*=\s*"([^"]+)"/i);
  if (href) return decodeEntities(href[1]);
  return pickTag(xml, 'link');
}

async function adapterRss(source) {
  const items = [];
  for (const url of (source.urls || [])) {
    const xml = await fetchText(url);
    const blocks = xml.match(RSS_ITEM_RE) || [];
    for (const b of blocks) {
      const title = pickTag(b, 'title');
      const link = pickLink(b);
      if (!title || !link) continue;
      const desc = pickTag(b, 'description') || pickTag(b, 'summary');
      const pub = pickTag(b, 'pubDate') || pickTag(b, 'updated') || pickTag(b, 'published');
      let publishedAt = '';
      if (pub) {
        const d = new Date(pub);
        publishedAt = isNaN(d) ? parseDateNear(pub) : ymd(d);
      }
      const context = (title + ' ' + desc).slice(0, 700);
      items.push({
        title, url: link, context, publishedAt,
        deadlineAt: dateAfterHint(context, DEADLINE_HINTS),
        summary: desc.slice(0, 300)
      });
    }
    await sleep(POLITE_DELAY_MS);
  }
  return items;
}

/** data.gov.il — CKAN. מאתר מערכי נתונים של מכרזים ושולף מהם רשומות לפי מילות חיפוש. */
async function adapterCkan(source) {
  const api = source.api || 'https://data.gov.il/api/3/action';
  const items = [];

  const pkgRaw = await fetchText(
    `${api}/package_search?q=${encodeURIComponent(source.datasetQuery || 'מכרזים')}&rows=${source.maxDatasets || 6}`
  );
  const pkgJson = JSON.parse(pkgRaw);
  const packages = (pkgJson && pkgJson.result && pkgJson.result.results) || [];

  for (const pkg of packages) {
    const resources = (pkg.resources || []).filter(r => r.datastore_active);
    for (const res of resources.slice(0, 2)) {
      for (const q of (source.queries || ['תקשורת'])) {
        await sleep(POLITE_DELAY_MS);
        let recs = [];
        try {
          const raw = await fetchText(
            `${api}/datastore_search?resource_id=${encodeURIComponent(res.id)}&q=${encodeURIComponent(q)}&limit=25`
          );
          const j = JSON.parse(raw);
          recs = (j && j.result && j.result.records) || [];
        } catch (_) { continue; }

        for (const rec of recs) {
          const mapped = mapCkanRecord(rec);
          if (!mapped.title) continue;
          items.push({
            title: mapped.title,
            url: mapped.url || pkg.url || `https://data.gov.il/dataset/${pkg.name}`,
            context: mapped.context,
            publishedAt: mapped.publishedAt,
            deadlineAt: mapped.deadlineAt,
            publisher: mapped.publisher || pkg.title || '',
            summary: mapped.context.slice(0, 300)
          });
        }
      }
    }
  }
  return items;
}

/** ממפה רשומת CKAN גנרית לשדות שלנו לפי שמות עמודות בעברית/אנגלית */
function mapCkanRecord(rec) {
  const entries = Object.entries(rec).filter(([k]) => k !== '_id' && k !== 'rank');
  const find = (...pats) => {
    for (const [k, v] of entries) {
      if (v == null || v === '') continue;
      if (pats.some(p => k.includes(p))) return String(v);
    }
    return '';
  };
  // שדות ב-CKAN מגיעים לעיתים עם ישויות HTML מקודדות (למשל &#39; במקום גרש) — מפענחים אותן
  const title = decodeEntities(find('שם', 'נושא', 'תיאור', 'title', 'name', 'subject'));
  const url = find('קישור', 'url', 'link');
  const publisher = decodeEntities(find('משרד', 'יחידה', 'רשות', 'מפרסם', 'publisher', 'office'));
  const publishedAt = parseDateNear(find('פרסום', 'publish'));
  const deadlineAt = parseDateNear(find('אחרון', 'הגשה', 'סיום', 'deadline', 'closing'));
  const context = decodeEntities(entries.map(([k, v]) => `${k}: ${v}`).join(' | ')).slice(0, 900);
  return { title, url: /^https?:/i.test(url) ? url : '', publisher, publishedAt, deadlineAt, context };
}

const ADAPTERS = { html: adapterHtml, rss: adapterRss, ckan: adapterCkan };

/* ───────────────────────── תהליך ראשי ───────────────────────── */

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

async function main() {
  const kw = readJson(path.join(CFG_DIR, 'keywords.json'), null);
  const cfg = readJson(path.join(CFG_DIR, 'sources.json'), null);
  if (!kw || !cfg) {
    console.error('✖ חסרים קבצי תצורה תחת tenders/config');
    process.exit(1);
  }

  if (DEBUG_SOURCE) { await debugSource(cfg, kw); return; }

  const previous = readJson(path.join(DATA_DIR, 'tenders.json'), { tenders: [] });
  const prevById = new Map((previous.tenders || []).map(t => [t.id, t]));

  const sources = (cfg.sources || []).filter(s => s.enabled !== false)
    .filter(s => !ONLY_SOURCE || s.id === ONLY_SOURCE);

  const status = [];
  const found = new Map();

  for (const source of sources) {
    const adapter = ADAPTERS[source.kind];
    const started = Date.now();
    if (!adapter) {
      status.push({ id: source.id, name: source.name, ok: false, count: 0, error: `סוג מקור לא נתמך: ${source.kind}` });
      continue;
    }
    process.stderr.write(`→ ${source.name} (${source.id}) … `);
    try {
      const raw = await adapter(source);
      let kept = 0;
      for (const item of raw) {
        const rec = buildRecord(item, source, kw);
        if (!rec) continue;
        if (kept >= MAX_PER_SOURCE) break;
        // בבחירה בין כפילויות — שומרים את הרשומה עם הניקוד הגבוה יותר
        const existing = found.get(rec.id);
        if (!existing || rec.score > existing.score) found.set(rec.id, rec);
        kept++;
      }
      status.push({
        id: source.id, name: source.name, category: source.category || '', ok: true,
        scanned: raw.length, count: kept, ms: Date.now() - started,
        searchUrl: source.searchUrl || source.home || ''
      });
      console.error(`נסרקו ${raw.length}, רלוונטיים ${kept}`);
    } catch (e) {
      status.push({
        id: source.id, name: source.name, category: source.category || '', ok: false,
        scanned: 0, count: 0, error: String(e && e.message || e), ms: Date.now() - started,
        searchUrl: source.searchUrl || source.home || ''
      });
      console.error(`נכשל: ${e && e.message || e}`);
    }
    await sleep(POLITE_DELAY_MS);
  }

  const merged = mergeWithHistory([...found.values()], prevById);
  const payload = {
    generatedAt: new Date().toISOString(),
    generatedDate: today,
    topics: Object.fromEntries(Object.entries(kw.topics).map(([id, t]) => [id, { label: t.label, icon: t.icon, color: t.color }])),
    manualLinks: cfg.manualLinks || [],
    counts: summarize(merged),
    sources: status,
    tenders: merged
  };

  if (DRY_RUN) {
    console.log(JSON.stringify({ ...payload, tenders: merged.slice(0, 5) }, null, 2));
    console.error(`\n(dry-run) סה"כ ${merged.length} מכרזים, ${payload.counts.new} חדשים`);
    return;
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'tenders.json'), JSON.stringify(payload, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(DATA_DIR, 'status.json'), JSON.stringify({
    generatedAt: payload.generatedAt, sources: status, counts: payload.counts
  }, null, 2) + '\n', 'utf8');

  console.error(`\n✔ נשמרו ${merged.length} מכרזים (${payload.counts.new} חדשים) → tenders/data/tenders.json`);
}

/** מצב אבחון: מדפיס מה נקצר ממקור בודד, כדי לראות איפה התאריכים יושבים בדף */
async function debugSource(cfg, kw) {
  const source = (cfg.sources || []).find(s => s.id === DEBUG_SOURCE);
  if (!source) {
    console.log(`מקור לא נמצא: ${DEBUG_SOURCE}. מקורות קיימים: ${(cfg.sources||[]).map(s => s.id).join(', ')}`);
    return;
  }
  console.log(`=== אבחון מקור: ${source.name} (${source.id}) ===`);
  for (const url of (source.urls || [])) {
    console.log(`\n--- ${url} ---`);
    let html;
    try { html = await fetchText(url); }
    catch (e) { console.log('שגיאת הבאה:', e && e.message || e); continue; }
    console.log(`אורך HTML: ${html.length}`);

    const anchors = harvestAnchors(html, url);
    console.log(`קישורים שנקצרו: ${anchors.length}`);

    // כמה תאריכים בכלל יש בדף, ובאיזה פורמט
    const allDates = html.match(/\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{4}-\d{2}-\d{2}/g) || [];
    console.log(`תאריכים בדף (סה"כ ${allDates.length}), 10 ראשונים: ${allDates.slice(0, 10).join(' , ')}`);
    const hintWords = (html.match(/(מועד\s*אחרון|תאריך\s*אחרון|להגשה|מועד\s*הגשה|תאריך\s*פרסום|סגירה|נעילה)/g) || []);
    console.log(`ביטויי רמז למועד בדף: ${[...new Set(hintWords)].join(' , ') || 'לא נמצאו'}`);

    const relevant = anchors.filter(a => classify(a.title, kw).topics.length);
    console.log(`מתוכם רלוונטיים לנושאים שלנו: ${relevant.length}`);
    for (const a of relevant.slice(0, 4)) {
      console.log(`\n  כותרת : ${a.title.slice(0, 110)}`);
      console.log(`  קישור : ${a.url}`);
      console.log(`  הקשר  : ${a.context.slice(0, 400).replace(/\s+/g, ' ')}`);
      console.log(`  חולץ  : פרסום=${dateAfterHint(a.context, PUBLISH_HINTS) || '—'} הגשה=${dateAfterHint(a.context, DEADLINE_HINTS) || '—'} תאריך-כלשהו=${parseDateNear(a.context) || '—'}`);
    }
    await sleep(POLITE_DELAY_MS);
  }
}

function buildRecord(item, source, kw) {
  const haystack = `${item.title} ${item.summary || ''} ${item.context || ''}`;
  const titleAndSummary = `${item.title} ${item.summary || ''}`;

  // שער "האם זה בכלל מכרז" — נדרש רק בדפים שאינם ייעודיים למכרזים
  if (!source.allTenders && !looksLikeTender(titleAndSummary, kw)) return null;

  // הסיווג נעשה על הכותרת והתקציר בלבד, כדי שהקשר הדף לא ייצור התאמות שווא
  const cls = classify(titleAndSummary, kw);
  if (cls.blocked || cls.topics.length === 0) return null;

  const tenderNumber = extractTenderNumber(titleAndSummary) || extractTenderNumber(item.context || '');
  const host = (() => { try { return new URL(item.url).host; } catch (_) { return source.id; } })();
  const id = hashId(source.id + '|' + (tenderNumber || normKey(item.title)) + '|' + host);

  let deadlineAt = item.deadlineAt || '';
  // תאריך הגשה שכבר חלף בשנה שעברה הוא כמעט תמיד שגיאת חילוץ — עדיף לא להציג
  if (deadlineAt && daysBetween(today, deadlineAt) < -400) deadlineAt = '';

  return {
    id,
    title: item.title.trim(),
    url: item.url,
    source: source.id,
    sourceName: source.name,
    category: source.category || '',
    publisher: item.publisher || source.name,
    tenderNumber,
    publishedAt: item.publishedAt || '',
    deadlineAt,
    summary: (item.summary || '').trim(),
    topics: cls.topics,
    score: cls.score,
    matched: cls.matched,
    firstSeen: today,
    lastSeen: today
  };
}

function mergeWithHistory(current, prevById) {
  const out = new Map();

  for (const rec of current) {
    const prev = prevById.get(rec.id);
    out.set(rec.id, prev
      ? { ...prev, ...rec, firstSeen: prev.firstSeen || rec.firstSeen, lastSeen: today }
      : rec);
  }

  // רשומות שלא נראו בריצה הזו — נשמרות עד שהן מתיישנות או שמועד ההגשה חלף
  for (const [id, prev] of prevById) {
    if (out.has(id)) continue;
    const age = daysBetween(prev.lastSeen || prev.firstSeen || today, today);
    const deadlinePassed = prev.deadlineAt && daysBetween(today, prev.deadlineAt) < -14;
    if (deadlinePassed) continue;
    if (age !== null && age > KEEP_DAYS) continue;
    out.set(id, prev);
  }

  return [...out.values()].sort((a, b) => {
    // פתוחים עם דדליין קרוב קודם, אחר כך לפי ניקוד רלוונטיות
    const da = a.deadlineAt ? daysBetween(today, a.deadlineAt) : null;
    const db = b.deadlineAt ? daysBetween(today, b.deadlineAt) : null;
    const oa = da !== null && da >= 0, ob = db !== null && db >= 0;
    if (oa && ob) return da - db;
    if (oa !== ob) return oa ? -1 : 1;
    return b.score - a.score;
  });
}

function summarize(tenders) {
  const byTopic = {};
  let isNew = 0, closingSoon = 0, open = 0;
  for (const t of tenders) {
    for (const topic of t.topics) byTopic[topic] = (byTopic[topic] || 0) + 1;
    if (t.firstSeen === today) isNew++;
    if (t.deadlineAt) {
      const d = daysBetween(today, t.deadlineAt);
      if (d !== null && d >= 0) { open++; if (d <= 7) closingSoon++; }
    }
  }
  return { total: tenders.length, new: isNew, open, closingSoon, byTopic };
}

if (require.main === module) {
  main().catch(e => {
    console.error('✖ הריצה נכשלה:', e && e.stack || e);
    process.exit(1);
  });
}

module.exports = {
  classify, looksLikeTender, harvestAnchors, parseDateNear, dateAfterHint,
  extractTenderNumber, buildRecord, mergeWithHistory, summarize,
  normKey, hashId, stripTags, decodeEntities, daysBetween,
  DEADLINE_HINTS, PUBLISH_HINTS
};
