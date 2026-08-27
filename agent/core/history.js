'use strict';
/**
 * מיזוג עם ההיסטוריה: מה נשמר בין ריצות, ומה יורד.
 *
 * שני לקחים שנקנו בתקלות אמיתיות בראדאר המכרזים, ושניהם מקודדים כאן:
 *
 * 1. **`firstSeen` המקורי נשמר.** בלעדיו הסימון "חדש" היה מסמן כל רשומה בכל
 *    בוקר, וההתראה הופכת לרעש.
 *
 * 2. **ערך שהסריקה מחזירה ריק אינו דורס ערך שמור.** דף רשימה שאינו מכיל מועד
 *    מחזיר `deadlineAt: ''`, ומיזוג נאיבי (`{...prev, ...rec}`) מחק בדיוק את
 *    המועד שנשלף בעמל מדף הפריט עצמו. מה שהפך את זה לקבוע: הדגל
 *    "כבר בדקנו" כן שרד, ולכן אותן רשומות לא נשלחו שוב להעשרה **לעולם**.
 *    ערך חדש שאינו ריק עדיין גובר, כדי שהארכת מועד תעדכן.
 */

const { daysBetween } = require('./text');

/** שדות שנשלפו בעמל ואינם חוזרים מדף הרשימה — לא נמחקים במיזוג */
const DEFAULT_ENRICHED = ['deadlineAt', 'publishedAt', 'publisher', 'serial'];

function keepEnriched(prev, rec, enrichedFields = DEFAULT_ENRICHED) {
  const merged = { ...prev, ...rec };
  for (const f of enrichedFields) if (!merged[f] && prev[f]) merged[f] = prev[f];
  // מקור המועד חייב לתאר את המועד שנשמר בפועל, אחרת מועד טרי מדף הרשימה
  // היה מוצג כאילו נשלף מדף הפריט
  if (rec.deadlineAt) merged.deadlineFrom = rec.deadlineFrom || '';
  else if (prev.deadlineAt) merged.deadlineFrom = prev.deadlineFrom;
  return merged;
}

/**
 * ממזג את תוצאות הריצה עם המאגר השמור.
 *
 * @param {Object[]} current      רשומות מהריצה הזו
 * @param {Map} prevById          המאגר השמור, לפי מזהה
 * @param {Map} activeSources     מזהי המקורות הפעילים כרגע → תצורת המקור
 * @param {Object} watch          קובץ המשימה (retention, gate, taxonomy)
 * @param {Function} [recheck]    בדיקה חוזרת של רשומה שמורה מול התצורה הנוכחית.
 *                                מחזירה רשומה מעודכנת, או null כדי להוריד אותה.
 */
function mergeWithHistory(current, prevById, activeSources, watch, today, recheck) {
  const out = new Map();
  const keepDays = (watch.retention && watch.retention.keepDays) || 45;
  const graceDays = (watch.retention && watch.retention.deadlineGraceDays) != null
    ? watch.retention.deadlineGraceDays : 14;

  for (const rec of current) {
    const prev = prevById.get(rec.id);
    out.set(rec.id, prev
      ? { ...keepEnriched(prev, rec), firstSeen: prev.firstSeen || rec.firstSeen, lastSeen: today }
      : rec);
  }

  // רשומות שלא נראו בריצה הזו — נשמרות עד שהן מתיישנות או שהמועד חלף
  for (const [id, saved] of prevById) {
    if (out.has(id)) continue;
    // מקור שנוטרל או הוסר מהתצורה — הרשומות שלו יורדות מיד ולא ממתינות keepDays,
    // אחרת נטרול מקור לא היה משפיע על התוצאות במשך שבועות
    if (activeSources && !activeSources.has(saved.source)) continue;

    const age = daysBetween(saved.lastSeen || saved.firstSeen || today, today);
    if (saved.deadlineAt && daysBetween(today, saved.deadlineAt) < -graceDays) continue;
    if (age !== null && age > keepDays) continue;

    // רשומה שנשמרה נבדקת מחדש מול התצורה הנוכחית. בלי זה, חידוד הטקסונומיה או
    // השערים לא היה מנקה רשומות שכבר נכנסו — הן היו נשארות עד keepDays.
    const kept = recheck ? recheck(saved, activeSources) : saved;
    if (!kept) continue;
    out.set(id, kept);
  }

  return [...out.values()];
}

/**
 * היסטוריית בריאות למקור.
 *
 * **403 של היום נראה זהה ל-403 קבוע**, וזו ההבחנה שהמודול הזה קיים בשבילה.
 * מקור שחוסם תמיד צריך לעבור לבדיקה ידנית; מקור שעבד אתמול ונכשל היום הוא
 * כמעט תמיד הגבלת קצב שתתפוגג. בסריקה אחת החזירו 17 רשויות 403 אחרי שעבדו
 * ארבעים דקות קודם — בלי ההבחנה הן היו יורדות מהסריקה לתמיד. למחרת, בלי שום
 * שינוי בקוד, כולן נסרקו בהצלחה.
 */
function withHealth(status, prevSources, today) {
  const prev = new Map((prevSources || []).map(s => [s.id, s]));
  return status.map(s => {
    const p = prev.get(s.id) || {};
    if (s.ok) return { ...s, lastOkAt: today, failingSince: undefined };
    return {
      ...s,
      lastOkAt: p.lastOkAt || '',
      failingSince: p.failingSince || (p.lastOkAt ? today : today),
      // מקור שעבד לאחרונה ונכשל היום — סביר שזו הגבלה זמנית ולא חסימה קבועה
      likelyTransient: !!(p.lastOkAt && daysBetween(p.lastOkAt, today) <= 3) || undefined
    };
  });
}

module.exports = { mergeWithHistory, keepEnriched, withHealth, DEFAULT_ENRICHED };
