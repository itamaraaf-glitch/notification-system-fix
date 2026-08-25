'use strict';
/**
 * התאמת מונחים בעברית וסיווג לפי טקסונומיה.
 *
 * זהו הלב של הסוכן, והחלק היחיד שנדרש בו ידע לשוני. הוא גנרי לחלוטין: הוא לא
 * יודע דבר על מכרזים ולא על שום תחום אחר — הוא מקבל טקסט וקובץ טקסונומיה
 * ומחזיר נושאים וניקוד. כל משימה (watch) מביאה את הטקסונומיה שלה.
 *
 * מבנה הטקסונומיה:
 *   {
 *     "minScore": 3,
 *     "topics": { "<id>": { "label": "...", "terms": [["מונח", משקל], ...],
 *                           "acronyms": [["SIEM", משקל], ...] } },
 *     "negative": [["מונח שלילה", משקל], ...]
 *   }
 */

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
    // טקסט בלי שום התאמה (0 מול 0) נחשב "חסום" — מה שהסתיר פרסומים שאין להם
    // התאמה כלל, בדיוק אלה שסקירת ה-AI אמורה לשפוט.
    blocked: penalty > 0 && penalty >= total
  };
}

/**
 * תיאור מילולי קצר של הטקסונומיה, להזנת מודל שפה.
 * נגזר מהטקסונומיה עצמה כדי שלא יהיו שתי הגדרות שנפרדות זו מזו.
 */
function topicBrief(kw) {
  return Object.entries(kw.topics)
    .map(([id, t]) => `${id} (${t.label}): ` + (t.terms || []).slice(0, 12).map(([term]) => term).join(', '))
    .join('\n');
}

module.exports = { classify, termRegex, acronymRegex, topicBrief };
