'use strict';
/**
 * קציר קישורים מדף HTML.
 *
 * הקציר גנרי בכוונה — הוא לא מכיר את מבנה ה-DOM של אף אתר, אלא אוסף כותרות
 * קישורים ואת חלון הטקסט שסביבן. לכן הוא לא נשבר בכל שינוי עיצוב באתר המקור,
 * וזו הסיבה שאותו קוד עובד על עשרות אתרים שאיש לא כתב עבורם מתאם ייעודי.
 */

const { decodeEntities, stripTags, normKey } = require('./text');

const ANCHOR_RE = /<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))[^>]*>([\s\S]*?)<\/a>/gi;

/**
 * קוצר קישורים מדף רשימה. מחזיר גם חלון הקשר סביב כל קישור, שממנו נחלצים
 * תאריכים ומטא-דאטה.
 *
 * @param {string} html   גוף הדף
 * @param {string} baseUrl הכתובת הסופית של הדף (אחרי הפניות) — לבניית קישורים יחסיים
 * @param {{minLen?:number}} [opts]
 */
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

/* ───────────────────────── פידים ───────────────────────── */

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

/** פריטים מתוך פיד RSS/Atom, באותה צורה שמחזיר harvestAnchors */
function harvestFeed(xml) {
  const out = [];
  for (const block of (xml.match(RSS_ITEM_RE) || [])) {
    const title = pickTag(block, 'title');
    const url = pickLink(block);
    if (!title || !url) continue;
    const desc = pickTag(block, 'description') || pickTag(block, 'summary');
    const date = pickTag(block, 'pubDate') || pickTag(block, 'updated') || pickTag(block, 'published');
    // `summary` הוא מה שהמפרסם עצמו כתב על הפריט, ולכן הוא נכנס לסיווג;
    // `context` הוא חומר גלם לחילוץ תאריכים בלבד.
    out.push({ title, url, summary: desc, context: `${title} ${desc} ${date}`.trim(), feedDate: date });
  }
  return out;
}

module.exports = { harvestAnchors, harvestFeed, pickTag, pickLink, ANCHOR_RE };
