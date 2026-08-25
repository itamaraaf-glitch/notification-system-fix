#!/usr/bin/env node
'use strict';
/**
 * ראדאר מכרזים — סורק מקורות מכרזים ציבוריים בישראל ומסנן את הרלוונטיים
 * לתחומי תקשורת, ציוד תקשורת, אבטחת מידע, IT ובינה מלאכותית.
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
// --audit=<קטגוריה|מזהה> מריץ את הסריקה האמיתית על קבוצת מקורות ומדווח את המשפך
// המלא: כמה קישורים נקצרו, כמה עברו כל שער, ובאיזה שלב נפל השאר. בלי זה אפשר
// לאבחן מקור אחד בכל פעם, וזה לא מספיק כדי לדעת איפה 30 רשויות נופלות.
const AUDIT_FILTER = (ARGS.find(a => a.startsWith('--audit=')) || '').split('=')[1] || '';
// --authorities מחפש ב-data.gov.il את מפתח הרשויות המקומיות הרשמי ומדווח אילו
// מערכי נתונים ושדות קיימים. עד עכשיו הכתובות של הרשויות היו ניחוש לפי דפוס
// (muni.il / org.il), עם 3% הצלחה בסבב האחרון; מקור רשמי הוא הדרך להחליף ניחוש
// במידע. פוגע רק ב-data.gov.il ולא באתרי הרשויות עצמם.
const LIST_AUTHORITIES = ARGS.includes('--authorities');

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
    // חסום = מונחי השלילה גוברים על החיוביים. בלי הדרישה שיהיה קיזוז בפועל,
    // טקסט בלי שום התאמה (0 מול 0) נחשב "חסום" — מה שהסתיר מכרזים שאין להם
    // התאמה כלל, בדיוק אלה שסקירת ה-AI אמורה לשפוט.
    blocked: penalty > 0 && penalty >= total
  };
}

/**
 * כותרת שהיא תווית ניווט ולא מכרז.
 *
 * ביקורת המשפך הראתה ש-13 המועמדים לבדיקה שנשארו הם כולם קישורי תפריט:
 * "ועדת מכרזים", "מכרזי עירייה", "מכרזים והצעות מחיר", "לתשלום עבור מסמכי
 * המכרז - לחצו כאן". כולם מכילים "מכרז" ולכן עוברים את שער "האם זה מכרז",
 * וממלאים את רשימת הבדיקה במקום מכרזים אמיתיים.
 *
 * ההבחנה: כותרת של מכרז אמיתי אומרת **מה** נרכש. תווית ניווט אומרת רק
 * "מכרזים" ועוד מילה מנהלית.
 */
const NAV_TITLE_RE = new RegExp([
  '^\\s*ועד(ת|ות)\\s*(ה)?מכרזים',
  '^\\s*מכרזי\\s*(ה)?(עירייה|עיריה|מועצה|חברה|רשות)',
  '^\\s*מכרזים\\s*[ו,]',
  '^\\s*(ל)?מכרזי\\s*(ה)?(עירייה|עיריה|מועצה)\\s*ישנים',
  '^\\s*קול\\s*קורא\\s*לקבלת\\s*מידע\\s*(ו\\/?או|$)',
  'לתשלום\\s*עבור',
  'לחצו\\s*כאן',
  'טופס\\s*בקשה',
  'חופש\\s*המידע',
  'רישום\\s*למאגר',
  'מאגר\\s*נותני\\s*שירות',
  'ניתן\\s*לפנות',
  'אינ(ם|ן)\\s*מופיע',
  // סבב שני, אחרי מדידה חוזרת: מה שנשאר ברשימת הבדיקה היה שוב תפריטים
  '^\\s*הצעות\\s*ומכרזים',
  '^\\s*מכרזי\\s*(ה)?(עמותה|תאגיד|איגוד|החברה\\s*הכלכלית)',
  'נציגי?(/ו)?ת?\\s*ציבור',
  'ועדות?\\s*בחינה',
  '^\\s*מכרזי\\s*ספקים',
  '^\\s*מכרזים\\s*(פעילים|קודמים|ארכיון)\\s*$',
  '^\\s*מחלקת\\s',
  '^\\s*ל?ארכיון\\s*מכרזים',
  '^\\s*דיון\\s'
].join('|'));
function isNavTitle(title) {
  return NAV_TITLE_RE.test(String(title || ''));
}

function looksLikeTender(text, kw) {
  if (isNavTitle(text)) return false;
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
// המפריד כולל מקף: אתרי רשויות כותבים "תאריך עדכון אחרון: 14-07-2026". הבדיקה
// של ISO קודמת תמיד, אחרת "2026-08-24" היה נקרא כ-24/08/2026 הפוך.
const DATE_DMY = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/;

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
// "תאריך עדכון אחרון" אינו תאריך פרסום, אבל הוא העדות הטובה ביותר שיש בדפי
// הרשויות לכך שהפרסום עדיין חי. הביקורת על 30 רשויות מצאה מכרז אתר אינטרנט
// שנשר כ"בלי מועד ובלי סטטוס" בעוד שבכותרת שלו כתוב "עדכון אחרון: 14-07-2026".
const UPDATED_HINTS = /(תאריך\s*עדכון\s*אחרון|עדכון\s*אחרון|עודכן\s*ב)/;

/**
 * תאריך מתוך נתיב הכתובת.
 *
 * ברשויות רבות קישור המכרז מוביל ישירות ל-PDF תחת נתיב שמכיל שנה וחודש —
 * /wp-content/uploads/2026/02/... — כי הן רצות על וורדפרס. זה תאריך העלאת
 * הקובץ, וזו לרוב האינדיקציה היחידה לגיל הפרסום כשדף הרשימה לא נותן תאריך.
 * מוחזר אמצע החודש, כי היום אינו ידוע.
 */
const URL_YM_RE = /\/(20\d{2})\/(0[1-9]|1[0-2])\//;
function dateFromUrl(url) {
  const m = String(url || '').match(URL_YM_RE);
  return m ? `${m[1]}-${m[2]}-15` : '';
}

/**
 * מחפש תאריך שמופיע אחרי ביטוי רמז, בתוך חלון טקסט.
 *
 * בדף רשימה של רשות מקומית מופיעים עשרות מכרזים זה אחר זה, וחלון ההקשר של
 * קישור אחד בולע גם את שכניו. אבחון על אתר מ.א. לכיש הראה את התוצאה: ההקשר
 * הכיל גם "המועד המעודכן להגשה עד 13.6.2024" של מכרז ישן וגם "להגשה עד
 * 25/08/2026" של מכרז פתוח, והבדיקה על ההיקרות הראשונה בלבד החזירה את הישן.
 * לכן עוברים על כל ההיקרויות ומעדיפים מועד שטרם חלף; אם אין כזה, מוחזר
 * הראשון שנמצא, כדי שהסינון יוכל לזהות אותו כמכרז שנסגר.
 */
function dateAfterHint(context, hintRe) {
  const text = String(context || '');
  const re = new RegExp(hintRe.source, hintRe.flags.includes('g') ? hintRe.flags : hintRe.flags + 'g');
  let first = '';
  let m;
  while ((m = re.exec(text)) !== null) {
    re.lastIndex = m.index + m[0].length;
    const d = parseDateNear(text.slice(m.index, m.index + 140));
    if (!d) continue;
    if (!first) first = d;
    if (daysBetween(today, d) >= 0) return d;
  }
  return first;
}

/**
 * קישור לקובץ ולא לעמוד. ברשויות מקומיות רוב קישורי המכרזים מובילים ישירות
 * ל-PDF, ו"קריאת" PDF כטקסט מחזירה בייטים דחוסים — לא טקסט. אבחון על מ.א.
 * לכיש הראה בדיוק את זה: 209,567 תווים שמתוכם שני תאריכים, שניהם מטא-דאטה של
 * הקובץ. לכן קישור כזה אינו נשלח להעשרת מועדים: הבקשה לעולם לא תניב מועד,
 * והיא גוזלת מהתקציב עמוד HTML שכן היה מניב.
 */
const BINARY_URL_RE = /\.(pdf|docx?|xlsx?|pptx?|odt|zip|rar|7z)(\?|#|$)/i;

const TENDER_NUM = /(?:מכרז|הליך|פנייה|פניה)[^\d\n]{0,25}(\d{1,4}\s*[\/\-]\s*\d{2,4})/;

/**
 * שנת הפרסום מתוך מספר המכרז.
 *
 * מספר מכרז ישראלי כמעט תמיד מכיל את השנה — "07/2024", "2/2015", "01/2023".
 * זו העדות האחרונה לגיל כשאין מועד, אין תאריך פרסום ואין תאריך בנתיב הקובץ:
 * הסריקה הראשונה עם keepUndated הכניסה לראדאר מכרז של שנקר מ-2015 בדיוק כך.
 * מוחזר סוף השנה, כדי להיות נדיבים — מכרז שמספרו 2026 נשאר טרי כל השנה.
 */
function yearFromTenderNumber(num) {
  for (const part of String(num || '').split(/[\/\-]/)) {
    const y = +part.trim();
    if (y >= 2000 && y <= new Date().getFullYear() + 1) return `${y}-12-31`;
  }
  return '';
}
function extractTenderNumber(text) {
  const m = text.match(TENDER_NUM);
  return m ? m[1].replace(/\s+/g, '') : '';
}

/* ───────────────────────── שכבת רשת ───────────────────────── */

/** הכתובת הסופית של כל הבאה, אחרי הפניות — נדרשת לבניית קישורים יחסיים נכונה */
const LAST_FINAL_URL = new Map();
function finalUrlOf(url) { return LAST_FINAL_URL.get(url) || url; }

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
      const body = await res.text();
      // הכתובת הסופית אחרי הפניות חשובה: www.braude.ac.il מפנה ל-w3.braude.ac.il,
      // ובלי הכתובת הסופית קישורים יחסיים נבנים מול הדומיין הלא נכון והמסנן
      // "אותו אתר" פוסל את עמוד המכרזים האמיתי.
      LAST_FINAL_URL.set(url, res.url || url);
      return body;
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
    publishedAt: dateAfterHint(a.context, PUBLISH_HINTS)
      || dateAfterHint(a.context, UPDATED_HINTS)
      || dateFromUrl(a.url),
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
      const landed = finalUrlOf(url);
      // רמז שהופנה לדף הבית הוא 404 רך, לא עמוד מכרזים. בלי הבדיקה הזו ניחוש
      // כתובת שגוי "מצליח" — הוא מחזיר קישורים, כולם מתפריט הניווט — ומשתלט
      // על מקור שהגילוי האוטומטי היה מטפל בו נכון.
      if (isSiteRoot(landed)) continue;
      const anchors = harvestAnchors(html, landed);
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
  const candidates = findTenderLinks(homeHtml, finalUrlOf(start));
  if (!candidates.length) throw new Error('לא נמצא קישור לעמוד מכרזים בדף הבית');

  const wanted = source.maxPages || 2;
  const items = [];
  const warnings = [];
  const used = [];
  // מנסים לפי סדר העדיפות ועוברים לבא בתור כשעמוד לא נטען, במקום לוותר על המקור
  for (const link of candidates.slice(0, wanted + 3)) {
    if (used.length >= wanted) break;
    await sleep(POLITE_DELAY_MS);
    try {
      const html = await fetchText(link.url);
      used.push(link.url);
      for (const a of harvestAnchors(html, finalUrlOf(link.url))) items.push(itemFromAnchor(a));
    } catch (e) {
      warnings.push(`${shortUrl(link.url)} — ${(e && e.message) || e}`);
    }
  }
  if (!used.length) throw new Error('עמוד המכרזים שאותר לא נטען: ' + warnings.join(' | '));
  items.warnings = warnings;
  items.discovered = used;
  return items;
}

/**
 * האם שתי כתובות שייכות לאותו אתר. ההשוואה היא על הדומיין הרשום ולא על ה-host
 * המלא, כי עמוד המכרזים יושב פעמים רבות בתת־דומיין נפרד (tenders.huji.ac.il,
 * w3.braude.ac.il), וגם www מול לא-www הוא אותו אתר.
 */
function registrableDomain(host) {
  const parts = String(host || '').toLowerCase().split('.').filter(Boolean);
  // סיומות ישראליות דו־שלביות (co.il, ac.il, muni.il, org.il, gov.il) דורשות שלוש רמות
  const twoLevel = parts.length >= 3 && /^(co|ac|muni|org|gov|net|k12|idf|muni)$/.test(parts[parts.length - 2]);
  return parts.slice(twoLevel ? -3 : -2).join('.');
}
function sameSite(a, b) {
  return registrableDomain(new URL(a).host) === registrableDomain(new URL(b).host);
}
/**
 * כתובת עמוד המדור שמעל הכתובת הנתונה, כשהשם של המדור הוא מכרזי. למשל
 * /על-המרכז/דרושים-ומכרזים/דרושים-במכללה/ → /על-המרכז/דרושים-ומכרזים/
 */
function tenderSectionParent(u) {
  try {
    const url = new URL(u);
    const parts = decodeURIComponent(url.pathname).split('/').filter(Boolean);
    if (parts.length < 2) return '';
    const parent = parts[parts.length - 2];
    if (!/(מכרז|מיכרז|michraz|tender)/i.test(parent)) return '';
    return url.origin + '/' + parts.slice(0, -1).map(encodeURIComponent).join('/') + '/';
  } catch (_) { return ''; }
}

/** האם הכתובת היא שורש האתר — דף הבית לעולם אינו עמוד רשימת המכרזים */
function isSiteRoot(u) {
  try { return new URL(u).pathname.replace(/\/+$/, '') === ''; } catch (_) { return false; }
}
/** הקטע האחרון בנתיב, מפוענח — שם העמוד עצמו, בלי הנתיב שמעליו */
function lastPathSegment(u) {
  try {
    const parts = decodeURIComponent(new URL(u).pathname).split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  } catch (_) { return ''; }
}
/** אותה כתובת, בהתעלם מעוגן ומקו נטוי מסיים */
function sameUrl(a, b) {
  const norm = u => {
    try {
      const p = new URL(u);
      return p.origin + p.pathname.replace(/\/+$/, '') + p.search;
    } catch (_) { return String(u); }
  };
  return norm(a) === norm(b);
}

/**
 * עמוד "תוצאות מכרזים" / "ארכיון מכרזים" הוא עמוד מכרזים לכל דבר מבחינת הגילוי,
 * אבל אין בו מה להגיש — הוא מפרסם את מי שזכה. באתר עיריית אריאל הגילוי בחר בדיוק
 * אותו, ולכן הוא מקבל ניקוד שלילי חזק. עמוד "מכרזים פעילים" מקבל העדפה.
 */
const ARCHIVE_LINK_RE = /(תוצאות|ארכיון|שהסתיימו|שנסגרו|קודמים|היסטורי|זוכ(ה|ים)|פרוטוקול|archive|results|protocol)/i;
const ACTIVE_LINK_RE = /(פעילים|פתוחים|נוכחיים|חדשים|מכרזים\s*מתפרסמים)/;
// נתיב שהוא במפורש עמוד מכרזים הוא האינדיקציה החזקה ביותר, חזקה מטקסט הקישור:
// באתר עיריית נס ציונה הגילוי נחת על /protocols/ — עמוד פרוטוקולי ועדות מ-2021 —
// בעוד ש-/bids/ הוא עמוד המכרזים האמיתי.
const TENDER_PATH_RE = /\/(bids?|michrazim|mihrazim|tenders?|michraz|tender)(\/|$|\?)/i;
// "מכרזי כוח אדם" ודפי דרושים אינם מכרזי רכש. באתר הדסה האקדמית הגילוי נחת על
// "דרושים במכללה" — עמוד משרות. קישור שמדבר על משרות ולא על מכרז מקבל ניקוד שלילי,
// אבל עמוד משולב ("מכרזים ודרושים") נשאר, כי ברשויות רבות זה אותו עמוד.
const JOBS_LINK_RE = /(דרושים|משרות|קריירה|כוח\s*אדם|jobs?|careers?|vacanc)/i;
/** מדבר על משרות ולא על מכרז. עמוד משולב ("מכרזים ודרושים") אינו נחשב כזה. */
function jobsOnly(text) {
  const t = String(text || '');
  return JOBS_LINK_RE.test(t) && !/(מכרז|מיכרז|michraz|tender)/i.test(t);
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
    // נשארים באותו אתר, אבל תת־דומיין נחשב אותו אתר: עמוד המכרזים של הטכניון,
    // האוניברסיטה העברית ומכללת בראודה יושב על tenders./w3. ולא על www.
    try { if (!sameSite(a.url, baseUrl)) continue; } catch (_) { continue; }
    if (seen.has(a.url)) continue;
    seen.add(a.url);
    // קישור שחוזר לעמוד הנוכחי, או לשורש האתר, אינו עמוד המכרזים. באתר
    // אוניברסיטת תל אביב קישור התפריט "מכרזים" מצביע על "/" בעוד שדף הבית עצמו
    // מוגש מ-"/he", ולכן השוואה לעמוד הנוכחי לבדה לא תפסה את זה.
    if (sameUrl(a.url, baseUrl) || isSiteRoot(a.url)) continue;
    // "מכרזים" כטקסט הקישור הוא האינדיקציה החזקה ביותר לעמוד רשימה
    const haystack = a.title + ' ' + decodeURIComponent(a.url);
    const score = (/^\s*מכרזים\s*$/.test(a.title) ? 100 : 0) + (byText ? 10 : 0) + (byUrl ? 5 : 0)
      + (ACTIVE_LINK_RE.test(haystack) ? 40 : 0)
      + (TENDER_PATH_RE.test(a.url) ? 60 : 0)
      - (ARCHIVE_LINK_RE.test(haystack) ? 150 : 0)
      - (jobsOnly(a.title) || jobsOnly(lastPathSegment(a.url)) ? 150 : 0)
      - Math.min(20, a.title.length / 5);
    scored.push({ url: a.url, title: a.title, score });
  }
  // עמוד מכרזים יושב לעיתים בתוך מדור שהשם שלו הוא המכרזי ("דרושים-ומכרזים"),
  // בעוד שהעמוד עצמו הוא דרושים. במקרה כזה מוסיפים את עמוד המדור עצמו כמועמד —
  // שם בדרך כלל יושבת הרשימה המשולבת. נמדד באתר הדסה האקדמית ירושלים.
  for (const cand of scored.slice()) {
    const parent = tenderSectionParent(cand.url);
    if (parent && !seen.has(parent) && !sameUrl(parent, baseUrl) && !isSiteRoot(parent)) {
      seen.add(parent);
      scored.push({ url: parent, title: '(מדור מכרזים)', score: 30 });
    }
  }

  // הדירוג הוא סדר הניסיון, לא סינון: עמוד חי נבדק ראשון, ועמוד ארכיון או
  // דרושים נשאר בסוף התור. באתר הדסה האקדמית סינון מוחלט הפך את המקור לכושל
  // כשהמועמד המועדף החזיר 404 — עדיף לנסות את הבא בתור מאשר לאבד את המקור.
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

/**
 * הרחבת שאילתות החיפוש מתוך הטקסונומיה.
 *
 * במנהל הרכש הממשלתי החיפוש מילולי: מכרז שאינו מכיל את מילת החיפוש פשוט לא מגיע
 * לדף התוצאות. כשהוספנו את נושא הבינה המלאכותית זה הוכח בפועל — שלושת מכרזי המטה
 * הלאומי הגיעו רק אחרי שנוספה השאילתה "בינה מלאכותית". אבל תחזוקה ידנית של רשימת
 * השאילתות נגררת אחרי הטקסונומיה: מתוך 142 המונחים במשקל 5 ומעלה, רק 58 היו
 * מכוסים בחיפוש, ו"מתגים", "טמ״ס", "מבדקי חדירה" ו"עיבוד שפה טבעית" לא נשאלו כלל.
 *
 * לכן השאילתות נגזרות מהטקסונומיה עצמה: המונחים הכבדים ביותר בכל נושא, עם תקרה
 * לנושא ולסך הכול כדי לא להציף את המקור בבקשות. הוספת מונח כבד לטקסונומיה מרחיבה
 * מעכשיו גם את החיפוש, בלי לזכור לעדכן שני מקומות.
 */
function expandSearchUrls(source, kw) {
  const spec = source.searchFromKeywords;
  if (!spec || !spec.template) return source;
  const minWeight = spec.minWeight || 5;
  const perTopic = spec.maxPerTopic || 8;
  const max = spec.max || 34;

  const urls = [...(source.urls || [])];
  const existing = urls.map(u => { let d = u; try { d = decodeURIComponent(u); } catch (_) {} 
    const m = d.split('text='); return m.length > 1 ? m[1] : ''; }).filter(Boolean);

  // מונח שמכיל בתוכו שאילתה קיימת הוא צמצום שלה — "אספקת ציוד תקשורת" מחזיר תת־קבוצה
  // של "ציוד תקשורת" ולכן אינו מוסיף מכרזים. מונח כזה מדולג.
  const redundant = (term, against) => against.some(q => term.includes(q));
  const wordsOf = t => String(t).split(/\s+/).filter(Boolean);
  const words = t => wordsOf(t).length;
  // וריאנטים של אותו מונח ("ראיה"/"ראייה", "רשת"/"רשתות") מחזירים כמעט את אותן
  // תוצאות ומבזבזים שאילתה. שני מונחים נחשבים זהים אם יש להם אותו מספר מילים
  // וכל מילה חולקת את שלוש האותיות הראשונות.
  // גרשיים ומקפים אינם מבדילים בין וריאנטים: טמ"ס/טמ״ס, צ'אטבוט/צ׳אטבוט,
  // אנטי-וירוס/אנטי וירוס — שאילתה אחת לכל משפחה מספיקה.
  const norm = t => String(t).replace(/["'׳״]/g, '').replace(/[-\u2010-\u2015]/g, ' ');
  const sameStem = (a, b) => {
    const x = wordsOf(norm(a)), y = wordsOf(norm(b));
    return x.length === y.length && x.every((w, i) => w.slice(0, 3) === y[i].slice(0, 3));
  };

  const chosen = [];
  for (const topic of Object.values(kw.topics || {})) {
    const picked = [];
    // דירוג לחיפוש מילולי אינו דירוג לפי משקל: מונח קצר הוא שאילתה רחבה שמחזירה
    // יותר מכרזים, ולכן קודם מספר המילים ורק אחריו המשקל.
    const ranked = (topic.terms || []).filter(([, w]) => w >= minWeight)
      .sort((a, b) => words(a[0]) - words(b[0]) || b[1] - a[1] || a[0].localeCompare(b[0], 'he'));
    for (const [term] of ranked) {
      if (picked.length >= perTopic) break;
      if (redundant(term, existing) || redundant(term, chosen)) continue;
      if (existing.some(q => sameStem(term, q)) || chosen.some(c => sameStem(term, c))) continue;
      picked.push(term);
      chosen.push(term);
    }
  }

  const added = chosen.slice(0, max);
  for (const term of added) urls.push(spec.template.replace('{term}', encodeURIComponent(term)));
  if (added.length) console.error(`  \u21b3 ${source.id}: ${added.length} שאילתות חיפוש נוספו מהטקסונומיה`);
  return { ...source, urls };
}


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

  if (LIST_AUTHORITIES) {
    if (process.argv.includes('--domains')) { await authorityDomains(); return; }
    await listAuthorities(); return;
  }
  if (AUDIT_FILTER) { await auditSources(cfg, kw); return; }
  if (DEBUG_SOURCE) { await debugSource(cfg, kw); return; }
  if (PROBE) { await probeSources(cfg); return; }

  const previous = readJson(path.join(DATA_DIR, 'tenders.json'), { tenders: [] });
  const prevById = new Map((previous.tenders || []).map(t => [t.id, t]));

  const sources = (cfg.sources || []).filter(s => s.enabled !== false)
    .filter(s => !ONLY_SOURCE || s.id === ONLY_SOURCE)
    .map(s => expandSearchUrls(s, kw));

  const status = [];
  const found = new Map();
  const nearMisses = new Map();

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
        const rec = buildRecord(item, source, kw, { near: true });
        if (!rec) continue;
        // כמעט־התאמה אינה נכנסת לראדאר עצמו — היא נשמרת בצד לבדיקה
        if (rec.near) {
          const prev = nearMisses.get(rec.id);
          if (!prev || rec.score > prev.score) nearMisses.set(rec.id, rec);
          continue;
        }
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
  const dropped = {};
  const droppedSample = {};
  merged = merged.filter(rec => {
    const why = dropReason(rec);
    if (!why) return true;
    dropped[why] = (dropped[why] || 0) + 1;
    (droppedSample[why] = droppedSample[why] || []).push(rec.title.slice(0, 70));
    return false;
  });
  if (beforeFilter !== merged.length) {
    console.error(`\n🗂  הוסרו ${beforeFilter - merged.length} מכרזים שאי אפשר להגיש אליהם:`);
    for (const [why, n] of Object.entries(dropped).sort((a, b) => b[1] - a[1])) {
      console.error(`     ${n} — ${DROP_LABELS[why] || why}`);
      for (const t of droppedSample[why].slice(0, 3)) console.error(`          · ${t}`);
    }
  }
  // מועמדים לבדיקה: רק כאלה שאפשר להגיש אליהם. בלי הסינון הזה הרשימה מתמלאת
  // בארכיון של כל מכרזי הגינון והבנייה מכל המקורות, ואין בה שום ערך.
  const inRadar = new Set(merged.map(t => t.id));
  const nearAll = [...nearMisses.values()].filter(r => !inRadar.has(r.id));
  const nearActionable = nearAll.filter(isActionable);
  // הקרוב להיסגר קודם: הרשימה חתוכה בתקרה, וחבל לחתוך דווקא את מה שנסגר מחר.
  // מכרז בלי מועד יורד לסוף — אי אפשר לדעת כמה הוא דחוף.
  const byDeadline = (a, b) => {
    const da = a.deadlineAt || '9999-99-99', db2 = b.deadlineAt || '9999-99-99';
    return da.localeCompare(db2) || (b.score || 0) - (a.score || 0);
  };
  // מכסה מגזרית: בלעדיה מנהל הרכש הממשלתי — שמייצר אלפי קישורים ליום — תופס את
  // כל 40 המקומות, ומועמד מוניציפלי אחד לא מגיע לבדיקה. חצי מהמקומות שמורים
  // לרשויות מקומיות ולמוסדות אקדמיים, ומה שלא נוצל חוזר לשאר.
  const NEAR_LIMIT = +(process.env.TENDERS_NEAR_LIMIT || 40);
  const LOCAL_CATS = new Set(['רשויות מקומיות', 'מוסדות אקדמיים']);
  const sorted = nearActionable.sort(byDeadline);
  const local = sorted.filter(r => LOCAL_CATS.has(r.category || ''));
  const rest = sorted.filter(r => !LOCAL_CATS.has(r.category || ''));
  const localQuota = Math.min(local.length, Math.ceil(NEAR_LIMIT / 2));
  const nearList = [...local.slice(0, localQuota), ...rest.slice(0, NEAR_LIMIT - localQuota)]
    .sort(byDeadline);
  if (local.length) console.error(`   מתוכם ${local.length} מרשויות ומוסדות — ${localQuota} נכנסו למכסה השמורה`);
  console.error(`\n🔎 מועמדים לבדיקה: ${nearAll.length} בלי נושא, מתוכם ${nearActionable.length} פתוחים להגשה, נשמרו ${nearList.length}`);

  // הכרעות AI שנשמרו מריצות קודמות מוחלות מחדש: הסורק כותב את הקובץ מחדש בכל
  // ריצה, ובלעדיהן כל מכרז שסקירת ה-AI אישרה היה נעלם בסריקה הבאה.
  const aiStore = readJson(path.join(DATA_DIR, 'ai-decisions.json'), { decisions: {} });
  const aiDec = aiStore.decisions || {};
  let restored = 0;
  for (const [id, d] of Object.entries(aiDec)) {
    const cand = nearMisses.get(id);
    if (!cand || inRadar.has(id)) continue;
    if (!d.relevant || !kw.topics[d.topic] || !isActionable(cand)) continue;
    const { near, ...rec } = cand;
    merged.push({ ...rec, topics: [d.topic], aiMatched: true, aiReviewer: d.reviewer || 'api', aiReason: d.reason || '' });
    inRadar.add(id);
    restored++;
  }
  if (restored) console.error(`\n🤖 ${restored} מכרזים הוחזרו מהכרעות AI שמורות`);

  // מועמד שכבר הוכרע — לחיוב או לשלילה — אינו מוצג שוב ברשימת הבדיקה
  const nearFinal = nearList.filter(r => !aiDec[r.id] && !inRadar.has(r.id));

  const payload = {
    generatedAt: new Date().toISOString(),
    generatedDate: today,
    topics: Object.fromEntries(Object.entries(kw.topics).map(([id, t]) => [id, { label: t.label, icon: t.icon, color: t.color }])),
    kindLabels: KIND_LABELS,
    manualLinks: cfg.manualLinks || [],
    manualAuthorities: cfg.manualAuthorities || [],
    counts: { ...summarize(merged), dropped, droppedLabels: DROP_LABELS, near: nearFinal.length },
    nearMisses: nearFinal,
    sources: withHealth(status, previous.sources),
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

/**
 * ביקורת משפך על קבוצת מקורות.
 *
 * "נסרקו 664, רלוונטיים 10, בראדאר 0" לא אומר כלום: אי אפשר לדעת אם הטקסונומיה
 * מפספסת ניסוח מוניציפלי, אם השערים בולעים מכרזים אמיתיים, או אם הרשויות פשוט
 * לא מפרסמות בתחום. הביקורת מריצה את המסלול האמיתי — אותם אדפטרים, אותו
 * buildRecord — וסופרת כל שלב בנפרד, עם דוגמאות.
 */
/**
 * היסטוריית בריאות למקור.
 *
 * HTTP 403 של היום נראה זהה ל-403 קבוע, וזה הבדל שמשנה הכול: מקור שחוסם תמיד
 * צריך לעבור לרשימה הידנית, ומקור שעבד אתמול ונחסם היום הוא כמעט תמיד הגבלת
 * קצב זמנית. נמדד בפועל (24/08/2026): אחרי כתריסר סריקות ידניות בשעה וחצי,
 * 17 מתוך 31 הרשויות החזירו 403 — כולן החזירו אלפי קישורים ארבעים דקות קודם.
 * בלי ההיסטוריה הזו הייתי מסיק שהן חוסמות סריקה ומוציא אותן מהסריקה לתמיד.
 */
function withHealth(status, prevSources) {
  const prev = new Map((prevSources || []).map(s => [s.id, s]));
  return status.map(s => {
    const p = prev.get(s.id) || {};
    if (s.ok) return { ...s, lastOkAt: today, failingSince: undefined };
    return {
      ...s,
      lastOkAt: p.lastOkAt || '',
      failingSince: p.failingSince || (p.lastOkAt ? today : p.failingSince || today),
      // מקור שעבד לאחרונה ונכשל היום — סביר שזו הגבלה זמנית ולא חסימה קבועה
      likelyTransient: !!(p.lastOkAt && daysBetween(p.lastOkAt, today) <= 3) || undefined
    };
  });
}

/**
 * חיפוש מפתח הרשויות המקומיות הרשמי ב-data.gov.il.
 *
 * הכתובות של הרשויות ברשימה הידנית הן ניחוש לפי דפוס מקובל, ו-46 מהן לא נענו
 * כלל. סבב ניחושים נוסף החזיר 3% הצלחה. מקור רשמי הוא הדרך להחליף ניחוש
 * במידע — ולכן קודם כול בודקים מה בכלל קיים שם ובאילו שדות.
 */
/**
 * דומיינים רשמיים של רשויות, מתוך כתובות דוא"ל ב-data.gov.il.
 *
 * חיפוש ישיר של "מפתח הרשויות" ו"אתרי רשויות" ב-data.gov.il החזיר אפס — אין שם
 * מערך נתונים של כתובות אתרי הרשויות. אבל מערך "פרוייקטורים - מלווי עולים
 * ברשויות המקומיות" מכיל 166 כתובות דוא"ל רשמיות (nurab@eilat.muni.il), והדומיין
 * בכתובת כזו **הוא** הדומיין של הרשות. זו העדות הרשמית שחיפשתי, בדרך עקיפה:
 * במקום לנחש muni.il מול org.il, קוראים את התשובה.
 */
async function authorityDomains() {
  const api = 'https://data.gov.il/api/3/action';
  const RES = 'ad4534da-09db-41d7-94e2-b56ce1ec3dc3';
  const raw = await fetchText(`${api}/datastore_search?resource_id=${RES}&limit=500`);
  const records = ((JSON.parse(raw).result) || {}).records || [];

  const byCity = new Map();
  for (const rec of records) {
    const city = String(rec.city || '').trim();
    const mail = String(rec.additional_email || rec.email || '').trim();
    const m = mail.match(/@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/);
    if (!city || !m) continue;
    const domain = m[1].toLowerCase();
    // דומיין כללי אינו דומיין של רשות
    if (/gmail|walla|hotmail|outlook|yahoo|012|013|bezeq/.test(domain)) continue;
    if (!byCity.has(city)) byCity.set(city, new Set());
    byCity.get(city).add(domain);
  }

  console.log(`\n## דומיינים רשמיים מתוך ${records.length} רשומות — ${byCity.size} רשויות\n`);
  console.log('| רשות | דומיין רשמי |');
  console.log('| --- | --- |');
  for (const [city, set] of [...byCity].sort((a, b) => a[0].localeCompare(b[0], 'he'))) {
    console.log(`| ${city} | ${[...set].join(', ')} |`);
  }

  console.log('\n<!--DOMAINS-JSON');
  console.log(JSON.stringify([...byCity].map(([city, s]) => ({ city, domains: [...s] }))));
  console.log('DOMAINS-JSON-->');
}

async function listAuthorities() {
  const api = 'https://data.gov.il/api/3/action';
  const queries = ['רשויות מקומיות', 'מפתח הרשויות', 'אתרי רשויות'];
  const seen = new Set();

  for (const q of queries) {
    console.log(`\n## חיפוש: "${q}"\n`);
    let json;
    try {
      json = JSON.parse(await fetchText(`${api}/package_search?q=${encodeURIComponent(q)}&rows=8`));
    } catch (e) { console.log('  ✖ החיפוש נכשל:', (e && e.message) || e); continue; }

    for (const pkg of ((json.result || {}).results || [])) {
      if (seen.has(pkg.id)) continue;
      seen.add(pkg.id);
      const resources = (pkg.resources || []).filter(r => r.datastore_active);
      console.log(`- **${pkg.title}** (\`${pkg.name}\`) — ${resources.length} משאבים פעילים`);

      for (const res of resources.slice(0, 2)) {
        await sleep(POLITE_DELAY_MS);
        try {
          const raw = await fetchText(`${api}/datastore_search?resource_id=${encodeURIComponent(res.id)}&limit=3`);
          const r = (JSON.parse(raw).result) || {};
          const fields = (r.fields || []).map(f => f.id);
          console.log(`  - משאב \`${res.id}\` (${r.total || 0} רשומות)`);
          console.log(`    שדות: ${fields.join(' | ')}`);
          // שדה שנראה כמו כתובת אתר הוא כל מה שמעניין כאן
          const urlish = fields.filter(f => /url|site|אתר|כתובת|domain|web/i.test(f));
          if (urlish.length) console.log(`    ← **שדות כתובת: ${urlish.join(', ')}**`);
          for (const rec of (r.records || []).slice(0, 2)) {
            console.log(`    דוגמה: ${JSON.stringify(rec).slice(0, 300)}`);
          }
        } catch (e) { console.log(`  - משאב ${res.id} — שגיאה: ${(e && e.message) || e}`); }
      }
    }
  }
}

async function auditSources(cfg, kw) {
  const list = (cfg.sources || []).filter(s => s.enabled !== false)
    .filter(s => (s.category || '').includes(AUDIT_FILTER) || s.id === AUDIT_FILTER || s.id.startsWith(AUDIT_FILTER))
    .map(s => expandSearchUrls(s, kw));
  if (!list.length) { console.log(`אין מקורות שתואמים ל-"${AUDIT_FILTER}"`); return; }

  console.log(`\n🔬 ביקורת משפך על ${list.length} מקורות — "${AUDIT_FILTER}"\n`);

  const totals = { anchors: 0, radar: 0, near: 0 };
  const stages = new Map();
  const drops = new Map();
  const samples = new Map();
  const rows = [];
  const topicHits = new Map();

  const note = (map, key, example) => {
    map.set(key, (map.get(key) || 0) + 1);
    const arr = samples.get(key) || [];
    if (arr.length < 4 && example) { arr.push(example); samples.set(key, arr); }
  };

  const one = async (source) => {
    const row = { name: source.name, anchors: 0, radar: 0, near: 0, err: '' };
    try {
      const raw = await withDeadline(ADAPTERS[source.kind](source), sourceBudget(source), 'חריגה מזמן הסריקה');
      row.anchors = raw.length;
      for (const item of raw) {
        const trace = {};
        const rec = buildRecord(item, source, kw, { near: true, trace });
        if (!rec) { note(stages, trace.stage || 'לא ידוע', (trace.detail ? `[${trace.detail}] ` : '') + item.title.slice(0, 70)); continue; }
        if (rec.near) { row.near++; note(stages, 'מועמד לבדיקה (בלי נושא)', item.title.slice(0, 70)); continue; }
        const why = dropReason(rec);
        if (why) { note(drops, DROP_LABELS[why] || why, rec.title.slice(0, 70)); continue; }
        row.radar++;
        for (const tp of rec.topics) topicHits.set(tp, (topicHits.get(tp) || 0) + 1);
        note(stages, '✅ נכנס לראדאר', `${source.name}: ${rec.title.slice(0, 60)}`);
      }
    } catch (e) { row.err = (e && e.message) || String(e); }
    totals.anchors += row.anchors; totals.radar += row.radar; totals.near += row.near;
    rows.push(row);
  };

  for (let i = 0; i < list.length; i += SOURCE_PARALLEL) {
    await Promise.all(list.slice(i, i + SOURCE_PARALLEL).map(one));
  }

  rows.sort((a, b) => b.anchors - a.anchors);
  console.log('| מקור | קישורים | לראדאר | מועמדים | שגיאה |');
  console.log('| --- | ---: | ---: | ---: | --- |');
  for (const r of rows) console.log(`| ${r.name} | ${r.anchors} | ${r.radar} | ${r.near} | ${r.err.slice(0, 40)} |`);

  console.log(`\n**סה"כ: ${totals.anchors} קישורים → ${totals.radar} בראדאר, ${totals.near} מועמדים לבדיקה**\n`);

  const table = (title, map) => {
    if (!map.size) return;
    console.log(`\n### ${title}\n`);
    console.log('| שלב | כמות | דוגמאות |');
    console.log('| --- | ---: | --- |');
    for (const [k, v] of [...map].sort((a, b) => b[1] - a[1])) {
      const ex = (samples.get(k) || []).map(s => s.replace(/\|/g, '/')).join(' · ') || '—';
      console.log(`| ${k} | ${v} | ${ex.slice(0, 260)} |`);
    }
  };
  table('איפה נפלו הקישורים', stages);
  table('מה עבר את הסינון אבל נשר כלא-ניתן להגשה', drops);
  if (topicHits.size) console.log(`\nנושאים שנתפסו: ${[...topicHits].map(([k, v]) => `${k}=${v}`).join(', ')}`);
}

async function probeSources(cfg) {
  const timeout = +(process.env.TENDERS_PROBE_TIMEOUT_MS || 20000);
  const parallel = +(process.env.TENDERS_PROBE_PARALLEL || 5);
  const list = (cfg.sources || []).filter(s => s.enabled !== false)
    // הסינון תופס קטגוריה, מזהה מדויק, או תחילית מזהה — כדי שאפשר יהיה למדוד
    // קבוצת מקורות שנוספה יחד (למשל "alt-" לוריאציות כתובת) בלי לסרוק את הכול
    .filter(s => !PROBE_FILTER || (s.category || '').includes(PROBE_FILTER)
      || s.id === PROBE_FILTER || s.id.startsWith(PROBE_FILTER));

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
      // אותה בדיקה כמו במסלול האמיתי: רמז שהופנה לדף הבית הוא 404 רך
      const landed = h.finalUrl || hint;
      if (isSiteRoot(landed)) { (out.hintTried = out.hintTried || []).push(hint + ' → הופנה לדף הבית'); continue; }
      const n = harvestAnchors(h.body, landed).length;
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
  const raw = (cfg.sources || []).find(s => s.id === DEBUG_SOURCE);
  const source = raw ? expandSearchUrls(raw, kw) : raw;
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
  // סדר עדיפות: רשויות מקומיות ומוסדות אקדמיים קודם. מכרזי מנהל הרכש כבר מגיעים
  // עם מועד מדף הרשימה, ואילו דפי הרשויות כמעט לעולם לא — בלי העדפה, התקציב
  // המוגבל נבלע על ידי המקורות הממשלתיים ומכרזי הרשויות נושרים כ"בלי מועד".
  const NEEDS_ENRICH_FIRST = new Set(['רשויות מקומיות', 'מוסדות אקדמיים']);
  const pending = records.filter(r =>
    r.lastSeen === today && !r.deadlineAt && !r.deadlineChecked && r.url);
  const fetchable = pending.filter(r => !BINARY_URL_RE.test(r.url));
  const skipped = pending.length - fetchable.length;
  const targets = fetchable
    .sort((a, b) => (NEEDS_ENRICH_FIRST.has(b.category || '') ? 1 : 0) - (NEEDS_ENRICH_FIRST.has(a.category || '') ? 1 : 0))
    .slice(0, limit);
  if (!targets.length) {
    if (skipped) console.error(`\n🔎 העשרת מועדים: אין דף מכרז לבדיקה (${skipped} קישורים לקבצים דולגו)`);
    return;
  }

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
  console.error(`\n🔎 העשרת מועדים: נבדקו ${targets.length} דפי מכרז, נמצאו ${filled} מועדי הגשה` +
    (skipped ? ` (${skipped} קישורים לקבצים דולגו — PDF אינו נקרא כטקסט)` : ''));
}

/**
 * סוג הפרסום: לא כל מה שמתפרסם באזור המכרזים הוא מכרז פומבי להגשה.
 * בסריקה אמיתית כל עשר הרשומות של רשות שדות התעופה היו תחת
 * /exemption-notifications/ — הודעות על פטור ממכרז, שבהן הרשות מודיעה על כוונה
 * להתקשר עם ספק בלי מכרז. הצגתן כ"מכרז" מטעה, ולכן הסוג מזוהה ומוצג בממשק.
 */
const KIND_RULES = [
  // מסמך נלווה — לא מכרז שאפשר להגיש אליו אלא נספח לתהליך שכבר רץ: מענה לשאלות
  // הבהרה, פרוטוקול, הודעה על הארכת מועד. באתרי מוסדות אקדמיים ורשויות אלה רוב
  // הפריטים בעמוד המכרזים, וללא זיהוי הם נספרים כמכרזים. נבדק על אתר שנקר: שלושת
  // הפריטים שנכנסו לראדאר היו מענה לשאלות הבהרה למכרז מ-2022, הודעה על הארכת
  // מועדים, ומכרז מ-2015 — אף אחד מהם אינו מכרז פתוח.
  ['document',  /(מענה\s*לשאלות|תשובות\s*לשאלות|שאלות\s*הבהרה|מסמך\s*הבהרות|הבהרות\s*למכרז|פרוטוקול|הארכת\s*מועד|דחיית\s*מועד|תיקון\s*מסמכי|הודעה\s*לספקים|ריכוז\s*שאלות)/],
  // "התקשרות ללא מכרז" ו"החלטה על התקשרות" הם אותו דבר כמו פטור ממכרז: הרשות
  // מודיעה שהיא מתקשרת עם ספק בלי הליך תחרותי. באתרי הרשויות המקומיות אלה רוב
  // הפריטים בעמוד המכרזים — במועצה אזורית דרום השרון כל ארבעת הממצאים היו כאלה.
  ['exemption', /(פטור\s*ממכרז|התקשרות\s*בפטור|התקשרות\s*ללא\s*מכרז|התקשרויות\s*ללא\s*מכרז|exemption)/i],
  ['intent',    /(כוונה\s*להתקשר|הודעה\s*על\s*התקשרות|החלטה\s*על\s*התקשרות|intent[-_]to)/i],
  // "מכרז חיצוני" ו"מכרז פנימי" הם המונח העירוני למשרה פנויה, לא לרכש. במועצה
  // אזורית דרום השרון חמישה מתוך שישה מועמדים לבדיקה היו כאלה — ספרן, מזכירה,
  // פסיכולוג, רכז וחשמלאי. הם מכרזים לכל דבר בשמם, ולכן מילות השלילה לא תפסו
  // אותם: זהו סוג פרסום, בדיוק כמו הודעת פטור.
  ['job',       /(מכרז\s*(חיצוני|פנימי|פומבי\s*למשרת)|מכרז\s*כ(ו)?ח\s*אדם|מכרזי\s*משאבי\s*אנוש)/],
  ['rfi',       /(בקשה\s*לקבלת\s*מידע|\bRFI\b|request[-_]for[-_]information)/i],
  ['call',      /(קול\s*קורא)/],
  ['framework', /(הסכם\s*מסגרת|מכרז\s*מסגרת)/]
];
const KIND_LABELS = {
  tender: 'מכרז', exemption: 'פטור ממכרז', intent: 'כוונת התקשרות', job: 'מכרז כוח אדם',
  rfi: 'בקשת מידע', call: 'קול קורא', framework: 'הסכם מסגרת',
  document: 'מסמך נלווה'
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
  return dropReason(rec) === '';
}

/**
 * למה מכרז לא נכנס לראדאר — מחרוזת ריקה פירושה שהוא נכנס.
 *
 * המספר "60 רלוונטיים אבל 16 נשמרו" לא אומר כלום בלי הפירוט: אי אפשר לדעת אם
 * הסינון עובד או בולע מכרזים פתוחים. הסיבות נספרות ומדווחות בכל ריצה.
 */
/**
 * ברשויות מקומיות "בלי מועד" הוא הנורמה, לא עדות לארכיון.
 *
 * ביקורת המשפך על 30 רשויות (24/08/2026) מדדה 11,940 קישורים, מהם 14 בלבד
 * קיבלו נושא מהטקסונומיה — **וכל 14 נשרו על תאריכים**. ביניהם "מכרז משכ״ל
 * לאספקת שירותי תקשורת, תקשורת קווית ותשתית אלחוטית" ו"שירותי ניהול, תפעול
 * ואחזקת מחשוב ורשת" — בדיוק התחום. הסיבה מבנית: ברשות מועד ההגשה יושב בתוך
 * ה-PDF, לא בדף הרשימה, ולכן הכלל שנבנה למקורות ממשלתיים מוחק את כל המגזר.
 *
 * במקור עם `keepUndated` פרסום בלי מועד נשמר ומוצג בלי מועד, ובמקום זה נבחן
 * הגיל: תאריך פרסום שנגזר מהכותרת או מנתיב הקובץ מסנן את הארכיון (2024)
 * ומשאיר את מה שעלה השנה.
 */
const UNDATED_MAX_AGE_DAYS = 365;

const DROP_LABELS = {
  expired: 'מועד ההגשה חלף',
  stale: 'בלי מועד, ופורסם לפני יותר מ-' + FRESH_WITHOUT_DEADLINE_DAYS + ' יום',
  undated: 'סטטוס פעיל אבל בלי מועד ובלי תאריך פרסום',
  unknown: 'בלי מועד ובלי סטטוס פעיל במקור',
  archived: 'בלי מועד, והקובץ הועלה לפני יותר משנה'
};
function dropReason(rec) {
  if (rec.deadlineAt) {
    const left = daysBetween(today, rec.deadlineAt);
    return (left === null || left >= 0) ? '' : 'expired';
  }
  if (rec.keepUndated) {
    if (!rec.publishedAt) return '';
    const age = daysBetween(rec.publishedAt, today);
    return (age !== null && age > UNDATED_MAX_AGE_DAYS) ? 'archived' : '';
  }
  if (!ACTIVE_STATUS_RE.test(rec.status || '')) return 'unknown';
  // אין תאריך פרסום כלל — זה לא "ישן", זה "לא ידוע". הפרדה בין השניים נדרשת
  // כדי לדעת אם הסינון מוריד ארכיון או מכרזים פתוחים שפשוט לא פרסמו תאריך.
  if (!rec.publishedAt) return 'undated';
  const age = daysBetween(rec.publishedAt, today);
  return (age !== null && age <= FRESH_WITHOUT_DEADLINE_DAYS) ? '' : 'stale';
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

/**
 * סינון לפי הגוף המפרסם.
 *
 * מנהל הרכש הממשלתי הוא מקור אחד שמפרסם עבור כל משרדי הממשלה — הבריאות,
 * האוצר, החינוך, המשפטים וכן הלאה. אי אפשר לנטרל משרד בודד על ידי נטרול
 * המקור, כי כולם מגיעים מאותה כתובת; ההבחנה היחידה היא שדה הגוף המפרסם.
 * `onlyPublishers` שומר רק את המשרדים שברשימה, ו-`blockPublishers` מוריד
 * את מי שברשימה. ההשוואה היא הכלה במחרוזת, כדי ש"משרד התחבורה" יתפוס גם
 * "משרד התחבורה והבטיחות בדרכים".
 */
/**
 * דיווח סיבת הדחייה. buildRecord מחזיר null בשישה מקומות שונים, ובלי לדעת
 * באיזה מהם — אי אפשר לדעת אם הטקסונומיה מפספסת ניסוח, אם השערים בולעים
 * מכרזים אמיתיים, או אם פשוט אין מה למצוא. `opts.trace` הופך את זה למדיד
 * בלי לשכפל את הלוגיקה למקום שני שיסטה ממנה עם הזמן.
 */
function reject(opts, stage, detail) {
  if (opts && opts.trace) { opts.trace.stage = stage; opts.trace.detail = detail || ''; }
  return null;
}

function publisherAllowed(publisher, source) {
  const who = String(publisher || '');
  const only = source.onlyPublishers || [];
  const block = source.blockPublishers || [];
  if (block.length && block.some(b => who.includes(b))) return false;
  if (only.length) return only.some(o => who.includes(o));
  return true;
}

function buildRecord(item, source, kw, opts = {}) {
  const haystack = `${item.title} ${item.summary || ''} ${item.context || ''}`;
  const titleAndSummary = `${item.title} ${item.summary || ''}`;

  // שער "האם זה בכלל מכרז".
  // בדף שאינו ייעודי למכרזים נדרש ניסוח מזהה בכותרת.
  // גם בדף ייעודי (allTenders) לא מספיק שהכותרת תכיל מילת מפתח: דפי מכרזים כוללים גם
  // תפריטי ניווט, ובאבחון על אתר רשות שדות התעופה קישורי ניווט כמו "אלקטרוניקה וסלולר"
  // ו"מערכת ניהול סביבתי" נכנסו לתוצאות. לכן נדרש ניסוח מזהה בכותרת או נתיב קישור של מכרז.
  // תווית ניווט אינה מכרז יהיה הנתיב אשר יהיה. הבדיקה מוצאת מתוך looksLikeTender
  // כדי שגם מקור allTenders — שבו נתיב מכרזי לבדו מספיק — לא יעקוף אותה.
  if (isNavTitle(titleAndSummary)) return reject(opts, 'תווית ניווט, לא מכרז');
  const gatePassed = source.allTenders
    ? (looksLikeTender(titleAndSummary, kw) || looksLikeTenderUrl(item.url, source.linkPattern))
    : looksLikeTender(titleAndSummary, kw);
  if (!gatePassed) return reject(opts, 'לא נוסח כמכרז');

  // הסיווג נעשה על הכותרת והתקציר בלבד, כדי שהקשר הדף לא ייצור התאמות שווא
  const cls = classify(titleAndSummary, kw);
  // "מועמד לבדיקה": פרסום שעבר את שער "האם זה מכרז" אבל הטקסונומיה לא נתנה לו
  // נושא. כאן בדיוק יושבים המכרזים שניסוח שונה מבריח — "מערכות ניטור וידאו"
  // במקום "מצלמות אבטחה", "שדרוג תשתיות מיתוג" במקום "מתגים". מדידה הראתה
  // שלרובם הניקוד הוא אפס ולא "כמעט": מילות המפתח לא נוגעות בהם בכלל, ולכן סף
  // ניקוד היה מחמיץ בדיוק את מה שהוא נועד לתפוס.
  const near = !cls.blocked && cls.topics.length === 0 && cls.score >= (kw.nearMissMin || 0);
  if (cls.blocked) return reject(opts, 'נחסם במילות שלילה', cls.negative.join(','));
  if (cls.topics.length === 0 && !(opts.near && near)) return reject(opts, 'אין נושא מהטקסונומיה');

  // סוג פרסום שאינו מכרז להגשה (הודעת פטור, כוונה להתקשר) אינו נכנס לראדאר כלל
  const kind = detectKind(item.title, item.url);
  if ((kw.excludedKinds || []).includes(kind)) return reject(opts, 'סוג פרסום מוחרג', KIND_LABELS[kind] || kind);

  // מכרז שהמקור עצמו מדווח שמועד ההגשה שלו חלף אינו רלוונטי להגשה
  const status = extractStatus(item.context);
  if (isClosedStatus(status)) return reject(opts, 'המקור מדווח שנסגר', status);

  // סינון לפי הגוף המפרסם — נעשה לפני בניית הרשומה, כדי שמשרד שאינו נסרק
  // לא ייכנס גם לרשימת המועמדים לבדיקה
  const publisher = item.publisher || extractPublisher(item.context) || source.name;
  if (!publisherAllowed(publisher, source)) return reject(opts, 'גוף מפרסם שאינו נסרק', publisher);

  const tenderNumber = extractTenderNumber(titleAndSummary) || extractTenderNumber(item.context || '');
  const host = (() => { try { return new URL(item.url).host; } catch (_) { return source.id; } })();
  const id = hashId(source.id + '|' + (tenderNumber || normKey(item.title)) + '|' + host);

  // סדר העדפה לתאריך הפרסום: מה שהדף אמר, ואם אין — נתיב הקובץ, ואם גם אין —
  // השנה שבמספר המכרז. בלי החוליה האחרונה פרסום בלי שום תאריך נראה "טרי" לנצח.
  const publishedAt = item.publishedAt || yearFromTenderNumber(tenderNumber);

  let deadlineAt = item.deadlineAt || '';
  // תאריך הגשה שכבר חלף בשנה שעברה הוא כמעט תמיד שגיאת חילוץ — עדיף לא להציג
  if (deadlineAt && daysBetween(today, deadlineAt) < -400) deadlineAt = '';

  return {
    id,
    near: cls.topics.length === 0 ? true : undefined,
    title: item.title.trim(),
    url: item.url,
    source: source.id,
    sourceName: source.name,
    category: source.category || '',
    publisher,
    tenderNumber,
    publishedAt,
    keepUndated: source.keepUndated ? true : undefined,
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

/**
 * שדות שההעשרה מילאה מדף המכרז עצמו — הסריקה הבאה לא תמצא אותם שוב.
 *
 * דף רשימת המכרזים של רשות אינו מכיל את מועד ההגשה; הוא נמצא רק בדף המכרז,
 * ולשם נכנסים פעם אחת בלבד לכל מכרז. הפעולה `{ ...prev, ...rec }` דרסה את
 * הערך השמור במחרוזת הריקה שהסריקה החדשה מחזירה, ולכן כל ריצה מחקה את מה
 * שהריצה הקודמת גילתה: המדידה הראתה 35 מכרזים עם מועד יורדים ל-25 למחרת,
 * ותשע רשומות חוזרות לנשור כ"בלי מועד" — לצמיתות, כי deadlineChecked כן שרד
 * והן לא נבדקו שוב לעולם.
 *
 * ערך חדש מהסריקה עדיין גובר: דף הרשימה הוא המקור הסמכותי, ומועד שהוארך
 * צריך לעדכן את השמור.
 */
const ENRICHED_FIELDS = ['deadlineAt', 'publishedAt', 'tenderNumber'];
function keepEnriched(prev, rec) {
  const merged = { ...prev, ...rec };
  for (const f of ENRICHED_FIELDS) if (!merged[f] && prev[f]) merged[f] = prev[f];
  // מקור המועד חייב לתאר את המועד שנשמר בפועל, אחרת מועד טרי מדף הרשימה
  // היה מוצג כאילו נשלף מדף המכרז
  if (rec.deadlineAt) merged.deadlineFrom = rec.deadlineFrom || '';
  else if (prev.deadlineAt) merged.deadlineFrom = prev.deadlineFrom;
  return merged;
}

function mergeWithHistory(current, prevById, activeSources, kw) {
  const out = new Map();

  for (const rec of current) {
    const prev = prevById.get(rec.id);
    out.set(rec.id, prev
      ? { ...keepEnriched(prev, rec), firstSeen: prev.firstSeen || rec.firstSeen, lastSeen: today }
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
      // גוף מפרסם שהוסר מהתצורה יורד גם אם כבר נמצא במאגר
      if (!publisherAllowed(prev.publisher, srcCfg)) continue;
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
  classify, dropReason, DROP_LABELS, looksLikeTender, isNavTitle, looksLikeTenderUrl, detectKind, KIND_LABELS, extractStatus, isClosedStatus, isActionable, extractPublisher, harvestAnchors, findTenderLinks, TENDER_PATH_RE, expandSearchUrls, sameSite, sameUrl, isSiteRoot, lastPathSegment, tenderSectionParent, jobsOnly, registrableDomain, probeSources, auditSources, withHealth, sourceBudget, withDeadline, adapterDiscover, adapterHtml, enrichDeadlines, parseDateNear, dateAfterHint, dateFromUrl, yearFromTenderNumber, BINARY_URL_RE,
  extractTenderNumber, buildRecord, mergeWithHistory, keepEnriched, publisherAllowed, summarize,
  normKey, hashId, stripTags, decodeEntities, daysBetween,
  DEADLINE_HINTS, PUBLISH_HINTS
};
