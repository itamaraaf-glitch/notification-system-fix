'use strict';
/**
 * מתאמי מקור — כל אחד מביא פריטים גולמיים מאתר, בצורה אחידה.
 *
 * פריט גולמי הוא `{ title, url, context }` ותו לא. כל ההחלטות — האם זה בכלל
 * מה שחיפשנו, לאיזה נושא הוא שייך, מה התאריכים שלו — נעשות אחר כך ב-pipeline.
 * ההפרדה הזו היא מה שמאפשר להוסיף סוג מקור חדש בלי לגעת בשום שער סינון.
 *
 * כלל שנקבע ממדידה: **כתובת שנכשלת אינה מפילה מקור שלם.** היא נרשמת כאזהרה
 * והסריקה ממשיכה לכתובת הבאה; המקור נחשב כנכשל רק אם כל הכתובות שלו נכשלו.
 * בלי הכלל הזה מקור עם חמש כתובות שאחת מהן זזה היה נעלם מהתוצאות כליל.
 */

const { sleep } = require('./net');
const { harvestAnchors, harvestFeed } = require('./harvest');
const { isSiteRoot, shortUrl } = require('./urls');
const { findSectionLinks } = require('./discover');

/** עוטף מערך פריטים במטא-דאטה של הריצה, בלי לשנות את צורתו */
function withMeta(items, { warnings = [], discovered = [] } = {}) {
  items.warnings = warnings;
  items.discovered = discovered;
  return items;
}

/** קציר מדף רשימה שכתובתו ידועה */
async function adapterHtml(source, ctx) {
  const { client, politeDelayMs } = ctx;
  const items = [];
  const warnings = [];
  let ok = 0;
  for (const url of (source.urls || [])) {
    try {
      const html = await client.fetchText(url);
      ok++;
      for (const a of harvestAnchors(html, client.finalUrlOf(url))) items.push(a);
    } catch (e) {
      warnings.push(`${shortUrl(url)} — ${(e && e.message) || e}`);
    }
    await sleep(politeDelayMs);
  }
  if (!ok) throw new Error(warnings.join(' | ') || 'לא הוגדרו כתובות למקור');
  return withMeta(items, { warnings });
}

/**
 * גילוי אוטומטי של עמוד הרשימה: נכנס לדף הבית, מאתר את הקישור למדור וקוצר משם.
 * כך אפשר לכסות עשרות אתרים בלי לתחזק כתובת מדויקת לכל אחד.
 *
 * `hintUrls` הוא רמז לכתובת ידועה: מנסים אותה קודם, ורק אם היא לא נענית חוזרים
 * לגילוי מדף הבית. כך אתר עם ניווט מבוסס JavaScript עדיין נסרק, ואם הכתובת
 * תשתנה — הגילוי האוטומטי עדיין מכסה.
 */
async function adapterDiscover(source, ctx) {
  const { client, politeDelayMs, vocab } = ctx;
  const start = source.home || (source.urls || [])[0];
  if (!start) throw new Error('למקור אין כתובת דף בית');

  for (const url of (source.hintUrls || source.tendersUrls || [])) {
    try {
      // רמז הוא ניחוש מושכל, לא מקור: בלי ניסיון חוזר, כדי שכתובת שגויה
      // לא תבזבז את תקציב הזמן של הסריקה כולה
      const html = await client.fetchText(url, { retries: 0 });
      const landed = client.finalUrlOf(url);
      // רמז שהופנה לדף הבית הוא 404 רך, לא עמוד רשימה. בלי הבדיקה הזו ניחוש
      // כתובת שגוי "מצליח" — הוא מחזיר קישורים, כולם מתפריט הניווט — ומשתלט
      // על מקור שהגילוי האוטומטי היה מטפל בו נכון.
      if (isSiteRoot(landed)) continue;
      const anchors = harvestAnchors(html, landed);
      if (anchors.length) return withMeta(anchors.slice(), { warnings: [], discovered: [url] });
    } catch (_) { /* רמז שלא נענה — ממשיכים לרמז הבא ואז לגילוי */ }
    await sleep(politeDelayMs);
  }

  const homeHtml = await client.fetchText(start);
  const candidates = findSectionLinks(homeHtml, client.finalUrlOf(start), vocab);
  if (!candidates.length) throw new Error('לא נמצא קישור לעמוד הרשימה בדף הבית');

  const wanted = source.maxPages || 2;
  const items = [];
  const warnings = [];
  const used = [];
  // מנסים לפי סדר העדיפות ועוברים לבא בתור כשעמוד לא נטען, במקום לוותר על המקור
  for (const link of candidates.slice(0, wanted + 3)) {
    if (used.length >= wanted) break;
    await sleep(politeDelayMs);
    try {
      const html = await client.fetchText(link.url);
      used.push(link.url);
      for (const a of harvestAnchors(html, client.finalUrlOf(link.url))) items.push(a);
    } catch (e) {
      warnings.push(`${shortUrl(link.url)} — ${(e && e.message) || e}`);
    }
  }
  if (!used.length) throw new Error('העמוד שאותר לא נטען: ' + warnings.join(' | '));
  return withMeta(items, { warnings, discovered: used });
}

/** פיד RSS/Atom */
async function adapterRss(source, ctx) {
  const { client, politeDelayMs } = ctx;
  const items = [];
  const warnings = [];
  let ok = 0;
  for (const url of (source.urls || [])) {
    try {
      const xml = await client.fetchText(url);
      ok++;
      for (const it of harvestFeed(xml)) items.push(it);
    } catch (e) {
      warnings.push(`${shortUrl(url)} — ${(e && e.message) || e}`);
    }
    await sleep(politeDelayMs);
  }
  if (!ok) throw new Error(warnings.join(' | ') || 'לא הוגדרו כתובות למקור');
  return withMeta(items, { warnings });
}

/**
 * API שמחזיר JSON. המקור מגדיר היכן יושבים הרשומות ואילו שדות הם הכותרת
 * והקישור, כך שאפשר לחבר API חדש בתצורה בלבד:
 *
 *   { "kind": "json", "urls": [...],
 *     "json": { "records": "result.records", "title": "Name", "url": "Link",
 *               "context": ["Description", "Publisher"] } }
 */
function dig(obj, dottedPath) {
  return String(dottedPath || '').split('.').filter(Boolean)
    .reduce((o, k) => (o == null ? o : o[k]), obj);
}
function firstField(rec, spec) {
  for (const key of [].concat(spec || [])) {
    const v = dig(rec, key);
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

async function adapterJson(source, ctx) {
  const { client, politeDelayMs } = ctx;
  const map = source.json || {};
  const items = [];
  const warnings = [];
  let ok = 0;
  for (const url of (source.urls || [])) {
    try {
      const raw = await client.fetchText(url);
      const data = JSON.parse(raw);
      ok++;
      const records = map.records ? (dig(data, map.records) || []) : (Array.isArray(data) ? data : []);
      for (const rec of records) {
        const title = firstField(rec, map.title);
        if (!title) continue;
        const href = firstField(rec, map.url);
        let abs = href;
        try { abs = new URL(href, url).toString(); } catch (_) { abs = href || url; }
        // מה שה-API עצמו מספר על הרשומה הוא תקציר אמיתי ונכנס לסיווג,
        // בשונה מחלון הקשר שנקצר מדף HTML ובולע את שכניו.
        const summary = [].concat(map.context || []).map(k => firstField(rec, k)).filter(Boolean).join(' · ');
        const context = [title, summary].filter(Boolean).join(' · ');
        items.push({ title, url: abs, summary, context, publisher: firstField(rec, map.publisher) });
      }
    } catch (e) {
      warnings.push(`${shortUrl(url)} — ${(e && e.message) || e}`);
    }
    await sleep(politeDelayMs);
  }
  if (!ok) throw new Error(warnings.join(' | ') || 'לא הוגדרו כתובות למקור');
  return withMeta(items, { warnings });
}

const ADAPTERS = {
  html: adapterHtml,
  discover: adapterDiscover,
  rss: adapterRss,
  json: adapterJson
};

/** מריץ את המתאם המתאים למקור */
function runAdapter(source, ctx) {
  const fn = ADAPTERS[source.kind || 'html'];
  if (!fn) throw new Error(`סוג מקור לא מוכר: ${source.kind}`);
  return fn(source, ctx);
}

module.exports = { runAdapter, ADAPTERS, adapterHtml, adapterDiscover, adapterRss, adapterJson, dig };
