'use strict';
/**
 * בדיקות המשפך המלא — מ-HTML גולמי ועד רשומה שמורה, בלי רשת.
 *
 * הבדיקות מזריקות לקוח מזויף במקום שכבת הרשת, ולכן הן מריצות את אותו מסלול
 * קוד בדיוק שרץ בייצור: אותם מתאמים, אותם שערים, אותו מיזוג היסטוריה.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { buildContext, scanSource, recheckSaved, loadWatch, sourceBudget } = require('../run');
const { mergeWithHistory, keepEnriched, withHealth } = require('../core/history');
const { compileGate, passesGate, isNavTitle, summarize, sortRecords, timeDropReason } = require('../core/pipeline');

const TODAY = '2026-08-25';
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

/** משימת בדיקה — טקסונומיית תקשורת/אבטחה מצומצמת, שער מכרזים */
const WATCH = {
  id: 'test',
  name: 'משימת בדיקה',
  taxonomy: {
    minScore: 3,
    topics: {
      telecom: { label: 'תקשורת', terms: [['תקשורת', 3], ['סיבים אופטיים', 5], ['מתגים', 4], ['נתבים', 4]], acronyms: [] },
      infosec: { label: 'אבטחת מידע', terms: [['אבטחת מידע', 5]], acronyms: [['SIEM', 5], ['SOC', 4]] }
    },
    negative: [['קלינאי תקשורת', 8]]
  },
  gate: {
    phrases: ['מכרז', 'קול קורא'],
    navBlock: '^\\s*ועד(ת|ות)\\s*(ה)?מכרזים|לתשלום\\s*עבור|לחצו\\s*כאן'
  },
  discovery: {
    text: '(מכרז|tenders?)', url: '(tender|bids?|מכרז)', path: '\\/(bids?|tenders?)(\\/|$|\\?)',
    exact: '^\\s*מכרזים\\s*$', active: '(פעילים|פתוחים)',
    archive: '(תוצאות|ארכיון|פרוטוקול|archive|results|protocol)',
    demote: '(דרושים|משרות|jobs?)', demoteUnless: '(מכרז|tender)', sectionParent: '(מכרז|tender)'
  },
  dates: {
    deadlineHints: '(מועד\\s*אחרון|להגשה\\s*עד)',
    publishHints: '(תאריך\\s*פרסום|פורסם\\s*ב)',
    serialPattern: '(?:מכרז)[^\\d\\n]{0,25}(\\d{1,4}\\s*[\\/\\-]\\s*\\d{2,4})'
  },
  retention: { keepUndated: true, keepDays: 45, maxAgeDays: 365, deadlineGraceDays: 14 },
  limits: { maxPerSource: 60, parallel: 1, politeDelayMs: 0 }
};

/** לקוח מזויף: מחזיר פיקסטורים לפי כתובת, ורושם מה נתבקש */
function stubClient(pages) {
  const asked = [];
  return {
    asked,
    fetchText: async url => {
      asked.push(url);
      const body = pages[url];
      if (body === undefined) { const e = new Error('HTTP 404'); e.permanent = true; throw e; }
      if (body instanceof Error) throw body;
      return body;
    },
    finalUrlOf: url => url
  };
}

function ctxWith(pages, watch = WATCH) {
  const ctx = buildContext(watch);
  ctx.client = stubClient(pages);
  ctx.politeDelayMs = 0;
  ctx.today = TODAY;
  return ctx;
}

const HOME = 'https://muni-example.org.il/';
const BIDS = 'https://muni-example.org.il/bids/';

/* ───────────────────────── מקור discover, מקצה לקצה ───────────────────────── */

test('מקור discover: מוצא את עמוד המכרזים מדף הבית וקוצר ממנו רשומות', async () => {
  const ctx = ctxWith({ [HOME]: fixture('home.html'), [BIDS]: fixture('bids.html') });
  const dropped = {};
  const { entry, records } = await scanSource(
    { id: 'muni', name: 'מועצה לדוגמה', kind: 'discover', home: HOME, maxPages: 1 },
    WATCH, ctx, dropped
  );

  assert.strictEqual(entry.ok, true, entry.error);
  assert.deepStrictEqual(entry.discovered, [BIDS], 'הגילוי צריך לנחות על עמוד המכרזים');

  const titles = records.map(r => r.title);
  assert.ok(titles.some(t => t.includes('סיבים אופטיים')), 'מכרז התקשורת חייב להיכנס');
  assert.ok(titles.some(t => t.includes('SIEM')), 'מכרז אבטחת המידע חייב להיכנס');
  assert.strictEqual(records.length, 2, 'רק שני המכרזים הרלוונטיים והפתוחים נכנסים: ' + titles.join(' | '));
});

test('כל נשירה מסווגת לסיבה — בלי זה אי אפשר לדעת אם הסינון בולע פרסומים אמיתיים', async () => {
  const ctx = ctxWith({ [HOME]: fixture('home.html'), [BIDS]: fixture('bids.html') });
  const dropped = {};
  await scanSource({ id: 'muni', kind: 'discover', home: HOME, maxPages: 1 }, WATCH, ctx, dropped);

  assert.ok(dropped.nav >= 2, 'ועדת מכרזים ו"לתשלום עבור" הן תוויות ניווט: ' + JSON.stringify(dropped));
  assert.ok(dropped.gate >= 1, 'ידיעה על טקס בית ספר לא נוסחה כמכרז');
  assert.strictEqual(dropped.blocked, 1, 'קלינאי תקשורת נחסם במילות שלילה');
  assert.ok(dropped.noTopic >= 1, 'מכרז גינון עבר את השער אבל אין לו נושא');
});

test('מכרז שמועדו חלף נושר עם הסיבה הנכונה', async () => {
  const url = 'https://muni-example.org.il/old/';
  const ctx = ctxWith({ [url]: fixture('expired.html') });
  const dropped = {};
  const { records } = await scanSource({ id: 'old', kind: 'html', urls: [url] }, WATCH, ctx, dropped);
  assert.strictEqual(records.length, 0);
  assert.strictEqual(dropped.expired, 1, JSON.stringify(dropped));
});

test('הסיווג מתעלם מחלון ההקשר — שכן בדף אינו מזכה פריט בנושא שאינו שלו', async () => {
  // בדף צפוף, חלון ההקשר של מכרז הגינון כולל את "סיבים אופטיים" ו-SIEM של
  // המכרזים שמעליו. אילו הסיווג היה רץ על ההקשר, הגינון היה נכנס לראדאר
  // כמכרז תקשורת — ומכרז קלינאי התקשורת היה ניצל ממילות השלילה בזכות שכניו.
  const ctx = ctxWith({ [HOME]: fixture('home.html'), [BIDS]: fixture('bids.html') });
  const dropped = {};
  const { records } = await scanSource({ id: 'muni', kind: 'discover', home: HOME, maxPages: 1 }, WATCH, ctx, dropped);
  assert.ok(!records.some(r => r.title.includes('גינון')), 'מכרז גינון לא אמור לקבל נושא');
  assert.ok(!records.some(r => r.title.includes('קלינאי')), 'מכרז קלינאי תקשורת חייב להיחסם');
});

test('כתובת שנכשלת אינה מפילה מקור שלם', async () => {
  const ctx = ctxWith({
    'https://x.il/a': fixture('bids.html')
    // 'https://x.il/b' חסר בכוונה — יחזיר 404
  });
  const dropped = {};
  const { entry, records } = await scanSource(
    { id: 'multi', kind: 'html', urls: ['https://x.il/a', 'https://x.il/b'] },
    WATCH, ctx, dropped
  );
  assert.strictEqual(entry.ok, true, 'מקור עם כתובת אחת שעובדת נחשב תקין');
  assert.strictEqual(entry.warnings.length, 1, 'הכישלון נרשם כאזהרה ולא נבלע');
  assert.ok(records.length > 0);
});

test('מקור שכל כתובותיו נכשלו מדווח ככושל', async () => {
  const ctx = ctxWith({});
  const { entry } = await scanSource({ id: 'dead', kind: 'html', urls: ['https://x.il/a'] }, WATCH, ctx, {});
  assert.strictEqual(entry.ok, false);
  assert.ok(entry.error.includes('404'));
});

test('מתאם json ממפה שדות לפי התצורה', async () => {
  const payload = JSON.stringify({
    result: { records: [
      { Name: 'מכרז 9/2026 לאספקת מתגים ונתבים', Link: '/t/9', Desc: 'מועד אחרון להגשה: 01/12/2026', Org: 'רשות לדוגמה' },
      { Name: '', Link: '/t/10' }
    ] }
  });
  const ctx = ctxWith({ 'https://api.example.il/items': payload });
  const { entry, records } = await scanSource({
    id: 'api', kind: 'json', urls: ['https://api.example.il/items'],
    json: { records: 'result.records', title: 'Name', url: 'Link', context: ['Desc'], publisher: 'Org' }
  }, WATCH, ctx, {});

  assert.strictEqual(entry.ok, true, entry.error);
  assert.strictEqual(records.length, 1, 'רשומה בלי כותרת מדולגת');
  assert.strictEqual(records[0].url, 'https://api.example.il/t/9', 'כתובת יחסית נבנית מול כתובת ה-API');
  assert.strictEqual(records[0].publisher, 'רשות לדוגמה');
  assert.strictEqual(records[0].deadlineAt, '2026-12-01');
  assert.ok(records[0].topics.includes('telecom'));
});

test('מתאם rss קורא פיד ומסווג ממנו', async () => {
  const xml = '<rss><channel>' +
    '<item><title>מכרז לאספקת שירותי תקשורת וסיבים אופטיים</title><link>https://x.il/1</link>' +
    '<description>מועד אחרון להגשה: 10/12/2026</description></item>' +
    '<item><title>מכרז לעבודות גינון</title><link>https://x.il/2</link><description>ללא</description></item>' +
    '</channel></rss>';
  const ctx = ctxWith({ 'https://x.il/feed': xml });
  const dropped = {};
  const { records } = await scanSource({ id: 'feed', kind: 'rss', urls: ['https://x.il/feed'] }, WATCH, ctx, dropped);
  assert.strictEqual(records.length, 1);
  assert.strictEqual(records[0].deadlineAt, '2026-12-10');
  assert.strictEqual(dropped.noTopic, 1);
});

/* ───────────────────────── שערים ───────────────────────── */

test('שער ריק מעביר הכול — משימת חדשות מסתמכת על הטקסונומיה לבדה', () => {
  const gate = compileGate({});
  assert.ok(passesGate({ title: 'ידיעה כלשהי על השוק' }, {}, gate));
});

test('allItems מדלג על דרישת הניסוח, אבל תווית ניווט נדחית גם שם', () => {
  const gate = compileGate({ phrases: ['מכרז'], navBlock: '^\\s*ועדת' });
  const src = { allItems: true };
  assert.ok(passesGate({ title: 'אספקת ציוד לרשת המועצה', url: 'https://x.il/bids/3' }, src, gate) === false,
    'בלי ניסוח מזהה ובלי התאמת כתובת — לא עובר');
  assert.ok(isNavTitle('ועדת מכרזים', gate));
});

test('urlPattern מעביר פריט שכתובתו מעידה, גם בלי ניסוח בכותרת', () => {
  const gate = compileGate({ phrases: ['מכרז'], urlPattern: '\\/bids\\/' });
  assert.ok(passesGate({ title: 'אספקת ציוד לרשת המועצה', url: 'https://x.il/bids/3' }, { allItems: true }, gate));
});

/* ───────────────────────── נשירה על תאריכים ───────────────────────── */

test('keepUndated=false מוחק פרסום בלי מועד; true שומר אותו', () => {
  const rec = { title: 'מכרז לאספקת מתגים', publishedAt: '', deadlineAt: '' };
  const hints = { serial: null };
  assert.strictEqual(timeDropReason(rec, { retention: { keepUndated: false } }, hints, TODAY), 'undated');
  assert.strictEqual(timeDropReason(rec, { retention: { keepUndated: true } }, hints, TODAY), '');
});

test('פרסום בלי מועד שגילו מעל השנה נושר כארכיון, לפי השנה שבמספר המכרז', () => {
  const rec = { title: 'מכרז 07/2015 לאספקת מתגים', publishedAt: '', deadlineAt: '' };
  const hints = { serial: /(?:מכרז)[^\d\n]{0,25}(\d{1,4}\s*[/\-]\s*\d{2,4})/ };
  const watch = { retention: { keepUndated: true, maxAgeDays: 365 } };
  assert.strictEqual(timeDropReason(rec, watch, hints, TODAY), 'archived',
    'בלי החוליה הזו פרסום בלי שום תאריך נראה טרי לנצח');
});

/* ───────────────────────── היסטוריה ───────────────────────── */

test('firstSeen המקורי נשמר — אחרת כל רשומה הייתה "חדשה" בכל בוקר', () => {
  const prev = new Map([['a', { id: 'a', source: 's', title: 'מכרז', firstSeen: '2026-08-01', lastSeen: '2026-08-24', topics: [], score: 0 }]]);
  const merged = mergeWithHistory(
    [{ id: 'a', source: 's', title: 'מכרז', firstSeen: TODAY, lastSeen: TODAY, topics: [], score: 0 }],
    prev, new Map([['s', {}]]), WATCH, TODAY, null
  );
  assert.strictEqual(merged[0].firstSeen, '2026-08-01');
  assert.strictEqual(merged[0].lastSeen, TODAY);
});

test('ערך ריק מהסריקה אינו דורס מועד שנשלף בעמל', () => {
  const prev = { id: 'a', deadlineAt: '2026-12-01', deadlineFrom: 'detail', publisher: 'רשות' };
  const fresh = { id: 'a', deadlineAt: '', publisher: '' };
  const merged = keepEnriched(prev, fresh);
  assert.strictEqual(merged.deadlineAt, '2026-12-01',
    'המחרוזת הריקה מדף הרשימה מחקה בדיוק את המועד שנשלף מדף המכרז');
  assert.strictEqual(merged.deadlineFrom, 'detail');
  assert.strictEqual(merged.publisher, 'רשות');
});

test('מועד חדש מדף הרשימה כן גובר, כדי שהארכת מועד תעדכן', () => {
  const merged = keepEnriched({ id: 'a', deadlineAt: '2026-12-01', deadlineFrom: 'detail' }, { id: 'a', deadlineAt: '2027-01-15' });
  assert.strictEqual(merged.deadlineAt, '2027-01-15');
  assert.strictEqual(merged.deadlineFrom, '');
});

test('רשומות של מקור שנוטרל יורדות מיד ולא ממתינות keepDays', () => {
  const prev = new Map([['a', { id: 'a', source: 'gone', title: 'מכרז', lastSeen: TODAY, topics: ['telecom'], score: 9 }]]);
  const merged = mergeWithHistory([], prev, new Map([['live', {}]]), WATCH, TODAY, x => x);
  assert.strictEqual(merged.length, 0);
});

test('רשומה שמורה נבדקת מחדש מול התצורה — חידוד הסינון מנקה גם את המאגר', () => {
  const ctx = ctxWith({});
  const recheck = recheckSaved(WATCH, ctx);
  const active = new Map([['s', {}]]);

  const stillGood = recheck({ id: 'a', source: 's', title: 'מכרז לאספקת סיבים אופטיים', summary: '' }, active);
  assert.ok(stillGood && stillGood.topics.includes('telecom'));

  assert.strictEqual(recheck({ id: 'b', source: 's', title: 'ועדת מכרזים', summary: '' }, active), null,
    'תווית ניווט שנתפסה לפני שהשער הוקשח חייבת לרדת');
  assert.strictEqual(recheck({ id: 'c', source: 's', title: 'מכרז לעבודות גינון', summary: '' }, active), null,
    'רשומה שהטקסונומיה כבר לא מסווגת חייבת לרדת');
});

test('מכרז שמועדו חלף לפני יותר משבועיים יורד מהמאגר', () => {
  const prev = new Map([
    ['old', { id: 'old', source: 's', deadlineAt: '2026-07-01', lastSeen: TODAY, topics: ['telecom'], score: 5 }],
    ['grace', { id: 'grace', source: 's', deadlineAt: '2026-08-20', lastSeen: TODAY, topics: ['telecom'], score: 5 }]
  ]);
  const merged = mergeWithHistory([], prev, new Map([['s', {}]]), WATCH, TODAY, x => x);
  const ids = merged.map(r => r.id);
  assert.ok(!ids.includes('old'), 'מועד שחלף לפני חודשיים');
  assert.ok(ids.includes('grace'), 'שבועיים חסד — מכרז שנסגר אתמול עדיין מעניין');
});

/* ───────────────────────── בריאות המקורות ───────────────────────── */

test('403 של היום מסומן כהגבלה זמנית אם המקור עבד לאחרונה', () => {
  const status = withHealth(
    [{ id: 's', ok: false, error: 'HTTP 403' }],
    [{ id: 's', lastOkAt: '2026-08-24' }],
    TODAY
  );
  assert.strictEqual(status[0].likelyTransient, true,
    'בלי ההבחנה הזו 17 רשויות היו יורדות מהסריקה לתמיד אחרי הגבלת קצב של יום אחד');
  assert.strictEqual(status[0].failingSince, TODAY);
});

test('מקור שלא עבד מעולם אינו מסומן כזמני', () => {
  const status = withHealth([{ id: 's', ok: false, error: 'HTTP 403' }], [], TODAY);
  assert.strictEqual(status[0].likelyTransient, undefined);
});

test('מקור שעבד מאפס את failingSince', () => {
  const status = withHealth([{ id: 's', ok: true }], [{ id: 's', failingSince: '2026-08-01' }], TODAY);
  assert.strictEqual(status[0].lastOkAt, TODAY);
  assert.strictEqual(status[0].failingSince, undefined);
});

/* ───────────────────────── מיון וסיכום ───────────────────────── */

test('מיון: מועד קרוב קודם, פתוחים לפני חסרי מועד, ואז לפי ניקוד', () => {
  const sorted = sortRecords([
    { id: 'c', deadlineAt: '', score: 9 },
    { id: 'a', deadlineAt: '2026-09-01', score: 1 },
    { id: 'b', deadlineAt: '2026-08-28', score: 1 },
    { id: 'd', deadlineAt: '', score: 20 }
  ], TODAY).map(r => r.id);
  assert.deepStrictEqual(sorted, ['b', 'a', 'd', 'c']);
});

test('summarize סופר חדשים, פתוחים ונסגרים בשבוע', () => {
  const s = summarize([
    { topics: ['telecom'], firstSeen: TODAY, deadlineAt: '2026-08-27' },
    { topics: ['telecom', 'infosec'], firstSeen: '2026-08-01', deadlineAt: '2026-12-01' },
    { topics: [], firstSeen: '2026-08-01', deadlineAt: '' }
  ], TODAY);
  assert.strictEqual(s.total, 3);
  assert.strictEqual(s.new, 1);
  assert.strictEqual(s.open, 2);
  assert.strictEqual(s.closingSoon, 1);
  assert.strictEqual(s.byTopic.telecom, 2);
});

/* ───────────────────────── תקציב זמן ───────────────────────── */

test('תקציב המקור גדל עם מספר הכתובות אבל חסום מלמעלה', () => {
  assert.strictEqual(sourceBudget({ urls: ['a'] }, {}), 80000);
  assert.strictEqual(sourceBudget({ urls: new Array(50).fill('a') }, {}), 300000);
  assert.strictEqual(sourceBudget({ urls: ['a'] }, { sourceMaxMs: 5000 }), 5000);
});

/* ───────────────────────── קבצי המשימות שבמאגר ───────────────────────── */

test('כל קובץ משימה במאגר נטען ומתקמפל', () => {
  for (const id of ['tenders', 'example']) {
    const w = loadWatch(id);
    assert.ok(w.taxonomy.topics, `${id}: אין טקסונומיה`);
    assert.ok(Array.isArray(w.sources), `${id}: אין מקורות`);
    assert.doesNotThrow(() => buildContext(w), `${id}: התצורה אינה מתקמפלת`);
  }
});

test('פרופיל המכרזים טוען את המקורות והשער מקבצי הראדאר, בלי להעתיק אותם', () => {
  const w = loadWatch('tenders');
  assert.ok(w.sources.length > 40, 'המקורות נטענים מ-tenders/config/sources.json');
  assert.ok(w.gate.phrases.includes('מכרז'), 'ניסוחי השער נטענים מהטקסונומיה עצמה');
  assert.strictEqual(w.enabled, false, 'פרופיל ייחוס — הראדאר עצמו הוא מסלול הייצור');
});
