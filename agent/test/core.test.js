'use strict';
/**
 * בדיקות ליבת סוכן הרשת — התאמת מונחים, תאריכים, כתובות, קציר וגילוי.
 * הרצה:  node --test agent/test/
 */

const test = require('node:test');
const assert = require('node:assert');

const { normKey, hashId, stripTags, decodeEntities, daysBetween, ymd } = require('../core/text');
const { classify, termRegex } = require('../core/match');
const { parseDateNear, dateAfterHint, dateFromUrl, yearFromSerial, BINARY_URL_RE } = require('../core/dates');
const { registrableDomain, sameSite, isSiteRoot, sameUrl, sectionParent, lastPathSegment } = require('../core/urls');
const { harvestAnchors, harvestFeed } = require('../core/harvest');
const { findSectionLinks, compileVocab, demotedOnly } = require('../core/discover');
const { compileDateHints, extractDates } = require('../core/pipeline');
const net = require('../core/net');

/* ───────────────────────── טקסט ───────────────────────── */

test('stripTags מנקה תגיות ומפענח ישויות', () => {
  assert.strictEqual(stripTags('<b>מכרז</b>&nbsp;&#1502;&#1505;׳ 7'), 'מכרז מס׳ 7');
  assert.strictEqual(decodeEntities('&amp;&lt;&gt;'), '&<>');
});

test('normKey מנרמל גרשיים ופיסוק להשוואת כפילויות', () => {
  assert.strictEqual(normKey('טמ"ס — מצלמות'), normKey('טמ״ס  מצלמות'));
});

test('hashId יציב בין קריאות ושונה לקלט שונה', () => {
  assert.strictEqual(hashId('abc'), hashId('abc'));
  assert.notStrictEqual(hashId('abc'), hashId('abd'));
  assert.strictEqual(hashId('abc').length, 16);
});

test('daysBetween מחזיר null לקלט שאינו תאריך', () => {
  assert.strictEqual(daysBetween('2026-01-01', '2026-01-11'), 10);
  assert.strictEqual(daysBetween('לא תאריך', '2026-01-01'), null);
});

/* ───────────────────────── התאמת מונחים ───────────────────────── */

const TAX = {
  minScore: 3,
  topics: {
    telecom: { label: 'תקשורת', terms: [['תקשורת', 3], ['סיבים אופטיים', 5]], acronyms: [['MPLS', 5]] },
    infosec: { label: 'אבטחת מידע', terms: [['אבטחת מידע', 5]], acronyms: [['SIEM', 5], ['SOC', 4]] }
  },
  negative: [['קלינאי תקשורת', 8], ['קלינאות תקשורת', 8]]
};

test('מסווג לפי מונח מרכזי, כולל תחיליות עבריות', () => {
  assert.ok(classify('אספקת שירותי תקשורת', TAX).topics.includes('telecom'));
  assert.ok(classify('שדרוג והתקשורת בבתי הספר', TAX).topics.includes('telecom'),
    'תחילית ו/ה צריכה להיתפס');
});

test('ראשי תיבות באנגלית נבדקים כמילה שלמה', () => {
  assert.ok(classify('הקמת SOC ורכישת SIEM', TAX).topics.includes('infosec'));
  assert.ok(!classify('the soccer field', TAX).topics.includes('infosec'),
    '"soc" בתוך מילה אנגלית לא אמור להיתפס');
});

test('מילות שלילה מקזזות את כל הנושאים, לא רק את שלהן', () => {
  const c = classify('מתן שירותי קלינאי תקשורת בגני ילדים', TAX);
  assert.ok(!c.topics.includes('telecom'));
  assert.strictEqual(c.blocked, true);
});

test('טקסט בלי שום התאמה אינו "חסום" — הוא פשוט לא סווג', () => {
  const c = classify('עבודות גינון ותחזוקת שטחים', TAX);
  assert.deepStrictEqual(c.topics, []);
  assert.strictEqual(c.blocked, false,
    'בלי ההבחנה הזו כל פרסום לא מסווג היה נראה כאילו נחסם, ורשימת המועמדים לסקירה הייתה נשארת ריקה');
});

test('termRegex דוחה התאמה שאחריה גרשיים ואות (נתב"ג אינו נתב)', () => {
  assert.ok(termRegex('נתב').test('אספקת נתב לרשת'));
  assert.ok(!termRegex('נתב').test('מכרז זכיינות בנתב״ג'));
});

/* ───────────────────────── תאריכים ───────────────────────── */

test('parseDateNear מעדיף ISO ודוחה תאריך לא חוקי', () => {
  assert.strictEqual(parseDateNear('2026-08-24'), '2026-08-24');
  assert.strictEqual(parseDateNear('מועד אחרון 05/09/2026'), '2026-09-05');
  assert.strictEqual(parseDateNear('עדכון אחרון: 14-07-2026'), '2026-07-14');
  assert.strictEqual(parseDateNear('32/13/2026'), '');
});

test('dateAfterHint מעדיף מועד שטרם חלף מבין כמה היקרויות', () => {
  const hints = /(מועד\s*אחרון|להגשה\s*עד)/;
  const ctx = 'המועד המעודכן להגשה עד 13.6.2024 · מכרז אחר להגשה עד 25/08/2027';
  assert.strictEqual(dateAfterHint(ctx, hints, '2026-08-25'), '2027-08-25',
    'חלון ההקשר בולע פרסומים שכנים — צריך להעדיף את מה שעדיין פתוח');
});

test('dateAfterHint מחזיר מועד שחלף כשאין אחר, כדי שיסווג כ"נסגר" ולא כ"בלי מועד"', () => {
  const hints = /(להגשה\s*עד)/;
  assert.strictEqual(dateAfterHint('להגשה עד 13.6.2024', hints, '2026-08-25'), '2024-06-13');
});

test('dateFromUrl קורא שנה וחודש מנתיב וורדפרס', () => {
  assert.strictEqual(dateFromUrl('https://x.org.il/wp-content/uploads/2026/02/a.pdf'), '2026-02-15');
  assert.strictEqual(dateFromUrl('https://x.muni.il/bids/12'), '');
});

test('yearFromSerial מוציא שנה ממספר מכרז', () => {
  assert.strictEqual(yearFromSerial('07/2024'), '2024-12-31');
  assert.strictEqual(yearFromSerial('12/99'), '');
});

test('BINARY_URL_RE מזהה קישור לקובץ', () => {
  assert.ok(BINARY_URL_RE.test('https://x.il/a/b.pdf'));
  assert.ok(BINARY_URL_RE.test('https://x.il/a/b.docx?v=2'));
  assert.ok(!BINARY_URL_RE.test('https://x.il/bids/17'));
});

/* ───────────────────────── כתובות ───────────────────────── */

test('registrableDomain מכיר בסיומות ישראליות דו־שלביות', () => {
  assert.strictEqual(registrableDomain('tenders.huji.ac.il'), 'huji.ac.il');
  assert.strictEqual(registrableDomain('www.lachish.org.il'), 'lachish.org.il');
  assert.strictEqual(registrableDomain('example.com'), 'example.com');
});

test('sameSite רואה תת־דומיין ו-www כאותו אתר', () => {
  assert.ok(sameSite('https://w3.braude.ac.il/x', 'https://www.braude.ac.il/'));
  assert.ok(!sameSite('https://a.co.il/', 'https://b.co.il/'));
});

test('isSiteRoot ו-sameUrl מתעלמים מקו נטוי מסיים', () => {
  assert.ok(isSiteRoot('https://x.il/'));
  assert.ok(!isSiteRoot('https://x.il/bids'));
  assert.ok(sameUrl('https://x.il/bids/', 'https://x.il/bids'));
});

test('sectionParent מחזיר את עמוד המדור שמעל', () => {
  const u = 'https://x.ac.il/about/%D7%9E%D7%9B%D7%A8%D7%96%D7%99%D7%9D/jobs/';
  assert.ok(sectionParent(u, /(מכרז|tender)/i).endsWith('/'));
  assert.strictEqual(sectionParent('https://x.ac.il/about/news/item', /(מכרז|tender)/i), '');
});

test('lastPathSegment מחזיר את שם העמוד בלבד', () => {
  assert.strictEqual(lastPathSegment('https://x.il/a/b/c'), 'c');
  assert.strictEqual(lastPathSegment('https://x.il/'), '');
});

/* ───────────────────────── קציר ───────────────────────── */

test('harvestAnchors אוסף כותרת, כתובת מוחלטת וחלון הקשר', () => {
  const html = '<div><a href="/bids/1">מכרז לאספקת ציוד תקשורת</a><span>מועד אחרון: 01/12/2026</span></div>';
  const out = harvestAnchors(html, 'https://x.muni.il/bids/');
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].url, 'https://x.muni.il/bids/1');
  assert.ok(out[0].context.includes('01/12/2026'), 'ההקשר חייב לכלול את מה שאחרי הקישור');
});

test('harvestAnchors מדלג על javascript:, mailto: וכותרות קצרות', () => {
  const html = '<a href="javascript:void(0)">מכרזים כאן</a><a href="mailto:a@b.c">כתבו לנו עכשיו</a><a href="/x">קצר</a>';
  assert.strictEqual(harvestAnchors(html, 'https://x.il/').length, 0);
});

test('harvestFeed קורא RSS ו-Atom', () => {
  const rss = '<rss><channel><item><title>מכרז תקשורת</title><link>https://x.il/1</link>' +
              '<description>פרטים</description><pubDate>Mon, 03 Aug 2026 10:00:00 GMT</pubDate></item></channel></rss>';
  const out = harvestFeed(rss);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].url, 'https://x.il/1');
  assert.ok(out[0].context.includes('פרטים'));
});

/* ───────────────────────── גילוי ───────────────────────── */

const VOCAB = compileVocab({
  text: '(מכרז|מיכרז|tenders?)',
  url: '(tender|bids?|מכרז)',
  path: '\\/(bids?|tenders?)(\\/|$|\\?)',
  exact: '^\\s*מכרזים\\s*$',
  active: '(פעילים|פתוחים)',
  archive: '(תוצאות|ארכיון|פרוטוקול|archive|results|protocol)',
  demote: '(דרושים|משרות|jobs?)',
  demoteUnless: '(מכרז|tender)',
  sectionParent: '(מכרז|tender)'
});

const HOME = require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'home.html'), 'utf8');

test('הגילוי בוחר את עמוד המכרזים ולא את הארכיון או הדרושים', () => {
  const ranked = findSectionLinks(HOME, 'https://muni-example.org.il/', VOCAB);
  assert.ok(ranked.length, 'צריך למצוא מועמדים');
  assert.strictEqual(ranked[0].url, 'https://muni-example.org.il/bids/',
    'עמוד /bids/ שכותרתו בדיוק "מכרזים" חייב להיות ראשון בתור');
});

test('ארכיון ודרושים יורדים לסוף התור אבל אינם נמחקים', () => {
  const ranked = findSectionLinks(HOME, 'https://muni-example.org.il/', VOCAB);
  const archive = ranked.find(r => r.url.includes('archive-tenders'));
  assert.ok(archive, 'הארכיון נשאר כמועמד — הדירוג הוא סדר ניסיון ולא סינון');
  assert.ok(archive.score < ranked[0].score);
});

test('דף הבית עצמו ושורש האתר אינם מועמדים', () => {
  const ranked = findSectionLinks(HOME, 'https://muni-example.org.il/', VOCAB);
  assert.ok(!ranked.some(r => isSiteRoot(r.url)));
});

test('demotedOnly מדיח דרושים אבל לא עמוד משולב', () => {
  assert.ok(demotedOnly('דרושים במועצה', VOCAB));
  assert.ok(!demotedOnly('מכרזים ודרושים', VOCAB),
    'ברשויות רבות זה אותו עמוד — הדחה שלו הייתה מאבדת את המקור');
});

/* ───────────────────────── תאריכים מהכותרת ───────────────────────── */

// באתרים רבים המועד כתוב בתוך טקסט הקישור עצמו, והכותרת שייכת לפריט הזה בלבד
// בעוד שחלון ההקשר בולע את שכניו. נצפה באשכול רשויות נגב מערבי: הכותרת נשאה
// את המועד הנכון, ההקשר לא, והפריט נכנס כאילו אין לו מועד — מכרז שפג לפני
// יותר משנה. `item.context || item.title` לא תפס את זה כי ההקשר לא היה ריק.
test('מועד שבכותרת גובר על חלון ההקשר', () => {
  const hints = compileDateHints({
    deadlineHints: '(מועד\\s*אחרון|תאריך\\s*אחרון|להגשה\\s*עד|מועד\\s*הגשה)',
    publishHints: '(תאריך\\s*פרסום)'
  });
  const today = '2026-08-26';

  const item = {
    title: "מכרז משותף 6/25 — שירותי DPO | תאריך אחרון להגשה: 24/06/2025",
    context: 'פריט שכן כלשהו . מועד אחרון להגשה 30/11/2026 . פריט שכן נוסף',
    url: 'https://x.org.il/f.pdf'
  };
  assert.strictEqual(extractDates(item, hints, today).deadlineAt, '2025-06-24',
    'המועד נלקח מהכותרת ולא מהשכן שבהקשר');

  // בלי מועד בכותרת — ההקשר עדיין משמש, כמו קודם
  const noTitleDate = { title: 'מכרז לאספקת ציוד', context: 'מועד אחרון להגשה 30/11/2026', url: 'https://x.org.il/a' };
  assert.strictEqual(extractDates(noTitleDate, hints, today).deadlineAt, '2026-11-30');

  // ובלי תאריך בשום מקום — ריק, ולא נפילה
  const none = { title: 'מכרז לאספקת ציוד', context: '', url: 'https://x.org.il/a' };
  assert.strictEqual(extractDates(none, hints, today).deadlineAt, '');
});

// עשרה מקורות מוניציפליים נפלו ימים ברצף עם "fetch failed" ותו לא. הסיבה יושבת
// ב-cause, וכל עוד היא לא צורפה להודעה כל הכשלים נראו בדוח כתקלה אחת.
test('כשל רשת מדווח את סיבתו', async () => {
  const client = net.createClient({ retries: 0, timeoutMs: 200 });
  // כתובת שלא ניתנת ליישוב — הכשל הוא DNS, ולא תלוי ברשת חיצונית
  await assert.rejects(
    () => client.fetchText('https://אין-כזה-אתר.invalid/'),
    err => /fetch failed \(/.test(err.message) || err.name === 'AbortError'
  );
});
