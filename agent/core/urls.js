'use strict';
/**
 * עזרי כתובות — זהות אתר, שורש, ונרמול להשוואה.
 * גנרי לחלוטין; אין כאן ידע על תחום כלשהו.
 */

/**
 * הדומיין הרשום של host. ההשוואה בין כתובות היא עליו ולא על ה-host המלא, כי
 * עמוד המדור יושב פעמים רבות בתת־דומיין נפרד (tenders.huji.ac.il,
 * w3.braude.ac.il), וגם www מול לא-www הוא אותו אתר.
 */
function registrableDomain(host) {
  const parts = String(host || '').toLowerCase().split('.').filter(Boolean);
  // סיומות ישראליות דו־שלביות (co.il, ac.il, muni.il, org.il, gov.il) דורשות שלוש רמות
  const twoLevel = parts.length >= 3 && /^(co|ac|muni|org|gov|net|k12|idf)$/.test(parts[parts.length - 2]);
  return parts.slice(twoLevel ? -3 : -2).join('.');
}

function sameSite(a, b) {
  return registrableDomain(new URL(a).host) === registrableDomain(new URL(b).host);
}

/** האם הכתובת היא שורש האתר — דף הבית לעולם אינו עמוד רשימה */
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

/**
 * הכתובת בצורתה המנורמלת — בלי עוגן ובלי קו נטוי מסיים. זהו המפתח להשוואה בין
 * כתובות, ולכן הוא מיוצא: מי שמאחד רשומות לפי כתובת חייב לנרמל בדיוק כמו sameUrl,
 * אחרת שתי הבדיקות היו נחלקות על אותה כתובת.
 */
function normUrl(u) {
  try {
    const p = new URL(u);
    return p.origin + p.pathname.replace(/\/+$/, '') + p.search;
  } catch (_) { return String(u); }
}

/** אותה כתובת, בהתעלם מעוגן ומקו נטוי מסיים */
function sameUrl(a, b) {
  return normUrl(a) === normUrl(b);
}

/**
 * כתובת עמוד המדור שמעל הכתובת הנתונה, כששם המדור תואם לביטוי הנתון. למשל
 * /על-המרכז/דרושים-ומכרזים/דרושים-במכללה/ → /על-המרכז/דרושים-ומכרזים/
 */
function sectionParent(u, sectionRe) {
  try {
    const url = new URL(u);
    const parts = decodeURIComponent(url.pathname).split('/').filter(Boolean);
    if (parts.length < 2) return '';
    const parent = parts[parts.length - 2];
    if (!sectionRe.test(parent)) return '';
    return url.origin + '/' + parts.slice(0, -1).map(encodeURIComponent).join('/') + '/';
  } catch (_) { return ''; }
}

/** host + תחילת נתיב — לתצוגה בהודעות שגיאה, בלי להציף את הפלט */
function shortUrl(u) {
  try { const p = new URL(u); return p.host + p.pathname.slice(0, 40); }
  catch (_) { return String(u).slice(0, 50); }
}

module.exports = {
  registrableDomain, sameSite, isSiteRoot, lastPathSegment, sameUrl, normUrl, sectionParent, shortUrl
};
