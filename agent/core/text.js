'use strict';
/**
 * עזרי טקסט ותאריך — השכבה הנמוכה ביותר של סוכן הרשת.
 *
 * כל מה שכאן טהור: אין רשת, אין קבצים ואין מצב שנשמר בין קריאות. זו הסיבה
 * שהמודול הזה משותף לכל המשימות (watches) בלי תלות במה שהן סורקות.
 *
 * הקוד הועבר לכאן מראדאר המכרזים בלי שינוי התנהגות — הראדאר ממשיך לצרוך
 * אותו דרך אותם שמות בדיוק, ובדיקות הראדאר הן ההוכחה שההעברה נאמנה.
 */

/** תאריך כ-YYYY-MM-DD בשעון המקומי */
function ymd(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/** הפרש ימים בין שני תאריכי YYYY-MM-DD. מחזיר null אם אחד מהם אינו תאריך. */
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

function safeCodePoint(n) {
  try { return String.fromCodePoint(n); } catch (_) { return ''; }
}

function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => {
      const v = ENTITIES[name.toLowerCase()];
      return v === undefined ? m : v;
    });
}

function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** מפתח נרמול להשוואת כפילויות — מסיר ניקוד, סימני פיסוק וגרשיים */
function normKey(s) {
  return String(s)
    .replace(/[֑-ׇ]/g, '')
    .replace(/["'׳״`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();
}

/**
 * מזהה יציב לרשומה. FNV-1a 64 ביט (מיוצג כ-hex) — יציב בין ריצות ובין גרסאות
 * Node, בלי תלות ב-crypto. היציבות היא הדרישה: המזהה הוא מה שמבדיל "נראה כבר"
 * מ"חדש", ומזהה שמשתנה בין ריצות היה מסמן את כל המאגר כחדש בכל בוקר.
 */
function hashId(s) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'));
}

module.exports = {
  ymd, daysBetween, sleep,
  decodeEntities, safeCodePoint, stripTags, normKey, hashId
};
