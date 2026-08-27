'use strict';
/**
 * גילוי עמוד המדור באתר שלא מתחזקים עבורו כתובת מדויקת.
 *
 * הרעיון: במקום לתחזק כתובת לכל אתר — נכנסים לדף הבית, מאתרים בעצמנו את
 * הקישור לעמוד הרשימה (לפי טקסט הקישור או נתיבו) ומשם קוצרים. כך די בכתובת
 * האתר, ושינוי עיצוב או שינוי כתובת אינם מפילים את המקור.
 *
 * **הדירוג הוא סדר ניסיון ולא סינון.** כשעמוד מועדף אינו נטען עוברים לבא בתור,
 * והכישלון מדווח כאזהרה. סינון מוחלט הפך מקורות לכושלים כשהמועמד המועדף החזיר
 * 404 — עדיף לנסות את הבא בתור מאשר לאבד את המקור.
 *
 * אוצר המילים (vocab) מגיע מקובץ המשימה, ולכן אותו קוד מגלה עמוד מכרזים,
 * עמוד הודעות לעיתונות או כל מדור אחר — בלי לגעת בקוד.
 */

const { harvestAnchors } = require('./harvest');
const { sameSite, sameUrl, isSiteRoot, lastPathSegment, sectionParent } = require('./urls');

/** ניקוד המועמדים — נגזר ממדידה על אתרים אמיתיים, ראו agent/README.md */
const SCORE = {
  exactLabel: 100,   // טקסט הקישור הוא בדיוק שם המדור — האינדיקציה החזקה ביותר
  pathMatch: 60,     // הנתיב עצמו הוא נתיב המדור — חזק יותר מטקסט הקישור
  activeHint: 40,    // "פעילים" / "פתוחים" — עמוד חי ולא ארכיון
  sectionParent: 30, // עמוד המדור שמעל מועמד קיים
  textMatch: 10,
  urlMatch: 5,
  archive: -150,     // "תוצאות" / "ארכיון" — עמוד לגיטימי, אבל אין בו מה לעשות
  demoted: -150      // עמוד שהוא בבירור נושא אחר (למשל דרושים)
};

/**
 * הופך מפרט JSON לביטויים רגולריים. כל שדה הוא מחרוזת ביטוי, או `null` כדי
 * לנטרל את הכלל. שדה חסר מנוטרל — ביטוי שלא הוגדר לעולם אינו מתאים.
 */
function compileVocab(spec = {}) {
  const rx = (src, flags) => {
    if (!src) return null;
    return src instanceof RegExp ? src : new RegExp(src, flags);
  };
  return {
    text: rx(spec.text, 'i'),
    url: rx(spec.url, 'i'),
    path: rx(spec.path, 'i'),
    exact: rx(spec.exact, ''),
    active: rx(spec.active, ''),
    archive: rx(spec.archive, 'i'),
    demote: rx(spec.demote, 'i'),
    // עמוד משולב אינו מודח: באתרים רבים "מכרזים ודרושים" הוא אותו עמוד
    demoteUnless: rx(spec.demoteUnless, 'i'),
    sectionParent: rx(spec.sectionParent, 'i'),
    binary: rx(spec.binary || '\\.(pdf|docx?|xlsx?|zip)$', 'i')
  };
}

/** האם הקישור מדבר על הנושא המודח בלבד. עמוד משולב אינו נחשב כזה. */
function demotedOnly(text, vocab) {
  if (!vocab.demote) return false;
  const t = String(text || '');
  if (!vocab.demote.test(t)) return false;
  return !(vocab.demoteUnless && vocab.demoteUnless.test(t));
}

/** האם הכתובת מעידה על עמוד מהמדור — נבדק על הנתיב המפוענח, לא על המחרוזת הגולמית */
function urlMatches(url, vocab) {
  if (!vocab.url) return false;
  let target = String(url);
  try {
    const u = new URL(url);
    target = decodeURIComponent(u.pathname + u.search);
  } catch (_) { /* כתובת לא תקנית — נבדקת כמחרוזת */ }
  return vocab.url.test(target) || vocab.url.test(String(url));
}

/**
 * מאתר בדף קישורים שנראים כמובילים לעמוד המדור, ומחזיר אותם לפי סדר ניסיון.
 * @returns {{url:string, title:string, score:number}[]}
 */
function findSectionLinks(html, baseUrl, vocab) {
  const scored = [];
  const seen = new Set();

  for (const a of harvestAnchors(html, baseUrl, { minLen: 3 })) {
    const byText = !!(vocab.text && vocab.text.test(a.title));
    const byUrl = urlMatches(a.url, vocab);
    if (!byText && !byUrl) continue;

    // לא יורדים לעמוד של פריט בודד או לקובץ — מחפשים את עמוד הרשימה
    if (vocab.binary && vocab.binary.test(a.url)) continue;

    // נשארים באותו אתר, אבל תת־דומיין נחשב אותו אתר: עמוד המדור יושב פעמים
    // רבות על tenders. / w3. ולא על www.
    try { if (!sameSite(a.url, baseUrl)) continue; } catch (_) { continue; }
    if (seen.has(a.url)) continue;
    seen.add(a.url);

    // קישור שחוזר לעמוד הנוכחי, או לשורש האתר, אינו עמוד המדור. באתר
    // אוניברסיטת תל אביב קישור התפריט "מכרזים" מצביע על "/" בעוד שדף הבית עצמו
    // מוגש מ-"/he", ולכן השוואה לעמוד הנוכחי לבדה לא תפסה את זה.
    if (sameUrl(a.url, baseUrl) || isSiteRoot(a.url)) continue;

    const haystack = a.title + ' ' + decodeURIComponent(a.url);
    const score =
      (vocab.exact && vocab.exact.test(a.title) ? SCORE.exactLabel : 0) +
      (byText ? SCORE.textMatch : 0) +
      (byUrl ? SCORE.urlMatch : 0) +
      (vocab.active && vocab.active.test(haystack) ? SCORE.activeHint : 0) +
      (vocab.path && vocab.path.test(a.url) ? SCORE.pathMatch : 0) +
      (vocab.archive && vocab.archive.test(haystack) ? SCORE.archive : 0) +
      (demotedOnly(a.title, vocab) || demotedOnly(lastPathSegment(a.url), vocab) ? SCORE.demoted : 0) -
      Math.min(20, a.title.length / 5);

    scored.push({ url: a.url, title: a.title, score });
  }

  // עמוד הרשימה יושב לעיתים בתוך מדור ששמו הוא השם שאנחנו מחפשים ("דרושים-ומכרזים"),
  // בעוד שהעמוד עצמו הוא נושא אחר. במקרה כזה מוסיפים את עמוד המדור עצמו כמועמד —
  // שם בדרך כלל יושבת הרשימה המשולבת. נמדד באתר הדסה האקדמית ירושלים.
  if (vocab.sectionParent) {
    for (const cand of scored.slice()) {
      const parent = sectionParent(cand.url, vocab.sectionParent);
      if (parent && !seen.has(parent) && !sameUrl(parent, baseUrl) && !isSiteRoot(parent)) {
        seen.add(parent);
        scored.push({ url: parent, title: '(עמוד המדור)', score: SCORE.sectionParent });
      }
    }
  }

  return scored.sort((x, y) => y.score - x.score);
}

module.exports = { findSectionLinks, compileVocab, demotedOnly, urlMatches, SCORE };
