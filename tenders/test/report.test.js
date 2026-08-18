'use strict';
/**
 * בדיקות לשכבת הדיווח — סיכום הריצה וגוף ה-Issue של המכרזים החדשים.
 * הרצה:  node --test tenders/test/report.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const Rep = require('../../.github/scripts/tenders-report.js');

const today = new Date().toISOString().slice(0, 10);
const inFive = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);

const DATA = {
  generatedAt: new Date().toISOString(),
  generatedDate: today,
  topics: {
    telecom: { label: 'תקשורת', icon: '📡', color: '#4cc9f0' },
    infosec: { label: 'אבטחת מידע', icon: '🛡️', color: '#e63946' }
  },
  counts: { total: 2, new: 2, open: 1, closingSoon: 1, byTopic: { telecom: 1, infosec: 1 } },
  sources: [
    { id: 'mr-gov', name: 'מנהל הרכש הממשלתי', ok: true, scanned: 120, count: 4 },
    { id: 'tlv', name: 'עיריית תל אביב-יפו', ok: false, scanned: 0, count: 0, error: 'HTTP 403' }
  ],
  tenders: [
    {
      id: 'a', title: 'מכרז 14/2026 – אספקת שירותי תקשורת נתונים', url: 'https://example.gov.il/1',
      publisher: 'מנהל הרכש', sourceName: 'מנהל הרכש', tenderNumber: '14/2026',
      publishedAt: today, deadlineAt: inFive, topics: ['telecom'], score: 9,
      matched: ['שירותי תקשורת', 'תקשורת נתונים'], firstSeen: today, lastSeen: today
    },
    {
      id: 'b', title: 'מכרז 16/2026 – הקמת מוקד SOC והגנת סייבר', url: 'https://example.gov.il/2',
      publisher: 'עירייה', sourceName: 'עירייה', tenderNumber: '16/2026',
      publishedAt: today, deadlineAt: '', topics: ['infosec'], score: 11,
      matched: ['הגנת סייבר', 'SOC'], firstSeen: today, lastSeen: today
    }
  ]
};

test('תאריך מוצג בפורמט ישראלי', () => {
  assert.strictEqual(Rep.fmtDate('2026-09-15'), '15/09/2026');
  assert.strictEqual(Rep.fmtDate(''), '–');
});

test('חישוב ימים עד מועד ההגשה', () => {
  assert.strictEqual(Rep.daysLeft(today), 0);
  assert.strictEqual(Rep.daysLeft(inFive), 5);
  assert.strictEqual(Rep.daysLeft(''), null);
  assert.strictEqual(Rep.daysLeft('לא תאריך'), null);
});

test('הסיכום כולל מונים, פירוט נושאים ובריאות מקורות', () => {
  const md = Rep.summary(DATA);
  assert.ok(md.includes('ראדאר מכרזים'));
  assert.ok(md.includes('📡 תקשורת'));
  assert.ok(md.includes('🛡️ אבטחת מידע'));
  assert.ok(md.includes('מנהל הרכש הממשלתי'));
  assert.ok(md.includes('HTTP 403'), 'שגיאת מקור מוצגת');
  assert.ok(md.includes('מקור אחד לא נסרק'), 'התאמת יחיד/רבים בעברית');
});

test('גוף ה-Issue מקבץ לפי נושא ומציג מועדים וקישורים', () => {
  const body = Rep.issueBody(DATA, DATA.tenders);
  assert.ok(body.includes('🆕 חדשים בסריקה (2)'));
  assert.ok(body.includes('### 📡 תקשורת'));
  assert.ok(body.includes('### 🛡️ אבטחת מידע'));
  assert.ok(body.includes('[מכרז 14/2026 – אספקת שירותי תקשורת נתונים](https://example.gov.il/1)'));
  assert.ok(body.includes('בעוד 5 ימים'), 'ספירת ימים למועד ההגשה');
  assert.ok(body.includes('מועד הגשה: לא אותר'), 'מכרז בלי מועד מסומן במפורש');
  assert.ok(body.includes('מס׳ מכרז: 14/2026'));
  assert.ok(body.includes('התאמות: שירותי תקשורת, תקשורת נתונים'));
  assert.ok(body.includes('עיריית תל אביב-יפו'), 'מקור שנכשל מדווח ב-Issue');
});

test('מועד הגשה שחלף מסומן כך', () => {
  const past = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  const body = Rep.issueBody(DATA, [{ ...DATA.tenders[0], deadlineAt: past }]);
  assert.ok(body.includes('(חלף)'));
});

test('הסיכום לא נשבר כשאין מקורות ואין נושאים', () => {
  const md = Rep.summary({ generatedDate: today, topics: {}, counts: {}, sources: [], tenders: [] });
  assert.ok(md.includes('ראדאר מכרזים'));
  assert.ok(!md.includes('undefined'));
});

const DATA_SOON = {
  generatedDate: today,
  topics: DATA.topics,
  counts: { total: 3, new: 0, open: 3, closingSoon: 2, byTopic: { telecom: 2 } },
  sources: [{ id: 's', name: 'מקור', ok: true, scanned: 10, count: 3 }],
  tenders: [
    { id: 'a', title: 'מכרז נסגר מחר – שירותי תקשורת', url: 'https://x.gov.il/1', publisher: 'עירייה',
      tenderNumber: '9/2026', deadlineAt: new Date(Date.now() + 1 * 86400000).toISOString().slice(0, 10),
      topics: ['telecom'], score: 8, firstSeen: '2020-01-01', lastSeen: today },
    { id: 'b', title: 'מכרז נסגר בעוד 5 ימים – ציוד תקשורת', url: 'https://x.gov.il/2', publisher: 'עירייה',
      deadlineAt: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
      topics: ['telecom'], score: 7, firstSeen: '2020-01-01', lastSeen: today },
    { id: 'c', title: 'מכרז רחוק – מחשוב', url: 'https://x.gov.il/3', publisher: 'עירייה',
      deadlineAt: new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10),
      topics: ['it'], score: 6, firstSeen: '2020-01-01', lastSeen: today }
  ]
};

test('closingSoon מחזיר רק מכרזים פתוחים בתוך החלון, לפי סדר דחיפות', () => {
  const soon = Rep.closingSoon(DATA_SOON, 7);
  assert.deepStrictEqual(soon.map(t => t.id), ['a', 'b']);
  assert.deepStrictEqual(Rep.closingSoon(DATA_SOON, 3).map(t => t.id), ['a']);
  assert.deepStrictEqual(Rep.closingSoon(DATA_SOON, 0), []);
});

test('גוף ה-Issue מציג "נסגרים בשבוע הקרוב" גם כשאין מכרזים חדשים', () => {
  const body = Rep.issueBody(DATA_SOON, []);
  assert.ok(body.includes('⏰ נסגרים בשבוע הקרוב (2)'), 'מקטע הדחיפות מופיע');
  assert.ok(body.indexOf('נסגרים בשבוע הקרוב') < body.indexOf('לא נמצאו מכרזים חדשים'),
    'הדחוף מופיע לפני הודעת "אין חדשים"');
  assert.ok(body.includes('— מחר'), 'מכרז שנסגר מחר מסומן כך');
  assert.ok(body.includes('בעוד 5 ימים'));
  assert.ok(!body.includes('מכרז רחוק'), 'מכרז מחוץ לחלון אינו במקטע הדחיפות');
  assert.ok(body.includes('_בסריקה זו לא נמצאו מכרזים חדשים._'));
});

test('מכרז שנסגר בקרוב וגם חדש מופיע בשני המקטעים', () => {
  const fresh = [{ ...DATA_SOON.tenders[0], firstSeen: today }];
  const body = Rep.issueBody({ ...DATA_SOON, tenders: fresh }, fresh);
  assert.ok(body.includes('⏰ נסגרים בשבוע הקרוב (1)'));
  assert.ok(body.includes('🆕 חדשים בסריקה (1)'));
});

test('סוג הפרסום מצוין בדיווח — הודעת פטור אינה מוצגת כמכרז', () => {
  const data = { ...DATA_SOON, kindLabels: { tender: 'מכרז', exemption: 'פטור ממכרז', call: 'קול קורא' } };
  data.tenders = [
    { ...DATA_SOON.tenders[0], kind: 'exemption' },
    { ...DATA_SOON.tenders[1], kind: 'tender' }
  ];
  const body = Rep.issueBody(data, []);
  assert.ok(body.includes('_(פטור ממכרז)_'), 'הודעת פטור מסומנת בדיווח');
  assert.ok(!body.includes('_(מכרז)_'), 'מכרז רגיל אינו מקבל תווית מיותרת');
});

// שורת הפילוח המגזרי היא מה שנקרא במבט חטוף במייל: האם הגיע היום משהו
// מהרשויות המקומיות או מהמכללות, או שהכול ממשלתי.
test('דיווח: פילוח מגזרי מופיע בהודעה ומסודר מהגדול לקטן', () => {
  const fresh = [
    { title: 'א', url: 'u', category: 'רשויות מקומיות', topics: ['it'] },
    { title: 'ב', url: 'u', category: 'רשויות מקומיות', topics: ['it'] },
    { title: 'ג', url: 'u', category: 'מוסדות אקדמיים', topics: ['it'] },
    { title: 'ד', url: 'u', category: 'ממשלה', topics: ['it'] }
  ];
  assert.strictEqual(Rep.sectorBreakdown(fresh),
    '🏛️ 2 רשויות מקומיות · 🎓 1 מוסדות אקדמיים · 🏢 1 ממשלה');

  const body = Rep.issueBody({ tenders: [], topics: {}, sources: [] }, fresh);
  assert.ok(body.includes('מתוכם: 🏛️ 2 רשויות מקומיות'), 'הפילוח נכנס לגוף ההודעה');

  // מגזר יחיד — אין מה לפלח, ולא מוסיפים שורה מיותרת
  assert.strictEqual(Rep.sectorBreakdown([{ category: 'ממשלה' }, { category: 'ממשלה' }]), '');
});
