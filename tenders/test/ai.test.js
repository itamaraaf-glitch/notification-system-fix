'use strict';
/**
 * בדיקות לסוקר ה-AI. אין קריאות רשת: הלקוח מוחלף בכפיל שמחזיר תשובה קבועה,
 * כך שהבדיקה מאמתת את החוזה — מה נשלח, ואיך מתפרשת התשובה.
 * הרצה:  node --test tenders/test/ai.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const AI = require('../../.github/scripts/tenders-ai.js');
const KW = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'keywords.json'), 'utf8'));

/** לקוח מדומה שמחזיר החלטות קבועות ורושם את הבקשה שנשלחה */
function fakeClient(items) {
  const sent = [];
  return {
    sent,
    messages: {
      create: async req => {
        sent.push(req);
        return { content: [{ type: 'tool_use', name: 'report_relevance', input: { items } }] };
      }
    }
  };
}

test('תיאור התחומים למודל נבנה מהטקסונומיה ולא מרשימה כפולה', () => {
  const brief = AI.topicBrief(KW);
  for (const [id, t] of Object.entries(KW.topics)) {
    assert.ok(brief.includes(id), `התחום ${id} מופיע`);
    assert.ok(brief.includes(t.label), `התווית "${t.label}" מופיעה`);
  }
  // מונח אמיתי מהטקסונומיה מגיע למודל כדוגמה
  assert.ok(brief.includes(KW.topics.telecom.terms[0][0]));
});

test('הבקשה נשלחת עם כלי מחייב וסכימה מוגדרת', async () => {
  const client = fakeClient([]);
  await AI.judgeBatch(client, KW, [{ id: 'a', title: 'מכרז כלשהו' }]);
  const req = client.sent[0];
  assert.strictEqual(req.tool_choice.type, 'tool');
  assert.strictEqual(req.tool_choice.name, 'report_relevance');
  assert.strictEqual(req.tools[0].strict, true);
  assert.strictEqual(req.tools[0].input_schema.additionalProperties, false);
  assert.ok(req.system.includes('מכרזים'), 'הנחיית המערכת מוגדרת');
  assert.ok(req.messages[0].content.includes('1. מכרז כלשהו'), 'הכותרות ממוספרות');
});

test('ההחלטות משויכות בחזרה לרשומות לפי המספר הסידורי', async () => {
  const batch = [
    { id: 'a', title: 'אספקת מערכות ניטור וידאו' },
    { id: 'b', title: 'עבודות גינון' },
    { id: 'c', title: 'שדרוג תשתיות מיתוג' }
  ];
  const client = fakeClient([
    { index: 1, relevant: true, topic: 'equipment', reason: 'מצלמות ומערכות ניטור' },
    { index: 2, relevant: false, topic: '', reason: 'גינון אינו בתחום' },
    { index: 3, relevant: true, topic: 'equipment', reason: 'מתגים ותשתיות רשת' }
  ]);
  const out = await AI.judgeBatch(client, KW, batch);
  assert.strictEqual(out.length, 3);
  assert.strictEqual(out[0].rec.id, 'a');
  assert.strictEqual(out[1].rec.id, 'b');
  assert.strictEqual(out[2].rec.id, 'c');
  assert.strictEqual(out[0].relevant, true);
  assert.strictEqual(out[1].relevant, false);
});

test('מספר סידורי מחוץ לתחום נזרק ולא מפיל את הסקירה', async () => {
  const batch = [{ id: 'a', title: 'א' }];
  const client = fakeClient([
    { index: 1, relevant: true, topic: 'it', reason: 'תקין' },
    { index: 7, relevant: true, topic: 'it', reason: 'לא קיים' },
    { index: 0, relevant: true, topic: 'it', reason: 'לא חוקי' }
  ]);
  const out = await AI.judgeBatch(client, KW, batch);
  assert.strictEqual(out.length, 1, 'רק ההחלטה התקינה נשמרת');
});

test('תשובה בלי קריאת כלי מחזירה רשימה ריקה במקום לזרוק', async () => {
  const client = { messages: { create: async () => ({ content: [{ type: 'text', text: 'לא' }] }) } };
  assert.deepStrictEqual(await AI.judgeBatch(client, KW, [{ id: 'a', title: 'א' }]), []);
});

test('הסכימה מגבילה את התחום לערכים מהטקסונומיה', () => {
  const topics = AI.RESULT_SCHEMA.properties.items.items.properties.topic.enum;
  for (const id of Object.keys(KW.topics)) {
    assert.ok(topics.includes(id), `התחום ${id} מותר בסכימה — אחרת מכרז שאושר יידחה בשקט`);
  }
  assert.ok(topics.includes(''), 'מחרוזת ריקה מותרת עבור "לא רלוונטי"');
});

test('מצב --decisions מוגדר כך שאפשר להחיל סקירה גם בלי מפתח API', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'scripts', 'tenders-ai.js'), 'utf8');
  assert.ok(src.includes('--decisions='), 'הדגל קיים');
  assert.ok(/if \(!DECISIONS_FILE && !process\.env\.ANTHROPIC_API_KEY\)/.test(src),
    'קובץ החלטות פוטר מהדרישה למפתח');
  assert.ok(src.includes('aiReviewer'), 'נרשם מי ביצע את הסקירה — API או גורם חיצוני');
  assert.ok(src.includes('decisions = raw.filter(d => byId.has(d.id))'),
    'החלטה על מזהה שאינו ברשימת המועמדים מדולגת ולא מייצרת רשומה יש מאין');
});

// הסורק כותב את tenders.json מחדש בכל ריצה. בלי אחסון נפרד להכרעות, כל מכרז
// שסקירת ה-AI אישרה נמחק בסריקה הבאה — וזה בדיוק מה שקרה בפועל: 4 מכרזים
// שאושרו נעלמו למחרת.
test('ההכרעות נשמרות בקובץ נפרד ששורד סריקה מחדש', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'scripts', 'tenders-ai.js'), 'utf8');
  assert.ok(src.includes('ai-decisions.json'), 'הסוקר כותב לאחסון ההכרעות');
  assert.ok(/store\.decisions\[d\.rec\.id\]/.test(src), 'ההכרעה נשמרת לפי מזהה המכרז');
  assert.ok(/relevant: !!d\.relevant/.test(src), 'גם דחייה נשמרת — כדי לא לשאול שוב על אותו מכרז');

  const fetcher = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'scripts', 'tenders-fetch.js'), 'utf8');
  assert.ok(fetcher.includes("readJson(path.join(DATA_DIR, 'ai-decisions.json')"), 'הסורק קורא את האחסון');
  assert.ok(/aiMatched: true, aiReviewer: d\.reviewer/.test(fetcher), 'ומחזיר את המכרזים שאושרו');
  assert.ok(/nearList\.filter\(r => !aiDec\[r\.id\]/.test(fetcher),
    'מועמד שכבר הוכרע אינו מוצג שוב ברשימת הבדיקה');
});
