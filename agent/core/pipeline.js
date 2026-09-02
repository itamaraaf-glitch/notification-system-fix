'use strict';
/**
 * המשפך: מפריט גולמי לרשומה — או לנשירה עם סיבה.
 *
 * **כל נשירה מסווגת לסיבה.** זה לא קישוט: הסורק מוצא הרבה יותר ממה שהוא שומר,
 * ובלי פירוט אי אפשר לדעת אם הסינון עובד או בולע פרסומים אמיתיים. ביקורת
 * המשפך של ראדאר המכרזים על 30 רשויות מצאה בדיוק כך ששכבה שלמה נופלת על
 * תאריכים ולא על תוכן — מסקנה שאי אפשר היה להגיע אליה מספירת התוצאות בלבד.
 */

const { hashId, normKey, daysBetween } = require('./text');
const { termRegex, classify } = require('./match');
const { parseDateNear, dateAfterHint, dateFromUrl, yearFromSerial } = require('./dates');

/** תוויות הנשירה, לדיווח בעברית */
const DROP_LABELS = {
  nav: 'תווית ניווט ולא פרסום',
  gate: 'לא נוסח כמו מה שחיפשנו',
  blocked: 'נחסם במילות שלילה',
  noTopic: 'בלי נושא מהטקסונומיה',
  expired: 'המועד חלף',
  archived: 'ישן מדי',
  undated: 'בלי תאריך כלשהו'
};

/**
 * הופך את מקטע `gate` שבקובץ המשימה לשער שאפשר להריץ.
 * `phrases` נבדקות בהתאמה מודעת־עברית (תחיליות וסיומות נטייה), לא כמחרוזת.
 */
function compileGate(spec = {}) {
  const rx = src => (src ? (src instanceof RegExp ? src : new RegExp(src, 'i')) : null);
  return {
    phrases: [].concat(spec.phrases || []),
    navBlock: rx(spec.navBlock),
    urlPattern: rx(spec.urlPattern),
    // מקור שכל תוכנו הוא מה שחיפשנו אינו צריך ניסוח מזהה בכותרת —
    // אבל תווית ניווט נדחית גם שם, אחרת התפריט של האתר נכנס לתוצאות.
    minTitleLen: spec.minTitleLen || 0
  };
}

/** האם הכותרת היא תווית ניווט ולא פרסום אמיתי */
function isNavTitle(title, gate) {
  return !!(gate.navBlock && gate.navBlock.test(String(title || '')));
}

/**
 * האם הפריט נוסח כמו מה שהמשימה מחפשת.
 * `allItems: true` על המקור מדלג על הדרישה — לדף שכולו פרסומים מהסוג הנכון.
 */
function passesGate(item, source, gate) {
  const text = `${item.title} ${item.summary || ''}`;
  if (isNavTitle(item.title, gate)) return false;
  if (String(item.title || '').length < gate.minTitleLen) return false;
  if (source.allItems) {
    if (!gate.phrases.length) return true;
    return gate.phrases.some(p => termRegex(p).test(text))
      || !!(gate.urlPattern && gate.urlPattern.test(item.url || ''));
  }
  if (!gate.phrases.length) return true;
  return gate.phrases.some(p => termRegex(p).test(text));
}

/** ביטויי הרמז לתאריכים, מקובץ המשימה */
function compileDateHints(spec = {}) {
  const rx = src => (src ? (src instanceof RegExp ? src : new RegExp(src)) : null);
  return {
    deadline: rx(spec.deadlineHints),
    publish: rx(spec.publishHints),
    updated: rx(spec.updatedHints),
    serial: rx(spec.serialPattern)
  };
}

/**
 * שולף תאריכים מהפריט.
 *
 * **הכותרת נבדקת לפני חלון ההקשר, לא כגיבוי לו.** באתרים רבים המועד כתוב בתוך
 * טקסט הקישור עצמו ("… | תאריך אחרון להגשה: 24/06/2025"), והכותרת שייכת לפריט
 * הזה בלבד — בעוד שחלון ההקשר בולע גם את שכניו בדף רשימה צפוף. נצפה בפועל
 * באשכול רשויות נגב מערבי: הכותרת נשאה את המועד הנכון, ההקשר לא, והפריט נכנס
 * כאילו אין לו מועד כלל — מכרז שפג לפני יותר משנה. `item.context || item.title`
 * לא תפס את זה, כי ההקשר לא היה ריק.
 */
function extractDates(item, hints, today) {
  const title = item.title || '';
  const ctx = item.context || title;
  const pick = (re) => (re ? (dateAfterHint(title, re, today) || dateAfterHint(ctx, re, today)) : '');
  const deadlineAt = pick(hints.deadline);
  const publishedAt =
    pick(hints.publish) ||
    pick(hints.updated) ||
    (item.feedDate ? parseDateNear(item.feedDate) : '') ||
    dateFromUrl(item.url);
  return { deadlineAt, publishedAt };
}

/** המזהה היציב של רשומה — מה שמבדיל "נראה כבר" מ"חדש" */
function recordId(item, source) {
  return hashId(`${source.id}|${normKey(item.title)}|${item.url}`);
}

/**
 * הגיל של הפרסום, לפי שרשרת עדויות: מה שהדף אמר → נתיב הקובץ → השנה שבמזהה.
 * בלי החוליה האחרונה פרסום בלי שום תאריך נראה טרי לנצח.
 */
function ageDate(rec, hints) {
  if (rec.publishedAt) return rec.publishedAt;
  if (hints.serial) {
    const m = String(rec.title || '').match(hints.serial);
    if (m) return yearFromSerial(m[1] || m[0]);
  }
  return '';
}

/**
 * בונה רשומה מפריט גולמי, או מחזיר את סיבת הנשירה.
 * @returns {{record?:Object, drop?:string}}
 */
function buildRecord(item, source, watch, ctx) {
  const { gate, hints, taxonomy, today } = ctx;

  if (isNavTitle(item.title, gate)) return { drop: 'nav' };
  if (!passesGate(item, source, gate)) return { drop: 'gate' };

  // **הסיווג נעשה על הכותרת והתקציר בלבד ולא על חלון ההקשר.** חלון ההקשר של
  // פריט אחד בולע את שכניו בדף רשימה צפוף, ולכן סיווג עליו נותן לכל פריט את
  // המונחים של הפריט שאחריו: מכרז גינון היה מקבל נושא "תקשורת" מהמכרז שמעליו,
  // ומכרז שנחסם במילות שלילה היה ניצל מהן בזכות ניקוד של שכניו. ההקשר משמש
  // לחילוץ תאריכים ומטא-דאטה בלבד — שם הבליעה אינה מזיקה, כי מועדף מועד שטרם חלף.
  const titleAndSummary = `${item.title} ${item.summary || ''}`.trim();
  const cls = classify(titleAndSummary, taxonomy);
  const { deadlineAt, publishedAt } = extractDates(item, hints, today);

  const record = {
    id: recordId(item, source),
    title: item.title,
    url: item.url,
    source: source.id,
    sourceName: source.name || source.id,
    category: source.category || '',
    publisher: item.publisher || '',
    topics: cls.topics,
    score: cls.score,
    matched: cls.matched,
    publishedAt,
    deadlineAt,
    // `abstract` הוא מה שהמפרסם כתב (פיד, API) — הטקסט היחיד שבטוח שייך לפריט
    // הזה, ולכן הוא זה שנשמר לסיווג חוזר בריצות הבאות. `summary` הוא תצוגה בלבד
    // ונגזר מחלון ההקשר, שעלול לכלול פירורים משכנים.
    abstract: item.summary || '',
    summary: (item.summary || item.context || '').slice(0, 300),
    firstSeen: today,
    lastSeen: today
  };

  // נשירה על מילות שלילה נבדקת לפני היעדר נושא, כדי שהדיווח יראה מה באמת קרה:
  // "נחסם" ו"לא סווג" הן שתי מסקנות שונות לגמרי לגבי איכות הטקסונומיה.
  if (cls.blocked) return { drop: 'blocked', record };
  if (!cls.topics.length) return { drop: 'noTopic', record };

  const drop = timeDropReason(record, watch, hints, today);
  if (drop) return { drop, record };
  return { record };
}

/**
 * נשירה על תאריכים.
 *
 * `keepUndated` הוא ההבדל בין מגזר שנסרק למגזר שנמחק: הכלל "בלי מועד — לא
 * נכנס" נכון למקור שתמיד מפרסם מועד, ומוחק מגזר שלם כשמפעילים אותו על אתרים
 * שבהם המועד יושב בתוך קובץ ה-PDF.
 */
function timeDropReason(rec, watch, hints, today) {
  const ret = watch.retention || {};
  if (rec.deadlineAt) {
    const left = daysBetween(today, rec.deadlineAt);
    if (left !== null && left < 0) return 'expired';
    return '';
  }
  if (!ret.keepUndated) return 'undated';
  const age = ageDate(rec, hints);
  if (!age) return ret.requireDate ? 'undated' : '';
  const maxAge = ret.maxAgeDays || 365;
  const old = daysBetween(age, today);
  if (old !== null && old > maxAge) return 'archived';
  return '';
}

/** מיון התצוגה: מועד קרוב קודם, ואחריו לפי ניקוד רלוונטיות */
function sortRecords(records, today) {
  return records.slice().sort((a, b) => {
    const da = a.deadlineAt ? daysBetween(today, a.deadlineAt) : null;
    const db = b.deadlineAt ? daysBetween(today, b.deadlineAt) : null;
    const oa = da !== null && da >= 0, ob = db !== null && db >= 0;
    if (oa && ob) return da - db;
    if (oa !== ob) return oa ? -1 : 1;
    return b.score - a.score;
  });
}

/** סיכום מספרי לתצוגה ולדיווח */
function summarize(records, today) {
  const byTopic = {};
  let isNew = 0, open = 0, closingSoon = 0;
  for (const r of records) {
    for (const t of r.topics) byTopic[t] = (byTopic[t] || 0) + 1;
    if (r.firstSeen === today) isNew++;
    if (r.deadlineAt) {
      const d = daysBetween(today, r.deadlineAt);
      if (d !== null && d >= 0) { open++; if (d <= 7) closingSoon++; }
    }
  }
  return { total: records.length, new: isNew, open, closingSoon, byTopic };
}

module.exports = {
  compileGate, compileDateHints, passesGate, isNavTitle, buildRecord,
  extractDates, recordId, timeDropReason, ageDate, sortRecords, summarize,
  DROP_LABELS
};
