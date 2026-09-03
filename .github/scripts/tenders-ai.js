#!/usr/bin/env node
'use strict';
/**
 * סוקר AI ל"כמעט התאמות" של ראדאר המכרזים.
 *
 * הסינון לפי מילות מפתח תופס רק ניסוחים שנכתבו בטקסונומיה. מכרז שנוסח אחרת —
 * "אספקת מערכות ניטור וידאו" במקום "מצלמות אבטחה", "שדרוג תשתיות מיתוג" במקום
 * "מתגים" — נופל מתחת לסף ונעלם. הסורק שומר את המכרזים האלה בנפרד תחת
 * nearMisses, והסקריפט הזה נותן למודל להכריע לגביהם אחד־אחד.
 *
 * ריצה:  node .github/scripts/tenders-ai.js
 * דורש:  ANTHROPIC_API_KEY. בלי המפתח הסקריפט יוצא בשקט ולא משנה דבר —
 *        הראדאר ממשיך לעבוד בדיוק כמו קודם.
 *
 * מכרז שהמודל מאשר נכנס לראדאר עם aiMatched: true, ומוצג בממשק עם תווית
 * שמסבירה שהוא נכנס בזכות בדיקת AI ולא בזכות מילת מפתח.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA_FILE = path.join(ROOT, 'tenders', 'data', 'tenders.json');
const KW_FILE = path.join(ROOT, 'tenders', 'config', 'keywords.json');
// ההכרעות נשמרות בנפרד מהנתונים: הסורק כותב את tenders.json מחדש בכל ריצה, ובלי
// הקובץ הזה כל מכרז שהסקירה אישרה היה נמחק בסריקה הבאה.
const DECISIONS_STORE = path.join(ROOT, 'tenders', 'data', 'ai-decisions.json');

// --decisions=<file> מחיל סקירה שכבר נעשתה, במקום לקרוא ל-API. הקובץ הוא מערך של
// { id, relevant, topic, reason }. זה מאפשר להחיל סקירה גם כשאין מפתח API —
// למשל סקירה שנעשתה ידנית או בסביבה אחרת — דרך אותו מסלול קוד בדיוק.
const DECISIONS_FILE = (process.argv.slice(2).find(a => a.startsWith('--decisions=')) || '').split('=')[1] || '';
const REVIEWER = process.env.TENDERS_AI_REVIEWER || (DECISIONS_FILE ? 'external' : 'api');

const MODEL = process.env.TENDERS_AI_MODEL || 'claude-opus-5';
const BATCH = +(process.env.TENDERS_AI_BATCH || 20);
const MAX_ITEMS = +(process.env.TENDERS_AI_MAX || 40);

const today = () => new Date().toISOString().slice(0, 10);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

/** תיאור התחומים למודל — נבנה מהטקסונומיה, כדי שלא יהיו שתי הגדרות שונות */
function topicBrief(kw) {
  return Object.entries(kw.topics || {}).map(([id, t]) => {
    const sample = (t.terms || []).slice(0, 10).map(([term]) => term).join(', ');
    return `- ${id} (${t.label}): ${sample}`;
  }).join('\n');
}

const SYSTEM = `אתה עוזר לחברת אינטגרציה ישראלית לסנן מכרזים ציבוריים.

החברה מוכרת ומתקינה: תקשורת ותשתיות תקשורת, ציוד תקשורת ואבטחה (מתגים, נתבים,
מצלמות, טמ"ס), אבטחת מידע וסייבר, שירותי IT ומערכות מידע, ופתרונות בינה מלאכותית.

תקבל כותרות של פרסומים שנמצאו באתרי מכרזים ציבוריים. לכל אחת החלט אם היא מכרז
שהחברה יכולה להגיש אליו הצעה בתחומים האלה.

ענה "לא רלוונטי" כאשר:
- הפרסום אינו מכרז רכש (דף ניווט, שם חוג או תכנית לימודים, עמוד דרושים, פרוטוקול,
  מענה לשאלות הבהרה, הודעה על הארכת מועד)
- התחום אינו שלנו (בנייה, גינון, ניקיון, הסעדה, שמירה פיזית, כוח אדם, ייעוץ משפטי,
  קלינאות תקשורת, תקשורת שיווקית ויחסי ציבור)
- מדובר בתקשורת במובן של מדיה, עיתונות או תקשורת בין־אישית ולא בתקשורת מחשבים

היה מחמיר. במקרה של ספק ענה "לא רלוונטי" — עדיף לפספס מכרז אחד מאשר להציף את
הרשימה בפרסומים שאינם בתחום.`;

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer', description: 'המספר הסידורי של הכותרת ברשימה שקיבלת' },
          relevant: { type: 'boolean', description: 'האם זהו מכרז רכש בתחומי החברה' },
          topic: {
            type: 'string',
            description: 'מזהה התחום המתאים ביותר, או מחרוזת ריקה כשאינו רלוונטי',
            enum: ['telecom', 'equipment', 'infosec', 'it', 'ai', '']
          },
          reason: { type: 'string', description: 'נימוק קצר בעברית, עד 12 מילים' }
        },
        required: ['index', 'relevant', 'topic', 'reason'],
        additionalProperties: false
      }
    }
  },
  required: ['items'],
  additionalProperties: false
};

/** שולח קבוצת כותרות אחת להכרעה ומחזיר את ההחלטות */
async function judgeBatch(client, kw, batch) {
  const list = batch.map((r, i) => `${i + 1}. ${r.title}`).join('\n');
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: `התחומים והמונחים האופייניים להם:\n${topicBrief(kw)}\n\n` +
               `הכרע לגבי כל אחת מהכותרות הבאות והחזר החלטה לכל מספר סידורי:\n\n${list}`
    }],
    tools: [{
      name: 'report_relevance',
      description: 'מדווח את ההכרעה לכל כותרת ברשימה',
      strict: true,
      input_schema: RESULT_SCHEMA
    }],
    tool_choice: { type: 'tool', name: 'report_relevance' }
  });

  const call = response.content.find(b => b.type === 'tool_use');
  if (!call) return [];
  // input עשוי להגיע עם בריחות שונות — תמיד עוברים דרך המבנה ולא דרך המחרוזת
  const items = (call.input && call.input.items) || [];
  return items
    .filter(x => Number.isInteger(x.index) && x.index >= 1 && x.index <= batch.length)
    .map(x => ({ rec: batch[x.index - 1], ...x }));
}

async function main() {
  if (!DECISIONS_FILE && !process.env.ANTHROPIC_API_KEY) {
    console.error('ℹ️  אין ANTHROPIC_API_KEY — סקירת ה-AI מדולגת, הראדאר לא משתנה');
    return;
  }

  const data = readJson(DATA_FILE, null);
  const kw = readJson(KW_FILE, null);
  if (!data || !kw) { console.error('✖ חסרים קבצי נתונים או תצורה'); process.exit(1); }

  const pending = (data.nearMisses || []).slice(0, MAX_ITEMS);
  if (!pending.length) { console.error('ℹ️  אין מועמדים לבדיקה'); return; }

  let decisions = [];
  if (DECISIONS_FILE) {
    const byId = new Map(pending.map(r => [r.id, r]));
    const raw = readJson(path.resolve(DECISIONS_FILE), null);
    if (!Array.isArray(raw)) { console.error('✖ קובץ ההחלטות אינו מערך'); process.exit(1); }
    decisions = raw.filter(d => byId.has(d.id)).map(d => ({ ...d, rec: byId.get(d.id) }));
    const unknown = raw.length - decisions.length;
    if (unknown) console.error(`⚠️  ${unknown} החלטות מתייחסות למזהים שאינם ברשימת המועמדים ולכן דולגו`);
  } else {
    let Anthropic;
    try { Anthropic = require('@anthropic-ai/sdk'); }
    catch (_) { console.error('✖ החבילה @anthropic-ai/sdk אינה מותקנת — הרץ npm ci'); process.exit(1); }
    // החבילה מתפרסמת גם כ-ESM וגם כ-CJS; require מחזיר את המודול או את default שלו
    const Ctor = Anthropic.default || Anthropic;
    const client = new Ctor();

    for (let i = 0; i < pending.length; i += BATCH) {
      const batch = pending.slice(i, i + BATCH);
      try {
        decisions.push(...await judgeBatch(client, kw, batch));
      } catch (e) {
        // כשל בסקירה אינו מפיל את הראדאר — הנתונים נשארים כפי שהם
        console.error(`✖ סקירת AI נכשלה על קבוצה ${i / BATCH + 1}: ${(e && e.message) || e}`);
        return;
      }
    }
  }

  const accepted = decisions.filter(d => d.relevant && d.topic && kw.topics[d.topic]);
  const known = new Set((data.tenders || []).map(t => t.id));
  const promoted = [];
  for (const d of accepted) {
    if (known.has(d.rec.id)) continue;
    known.add(d.rec.id);
    const { near, ...rec } = d.rec;
    promoted.push({ ...rec, topics: [d.topic], aiMatched: true, aiReviewer: REVIEWER, aiReason: String(d.reason || '').slice(0, 120) });
  }

  const rejectedIds = new Set(decisions.filter(d => !d.relevant).map(d => d.rec.id));
  data.tenders = [...(data.tenders || []), ...promoted];
  data.nearMisses = (data.nearMisses || []).filter(r => !rejectedIds.has(r.id) && !known.has(r.id));
  data.counts = data.counts || {};
  data.counts.total = data.tenders.length;
  data.counts.aiMatched = (data.counts.aiMatched || 0) + promoted.length;
  data.counts.near = data.nearMisses.length;
  data.aiReviewedAt = new Date().toISOString();
  data.aiReviewer = REVIEWER;

  // שמירת ההכרעות: כך הן שורדות את הסריקה הבאה, וגם אין צורך לשאול את המודל
  // שוב על אותם מכרזים
  const store = readJson(DECISIONS_STORE, { decisions: {} });
  store.decisions = store.decisions || {};
  for (const d of decisions) {
    store.decisions[d.rec.id] = {
      relevant: !!d.relevant,
      topic: d.relevant ? d.topic : '',
      reason: String(d.reason || '').slice(0, 120),
      title: d.rec.title.slice(0, 120),
      // הכתובת נשמרת כדי שההכרעה תשרוד שינוי בנוסחת המזהה — המזהה הוא מפתח
      // נוח, אבל הכתובת היא זו שמזהה את המכרז לאורך זמן
      url: d.rec.url || '',
      source: d.rec.source || '',
      reviewer: REVIEWER,
      at: today()
    };
  }
  store.updatedAt = new Date().toISOString();
  fs.writeFileSync(DECISIONS_STORE, JSON.stringify(store, null, 2) + '\n', 'utf8');

  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.error(`\n🤖 סקירת AI: נבדקו ${decisions.length}, אושרו ${promoted.length}, נדחו ${rejectedIds.size}`);
  for (const p of promoted) console.error(`   ✔ ${p.title.slice(0, 70)}  — ${p.aiReason}`);
}

if (require.main === module) {
  main().catch(e => { console.error('✖ סקירת AI נכשלה:', (e && e.stack) || e); process.exit(1); });
}

module.exports = { topicBrief, judgeBatch, RESULT_SCHEMA, SYSTEM };
