'use strict';
/**
 * חילוץ תאריכים מטקסט חופשי ומכתובות.
 *
 * גנרי: הוא לא יודע מהו "מועד הגשה" — הוא מקבל ביטוי רמז ומחפש תאריך אחריו.
 * כל משימה מגדירה את ביטויי הרמז שלה בקובץ המשימה.
 */

const { ymd, daysBetween } = require('./text');

const DATE_ISO = /(\d{4})-(\d{1,2})-(\d{1,2})/;
// המפריד כולל מקף: אתרי רשויות כותבים "תאריך עדכון אחרון: 14-07-2026". הבדיקה
// של ISO קודמת תמיד, אחרת "2026-08-24" היה נקרא כ-24/08/2026 הפוך.
const DATE_DMY = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/;

function normalizeParts(y, m, d) {
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return '';
  if (y < 2000 || y > 2100) return '';
  const p = n => String(n).padStart(2, '0');
  return `${y}-${p(m)}-${p(d)}`;
}

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

/**
 * תאריך מתוך נתיב הכתובת.
 *
 * אתרים רבים רצים על וורדפרס, וקישור לקובץ מוביל לנתיב שמכיל שנה וחודש —
 * /wp-content/uploads/2026/02/... זהו תאריך העלאת הקובץ, וזו לרוב האינדיקציה
 * היחידה לגיל הפרסום כשדף הרשימה לא נותן תאריך. מוחזר אמצע החודש, כי היום
 * אינו ידוע.
 */
const URL_YM_RE = /\/(20\d{2})\/(0[1-9]|1[0-2])\//;
function dateFromUrl(url) {
  const m = String(url || '').match(URL_YM_RE);
  return m ? `${m[1]}-${m[2]}-15` : '';
}

/**
 * מחפש תאריך שמופיע אחרי ביטוי רמז, בתוך חלון טקסט.
 *
 * בדף רשימה מופיעים עשרות פרסומים זה אחר זה, וחלון ההקשר של קישור אחד בולע גם
 * את שכניו — ולכן ההיקרות הראשונה אינה בהכרח של הפריט שאנחנו מחלצים.
 *
 * שני כשלים אמיתיים, הפוכים זה לזה, מגדירים את הכלל:
 *
 * 1. מ.א. לכיש: ההקשר הכיל "המועד המעודכן להגשה עד 13.6.2024" של מכרז ישן וגם
 *    "להגשה עד 25/08/2026" של מכרז פתוח. בחירת ההיקרות הראשונה החזירה את הישן.
 * 2. דף רשימה עירוני: שורה שמועדה חלף אתמול, והשורה שאחריה — שנבלעה באותו חלון
 *    — עדיין פתוחה. העדפה עיוורת של "מועד שטרם חלף" גנבה לשורה הראשונה את
 *    המועד של שכנתה, והציגה מכרז סגור כפתוח עם תאריך של מכרז אחר.
 *
 * מה שמבדיל בין השניים אינו המיקום אלא **כמה רחוק בעבר** המועד הראשון: מכרז
 * שנסגר לאחרונה עדיין מציג את המועד שלו עצמו, בעוד מועד מלפני חודשים רבים
 * שיושב לצד מועד פתוח הוא כמעט תמיד דליפה משכן. לכן: ההיקרות הראשונה נבחרת
 * כברירת מחדל, ורק אם היא ישנה מהותית מחפשים אחריה מועד שטרם חלף. אם אין כזה,
 * מוחזרת הראשונה בכל זאת — כדי שהסינון יזהה פרסום סגור ולא "בלי מועד".
 */
const STALE_DEADLINE_DAYS = 90;   // מעבר לזה, מועד שחלף אינו נחשב עוד "נסגר לאחרונה"

function dateAfterHint(context, hintRe, today) {
  const now = today || ymd(new Date());
  const text = String(context || '');
  const re = new RegExp(hintRe.source, hintRe.flags.includes('g') ? hintRe.flags : hintRe.flags + 'g');
  const found = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    re.lastIndex = m.index + m[0].length;
    const d = parseDateNear(text.slice(m.index, m.index + 140));
    if (d) found.push(d);
  }
  if (!found.length) return '';
  const first = found[0];
  const daysPast = -daysBetween(now, first);        // חיובי = כבר חלף, בכמה ימים
  if (!(daysPast > STALE_DEADLINE_DAYS)) return first;   // עתידי, היום, או שחלף לא מזמן
  return found.find(d => daysBetween(now, d) >= 0) || first;
}

/**
 * קישור לקובץ ולא לעמוד. "קריאת" PDF כטקסט מחזירה בייטים דחוסים — לא טקסט.
 * אבחון על מ.א. לכיש הראה בדיוק את זה: 209,567 תווים שמתוכם שני תאריכים,
 * שניהם מטא-דאטה של הקובץ. קישור כזה אינו נשלח להעשרה: הבקשה לעולם לא תניב
 * תאריך, והיא גוזלת מהתקציב עמוד HTML שכן היה מניב.
 */
const BINARY_URL_RE = /\.(pdf|docx?|xlsx?|pptx?|odt|zip|rar|7z)(\?|#|$)/i;

/**
 * שנה מתוך מזהה שמכיל אותה — "07/2024", "2/2015", "01/2023".
 * זו העדות האחרונה לגיל כשאין תאריך אחר בשום מקום. מוחזר סוף השנה, כדי להיות
 * נדיבים: פרסום שמספרו 2026 נשאר טרי כל השנה.
 */
function yearFromSerial(num) {
  for (const part of String(num || '').split(/[/\-]/)) {
    const y = +part.trim();
    if (y >= 2000 && y <= new Date().getFullYear() + 1) return `${y}-12-31`;
  }
  return '';
}

module.exports = {
  parseDateNear, normalizeParts, dateFromUrl, dateAfterHint, yearFromSerial,
  BINARY_URL_RE, DATE_ISO, DATE_DMY
};
