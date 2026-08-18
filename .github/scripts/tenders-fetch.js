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
// --probe[=<קטגוריה>] בודק נגישות בלבד: לכל מקור בקשה אחת, ומדווח מי נענה, מי חוסם
// ומי לא קיים. זו מדידה ולא סריקה — היא לא שומרת נתונים ולא מדווחת מכרזים, ומטרתה
// להחליט אילו מקורות שווים סריקה אוטומטית ואילו יעברו לרשימת הבדיקה הידנית.
const PROBE = ARGS.some(a => a === '--probe' || a.startsWith('--probe='));
const PROBE_FILTER = (ARGS.find(a => a.startsWith('--probe=')) || '').split('=')[1] || '';

const TIMEOUT_MS = +(process.env.TENDERS_TIMEOUT_MS || 15000);
const RETRIES = +(process.env.TENDERS_RETRIES || 1);
// תקציב זמן כולל לסריקה. עם עשרות רשויות מקומיות, כמה אתרים איטיים או לא זמינים
// יכולים למתוח את הריצה בלי גבול; בחריגה מהתקציב הסריקה נעצרת ושומרת את מה שנאסף,
// והמקורות שלא הגיע אליהם התור מדווחים במפורש — עדיף על ריצה שנקטלת בלי תוצאות.
const BUDGET_MS = +(process.env.TENDERS_BUDGET_MS || 32 * 60 * 1000);
const RUN_STARTED = Date.now();
const budgetLeft = () => BUDGET_MS - (Date.now() - RUN_STARTED);
const KEEP_DAYS = +(process.env.TENDERS_KEEP_DAYS || 45);
const MAX_PER_SOURCE = +(process.env.TENDERS_MAX_PER_SOURCE || 60);
const POLITE_DELAY_MS = +(process.env.TENDERS_DELAY_MS || 900);
// כמה מקורות נסרקים במקביל. כל מקור הוא אתר אחר, ובתוך מקור הבקשות נשארות
// טוריות עם השהיה — כך הנימוס מול כל שרת נשמר, אבל 44 מקורות לא נסרקים בטור
// אחד ארוך שחורג מזמן הריצה.
const SOURCE_PARALLEL = +(process.env.TENDERS_PARALLEL || 4);
// תקרת זמן קשיחה לכל מקור. בלעדיה אתר איטי אחד עם הרבה כתובות בולע את כל
// תקציב הריצה, והמקורות שאחריו לא נסרקים בכלל.
const SOURCE_MAX_MS = +(process.env.TENDERS_SOURCE_MAX_MS || 0);
const UA = 'Mozilla/5.0 (compatible; TendersRadar/1.0; +https://github.com/itamaraaf-glitch/notification-system-fix)';

const today = ymd(new Date());

/** תקרת הזמן של מקור בודד — גדלה עם מספר הכתובות שלו, אבל חסומה מלמעלה */
function sourceBudget(source) {
  if (SOURCE_MAX_MS) return SOURCE_MAX_MS;
  const urls = Math.max(1, (source.urls || []).length + (source.tendersUrls || []).length);
  return Math.min(300000, 60000 + 20000 * urls);
}
/** מריץ הבטחה עם תקרת זמן. חריגה נזרקת כשגיאה רגילה ומדווחת ככשל של המקור. */
function withDeadline(promise, ms, message) {
  let timer;
  const guard = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

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

/**
 * מונח עברי/כללי: מתיר תחיליות (ו/ה/ב/ל/מ/ש/כ/ד) וסיומות נטייה קצרות.
 *
 * ראשי תיבות בעברית נכתבים עם גרשיים לפני האות האחרונה (נתב"ג, רש"ת, ח"ח), והגרשיים
 * אינם אות ולכן נחשבו סוף מילה — כך המונח "נתב" נתפס בתוך "נתב\"ג" (נמל התעופה בן גוריון)
 * וסימן 32 מכרזי זכיינות בשדה התעופה כ"ציוד תקשורת". לכן נדחית התאמה שאחריה גרשיים ואות.
 */
const ACRONYM_TAIL = '(?![׳״\'"]\\p{L})';
function termRegex(term) {
  const key = 't:' + term;
  if (RX_CACHE.has(key)) return RX_CACHE.get(key);
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s\u2010-\u2015-]+/g, '[\\s\\-]+');
  const rx = new RegExp('(?:^|[^\\p{L}\\p{N}])[והבלמשכד]{0,2}' + esc + ACRONYM_TAIL + '\\p{L}{0,3}(?:$|[^\\p{L}\\p{N}])', 'iu');
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

/**
 * האם הקישור מעיד על עמוד מכרז — מבדיל מכרזים מקישורי ניווט באתר.
 * מקור שבו כתובות המכרזים אינן מכילות מילה מזהה יכול להגדיר linkPattern משלו:
 * למשל במנהל הרכש הממשלתי כתובת מכרז היא /ilgstorefront/he/p/4000620724.
 */
const TENDER_URL_RE = /(tender|michraz|bids?|rfp|rfq|מכרז)/i;
function looksLikeTenderUrl(url, linkPattern) {
  let target = String(url);
  try {
    const u = new URL(url);
    target = decodeURIComponent(u.pathname + u.search);
  } catch (_) { /* כתובת לא תקנית — נבדקת כמחרוזת */ }
  if (linkPattern) {
    try { return new RegExp(linkPattern).test(target) || new RegExp(linkPattern).test(String(url)); }
    catch (_) { /* תבנית לא תקינה — נפילה לברירת המחדל */ }
  }
  return TENDER_URL_RE.test(target);
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

async function fetchText(url, { retries = RETRIES } = {}) {
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
      if (!res.ok) {
        const err = new Error('HTTP ' + res.status);
        // שגיאת 4xx היא קבועה (חסימה/דף שאינו קיים) — ניסיון חוזר רק מבזבז זמן.
        // בסריקה של עשרות רשויות, ניסיונות חוזרים על כתובות מתות הופכים את הריצה לארוכה מאוד.
        if (res.status >= 400 && res.status < 500 && res.status !== 429) err.permanent = true;
        throw err;
      }
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (e.permanent) break;
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
function harvestAnchors(html, baseUrl, opts) {
  const minLen = (opts && opts.minLen != null) ? opts.minLen : 10;
  const out = [];
  const seen = new Set();
  let m;
  ANCHOR_RE.lastIndex = 0;
  while ((m = ANCHOR_RE.exec(html)) !== null) {
    const href = decodeEntities(m[1] || m[2] || m[3] || '').trim();
    const title = stripTags(m[4] || '');
    if (!href || !title) continue;
    if (/^(javascript:|mailto:|tel:|#)/i.test(href)) continue;
    if (title.length < minLen || title.length > 300) continue;

    let abs;
    try { abs = new URL(href, baseUrl).toString(); } catch (_) { continue; }
    if (!/^https?:/i.test(abs)) continue;

    const dedupe = normKey(title) + '|' + abs;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    // חלון הקשר: מעט לפני הקישור והרבה אחריו (תאריכים מופיעים בהמשך השורה/הכרטיס).
    // החלון נמדד ב-HTML גולמי ואחר כך מנוקה מתגיות — בדפים עם מארקאפ עתיר מחלקות ותכונות
    // חלון קטן "נאכל" כולו על ידי התגיות, והתאריכים שבתאים הבאים של השורה נופלים מחוצה לו.
    const start = Math.max(0, m.index - 300);
    const context = stripTags(html.slice(start, m.index + m[0].length + 3000)).slice(0, 900);

    out.push({ title, url: abs, context });
  }
  return out;
}

function itemFromAnchor(a) {
  return {
    title: a.title,
    url: a.url,
    context: a.context,
    publishedAt: dateAfterHint(a.context, PUBLISH_HINTS),
    deadlineAt: dateAfterHint(a.context, DEADLINE_HINTS)
  };
}
const shortUrl = u => { try { const p = new URL(u); return p.host + p.pathname.slice(0, 40); } catch (_) { return String(u).slice(0, 50); } };

/**
 * קציר קישורים מדף רשימה אחד או יותר.
 * כתובת שנכשלת אינה מפילה את המקור — היא נרשמת כאזהרה והסריקה ממשיכה לכתובת הבאה.
 * המקור נחשב כנכשל רק אם כל הכתובות שלו נכשלו.
 */
async function adapterHtml(source) {
  const items = [];
  const warnings = [];
  let ok = 0;
  for (const url of (source.urls || [])) {
    try {
      const html = await fetchText(url);
      ok++;
      for (const a of harvestAnchors(html, url)) items.push(itemFromAnchor(a));
    } catch (e) {
      warnings.push(`${shortUrl(url)} — ${(e && e.message) || e}`);
    }
    await sleep(POLITE_DELAY_MS);
  }
  if (!ok) throw new Error(warnings.join(' | ') || 'לא הוגדרו כתובות למקור');
  items.warnings = warnings;
  return items;
}

/**
 * גילוי אוטומטי של עמוד המכרזים: נכנס לדף הבית של הרשות, מאתר את הקישור
 * ל"מכרזים" וקוצר משם. כך אפשר לכסות עשרות רשויות מקומיות בלי לתחזק כתובת
 * מדויקת לכל אחת — לכל רשות אתר ומבנה כתובות שונים.
 */
async function adapterDiscover(source) {
  const start = source.home || (source.urls || [])[0];
  if (!start) throw new Error('למקור אין כתובת דף בית');

  // באתרים רבים עמוד המכרזים קיים אבל אינו מקושר מדף הבית — הוא יושב עמוק בתפריט
  // "אודות" או בתת־דומיין נפרד. tendersUrls הוא רמז מפורש לכתובת הידועה: מנסים אותה
  // קודם, ורק אם היא לא נענית חוזרים לגילוי מדף הבית. כך אתר עם ניווט מבוסס JavaScript
  // עדיין נסרק, ואם הכתובת תשתנה — הגילוי האוטומטי עדיין מכסה.
  const hinted = [];
  for (const url of (source.tendersUrls || [])) {
    try {
      // רמז הוא ניחוש מושכל, לא מקור: בלי ניסיון חוזר, כדי שכתובת שגויה
      // לא תבזבז את תקציב הזמן של הסריקה כולה
      const html = await fetchText(url, { retries: 0 });
      const anchors = harvestAnchors(html, url);
      if (anchors.length) { hinted.push({ url, anchors }); break; }
    } catch (_) { /* רמז שלא נענה — ממשיכים לרמז הבא ואז לגילוי */ }
    await sleep(POLITE_DELAY_MS);
  }
  if (hinted.length) {
    const items = [];
    for (const a of hinted[0].anchors) items.push(itemFromAnchor(a));
    items.warnings = [];
    items.discovered = [hinted[0].url];
    return items;
  }

  const homeHtml = await fetchText(start);
  const links = findTenderLinks(homeHtml, start).slice(0, source.maxPages || 2);
  if (!links.length) throw new Error('לא נמצא קישור לעמוד מכרזים בדף הבית');

  const items = [];
  const warnings = [];
  let ok = 0;
  for (const link of links) {
    await sleep(POLITE_DELAY_MS);
    try {
      const html = await fetchText(link.url);
      ok++;
      for (const a of harvestAnchors(html, link.url)) items.push(itemFromAnchor(a));
    } catch (e) {
      warnings.push(`${shortUrl(link.url)} — ${(e && e.message) || e}`);
    }
  }
  if (!ok) throw new Error('עמוד המכרזים שאותר לא נטען: ' + warnings.join(' | '));
  items.warnings = warnings;
  items.discovered = links.map(l => l.url);
  return items;
}

/** מאתר בדף הבית קישורים שנראים כמובילים לעמוד המכרזים, מהמדויק לפחות מדויק */
function findTenderLinks(html, baseUrl) {
  const TEXT_RE = /(מכרז|מיכרז|michraz|tenders?)/i;
  const scored = [];
  const seen = new Set();
  for (const a of harvestAnchors(html, baseUrl, { minLen: 3 })) {
    const byText = TEXT_RE.test(a.title);
    const byUrl = looksLikeTenderUrl(a.url);
    if (!byText && !byUrl) continue;
    // לא יורדים לעמוד של מכרז בודד — מחפשים את עמוד הרשימה
    if (/\.(pdf|docx?|xlsx?|zip)$/i.test(a.url)) continue;
    let host;
    try { host = new URL(a.url).host; } catch (_) { continue; }
    try { if (host !== new URL(baseUrl).host) continue; } catch (_) { /* נשאר באותו אתר */ }
    if (seen.has(a.url)) continue;
    seen.add(a.url);
    // "מכרזים" כטקסט הקישור הוא האינדיקציה החזקה ביותר לעמוד רשימה
    const score = (/^\s*מכרזים\s*$/.test(a.title) ? 100 : 0) + (byText ? 10 : 0) + (byUrl ? 5 : 0)
      - Math.min(20, a.title.length / 5);
    scored.push({ url: a.url, title: a.title, score });
  }
  return scored.sort((x, y) => y.score - x.score);
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
  const warnings = [];
  let ok = 0;
  for (const url of (source.urls || [])) {
    let xml;
    try { xml = await fetchText(url); ok++; }
    catch (e) { warnings.push(`${shortUrl(url)} — ${(e && e.message) || e}`); await sleep(POLITE_DELAY_MS); continue; }
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
  if (!ok) throw new Error(warnings.join(' | ') || 'לא הוגדרו כתובות למקור');
  items.warnings = warnings;
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

const ADAPTERS = { html: adapterHtml, discover: adapterDiscover, rss: adapterRss, ckan: adapterCkan };

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
  if (PROBE) { await probeSources(cfg); return; }

  const previous = readJson(path.join(DATA_DIR, 'tenders.json'), { tenders: [] });
  const prevById = new Map((previous.tenders || []).map(t => [t.id, t]));

  const sources = (cfg.sources || []).filter(s => s.enabled !== false)
    .filter(s => !ONLY_SOURCE || s.id === ONLY_SOURCE);

  const status = [];
  const found = new Map();

  const skipped = [];
  const scanOne = async (source) => {
    const adapter = ADAPTERS[source.kind];
    const started = Date.now();
    if (!adapter) {
      status.push({ id: source.id, name: source.name, ok: false, count: 0, error: `סוג מקור לא נתמך: ${source.kind}` });
      return;
    }
    try {
      const raw = await withDeadline(adapter(source), sourceBudget(source),
        `חריגה מזמן הסריקה של המקור (${Math.round(sourceBudget(source) / 1000)} שניות)`);
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
        warn: (raw.warnings || []).join(' | ').slice(0, 200),
        discovered: raw.discovered || undefined,
        searchUrl: source.searchUrl || source.home || ''
      });
      console.error(`✔ ${source.name} — נסרקו ${raw.length}, רלוונטיים ${kept}`);
    } catch (e) {
      status.push({
        id: source.id, name: source.name, category: source.category || '', ok: false,
        scanned: 0, count: 0, error: String(e && e.message || e), ms: Date.now() - started,
        searchUrl: source.searchUrl || source.home || ''
      });
      console.error(`✖ ${source.name} — ${e && e.message || e}`);
    }
  };

  const queue = sources.slice();
  await Promise.all(Array.from({ length: Math.min(SOURCE_PARALLEL, queue.length || 1) }, async () => {
    while (queue.length) {
      if (budgetLeft() <= 0) { skipped.push(...queue.splice(0)); return; }
      await scanOne(queue.shift());
      await sleep(POLITE_DELAY_MS);
    }
  }));

  for (const source of skipped) {
    status.push({
      id: source.id, name: source.name, category: source.category || '', ok: false,
      scanned: 0, count: 0, error: 'לא נסרק — חריגה מתקציב הזמן של הריצה',
      searchUrl: source.searchUrl || source.home || ''
    });
  }
  if (skipped.length) console.error(`\n⏱ ${skipped.length} מקורות לא נסרקו בגלל תקציב הזמן`);

  // סריקת מקור בודד לא אמורה למחוק את ההיסטוריה של המקורות האחרים
  // כולל את המקורות שלא נסרקו הפעם (מקור בודד או חריגת תקציב), אחרת ההיסטוריה שלהם תימחק
  const activeSources = new Map(
    (ONLY_SOURCE ? (cfg.sources || []).filter(s => s.enabled !== false) : (cfg.sources || []).filter(s => s.enabled !== false))
      .map(s => [s.id, s])
  );
  let merged = mergeWithHistory([...found.values()], prevById, activeSources, kw);
  await enrichDeadlines(merged);
  const beforeFilter = merged.length;
  merged = merged.filter(isActionable);
  if (beforeFilter !== merged.length) {
    console.error(`\n🗂  הוסרו ${beforeFilter - merged.length} מכרזים שאי אפשר להגיש אליהם (מועד שחלף, ארכיון או התקשרות בתוקף)`);
  }
  const payload = {
    generatedAt: new Date().toISOString(),
    generatedDate: today,
    topics: Object.fromEntries(Object.entries(kw.topics).map(([id, t]) => [id, { label: t.label, icon: t.icon, color: t.color }])),
    kindLabels: KIND_LABELS,
    manualLinks: cfg.manualLinks || [],
    manualAuthorities: cfg.manualAuthorities || [],
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

/**
 * מדידת נגישות של המקורות.
 *
 * לפני שמוסיפים עשרות רשויות ומכללות לסריקה היומית צריך לדעת מי מהן בכלל עונה.
 * כאן נשלחת בקשה אחת לכל מקור, ולמקורות מסוג discover נבדק גם אם נמצא בדף הבית
 * קישור לעמוד מכרזים ואם הוא נטען. הפלט הוא טבלה + JSON, כדי שאפשר יהיה לגזור
 * ממנו החלטה: מי נשאר בסריקה האוטומטית ומי עובר לבדיקה ידנית.
 */
async function probeSources(cfg) {
  const timeout = +(process.env.TENDERS_PROBE_TIMEOUT_MS || 20000);
  const parallel = +(process.env.TENDERS_PROBE_PARALLEL || 5);
  const list = (cfg.sources || []).filter(s => s.enabled !== false)
    .filter(s => !PROBE_FILTER || (s.category || '').includes(PROBE_FILTER) || s.id === PROBE_FILTER);

  // כשל רשת (timeout / חיבור שנסגר) הוא לעיתים רגעי. מקור לא נפסל על סמך ניסיון
  // אחד — רק כשל שחוזר בשני ניסיונות נחשב תשובה. שגיאת HTTP היא תשובה מוחלטת
  // של השרת ואין טעם לחזור עליה.
  const hit = async (url) => {
    const first = await hitOnce(url);
    if (first.status !== 0) return first;
    await sleep(1200);
    const second = await hitOnce(url);
    if (second.status === 0) second.retried = true;
    return second;
  };

  const hitOnce = async (url) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(url, {
        signal: ctl.signal, redirect: 'follow',
        headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*;q=0.8', 'Accept-Language': 'he-IL,he;q=0.9,en;q=0.8' }
      });
      const body = res.ok ? await res.text() : '';
      return { status: res.status, ok: res.ok, body, finalUrl: res.url || url };
    } catch (e) {
      return { status: 0, ok: false, body: '', error: e && e.name === 'AbortError' ? 'timeout' : String((e && e.message) || e) };
    } finally { clearTimeout(timer); }
  };

  const one = async (source) => {
    const entry = source.searchUrl || source.home || (source.urls || [])[0] || '';
    const started = Date.now();
    const out = { id: source.id, name: source.name, category: source.category || '', kind: source.kind, url: entry };
    if (!entry) { out.verdict = 'no-url'; return out; }
    // כמו במסלול האמיתי: כתובת ידועה נבדקת לפני דף הבית, כך שאתר שחוסם את דף הבית
    // אבל פותח את עמוד המכרזים עדיין נמדד כנגיש
    for (const hint of (source.tendersUrls || [])) {
      const h = await hit(hint);
      if (!h.ok) { (out.hintTried = out.hintTried || []).push(hint + ' → ' + (h.status || h.error)); continue; }
      const n = harvestAnchors(h.body, hint).length;
      if (!n) { (out.hintTried = out.hintTried || []).push(hint + ' → ריק'); continue; }
      out.tendersUrl = hint; out.tendersAnchors = n; out.verdict = 'ok-hint';
      out.ms = Date.now() - started;
      return out;
    }
    const r = await hit(entry);
    out.status = r.status;
    out.ms = Date.now() - started;
    if (!r.ok) {
      out.verdict = r.status ? 'http-' + r.status : (r.error || 'error');
      return out;
    }
    out.bytes = r.body.length;
    if (source.kind === 'discover') {
      const links = findTenderLinks(r.body, r.finalUrl || entry);
      if (!links.length) { out.verdict = 'no-tenders-link'; return out; }
      out.tendersUrl = links[0].url;
      const t = await hit(links[0].url);
      if (!t.ok) { out.verdict = 'tenders-page-' + (t.status || t.error); return out; }
      out.tendersAnchors = harvestAnchors(t.body, links[0].url).length;
      out.verdict = out.tendersAnchors ? 'ok' : 'tenders-page-empty';
      return out;
    }
    out.anchors = harvestAnchors(r.body, entry).length;
    out.verdict = out.anchors ? 'ok' : 'empty';
    return out;
  };

  const results = [];
  for (let i = 0; i < list.length; i += parallel) {
    const chunk = list.slice(i, i + parallel);
    results.push(...await Promise.all(chunk.map(one)));
    process.stderr.write(`… נבדקו ${Math.min(i + parallel, list.length)}/${list.length}\n`);
    await sleep(300);
  }

  const OKV = v => v === 'ok' || v === 'ok-hint';
  const okList = results.filter(r => OKV(r.verdict));
  console.log(`## מדידת נגישות מקורות — ${okList.length}/${results.length} נגישים\n`);
  const byCat = {};
  for (const r of results) (byCat[r.category || '—'] = byCat[r.category || '—'] || []).push(r);
  for (const [cat, rows] of Object.entries(byCat)) {
    const good = rows.filter(r => OKV(r.verdict)).length;
    console.log(`\n### ${cat} — ${good}/${rows.length}\n`);
    console.log('| מקור | תוצאה | קישורים | זמן |');
    console.log('| --- | --- | --- | --- |');
    for (const r of rows.sort((a, b) => (OKV(a.verdict) ? 0 : 1) - (OKV(b.verdict) ? 0 : 1))) {
      const n = r.tendersAnchors != null ? r.tendersAnchors : (r.anchors != null ? r.anchors : '—');
      const mark = r.verdict === 'ok' ? '✅ נגיש' : r.verdict === 'ok-hint' ? '✅ נגיש (כתובת ידועה)' : '❌ ' + r.verdict;
      console.log(`| ${r.name} (\`${r.id}\`) | ${mark} | ${n} | ${r.ms || 0}ms |`);
    }
  }
  console.log('\n<!--PROBE-JSON\n' + JSON.stringify(results) + '\nPROBE-JSON-->');
}

/** מצב אבחון: מדפיס מה נקצר ממקור בודד, כדי לראות איפה התאריכים יושבים בדף */
async function debugSource(cfg, kw) {
  const source = (cfg.sources || []).find(s => s.id === DEBUG_SOURCE);
  if (!source) {
    console.log(`מקור לא נמצא: ${DEBUG_SOURCE}. מקורות קיימים: ${(cfg.sources||[]).map(s => s.id).join(', ')}`);
    return;
  }
  console.log(`=== אבחון מקור: ${source.name} (${source.id}) ===`);

  // מקור discover אינו מחזיק רשימת כתובות — צריך קודם לאתר את עמוד המכרזים,
  // בדיוק כמו בסריקה עצמה, אחרת האבחון מדפיס כלום ולא עוזר.
  let urls = source.urls || [];
  if (!urls.length) {
    urls = (source.tendersUrls || []).slice();
    const start = source.home || '';
    if (start) {
      try {
        const found = findTenderLinks(await fetchText(start), start).slice(0, source.maxPages || 2);
        for (const l of found) if (!urls.includes(l.url)) urls.push(l.url);
        console.log(`עמודי מכרזים שאותרו מדף הבית: ${found.map(l => l.url).join(' , ') || 'לא נמצאו'}`);
      } catch (e) { console.log('דף הבית לא נטען:', (e && e.message) || e); }
    }
  }

  for (const url of urls) {
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

    // מה באמת נכנס לראדאר מהעמוד הזה — אחרי שער "האם זה מכרז", סיווג, סוג פרסום
    // וסטטוס. זה המספר שמשנה; "רלוונטיים לנושאים" הוא רק הסיווג הגולמי.
    const passed = [];
    for (const a of anchors) {
      const rec = buildRecord(itemFromAnchor(a), source, kw);
      if (rec) passed.push(rec);
    }
    console.log(`עוברים את כל השערים ונכנסים לראדאר: ${passed.length}`);
    for (const r of passed.slice(0, 12)) {
      console.log(`  ▸ ${r.title.slice(0, 90)}`);
      console.log(`    סוג=${r.kind} מועד=${r.deadlineAt || '—'} פורסם=${r.publishedAt || '—'} סטטוס=${r.status || '—'} ניתן-להגשה=${isActionable(r) ? 'כן' : 'לא'} התאמות=${(r.matched || []).slice(0, 4).join(',')}`);
    }
    for (const a of relevant.slice(0, 4)) {
      console.log(`\n  כותרת : ${a.title.slice(0, 110)}`);
      console.log(`  קישור : ${a.url}`);
      console.log(`  הקשר  : ${a.context.slice(0, 400).replace(/\s+/g, ' ')}`);
      console.log(`  חולץ  : פרסום=${dateAfterHint(a.context, PUBLISH_HINTS) || '—'} הגשה=${dateAfterHint(a.context, DEADLINE_HINTS) || '—'} תאריך-כלשהו=${parseDateNear(a.context) || '—'}`);
    }

    // דף המכרז עצמו: כשהמועד חסר בדף הרשימה, כאן אפשר לראות איך הוא באמת כתוב
    const first = relevant[0];
    if (first && first.url) {
      try {
        const detail = stripTags(await fetchText(first.url)).replace(/\s+/g, ' ');
        console.log(`\n  --- דף המכרז: ${first.url} ---`);
        console.log(`  אורך טקסט: ${detail.length}`);
        const dates = detail.match(/\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{4}-\d{2}-\d{2}/g) || [];
        console.log(`  תאריכים בדף (${dates.length}): ${dates.slice(0, 12).join(' , ') || 'אין'}`);
        for (const hint of ['מועד אחרון', 'מועד הגשה', 'תאריך אחרון', 'להגשה', 'הגשת הצעות', 'סגירה', 'תאריך פרסום']) {
          const i = detail.indexOf(hint);
          if (i >= 0) console.log(`  "${hint}" → …${detail.slice(Math.max(0, i - 40), i + 120)}…`);
        }
        console.log(`  חולץ מדף המכרז: הגשה=${dateAfterHint(detail, DEADLINE_HINTS) || '—'} פרסום=${dateAfterHint(detail, PUBLISH_HINTS) || '—'}`);
      } catch (e) { console.log('  דף המכרז לא נטען:', (e && e.message) || e); }
    }
    await sleep(POLITE_DELAY_MS);
  }
}

/**
 * העשרת מועד ההגשה מדף המכרז עצמו.
 *
 * בדפי רשימה רבים מועד ההגשה פשוט לא מופיע — הוא נמצא רק בעמוד המכרז. בלי זה
 * רוב הרשומות מגיעות בלי מועד, וממילא אי אפשר לדעת מה נסגר בשבוע הקרוב, שזה
 * המידע המעשי ביותר. לכן לכל מכרז חדש שאין לו מועד נכנסים פעם אחת לדף שלו.
 * הבדיקה נעשית פעם אחת בלבד לכל מכרז (deadlineChecked), כדי לא לחזור על כך יום־יום.
 */
async function enrichDeadlines(records) {
  const limit = +(process.env.TENDERS_ENRICH_LIMIT || 25);
  const targets = records.filter(r =>
    r.lastSeen === today && !r.deadlineAt && !r.deadlineChecked && r.url).slice(0, limit);
  if (!targets.length) return;

  let filled = 0;
  for (const rec of targets) {
    // משאירים מרווח בתקציב לשמירה ולדיווח
    if (budgetLeft() < 45000) break;
    rec.deadlineChecked = true;
    try {
      const text = stripTags(await fetchText(rec.url)).slice(0, 30000);
      const dl = dateAfterHint(text, DEADLINE_HINTS);
      // תאריך שחלף מזמן הוא כמעט תמיד שגיאת חילוץ מארכיון שמופיע באותו דף
      if (dl && daysBetween(today, dl) > -400) { rec.deadlineAt = dl; rec.deadlineFrom = 'detail'; filled++; }
      if (!rec.publishedAt) {
        const pub = dateAfterHint(text, PUBLISH_HINTS);
        if (pub) rec.publishedAt = pub;
      }
      if (!rec.tenderNumber) {
        const num = extractTenderNumber(text.slice(0, 3000));
        if (num) rec.tenderNumber = num;
      }
    } catch (_) { /* דף מכרז שלא נטען — נשאר בלי מועד */ }
    await sleep(POLITE_DELAY_MS);
  }
  console.error(`\n🔎 העשרת מועדים: נבדקו ${targets.length} דפי מכרז, נמצאו ${filled} מועדי הגשה`);
}

/**
 * סוג הפרסום: לא כל מה שמתפרסם באזור המכרזים הוא מכרז פומבי להגשה.
 * בסריקה אמיתית כל עשר הרשומות של רשות שדות התעופה היו תחת
 * /exemption-notifications/ — הודעות על פטור ממכרז, שבהן הרשות מודיעה על כוונה
 * להתקשר עם ספק בלי מכרז. הצגתן כ"מכרז" מטעה, ולכן הסוג מזוהה ומוצג בממשק.
 */
const KIND_RULES = [
  ['exemption', /(פטור\s*ממכרז|התקשרות\s*בפטור|exemption)/i],
  ['intent',    /(כוונה\s*להתקשר|הודעה\s*על\s*התקשרות|intent[-_]to)/i],
  ['rfi',       /(בקשה\s*לקבלת\s*מידע|\bRFI\b|request[-_]for[-_]information)/i],
  ['call',      /(קול\s*קורא)/],
  ['framework', /(הסכם\s*מסגרת|מכרז\s*מסגרת)/]
];
const KIND_LABELS = {
  tender: 'מכרז', exemption: 'פטור ממכרז', intent: 'כוונת התקשרות',
  rfi: 'בקשת מידע', call: 'קול קורא', framework: 'הסכם מסגרת'
};
function detectKind(title, url) {
  let path = String(url || '');
  try { path = decodeURIComponent(new URL(url).pathname); } catch (_) { /* כתובת לא תקנית */ }
  for (const [kind, re] of KIND_RULES) {
    if (re.test(title || '') || re.test(path)) return kind;
  }
  return 'tender';
}

/**
 * סטטוס הפרסום כפי שהמקור מדווח אותו. במנהל הרכש ההקשר כולל "סטטוס: חלף מועד הגשה"
 * למכרזים סגורים, ובסריקה אמיתית 52 מתוך 59 הממצאים היו כאלה — מכרזים אמיתיים
 * ורלוונטיים, אבל שאי אפשר להגיש אליהם יותר. הסטטוס נחלץ ומשמש לסינון.
 */
const STATUS_RE = /סטטוס:\s*([^|<]{2,40}?)\s*(?:\||$)/;
function extractStatus(context) {
  const m = String(context || '').match(STATUS_RE);
  return m ? m[1].trim() : '';
}
const CLOSED_STATUS_RE = /(חלף\s*מועד|נסגר|סגור|בוטל|הסתיים|לא\s*פעיל|התקשרות\s*בתוקף)/;
function isClosedStatus(status) {
  return CLOSED_STATUS_RE.test(String(status || ''));
}

/** סטטוס שמעיד שהפרסום פעיל כרגע (להבדיל מארכיון או מהתקשרות שכבר נחתמה) */
const ACTIVE_STATUS_RE = /(פורסם|עודכן|חדש)/;

/**
 * האם אפשר בכלל להגיש למכרז הזה.
 *
 * הסריקה מחזירה גם ארכיון: בעימוד הרשימה המלאה הגיעו מכרזים מ-2019 עד 2023,
 * וחוזים בתוקף שכבר נחתמו. מכרז בלי מועד הגשה עתידי אינו ניתן להגשה, ולכן
 * הוא נשמר רק אם המקור מדווח שהוא פורסם לאחרונה — מקרה שבו המועד פשוט לא
 * נחלץ, וההעשרה מדף המכרז עוד עשויה למלא אותו.
 */
const FRESH_WITHOUT_DEADLINE_DAYS = 90;
function isActionable(rec) {
  if (rec.deadlineAt) {
    const left = daysBetween(today, rec.deadlineAt);
    return left === null || left >= 0;
  }
  if (!ACTIVE_STATUS_RE.test(rec.status || '')) return false;
  const age = rec.publishedAt ? daysBetween(rec.publishedAt, today) : null;
  return age !== null && age <= FRESH_WITHOUT_DEADLINE_DAYS;
}

/**
 * המשרד או הגוף שמפרסם את המכרז, כפי שהוא מופיע בהקשר ("שם המפרסם: משרד התקשורת").
 * בלי זה כל מכרזי מנהל הרכש הוצגו כאילו המפרסם הוא מנהל הרכש עצמו, בעוד שהמשרד
 * המזמין הוא המידע המעשי — הוא זה שמולו עובדים.
 */
const PUBLISHER_RE = /שם\s*המפרסם:\s*([^|<]{2,60}?)\s*(?:\||מס['׳]|$)/;
function extractPublisher(context) {
  const m = String(context || '').match(PUBLISHER_RE);
  return m ? m[1].trim() : '';
}

function buildRecord(item, source, kw) {
  const haystack = `${item.title} ${item.summary || ''} ${item.context || ''}`;
  const titleAndSummary = `${item.title} ${item.summary || ''}`;

  // שער "האם זה בכלל מכרז".
  // בדף שאינו ייעודי למכרזים נדרש ניסוח מזהה בכותרת.
  // גם בדף ייעודי (allTenders) לא מספיק שהכותרת תכיל מילת מפתח: דפי מכרזים כוללים גם
  // תפריטי ניווט, ובאבחון על אתר רשות שדות התעופה קישורי ניווט כמו "אלקטרוניקה וסלולר"
  // ו"מערכת ניהול סביבתי" נכנסו לתוצאות. לכן נדרש ניסוח מזהה בכותרת או נתיב קישור של מכרז.
  const gatePassed = source.allTenders
    ? (looksLikeTender(titleAndSummary, kw) || looksLikeTenderUrl(item.url, source.linkPattern))
    : looksLikeTender(titleAndSummary, kw);
  if (!gatePassed) return null;

  // הסיווג נעשה על הכותרת והתקציר בלבד, כדי שהקשר הדף לא ייצור התאמות שווא
  const cls = classify(titleAndSummary, kw);
  if (cls.blocked || cls.topics.length === 0) return null;

  // סוג פרסום שאינו מכרז להגשה (הודעת פטור, כוונה להתקשר) אינו נכנס לראדאר כלל
  const kind = detectKind(item.title, item.url);
  if ((kw.excludedKinds || []).includes(kind)) return null;

  // מכרז שהמקור עצמו מדווח שמועד ההגשה שלו חלף אינו רלוונטי להגשה
  const status = extractStatus(item.context);
  if (isClosedStatus(status)) return null;

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
    publisher: item.publisher || extractPublisher(item.context) || source.name,
    tenderNumber,
    publishedAt: item.publishedAt || '',
    kind,
    status,
    deadlineAt,
    summary: (item.summary || '').trim(),
    topics: cls.topics,
    score: cls.score,
    matched: cls.matched,
    firstSeen: today,
    lastSeen: today
  };
}

function mergeWithHistory(current, prevById, activeSources, kw) {
  const out = new Map();

  for (const rec of current) {
    const prev = prevById.get(rec.id);
    out.set(rec.id, prev
      ? { ...prev, ...rec, firstSeen: prev.firstSeen || rec.firstSeen, lastSeen: today }
      : rec);
  }

  // רשומות שלא נראו בריצה הזו — נשמרות עד שהן מתיישנות או שמועד ההגשה חלף
  for (let [id, prev] of prevById) {
    if (out.has(id)) continue;
    // מקור שנוטרל או הוסר מהתצורה — הרשומות שלו יורדות מיד ולא ממתינות KEEP_DAYS,
    // אחרת נטרול מקור לא היה משפיע על התוצאות במשך שבועות
    if (activeSources && !activeSources.has(prev.source)) continue;
    const age = daysBetween(prev.lastSeen || prev.firstSeen || today, today);
    const deadlinePassed = prev.deadlineAt && daysBetween(today, prev.deadlineAt) < -14;
    if (deadlinePassed) continue;
    if (age !== null && age > KEEP_DAYS) continue;

    // רשומה שנשמרה בהיסטוריה נבדקת מחדש מול התצורה הנוכחית. בלי זה, חידוד של מילות
    // המפתח או של השערים לא היה מנקה רשומות שכבר נכנסו — הן היו נשארות עד 45 יום.
    if (kw) {
      const text = `${prev.title} ${prev.summary || ''}`;
      // גם שער המכרז נבדק מחדש, אחרת קישורי ניווט שנתפסו לפני שהשער הוקשח
      // (למשל "אלקטרוניקה וסלולר" ו"להורדת אפליקציה") היו נשארים במאגר.
      // הבדיקה חייבת להיות זהה לזו שב-buildRecord ולכבד את allTenders של המקור:
      // כשהיא הייתה מקלה יותר, רשומות שהסינון המעודכן דוחה שרדו דרך שער הקישור.
      const srcCfg = (activeSources instanceof Map ? activeSources.get(prev.source) : null) || {};
      const gatePassed = srcCfg.allTenders
        ? (looksLikeTender(text, kw) || looksLikeTenderUrl(prev.url || '', srcCfg.linkPattern))
        : looksLikeTender(text, kw);
      if (!gatePassed) continue;
      // סוג שהוחרג מהתצורה יורד גם אם כבר נמצא במאגר
      const prevKind = prev.kind || detectKind(prev.title, prev.url);
      if ((kw.excludedKinds || []).includes(prevKind)) continue;
      if (isClosedStatus(prev.status)) continue;
      const recheck = classify(text, kw);
      if (!recheck.topics.length) continue;
      prev = { ...prev, topics: recheck.topics, score: recheck.score, matched: recheck.matched };
    }
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
  main().then(() => {
    // בקשה שנקטעה בתקרת הזמן של מקור משאירה חיבור פתוח שיכול לעכב את סיום
    // התהליך. הנתונים כבר נכתבו לדיסק, ולכן סוגרים במפורש אחרי השהיה קצרה
    // שמספיקה לשטיפת הפלט.
    setTimeout(() => process.exit(0), 1500);
  }).catch(e => {
    console.error('✖ הריצה נכשלה:', e && e.stack || e);
    process.exit(1);
  });
}

module.exports = {
  classify, looksLikeTender, looksLikeTenderUrl, detectKind, KIND_LABELS, extractStatus, isClosedStatus, isActionable, extractPublisher, harvestAnchors, findTenderLinks, probeSources, sourceBudget, withDeadline, adapterDiscover, adapterHtml, enrichDeadlines, parseDateNear, dateAfterHint,
  extractTenderNumber, buildRecord, mergeWithHistory, summarize,
  normKey, hashId, stripTags, decodeEntities, daysBetween,
  DEADLINE_HINTS, PUBLISH_HINTS
};
