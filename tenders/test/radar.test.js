'use strict';
/**
 * בדיקות לליבת ראדאר המכרזים — סיווג נושאים, מילות שלילה, חילוץ תאריכים ומיזוג היסטוריה.
 * הרצה:  node --test tenders/test/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const R = require('../../.github/scripts/tenders-fetch.js');
const KW = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'keywords.json'), 'utf8'));

const topicsOf = text => R.classify(text, KW).topics;

test('מזהה מכרז תקשורת לפי מונח מרכזי', () => {
  const c = R.classify('מכרז פומבי 12/2026 – אספקת שירותי תקשורת נתונים וסיבים אופטיים', KW);
  assert.ok(c.topics.includes('telecom'), 'צפוי נושא תקשורת, קיבלנו: ' + c.topics.join(','));
  assert.ok(c.score >= 5);
});

test('מזהה אבטחת מידע גם לפי ראשי תיבות באנגלית', () => {
  assert.ok(topicsOf('הזמנה להציע הצעות להקמת SOC ורכישת מערכת SIEM').includes('infosec'));
  assert.ok(topicsOf('מכרז לאספקת שירותי EDR ובקרת DLP לארגון').includes('infosec'));
});

test('מזהה ציוד תקשורת', () => {
  assert.ok(topicsOf('מכרז לרכישת ציוד תקשורת – מתגים ונתבים מתוצרת Cisco').includes('equipment'));
});

test('מזהה IT ומערכות מידע', () => {
  assert.ok(topicsOf('מכרז מסגרת לשירותי מחשוב, רישוי תוכנה ווירטואליזציה').includes('it'));
});

test('קלינאות תקשורת נחסמת ואינה מדווחת כמכרז תקשורת', () => {
  const c = R.classify('מכרז למתן שירותי קלינאי תקשורת בגני ילדים', KW);
  assert.ok(!c.topics.includes('telecom'), 'קלינאות תקשורת לא אמורה להיכנס לנושא תקשורת');
});

test('תקשורת שיווקית ויחסי ציבור נחסמים', () => {
  const c = R.classify('מכרז לניהול תקשורת שיווקית ויחסי ציבור לעירייה', KW);
  assert.ok(!c.topics.includes('telecom'));
});

test('שירותי שמירה ואבטחה פיזית אינם אבטחת מידע', () => {
  const c = R.classify('מכרז לאספקת שירותי שמירה ואבטחה ומאבטחים למוסדות חינוך', KW);
  assert.ok(!c.topics.includes('infosec'));
});

test('מכרז ניקיון או גינון אינו נכנס לראדאר בכלל', () => {
  assert.deepStrictEqual(topicsOf('מכרז לביצוע עבודות גינון וניקיון במרחב הציבורי'), []);
});

test('תחיליות עברית מזוהות (ה/ל/ב/ו)', () => {
  assert.ok(topicsOf('הזמנה להציע הצעות בתחום התקשורת והמיחשוב').includes('telecom'));
  assert.ok(topicsOf('מכרז לאבטחת מידע ולהגנת סייבר').includes('infosec'));
});

test('סיומות נטייה מזוהות', () => {
  assert.ok(topicsOf('מכרז לאספקת פתרונות תקשורתיים ותשתיות תקשורת').includes('telecom'));
});

test('ראשי תיבות באותיות גדולות אינם מותאמים לטקסט אנגלי רגיל', () => {
  // "it" בתוך מילה/משפט באנגלית לא ייחשב כ-IT
  const c = R.classify('A tender for cleaning services, it includes daily work', KW);
  assert.ok(!c.topics.includes('it'), 'התאמת שווא ל-IT');
});

test('שער המכרז מזהה ניסוחים נפוצים', () => {
  assert.ok(R.looksLikeTender('הזמנה להציע הצעות לאספקת שרתים', KW));
  assert.ok(R.looksLikeTender('קול קורא לספקי תקשורת', KW));
  assert.ok(R.looksLikeTender('בקשה לקבלת מידע RFI', KW));
  assert.ok(!R.looksLikeTender('דף הבית של העירייה', KW));
});

test('חילוץ תאריכים בפורמטים שונים', () => {
  assert.strictEqual(R.parseDateNear('מועד אחרון 05/09/2026'), '2026-09-05');
  assert.strictEqual(R.parseDateNear('פורסם 2026-03-01'), '2026-03-01');
  assert.strictEqual(R.parseDateNear('7.4.26'), '2026-04-07');
  assert.strictEqual(R.parseDateNear('אין כאן תאריך'), '');
  assert.strictEqual(R.parseDateNear('32/13/2026'), '', 'תאריך לא חוקי נדחה');
});

test('תאריך הגשה נלקח מהביטוי הנכון ולא מהתאריך הראשון בטקסט', () => {
  const ctx = 'תאריך פרסום 01/03/2026 | מועד אחרון להגשת הצעות 20/04/2026 | סבב שאלות';
  assert.strictEqual(R.dateAfterHint(ctx, R.DEADLINE_HINTS), '2026-04-20');
  assert.strictEqual(R.dateAfterHint(ctx, R.PUBLISH_HINTS), '2026-03-01');
});

test('חילוץ מספר מכרז', () => {
  assert.strictEqual(R.extractTenderNumber('מכרז פומבי מס׳ 19/2026 לאספקת תקשורת'), '19/2026');
  assert.strictEqual(R.extractTenderNumber('הליך 7/26 – ציוד'), '7/26');
  assert.strictEqual(R.extractTenderNumber('מכרז לאספקת ציוד'), '');
});

test('קציר קישורים מדף HTML מפיק כותרת, קישור מוחלט והקשר', () => {
  const html = `
    <ul>
      <li><a href="/tenders/12">מכרז פומבי 12/2026 לאספקת שירותי תקשורת</a>
          <span>מועד אחרון להגשה 20/04/2026</span></li>
      <li><a href="javascript:void(0)">לא רלוונטי</a></li>
      <li><a href="/x">קצר</a></li>
    </ul>`;
  const items = R.harvestAnchors(html, 'https://example.gov.il/list');
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].url, 'https://example.gov.il/tenders/12');
  assert.ok(items[0].title.includes('שירותי תקשורת'));
  assert.ok(items[0].context.includes('20/04/2026'));
});

test('קציר קישורים מפענח ישויות HTML ומסיר תגיות פנימיות', () => {
  const html = `<a href="/t/1"><strong>מכרז</strong> לאספקת ציוד תקשורת &amp; מתגים</a>`;
  const items = R.harvestAnchors(html, 'https://example.gov.il/');
  assert.strictEqual(items[0].title, 'מכרז לאספקת ציוד תקשורת & מתגים');
});

test('buildRecord מסנן פרסום שאינו מכרז כשהמקור אינו ייעודי', () => {
  const source = { id: 's1', name: 'מקור', allTenders: false };
  const notTender = R.buildRecord(
    { title: 'עמוד מידע על תשתיות תקשורת בעיר', url: 'https://a.gov.il/1', context: '' }, source, KW);
  assert.strictEqual(notTender, null);

  const isTender = R.buildRecord(
    { title: 'מכרז לאספקת תשתיות תקשורת בעיר', url: 'https://a.gov.il/2', context: '' }, source, KW);
  assert.ok(isTender && isTender.topics.includes('telecom'));
});

test('buildRecord מייצר מזהה יציב לאותו מכרז', () => {
  const source = { id: 's1', name: 'מקור', allTenders: true };
  const item = { title: 'מכרז 19/2026 – אבטחת מידע', url: 'https://a.gov.il/19', context: '' };
  const a = R.buildRecord(item, source, KW);
  const b = R.buildRecord({ ...item, url: 'https://a.gov.il/19?ref=x' }, source, KW);
  assert.strictEqual(a.id, b.id, 'אותו מספר מכרז ואותו אתר → אותו מזהה');
});

test('מיזוג היסטוריה שומר firstSeen ומסמן מה נראה כרגע', () => {
  const current = [{ id: 'a', title: 'א', score: 5, topics: ['it'], firstSeen: '2099-01-01', lastSeen: '2099-01-01' }];
  const prev = new Map([['a', { id: 'a', title: 'א', score: 5, topics: ['it'], firstSeen: '2020-05-05', lastSeen: '2020-05-05' }]]);
  const merged = R.mergeWithHistory(current, prev);
  assert.strictEqual(merged[0].firstSeen, '2020-05-05', 'firstSeen המקורי נשמר');
});

test('מיזוג היסטוריה מסלק רשומות ישנות שמועד ההגשה שלהן חלף', () => {
  const prev = new Map([['old', {
    id: 'old', title: 'מכרז שפג', score: 5, topics: ['it'],
    firstSeen: '2020-01-01', lastSeen: '2020-01-02', deadlineAt: '2020-02-01'
  }]]);
  const merged = R.mergeWithHistory([], prev);
  assert.strictEqual(merged.length, 0);
});

test('summarize מונה פתוחים וקרובים לסגירה', () => {
  const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const far = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const s = R.summarize([
    { topics: ['it'], deadlineAt: soon, firstSeen: '2020-01-01' },
    { topics: ['it', 'telecom'], deadlineAt: far, firstSeen: '2020-01-01' },
    { topics: ['telecom'], deadlineAt: '', firstSeen: '2020-01-01' }
  ]);
  assert.strictEqual(s.total, 3);
  assert.strictEqual(s.open, 2);
  assert.strictEqual(s.closingSoon, 1);
  assert.strictEqual(s.byTopic.telecom, 2);
});

test('סינון מקצה לקצה על דף רשימה מציאותי — נשמרים רק המכרזים הרלוונטיים', () => {
  const html = `
  <table>
    <tr><td><a href="/t/101">מכרז פומבי 14/2026 – אספקה והתקנה של ציוד תקשורת ומתגים</a></td>
        <td>תאריך פרסום 01/08/2026</td><td>מועד אחרון להגשה 15/09/2026</td></tr>
    <tr><td><a href="/t/102">מכרז 15/2026 – שירותי קלינאי תקשורת במסגרות החינוך</a></td>
        <td>מועד אחרון להגשה 20/09/2026</td></tr>
    <tr><td><a href="/t/103">מכרז 16/2026 – הקמת מערך הגנת סייבר ומוקד SOC</a></td>
        <td>מועד אחרון להגשה 01/10/2026</td></tr>
    <tr><td><a href="/t/104">מכרז 17/2026 – עבודות גינון וניקיון בשצ״פים</a></td>
        <td>מועד אחרון להגשה 05/10/2026</td></tr>
    <tr><td><a href="/t/105">מכרז 18/2026 – מיקור חוץ לשירותי מחשוב ותמיכה טכנית</a></td>
        <td>מועד אחרון להגשה 10/10/2026</td></tr>
    <tr><td><a href="/t/106">מכרז 19/2026 – שירותי הסעות תלמידים</a></td>
        <td>מועד אחרון להגשה 12/10/2026</td></tr>
  </table>`;

  const source = { id: 'muni', name: 'עירייה לדוגמה', category: 'רשויות מקומיות', allTenders: true };
  const kept = R.harvestAnchors(html, 'https://muni.example.il/tenders')
    .map(a => R.buildRecord({
      title: a.title, url: a.url, context: a.context,
      publishedAt: R.dateAfterHint(a.context, R.PUBLISH_HINTS),
      deadlineAt: R.dateAfterHint(a.context, R.DEADLINE_HINTS)
    }, source, KW))
    .filter(Boolean);

  const nums = kept.map(t => t.tenderNumber).sort();
  assert.deepStrictEqual(nums, ['14/2026', '16/2026', '18/2026'],
    'צפויים רק מכרזי ציוד תקשורת, סייבר ומחשוב. קיבלנו: ' + JSON.stringify(kept.map(t => t.title)));

  const equipment = kept.find(t => t.tenderNumber === '14/2026');
  assert.ok(equipment.topics.includes('equipment'));
  assert.strictEqual(equipment.publishedAt, '2026-08-01');
  assert.strictEqual(equipment.deadlineAt, '2026-09-15');
  assert.ok(equipment.matched.length > 0, 'נשמרות מילות המפתח שהתאימו');
});

test('רשומות של מקור שנוטרל יורדות מיד ולא ממתינות לתפוגת ההיסטוריה', () => {
  const prev = new Map([
    ['keep', { id: 'keep', source: 'active-src', title: 'נשמר', score: 5, topics: ['it'], firstSeen: '2020-01-01', lastSeen: new Date().toISOString().slice(0,10) }],
    ['drop', { id: 'drop', source: 'disabled-src', title: 'יורד', score: 5, topics: ['it'], firstSeen: '2020-01-01', lastSeen: new Date().toISOString().slice(0,10) }]
  ]);
  const merged = R.mergeWithHistory([], prev, new Set(['active-src']));
  assert.deepStrictEqual(merged.map(t => t.id), ['keep']);
});

test('בלי רשימת מקורות פעילים ההיסטוריה נשמרת כרגיל', () => {
  const today = new Date().toISOString().slice(0,10);
  const prev = new Map([['a', { id: 'a', source: 'x', title: 'א', score: 5, topics: ['it'], firstSeen: '2020-01-01', lastSeen: today }]]);
  assert.strictEqual(R.mergeWithHistory([], prev).length, 1);
});

test('נתיב קישור של מכרז מזוהה, וקישורי ניווט באתר נדחים', () => {
  assert.ok(R.looksLikeTenderUrl('https://www.iaa.gov.il/tenders-and-contracts/tenders-collections/tenders/log_hoze_200007058/'));
  assert.ok(R.looksLikeTenderUrl('https://www2.haifa.muni.il/Michrazim/Default.aspx'));
  assert.ok(R.looksLikeTenderUrl('https://x.gov.il/%D7%9E%D7%9B%D7%A8%D7%96%D7%99%D7%9D/123'));
  assert.ok(!R.looksLikeTenderUrl('https://www.iaa.gov.il/airports/ben-gurion/businesses/electronics-and-cellular/'));
  assert.ok(!R.looksLikeTenderUrl('https://www.iaa.gov.il/airports/ben-gurion/picturesbgn/'));
});

test('בדף מכרזים ייעודי קישור ניווט שמכיל מילת מפתח נדחה', () => {
  const src = { id: 'iaa', name: 'רש"ת', allTenders: true };
  // קישורי ניווט אמיתיים שנתפסו באבחון על אתר רשות שדות התעופה
  assert.strictEqual(R.buildRecord({ title: 'אלקטרוניקה וסלולר', url: 'https://www.iaa.gov.il/airports/ben-gurion/businesses/electronics-and-cellular/', context: '' }, src, KW), null);
  assert.strictEqual(R.buildRecord({ title: 'מערכת ניהול סביבתי', url: 'https://www.iaa.gov.il/environment-and-sustainability/environmental-management-systems/', context: '' }, src, KW), null);
  // מכרז אמיתי מאותו אתר עובר
  const real = R.buildRecord({ title: 'מכרז פומבי למתן שירותי תקשורת ומחשוב עבור רשות שדות התעופה', url: 'https://www.iaa.gov.il/tenders-and-contracts/tenders-collections/tenders/log_200007058/', context: '' }, src, KW);
  assert.ok(real && real.topics.length, 'מכרז אמיתי אמור לעבור את השער');
});

test('חלון ההקשר גדול דיו לתפוס תאריכים בתאים הבאים של שורת טבלה עתירת מארקאפ', () => {
  // שורה בסגנון האתרים האמיתיים: כותרת ארוכה ואחריה מארקאפ עתיר תכונות, ואז תאי התאריכים
  const html = `<tr><td scope="row"><a href="/tenders-and-contracts/tenders/log_1/">מכרז פומבי להתקשרות בחוזה מסגרת למתן שירותי תקשורת נתונים וסיבים אופטיים עבור רשות שדות התעופה</a>
    <button type="button" class="btn d-lg-none js-toggle-row collapsed" data-bs-toggle="collapse" data-bs-target="#row-1" aria-expanded="false" aria-controls="row-1"><span class="visually-hidden">הצג פרטים</span></button></td>
    <td class="text-nowrap d-none d-lg-table-cell"><span class="label">תאריך פרסום</span> 02/08/2026</td>
    <td class="text-nowrap d-none d-lg-table-cell"><span class="label">תאריך אחרון להגשה</span> 17/09/2026</td></tr>`;
  const a = R.harvestAnchors(html, 'https://www.iaa.gov.il/list')[0];
  assert.ok(a.context.includes('17/09/2026'), 'תאריך ההגשה חייב להיכנס לחלון ההקשר');
  assert.strictEqual(R.dateAfterHint(a.context, R.DEADLINE_HINTS), '2026-09-17');
  assert.strictEqual(R.dateAfterHint(a.context, R.PUBLISH_HINTS), '2026-08-02');
});

test('ראשי תיבות עבריות אינן יוצרות התאמת שווא (נתב"ג ≠ נתב)', () => {
  // הבאג שהתגלה בסריקה אמיתית: 32 מכרזי זכיינות בנמל התעופה סומנו כ"ציוד תקשורת"
  for (const t of ['נתב״ג', 'נתב"ג']) {
    const c = R.classify(`מכרז להפעלת חנות גלידה באולם הנוסעים ב${t}`, KW);
    assert.deepStrictEqual(c.topics, [], `"${t}" לא אמור להתאים למונח "נתב"`);
  }
  assert.deepStrictEqual(R.classify('מכרז להדברת מזיקים וטיפול בבעלי חיים בנתב"ג', KW).topics, []);
  assert.deepStrictEqual(R.classify('מכרז לאספקת גז טבעי להפעלת המנוע החמישי בנתב״ג', KW).topics, []);
});

test('נתב אמיתי כן מזוהה', () => {
  assert.ok(R.classify('מכרז לאספקת נתב לסניף', KW).topics.includes('equipment'));
  assert.ok(R.classify('מכרז לאספקת נתבים ומתגים', KW).topics.includes('equipment'));
});

test('מונח בתוך מירכאות עדיין מזוהה', () => {
  assert.ok(R.classify('מכרז למתן "שירותי תקשורת" לרשות', KW).topics.includes('telecom'));
});

test('ניטור מדיה, ביטוח סייבר ותמיכה טכנית גנרית אינם נכנסים לראדאר', () => {
  // כל השלושה נמצאו כהתאמות שווא בסריקה אמיתית
  assert.deepStrictEqual(R.classify('מכרז 3/2026 לניטור ומחקר מידע תקשורתי', KW).topics, []);
  assert.deepStrictEqual(R.classify('מכרז למתן שירותי ביטוח סייבר עבור הרשות', KW).topics, []);
  assert.deepStrictEqual(R.classify('אספקת ח"ח, הדרכה ותמיכה טכנית למערכת שינוע', KW).topics, []);
});

test('תמיכה טכנית בהקשר מחשובי כן נכנסת', () => {
  assert.ok(R.classify('מכרז לשירותי מחשוב ותמיכה טכנית לתחנות קצה', KW).topics.includes('it'));
  assert.ok(R.classify('הקמת מוקד תמיכה למערכות מידע', KW).topics.includes('it'));
});

test('מכרזי סייבר אמיתיים לא נפגעו מהשלילה של ביטוח סייבר', () => {
  assert.ok(R.classify('מכרז להקמת מערך הגנת סייבר ומוקד SOC', KW).topics.includes('infosec'));
  assert.ok(R.classify('מכרז לשירותי אבטחת מידע וסייבר', KW).topics.includes('infosec'));
});

test('רשומות בהיסטוריה נבדקות מחדש מול התצורה הנוכחית', () => {
  const today = new Date().toISOString().slice(0,10);
  const prev = new Map([
    ['stale', { id:'stale', source:'s', title:'מכרז להפעלת חנות גלידה בנתב"ג', score:4, topics:['equipment'], firstSeen:'2020-01-01', lastSeen:today }],
    ['good',  { id:'good',  source:'s', title:'מכרז לאספקת נתבים ומתגים',      score:9, topics:['equipment'], firstSeen:'2020-01-01', lastSeen:today }]
  ]);
  const merged = R.mergeWithHistory([], prev, new Set(['s']), KW);
  assert.deepStrictEqual(merged.map(t => t.id), ['good'],
    'רשומה שכבר אינה עומדת בסינון המעודכן אמורה לרדת מההיסטוריה');
});

test('בדיקה מחדש מרעננת נושאים וניקוד של רשומה שנשמרה', () => {
  const today = new Date().toISOString().slice(0,10);
  const prev = new Map([['a', { id:'a', source:'s', title:'מכרז לאספקת שירותי תקשורת וסיבים אופטיים', score:1, topics:['it'], matched:[], firstSeen:'2020-01-01', lastSeen:today }]]);
  const merged = R.mergeWithHistory([], prev, new Set(['s']), KW);
  assert.ok(merged[0].topics.includes('telecom'), 'הנושאים מתעדכנים לפי התצורה הנוכחית');
  assert.ok(merged[0].score > 1);
});

test('קישורי ניווט שנשמרו בהיסטוריה יורדים כששער המכרז מוקשח', () => {
  const today = new Date().toISOString().slice(0,10);
  const prev = new Map([
    ['nav1', { id:'nav1', source:'iaa', title:'אלקטרוניקה וסלולר', url:'https://www.iaa.gov.il/airports/ben-gurion/businesses/electronics-and-cellular/', score:4, topics:['telecom'], firstSeen:'2020-01-01', lastSeen:today }],
    ['nav2', { id:'nav2', source:'iaa', title:'להורדת אפליקציה App Store', url:'https://apps.apple.com/il/app/x', score:3, topics:['it'], firstSeen:'2020-01-01', lastSeen:today }],
    ['real', { id:'real', source:'iaa', title:'מכרז לאספקת שירותי תקשורת', url:'https://www.iaa.gov.il/tenders/123/', score:8, topics:['telecom'], firstSeen:'2020-01-01', lastSeen:today }]
  ]);
  const merged = R.mergeWithHistory([], prev, new Set(['iaa']), KW);
  assert.deepStrictEqual(merged.map(t => t.id), ['real']);
});

test('תבנית קישור ייעודית למקור מאפשרת לזהות מכרזים בכתובות ללא מילה מזהה', () => {
  const pat = '/ilgstorefront/[a-z]{2}/p/\\d+';
  // כתובת מכרז אמיתית ממנהל הרכש הממשלתי
  assert.ok(R.looksLikeTenderUrl('https://mr.gov.il/ilgstorefront/he/p/4000620724', pat));
  assert.ok(!R.looksLikeTenderUrl('https://mr.gov.il/ilgstorefront/he/login', pat));
  // בלי תבנית ייעודית — אותה כתובת נדחית ע"י השער הכללי
  assert.ok(!R.looksLikeTenderUrl('https://mr.gov.il/ilgstorefront/he/p/4000620724'));
  // תבנית שגויה לא מפילה את הבדיקה, נופלת חזרה לברירת המחדל
  assert.ok(R.looksLikeTenderUrl('https://x.gov.il/tenders/5', '([unclosed'));
});

test('buildRecord מקבל מכרז ממקור עם תבנית קישור ייעודית', () => {
  const src = { id:'mr-gov', name:'מנהל הרכש', allTenders:true, linkPattern:'/ilgstorefront/[a-z]{2}/p/\\d+' };
  const rec = R.buildRecord({ title:'רכישת מחשבים ניידים', url:'https://mr.gov.il/ilgstorefront/he/p/4000620724', context:'' }, src, KW);
  assert.ok(rec && rec.topics.includes('it'), 'מכרז אמיתי בכתובת מספרית אמור לעבור את השער');
});

test('גילוי עמוד המכרזים מדף הבית של רשות מקומית', () => {
  const home = `
    <nav>
      <a href="/he/residents">תושבים</a>
      <a href="/he/education">חינוך</a>
      <a href="/he/business/michrazim">מכרזים</a>
      <a href="/he/about">אודות העירייה</a>
      <a href="https://facebook.com/city/tenders">עקבו אחרינו</a>
      <a href="/files/tender-14-2026.pdf">מכרז 14/2026 מסמכים</a>
    </nav>`;
  const links = R.findTenderLinks(home, 'https://www.city.muni.il/');
  assert.ok(links.length, 'צריך לאתר לפחות קישור אחד');
  assert.strictEqual(links[0].url, 'https://www.city.muni.il/he/business/michrazim',
    'הקישור שהטקסט שלו הוא בדיוק "מכרזים" הוא עמוד הרשימה');
  assert.ok(!links.some(l => l.url.includes('facebook.com')), 'לא יוצאים לדומיין חיצוני');
  assert.ok(!links.some(l => l.url.endsWith('.pdf')), 'לא יורדים לקובץ של מכרז בודד');
});

test('גילוי מזהה גם כתובת מכרזים שהטקסט שלה שונה', () => {
  const home = `<a href="/Tenders/Pages/default.aspx">הזדמנויות עסקיות וספקים</a>`;
  const links = R.findTenderLinks(home, 'https://www.city.muni.il/');
  assert.strictEqual(links.length, 1);
  assert.ok(links[0].url.includes('/Tenders/'));
});

test('דף בית בלי קישור למכרזים אינו מחזיר מועמדים', () => {
  const home = `<a href="/he/education">חינוך</a><a href="/he/sport">ספורט</a>`;
  assert.deepStrictEqual(R.findTenderLinks(home, 'https://www.city.muni.il/'), []);
});

test('בדיקה מחדש של ההיסטוריה מכבדת את allTenders של המקור', () => {
  const today = new Date().toISOString().slice(0,10);
  // רשומות אמיתיות שנתפסו מדפי ועדות/מסמכים של רשויות: הכותרת אינה מכרז,
  // אבל הקישור יושב על נתיב /bids/ ולכן שער הקישור לבדו אישר אותן.
  const prev = new Map([
    ['junk1', { id:'junk1', source:'muni', title:'אגף מחשוב ומערכות מידע', url:'https://x.org.il/bids/1', score:5, topics:['it'], firstSeen:'2020-01-01', lastSeen:today }],
    ['junk2', { id:'junk2', source:'muni', title:'טופס הסכמה לשימוש באפליקציה למלווים', url:'https://x.org.il/bids/2', score:3, topics:['it'], firstSeen:'2020-01-01', lastSeen:today }],
    ['real',  { id:'real',  source:'muni', title:'מכרז 8/2026 לאספקת ציוד תקשורת', url:'https://x.org.il/bids/3', score:9, topics:['equipment'], firstSeen:'2020-01-01', lastSeen:today }]
  ]);
  // מקור discover — allTenders=false, ולכן נדרש ניסוח מכרז בכותרת
  const strict = new Map([['muni', { id:'muni', allTenders: false }]]);
  assert.deepStrictEqual(R.mergeWithHistory([], prev, strict, KW).map(t => t.id), ['real']);

  // מקור שכל הדף שלו מכרזים — שער הקישור עדיין תקף
  const loose = new Map([['muni', { id:'muni', allTenders: true }]]);
  assert.strictEqual(R.mergeWithHistory([], prev, loose, KW).length, 3);
});

test('"התקשרות" לבדה אינה מסמנת פרסום כמכרז', () => {
  assert.ok(!R.looksLikeTender('מדריך לאבטחת מידע באשר להתקשרות עם גורם חיצוני', KW));
  assert.ok(R.looksLikeTender('הודעה על התקשרות עם ספק יחיד לאספקת רישוי תוכנה', KW));
  assert.ok(R.looksLikeTender('התקשרות בפטור ממכרז — שירותי תקשורת', KW));
});

test('הודעת פטור ממכרז אינה נכנסת לראדאר כלל', () => {
  const src = { id: 'iaa', name: 'רש"ת', allTenders: true };
  // כתובת אמיתית מרשות שדות התעופה — הודעת פטור, לא מכרז להגשה
  const exempt = R.buildRecord({
    title: 'מתן שירותי מחשוב וייעוץ בתחום התקשוב עבור רש"ת',
    url: 'https://www.iaa.gov.il/tenders-and-contracts/tenders-collections/exemption-notifications/log_1/',
    context: ''
  }, src, KW);
  assert.strictEqual(exempt, null, 'הודעת פטור נדחית');

  const intent = R.buildRecord({
    title: 'הודעה על כוונה להתקשר עם ספק יחיד לאספקת רישוי תוכנה',
    url: 'https://x.gov.il/tenders/5', context: ''
  }, src, KW);
  assert.strictEqual(intent, null, 'כוונת התקשרות נדחית');

  // מכרז פומבי באותו אתר כן נכנס
  const real = R.buildRecord({
    title: 'מכרז פומבי לאספקת שירותי תקשורת ומחשוב',
    url: 'https://www.iaa.gov.il/tenders-and-contracts/tenders-collections/tenders/log_2/', context: ''
  }, src, KW);
  assert.ok(real && real.kind === 'tender', 'מכרז פומבי נשמר');
});

test('הודעות פטור שכבר במאגר יורדות בסריקה הבאה', () => {
  const today = new Date().toISOString().slice(0, 10);
  const prev = new Map([
    ['ex', { id:'ex', source:'iaa', kind:'exemption', title:'מכרז לאספקת ציוד תקשורת',
             url:'https://www.iaa.gov.il/tenders-and-contracts/tenders-collections/exemption-notifications/a/',
             score:9, topics:['equipment'], firstSeen:'2020-01-01', lastSeen:today }],
    ['ok', { id:'ok', source:'iaa', kind:'tender', title:'מכרז לאספקת ציוד תקשורת',
             url:'https://www.iaa.gov.il/tenders-and-contracts/tenders-collections/tenders/b/',
             score:9, topics:['equipment'], firstSeen:'2020-01-01', lastSeen:today }]
  ]);
  const active = new Map([['iaa', { id:'iaa', allTenders:true }]]);
  assert.deepStrictEqual(R.mergeWithHistory([], prev, active, KW).map(t => t.id), ['ok']);
});

test('מכרז שהמקור מדווח עליו "חלף מועד הגשה" אינו נכנס', () => {
  const src = { id: 'mr-gov', name: 'מנהל הרכש', allTenders: true, linkPattern: '/ilgstorefront/[a-z]{2}/p/\\d+' };
  // ההקשר האמיתי כפי שהוא מגיע מאתר מנהל הרכש
  const closed = 'מכרז פומבי אספקת ציוד תקשורת אקטיבי שם המפרסם: משרד האוצר מס׳ פרסום: 4000618789 | סטטוס: חלף מועד הגשה | מס׳ הליך: 37-2026 | תאריך פרסום: 25/06/2026';
  const open   = 'מכרז פומבי אספקת ציוד תקשורת אקטיבי שם המפרסם: משרד האוצר מס׳ פרסום: 4000620724 | סטטוס: עודכן | מס׳ הליך: 01-2026 | תאריך פרסום: 10/08/2026';

  assert.strictEqual(R.extractStatus(closed), 'חלף מועד הגשה');
  assert.strictEqual(R.extractStatus(open), 'עודכן');
  assert.ok(R.isClosedStatus('חלף מועד הגשה'));
  assert.ok(!R.isClosedStatus('עודכן'));
  assert.ok(!R.isClosedStatus(''));

  const url = 'https://mr.gov.il/ilgstorefront/he/p/4000618789';
  assert.strictEqual(
    R.buildRecord({ title: 'אספקת ציוד תקשורת אקטיבי עבור משרדי הממשלה', url, context: closed }, src, KW),
    null, 'מכרז שחלף מועדו נדחה');
  const rec = R.buildRecord({ title: 'אספקת ציוד תקשורת אקטיבי עבור משרדי הממשלה', url, context: open }, src, KW);
  assert.ok(rec && rec.status === 'עודכן', 'מכרז פעיל נשמר עם הסטטוס שלו');
});

test('מכרזים סגורים שכבר במאגר יורדים בסריקה הבאה', () => {
  const today = new Date().toISOString().slice(0, 10);
  const prev = new Map([
    ['closed', { id:'closed', source:'mr-gov', kind:'tender', status:'חלף מועד הגשה',
                 title:'מכרז לאספקת ציוד תקשורת', url:'https://mr.gov.il/ilgstorefront/he/p/1',
                 score:9, topics:['equipment'], firstSeen:'2020-01-01', lastSeen:today }],
    ['open',   { id:'open', source:'mr-gov', kind:'tender', status:'עודכן',
                 title:'מכרז לאספקת ציוד תקשורת', url:'https://mr.gov.il/ilgstorefront/he/p/2',
                 score:9, topics:['equipment'], firstSeen:'2020-01-01', lastSeen:today }]
  ]);
  const active = new Map([['mr-gov', { id:'mr-gov', allTenders:true, linkPattern:'/ilgstorefront/[a-z]{2}/p/\\d+' }]]);
  assert.deepStrictEqual(R.mergeWithHistory([], prev, active, KW).map(t => t.id), ['open']);
});

test('רק מכרז שאפשר להגיש אליו נשמר', () => {
  const future = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  const past   = new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10);
  const recent = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
  const old    = new Date(Date.now() - 200 * 86400000).toISOString().slice(0, 10);

  assert.ok(R.isActionable({ deadlineAt: future }), 'מועד עתידי');
  assert.ok(!R.isActionable({ deadlineAt: past }), 'מועד שחלף');
  // בלי מועד: נשמר רק אם פורסם לאחרונה ובסטטוס פעיל
  assert.ok(R.isActionable({ deadlineAt: '', status: 'פורסם', publishedAt: recent }));
  assert.ok(!R.isActionable({ deadlineAt: '', status: 'פורסם', publishedAt: old }), 'פרסום ישן');
  assert.ok(!R.isActionable({ deadlineAt: '', status: '', publishedAt: recent }), 'בלי סטטוס פעיל');
  assert.ok(!R.isActionable({ deadlineAt: '', status: 'התקשרות בתוקף', publishedAt: recent }));
  assert.ok(!R.isActionable({ deadlineAt: '' }), 'ארכיון בלי שום סימן');
});

test('"התקשרות בתוקף" נחשבת סגורה — זה חוזה שנחתם ולא מכרז', () => {
  assert.ok(R.isClosedStatus('התקשרות בתוקף'));
  assert.ok(!R.isClosedStatus('פורסם'));
});

test('המשרד המפרסם נחלץ מההקשר ולא נשאר שם המקור', () => {
  const ctx = 'מכרז פומבי אספקת שירותי גישה לאינטרנט שם המפרסם: משרד התקשורת מס׳ פרסום: 4000620190 | סטטוס: עודכן | מס׳ הליך: 10-2026';
  assert.strictEqual(R.extractPublisher(ctx), 'משרד התקשורת');
  assert.strictEqual(R.extractPublisher('בלי מפרסם'), '');

  const src = { id: 'mr-gov', name: 'מנהל הרכש הממשלתי', allTenders: true, linkPattern: '/ilgstorefront/[a-z]{2}/p/\\d+' };
  const rec = R.buildRecord({
    title: 'אספקת שירותי גישה לאינטרנט (ISP)',
    url: 'https://mr.gov.il/ilgstorefront/he/p/4000620190', context: ctx
  }, src, KW);
  assert.strictEqual(rec.publisher, 'משרד התקשורת', 'המשרד המזמין, לא מנהל הרכש');
  assert.strictEqual(rec.sourceName, 'מנהל הרכש הממשלתי', 'שם המקור נשמר בנפרד');
});

// הניסוח המקצועי ברשויות המקומיות ובמוסדות האקדמיים שונה מזה של משרדי הממשלה:
// "תקשוב" במקום IT, "טמ״ס" ו"מוקד רואה" במקום מצלמות אבטחה, "עיר חכמה", "כיתה
// חכמה". בלי המונחים האלה רוב מכרזי הרשויות פשוט לא היו מזוהים כרלוונטיים.
test('הניסוח המוניציפלי והאקדמי מזוהה', () => {
  const hits = [
    ['מכרז פומבי 12/2026 לאספקת שירותי תקשוב לבתי הספר ברשות', 'it'],
    ['מכרז להקמת מערך טמ״ס ומוקד רואה בעיר', 'equipment'],
    ['מכרז מסגרת לאספקה והתקנה של מצלמות וקוראי לוחיות רישוי (LPR)', 'equipment'],
    ['מכרז פומבי להקמת מרכז שליטה ובקרה עירוני', 'infosec'],
    ['מכרז לאספקת מערכת ניהול למידה (LMS) למכללה', 'it'],
    ['מכרז לתשתיות תקשוב ומעבדות מחשבים בקמפוס', 'it'],
    ['מכרז לפרויקט עיר חכמה — חיישנים ותקשורת אלחוטית', 'telecom'],
    ['מכרז לאספקת לוחות חכמים וכיתות חכמות לבתי הספר', 'it']
  ];
  for (const [title, topic] of hits) {
    const c = R.classify(title, KW);
    assert.ok(c.topics.includes(topic), `"${title}" אמור להיות ${topic}, התקבל ${c.topics.join(',') || 'כלום'}`);
  }
});

// המונחים המוניציפליים החדשים שמשמשים גם מחוץ לתחום שלנו נכנסו במשקל נמוך
// בכוונה — הם מסייעים בצירוף אבל לא מספיקים לבדם, אחרת מכרזי השקיה, חניה
// וכוח אדם היו נכנסים לראדאר.
test('מונחים מוניציפליים דו־משמעיים לא נכנסים לבדם', () => {
  const misses = [
    'מכרז להפעלת מערכת שליטה ובקרה להשקיה בגני העיר',
    'מכרז להפעלת חדר בקרה לחניונים עירוניים',
    'דרוש/ה מוקדן/ית למוקד עירוני 106',
    'מכרז לשירותי קלינאי תקשורת במסגרות החינוך'
  ];
  for (const title of misses) {
    const c = R.classify(title, KW);
    assert.strictEqual(c.topics.length, 0, `"${title}" לא אמור להיכנס (${c.topics.join(',')})`);
  }
});

// באתרי מוסדות אקדמיים ורשויות, רוב הפריטים בעמוד המכרזים אינם מכרזים אלא
// נספחים לתהליך שכבר רץ. נמדד על אתר שנקר: שלושת הפריטים שנכנסו לראדאר היו
// מענה לשאלות הבהרה למכרז מ-2022, הודעה על הארכת מועדים, ומכרז מ-2015.
test('מסמך נלווה למכרז אינו מכרז שאפשר להגיש אליו', () => {
  const docs = [
    'מענה לשאלות הבהרה לגבי מכרז 2/2022 לאספקת מחשבים ומתן שירותי תחזוקה',
    'הודעה על הארכת מועדים למכרז אספקת מחשבים ושירותי תחזוקה ואחריות',
    'פרוטוקול ועדת המכרזים בנושא שירותי תקשורת',
    'ריכוז שאלות ותשובות — מכרז תקשוב',
    'תיקון מסמכי המכרז לאספקת ציוד תקשורת'
  ];
  for (const t of docs) {
    assert.strictEqual(R.detectKind(t, ''), 'document', `"${t}" אמור להיות מסמך נלווה`);
    assert.strictEqual(R.buildRecord({ title: t, url: 'https://x.ac.il/t/1', context: '' },
      { id: 's', name: 'מוסד', allTenders: true }, KW), null, 'ולכן אינו נכנס לראדאר');
  }
  // המכרז עצמו כן נכנס
  assert.strictEqual(R.detectKind('מכרז פומבי 4/2026 לאספקת ציוד תקשורת', ''), 'tender');
});

// באתרי מכללות תפריט הניווט מופיע בכל עמוד, כולל בעמוד המכרזים. "בית הספר
// לתקשורת חזותית" ו"החוג לתקשורת" הם שמות חוגים — לא תחום התקשורת שלנו,
// בדיוק כמו קלינאות תקשורת. נמדד באתר שנקר.
test('שמות חוגים ותכניות לימוד אינם נחשבים תקשורת', () => {
  for (const t of ['בית הספר לתקשורת חזותית', 'החוג לתקשורת ועיתונות',
                   'תואר שני בעיצוב תקשורת', 'לימודי תקשורת ומדיה דיגיטלית']) {
    assert.strictEqual(R.classify(t, KW).topics.length, 0, `"${t}" לא אמור להיכנס`);
  }
  // ומכרז אמיתי של אותה מכללה כן נכנס
  assert.ok(R.classify('מכרז לאספקת ציוד תקשורת ומתגים לקמפוס', KW).topics.includes('equipment'));
  assert.ok(R.classify('מכרז פומבי לאספקת מערכת ניהול למידה (LMS) והטמעתה', KW).topics.includes('it'));
});

// בינה מלאכותית היא נושא בפני עצמו ולא תת־סעיף של IT: המכרזים, אנשי הקשר
// והספקים שונים. המונחים הועברו מ-IT לנושא ייעודי והורחבו.
test('נושא הבינה המלאכותית מזוהה', () => {
  const hits = [
    'מכרז פומבי לאספקת פתרונות בינה מלאכותית יוצרת לניתוח מסמכים',
    'מכרז למתן שירותי ייעוץ בתחום למידת מכונה',
    'מכרז להקמת מערכת תמלול אוטומטי וזיהוי דיבור',
    'מכרז לרכש רישיונות Copilot ו-ChatGPT Enterprise',
    'מכרז לפיתוח צ׳אטבוט לשירות התושבים במוקד העירוני',
    'מכרז להטמעת מודל שפה גדול (LLM) עם RAG על מסמכי הארגון',
    'מכרז להקמת מנוע המלצות ומודלים חזויים',
    'ייעוץ וליווי בתחומי טכנולוגיה מתקדמת עבור המטה הלאומי לבינה מלאכותית'
  ];
  for (const t of hits) {
    const c = R.classify(t, KW);
    assert.ok(c.topics.includes('ai'), `"${t}" אמור להיות בינה מלאכותית, התקבל ${c.topics.join(',') || 'כלום'}`);
  }
  assert.ok(KW.topics.ai && KW.topics.ai.label === 'בינה מלאכותית', 'הנושא קיים בטקסונומיה');
});

// שמות חוגים ותכניות לימוד באוניברסיטאות מכילים בדיוק את אותם מונחים, ובאתרי
// המכללות הם מופיעים בכל עמוד דרך תפריט הניווט.
test('תכניות לימוד בבינה מלאכותית אינן מכרזים', () => {
  for (const t of ['תואר שני במערכות בינה מלאכותית', 'המרכז לחקר בינה מלאכותית – AI',
                   'לימודי בינה מלאכותית ומדעי הנתונים', 'תואר ראשון בהנדסת תוכנה']) {
    assert.strictEqual(R.classify(t, KW).topics.length, 0, `"${t}" לא אמור להיכנס`);
  }
  // "ML" לבדו אינו מספיק — הוא גם יחידת נפח
  assert.strictEqual(R.classify('מכרז לאספקת 500 ML של חומר ניקוי', KW).topics.length, 0);
});

// במנהל הרכש הממשלתי החיפוש מילולי: מכרז שאינו מכיל את מילת החיפוש לא מגיע
// לדף התוצאות. תחזוקה ידנית של רשימת השאילתות נגררה אחרי הטקסונומיה — מתוך
// המונחים במשקל 5 ומעלה, "מתגים", "טמ״ס", "מבדקי חדירה" ו"ראייה ממוחשבת"
// לא נשאלו כלל. לכן השאילתות נגזרות מהטקסונומיה עצמה.
test('שאילתות החיפוש נגזרות מהטקסונומיה, בלי כפילויות', () => {
  const src = {
    id: 's', urls: ['https://x/?text=' + encodeURIComponent('תקשורת')],
    searchFromKeywords: { template: 'https://x/?text={term}', minWeight: 5, maxPerTopic: 3, max: 10 }
  };
  const kw = { topics: { t: { terms: [
    ['תקשורת', 9],            // כבר נשאל
    ['שירותי תקשורת', 9],     // צמצום של שאילתה קיימת — לא מוסיף מכרזים
    ['מתגים', 5],
    ['ראיה ממוחשבת', 6],
    ['ראייה ממוחשבת', 6],     // וריאנט כתיב של הקודם
    ['טמ"ס', 5],
    ['טמ״ס', 5],              // וריאנט גרשיים
    ['קישוריות', 3]           // מתחת לסף המשקל
  ] } } };
  const q = u => decodeURIComponent(u).split('text=')[1];
  const out = R.expandSearchUrls(src, kw).urls.map(q);

  assert.ok(out.includes('מתגים'), 'מונח שלא נשאל נוסף');
  assert.ok(!out.includes('שירותי תקשורת'), 'צמצום של שאילתה קיימת מדולג');
  assert.ok(!out.includes('קישוריות'), 'מונח מתחת לסף המשקל מדולג');
  assert.strictEqual(out.filter(x => x.startsWith('רא')).length, 1, 'וריאנט כתיב אחד בלבד');
  assert.strictEqual(out.filter(x => x.startsWith('טמ')).length, 1, 'וריאנט גרשיים אחד בלבד');
  assert.ok(out.length <= 1 + 3, 'תקרת השאילתות לנושא נשמרת');

  // מקור בלי ההגדרה אינו משתנה כלל
  const plain = { id: 'p', urls: ['https://y/'] };
  assert.deepStrictEqual(R.expandSearchUrls(plain, kw).urls, ['https://y/']);
});

test('החיפוש במנהל הרכש מכסה את כל חמשת הנושאים', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'sources.json'), 'utf8'));
  const src = cfg.sources.find(s => s.id === 'mr-gov');
  const queries = R.expandSearchUrls(src, KW).urls
    .map(u => { const p = decodeURIComponent(u).split('text='); return p.length > 1 ? p[1] : ''; })
    .filter(Boolean);
  for (const [id, topic] of Object.entries(KW.topics)) {
    const hit = queries.some(q => (topic.terms || []).some(([t]) => t === q));
    assert.ok(hit, `לנושא ${topic.label} (${id}) אין שאילתת חיפוש`);
  }
});

// "60 רלוונטיים אבל 16 נשמרו" לא אומר אם הסינון עובד או בולע מכרזים פתוחים.
// לכל נשירה יש סיבה מסווגת, והיא נספרת ומדווחת בכל ריצה.
test('לכל מכרז שנושר יש סיבה מסווגת', () => {
  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const past = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const old = new Date(Date.now() - 200 * 86400000).toISOString().slice(0, 10);

  assert.strictEqual(R.dropReason({ deadlineAt: future }), '', 'מועד עתידי — נכנס');
  assert.strictEqual(R.dropReason({ deadlineAt: past }), 'expired');
  assert.strictEqual(R.dropReason({ deadlineAt: '', status: '' }), 'unknown');
  assert.strictEqual(R.dropReason({ deadlineAt: '', status: 'פורסם', publishedAt: today }), '',
    'בלי מועד אבל פורסם היום ומסומן פעיל — נכנס');
  assert.strictEqual(R.dropReason({ deadlineAt: '', status: 'פורסם', publishedAt: old }), 'stale');
  assert.strictEqual(R.dropReason({ deadlineAt: '', status: 'פורסם', publishedAt: '' }), 'undated',
    'בלי תאריך פרסום זה "לא ידוע" ולא "ישן" — ההפרדה נדרשת כדי לדעת מה הסינון מוריד');

  // isActionable נשאר העטיפה של אותה החלטה — שתי הפונקציות לא יכולות להיפרד
  for (const rec of [{ deadlineAt: future }, { deadlineAt: past }, { deadlineAt: '', status: 'פורסם', publishedAt: today }]) {
    assert.strictEqual(R.isActionable(rec), R.dropReason(rec) === '');
  }
  for (const why of Object.keys(R.DROP_LABELS)) assert.ok(R.DROP_LABELS[why], `לסיבה ${why} יש תיאור`);
});

// מכרז שניסוח שונה מבריח — "מערכות ניטור וידאו" במקום "מצלמות אבטחה" — מקבל
// מהטקסונומיה ניקוד אפס, לא "כמעט". מדידה על נתונים אמיתיים החזירה 0 מועמדים
// כשהסף היה 2, ולכן הסף הוא 0: המועמד נשמר על סמך שער המכרז, לא על סמך ניקוד.
test('פרסום שהוא מכרז אבל בלי נושא נשמר כמועמד לבדיקה', () => {
  const src = { id: 's', name: 'מקור', allTenders: true };
  const item = { title: 'מכרז לאספקה והתקנה של מערכות ניטור וידאו במוסדות העירייה',
                 url: 'https://x.muni.il/t/1', context: '' };

  assert.strictEqual(R.classify(item.title, KW).topics.length, 0, 'הטקסונומיה לא נותנת לו נושא');
  assert.strictEqual(R.buildRecord(item, src, KW), null, 'בלי המצב הזה הוא נדחה כרגיל');

  const cand = R.buildRecord(item, src, KW, { near: true });
  assert.ok(cand, 'עם near:true הוא נשמר');
  assert.strictEqual(cand.near, true, 'ומסומן כמועמד ולא כמכרז מלא');
  assert.deepStrictEqual(cand.topics, [], 'בלי נושא');

  // מה שאינו מכרז כלל אינו הופך למועמד גם במצב הזה
  assert.strictEqual(R.buildRecord({ title: 'בית הספר לתקשורת חזותית', url: 'https://x.ac.il/d', context: '' },
    { id: 's', name: 'מקור' }, KW, { near: true }), null, 'שער המכרז עדיין חוסם');

  // מכרז שעבר את הסף נשאר מכרז רגיל ולא מועמד
  const real = R.buildRecord({ title: 'מכרז לאספקת ציוד תקשורת ומתגים', url: 'https://x.muni.il/t/2', context: '' },
    src, KW, { near: true });
  assert.ok(real && !real.near, 'מכרז מסווג אינו מועמד');
});

// "חסום" אמור לומר שמונחי השלילה גוברים על החיוביים. בלי הדרישה שיהיה קיזוז
// בפועל, טקסט בלי שום התאמה (0 מול 0) נחשב חסום — וזה הסתיר בדיוק את הפרסומים
// שאין להם התאמה כלל, אלה שסקירת ה-AI אמורה לשפוט.
test('טקסט בלי שום התאמה אינו נחשב "חסום"', () => {
  const none = R.classify('מכרז לאספקה והתקנה של מערכות ניטור וידאו', KW);
  assert.strictEqual(none.score, 0);
  assert.strictEqual(none.penalty, 0);
  assert.strictEqual(none.blocked, false, 'אין מה לחסום כשאין מונחי שלילה');

  const blocked = R.classify('מכרז לשירותי קלינאי תקשורת', KW);
  assert.ok(blocked.penalty > 0, 'כאן יש מונח שלילה');
  assert.strictEqual(blocked.blocked, true, 'והוא גובר על החיובי');
});

// מנהל הרכש הממשלתי מייצר אלפי קישורים ליום ותופס את כל מקומות רשימת הבדיקה.
// במדידה: 40 מועמדים, מתוכם 0 מוניציפליים — בעוד שרשות אחת הפיקה 4 ממצאים.
// לכן חצי מהמקומות שמורים לרשויות ולמוסדות, ומה שלא נוצל חוזר לשאר.
test('מכסת מועמדים שמורה לרשויות מקומיות ולמוסדות אקדמיים', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'scripts', 'tenders-fetch.js'), 'utf8');
  assert.ok(/const LOCAL_CATS = new Set\(\['רשויות מקומיות', 'מוסדות אקדמיים'\]\)/.test(src),
    'המגזרים המועדפים מוגדרים');
  assert.ok(/Math\.ceil\(NEAR_LIMIT \/ 2\)/.test(src), 'חצי מהמקומות שמורים');
  assert.ok(/rest\.slice\(0, NEAR_LIMIT - localQuota\)/.test(src),
    'מכסה שלא נוצלה חוזרת לשאר ולא הולכת לאיבוד');

  // העשרת המועדים מעדיפה את אותם מגזרים — שם המועד באמת חסר
  assert.ok(/NEEDS_ENRICH_FIRST/.test(src), 'העשרת המועדים מעדיפה רשויות ומוסדות');
  const enrichAt = src.indexOf('NEEDS_ENRICH_FIRST.has(b.category');
  assert.ok(enrichAt > 0, 'המיון לפי מגזר קיים בהעשרה');
});

// באתרי הרשויות המקומיות רוב הפריטים בעמוד המכרזים אינם מכרזים אלא הודעות על
// התקשרות ללא הליך תחרותי. במועצה אזורית דרום השרון כל ארבעת הממצאים היו כאלה:
// "מכרז משכ״ל לשירותי תקשורת" תחת הכותרת "התקשרויות ללא מכרז פומבי", ו"החלטה
// על התקשרות" לשירותי IT ולהגנת סייבר.
test('"התקשרות ללא מכרז" ו"החלטה על התקשרות" מזוהות כפטור וככוונה', () => {
  assert.strictEqual(R.detectKind('התקשרות ללא מכרז פומבי לאספקת ציוד תקשורת', ''), 'exemption');
  assert.strictEqual(R.detectKind('התקשרויות ללא מכרז פומבי — שירותי תקשוב', ''), 'exemption');
  assert.strictEqual(R.detectKind('החלטה על התקשרות לאספקת שירותי הגנת סייבר', ''), 'intent');
  assert.strictEqual(R.detectKind('החלטה על התקשרות לשירותי ניהול ופיקוח מכרז מחשוב', ''), 'intent');
  // ומכרז אמיתי נשאר מכרז
  assert.strictEqual(R.detectKind('מכרז פומבי 4/2026 לאספקת ציוד תקשורת', ''), 'tender');
  assert.strictEqual(R.detectKind('מכרז משכ"ל לאספקת שירותי תקשורת ותקשוב', ''), 'tender');

  // שני הסוגים אינם נכנסים לראדאר
  for (const t of ['התקשרות ללא מכרז פומבי לאספקת ציוד תקשורת',
                   'החלטה על התקשרות לאספקת שירותי הגנת סייבר']) {
    assert.strictEqual(R.buildRecord({ title: t, url: 'https://x.org.il/bids/1', context: '' },
      { id: 's', name: 'מועצה', allTenders: true }, KW), null, `"${t}" אינו נכנס`);
  }
});

// ─────────── מועד ההגשה בדף רשימה עמוס ובקישור לקובץ ───────────
// שני ליקויים שהאבחון על אתר מ.א. לכיש חשף, בטקסט אמיתי מהעמוד.

test('מתוך כמה ביטויי מועד בהקשר נבחר זה שטרם חלף', () => {
  const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const [y, m, d] = future.split('-');
  const ctx = `מכרז ישן — המועד המעודכן להגשה עד 13.6.2024 בשעה 12:00 . ` +
              `תשלום עבור השתתפות במכרז – להגשה עד ${d}/${m}/${y} בשעה 12:00`;
  assert.strictEqual(R.dateAfterHint(ctx, R.DEADLINE_HINTS), future,
    'ההיקרות הראשונה היא מכרז שחלף — צריך להמשיך לזו שטרם חלפה');

  // כשכל המועדים חלפו מוחזר הראשון, כדי שהסינון יזהה מכרז סגור ולא "בלי מועד"
  const past = 'מועד אחרון להגשה 13.6.2024 . מועד הגשה 17/06/2024';
  assert.strictEqual(R.dateAfterHint(past, R.DEADLINE_HINTS), '2024-06-13');

  // בלי ביטוי רמז אין תאריך, גם כשיש תאריכים בטקסט
  assert.strictEqual(R.dateAfterHint('פורסם 01/01/2026 ועודכן 02/01/2026', R.DEADLINE_HINTS), '');
});

test('קישור לקובץ אינו נשלח להעשרת מועדים', async () => {
  for (const u of ['https://lachish.org.il/wp-content/uploads/2026/02/mich.pdf',
                   'https://x.muni.il/files/a.DOCX', 'https://x.muni.il/f.xlsx?v=2',
                   'https://x.muni.il/f.zip#p']) {
    assert.ok(R.BINARY_URL_RE.test(u), `${u} הוא קובץ`);
  }
  for (const u of ['https://x.muni.il/bids/123', 'https://x.muni.il/tender.aspx?id=5',
                   'https://x.muni.il/pdf-viewer/7']) {
    assert.ok(!R.BINARY_URL_RE.test(u), `${u} הוא עמוד`);
  }

  // enrichDeadlines לא מבצע ולו בקשה אחת כשכל המועמדים הם קבצים
  const today = new Date().toISOString().slice(0, 10);
  const recs = [{ id: 'a', lastSeen: today, url: 'https://x.muni.il/a.pdf', category: 'רשויות מקומיות' }];
  await R.enrichDeadlines(recs);
  assert.strictEqual(recs[0].deadlineChecked, undefined, 'קובץ אינו מסומן כנבדק');
  assert.strictEqual(recs[0].deadlineAt, undefined);
});

// המכרז המוניציפלי הראשון שנכנס לראדאר היה "מכרז יועץ אסטרטגי תקשורתי" של
// עיריית רמת השרון — יועץ תקשורת ויחסי ציבור, לא תקשורת מחשבים. הצורה
// המוטה ("תקשורתי") התאימה ל"תקשורת" ועברה, בעוד שהשלילה הכירה רק את צורת
// הסמיכות ("יועץ תקשורת").
test('ייעוץ אסטרטגי־תקשורתי אינו תחום התקשורת שלנו', () => {
  for (const t of ['מכרז יועץ אסטרטגי תקשורתי',
                   'מכרז ייעוץ אסטרטגי ניהולי ותקשורתי – מ.א. לכיש',
                   'מכרז לליווי תקשורתי ואסטרטגיה תקשורתית']) {
    assert.deepStrictEqual(topicsOf(t), [], `"${t}" אינו בתחום`);
  }
  // ומכרזי תקשורת אמיתיים ממשיכים להיכנס
  assert.ok(topicsOf('מכרז לאספקת ציוד תקשורת ומתגים').includes('telecom'));
  assert.ok(topicsOf('מכרז לשירותי תקשורת נתונים DATA').includes('telecom'));
  assert.ok(topicsOf('מכרז לתשתית תקשורת פסיבית ותקשוב').includes('telecom'));
});

// הסריקה של 23/08 שמרה 35 מכרזים עם מועד; הריצה שאחריה החזירה 25, ותשע רשומות
// חזרו לנשור כ"בלי מועד". הסיבה: { ...prev, ...rec } דרס את המועד שההעשרה
// מילאה במחרוזת הריקה שדף הרשימה מחזיר — ו-deadlineChecked כן שרד, ולכן הן לא
// נבדקו שוב לעולם.
test('מועד שההעשרה מילאה שורד את הסריקה הבאה', () => {
  const prev = { id: 'x', title: 'מכרז ציוד תקשורת', url: 'https://a.muni.il/t/1',
                 deadlineAt: '2026-09-30', deadlineFrom: 'detail', deadlineChecked: true,
                 publishedAt: '2026-08-01', tenderNumber: '5/2026', firstSeen: '2026-08-01' };
  const rec  = { id: 'x', title: 'מכרז ציוד תקשורת', url: 'https://a.muni.il/t/1',
                 deadlineAt: '', publishedAt: '', tenderNumber: '' };

  const kept = R.keepEnriched(prev, rec);
  assert.strictEqual(kept.deadlineAt, '2026-09-30', 'המועד לא נמחק');
  assert.strictEqual(kept.deadlineFrom, 'detail');
  assert.strictEqual(kept.publishedAt, '2026-08-01');
  assert.strictEqual(kept.tenderNumber, '5/2026');

  // מועד חדש מדף הרשימה גובר — הארכת מועד צריכה לעדכן
  const extended = R.keepEnriched(prev, { ...rec, deadlineAt: '2026-10-15' });
  assert.strictEqual(extended.deadlineAt, '2026-10-15');
  assert.ok(!extended.deadlineFrom, 'מועד טרי מדף הרשימה אינו מסומן כאילו נשלף מדף המכרז');

  // ואותו דבר דרך המיזוג המלא
  const merged = R.mergeWithHistory([rec], new Map([['x', prev]]), null, null);
  assert.strictEqual(merged.find(r => r.id === 'x').deadlineAt, '2026-09-30');
});

// מנהל הרכש הממשלתי הוא מקור אחד שמפרסם עבור כל משרדי הממשלה, ולכן אי אפשר
// לנטרל משרד בודד על ידי נטרול המקור. ההבחנה היחידה היא שדה הגוף המפרסם.
test('סינון לפי גוף מפרסם משאיר רק את המשרדים שברשימה', () => {
  const src = { id: 'mr-gov', name: 'מנהל הרכש הממשלתי', allTenders: true,
                onlyPublishers: ['משרד התחבורה'] };

  // הכלה במחרוזת — "משרד התחבורה" תופס גם את השם המלא
  assert.ok(R.publisherAllowed('משרד התחבורה והבטיחות בדרכים', src));
  assert.ok(!R.publisherAllowed('משרד הבריאות', src));
  assert.ok(!R.publisherAllowed('משרד האוצר - החשב הכללי', src));
  assert.ok(!R.publisherAllowed('', src), 'בלי גוף מפרסם — לא נכנס');

  // מקור בלי הגבלה ממשיך לקבל הכול
  assert.ok(R.publisherAllowed('משרד הבריאות', { id: 'x', name: 'x' }));

  // blockPublishers הוא הכיוון ההפוך
  const blocked = { id: 'y', name: 'y', blockPublishers: ['משרד הבריאות'] };
  assert.ok(!R.publisherAllowed('משרד הבריאות', blocked));
  assert.ok(R.publisherAllowed('משרד התחבורה', blocked));

  // והשער עובד דרך buildRecord: אותה כותרת, שני מפרסמים
  const item = t => ({ title: 'מכרז לאספקת ציוד תקשורת ומתגים',
                       url: 'https://mr.gov.il/p/1', context: 'הגוף המפרסם: ' + t,
                       publisher: t, deadlineAt: '2099-01-01' });
  assert.ok(R.buildRecord(item('משרד התחבורה והבטיחות בדרכים'), src, KW), 'תחבורה נכנס');
  assert.strictEqual(R.buildRecord(item('משרד הבריאות'), src, KW), null, 'בריאות לא נכנס');
});

// רשומה שכבר במאגר יורדת כשהמשרד שלה מוסר מהתצורה — אחרת היא הייתה נשארת
// עד 45 יום אחרי השינוי
test('גוף מפרסם שהוסר מהתצורה יורד גם מההיסטוריה', () => {
  const src = { id: 'mr-gov', name: 'מנהל הרכש', allTenders: true,
                onlyPublishers: ['משרד התחבורה'] };
  const active = new Map([['mr-gov', src]]);
  const mk = (id, pub) => ({ id, source: 'mr-gov', title: 'מכרז לאספקת ציוד תקשורת ומתגים',
    url: 'https://mr.gov.il/p/' + id, publisher: pub, kind: 'tender',
    lastSeen: new Date().toISOString().slice(0, 10), deadlineAt: '2099-01-01' });

  const out = R.mergeWithHistory([], new Map([
    ['keep', mk('keep', 'משרד התחבורה והבטיחות בדרכים')],
    ['drop', mk('drop', 'משרד הבריאות')],
  ]), active, KW);

  assert.deepStrictEqual(out.map(r => r.id), ['keep']);
});

// ביקורת המשפך על 30 רשויות מדדה 11,940 קישורים, מהם 14 בלבד קיבלו נושא
// מהטקסונומיה — וכל 14 נשרו על תאריכים. ברשות מועד ההגשה יושב בתוך ה-PDF ולא
// בדף הרשימה, ולכן הכלל שנבנה למקורות ממשלתיים מחק את כל המגזר המוניציפלי.
test('ברשות מקומית פרסום בלי מועד נשמר, וארכיון עדיין יורד', () => {
  const muni = { keepUndated: true };
  assert.strictEqual(R.dropReason({ ...muni, publishedAt: '' }), '',
    'בלי שום תאריך — נשמר, כי זו הנורמה ברשויות');
  assert.strictEqual(R.dropReason({ ...muni, publishedAt: R.todayYmd ? R.todayYmd() : new Date().toISOString().slice(0, 10) }), '');

  // קובץ שהועלה לפני יותר משנה הוא ארכיון גם בלי מועד
  assert.strictEqual(R.dropReason({ ...muni, publishedAt: '2019-05-15' }), 'archived');

  // מועד שחלף עדיין מוריד, גם ברשות
  assert.strictEqual(R.dropReason({ ...muni, deadlineAt: '2020-01-01' }), 'expired');

  // ומקור ממשלתי לא הושפע
  assert.strictEqual(R.dropReason({ publishedAt: '' }), 'unknown');
  assert.ok(R.DROP_LABELS.archived, 'לכל סיבת נשירה יש תווית');
});

// ברשויות רבות קישור המכרז מוביל ישירות ל-PDF תחת נתיב וורדפרס שמכיל שנה
// וחודש. זו לרוב האינדיקציה היחידה לגיל הפרסום.
test('תאריך פרסום נגזר מנתיב הקובץ ומ"עדכון אחרון"', () => {
  assert.strictEqual(R.dateFromUrl('https://lachish.org.il/wp-content/uploads/2026/02/a.pdf'), '2026-02-15');
  assert.strictEqual(R.dateFromUrl('https://x.org.il/wp-content/uploads/2024/05/b.pdf'), '2024-05-15');
  assert.strictEqual(R.dateFromUrl('https://x.muni.il/bids/12'), '', 'נתיב בלי שנה/חודש');
  assert.strictEqual(R.dateFromUrl('https://x.muni.il/2026/13/c.pdf'), '', 'חודש 13 אינו חודש');

  // אתרי רשויות כותבים תאריך עם מקפים; ISO חייב להיקרא נכון ולא הפוך
  assert.strictEqual(R.parseDateNear('תאריך עדכון אחרון: 14-07-2026'), '2026-07-14');
  assert.strictEqual(R.parseDateNear('2026-08-24'), '2026-08-24');
});

// הסריקה הראשונה עם keepUndated הכניסה לראדאר מכרז של שנקר מ-2015: אין לו
// מועד, אין תאריך פרסום ואין תאריך בנתיב — אבל מספר המכרז הוא "2/2015".
test('שנת הפרסום נגזרת ממספר המכרז כשאין שום תאריך אחר', () => {
  assert.strictEqual(R.yearFromTenderNumber('2/2015'), '2015-12-31');
  assert.strictEqual(R.yearFromTenderNumber('07/2024'), '2024-12-31');
  assert.strictEqual(R.yearFromTenderNumber('5/26'), '', 'שתי ספרות אינן שנה חד-משמעית');
  assert.strictEqual(R.yearFromTenderNumber(''), '');

  const src = { id: 'shenkar', name: 'שנקר', allTenders: true, keepUndated: true,
                category: 'מוסדות אקדמיים' };
  const mk = title => R.buildRecord(
    { title, url: 'https://shenkar.ac.il/tenders/x', context: '' }, src, KW);

  const old = mk("מכרז פומבי מס' 2/2015 לאספקת מחשבים אישיים ומסכים");
  assert.ok(old, 'הרשומה נבנית');
  assert.strictEqual(old.publishedAt, '2015-12-31');
  assert.strictEqual(R.dropReason(old), 'archived', 'מכרז מ-2015 אינו נכנס לראדאר');

  // ומכרז מהשנה הנוכחית כן נכנס
  const yr = new Date().getFullYear();
  const now = mk(`מכרז פומבי מס' 3/${yr} לאספקת מחשבים אישיים ומסכים`);
  assert.strictEqual(R.dropReason(now), '', `מכרז מ-${yr} נכנס`);
});

// ביקורת המשפך הראתה ש-13 המועמדים לבדיקה שנשארו הם כולם קישורי תפריט. כולם
// מכילים "מכרז", ולכן עברו את שער "האם זה מכרז" ומילאו את רשימת הבדיקה במקום
// מכרזים אמיתיים.
test('תווית ניווט אינה מכרז', () => {
  const nav = ['ועדת מכרזים', 'ועדות המכרזים', 'מכרזי עירייה', 'מכרזי החברה הכלכלית',
    'מכרזים והצעות מחיר', 'מכרזים, קולות קוראים והצעות מחיר',
    'לתשלום עבור מסמכי המכרז - לחצו כאן', 'טופס בקשה לקבלת מידע - לפי חוק חופש המידע',
    'קול קורא לרישום למאגרים', 'קול קורא לקבלת מידע ו/או הצעות',
    'קול קורא - מאגר נותני שירותים בתחום תחזוקה ותיקונים לכלי רכב',
    'למכרזי עירייה ישנים אשר אינם מופיעים בארכיון ניתן לפנות אל המחלקה המשפטית'];
  for (const n of nav) {
    assert.ok(R.isNavTitle(n), `"${n}" הוא ניווט`);
    assert.ok(!R.looksLikeTender(n, KW), `"${n}" אינו עובר את שער המכרז`);
  }

  // כותרת של מכרז אמיתי אומרת מה נרכש — וממשיכה לעבור
  const real = ['מכרז פומבי 4/2026 לאספקת ציוד תקשורת ומתגים',
    'מכרז משכ"ל לאספקת שירותי תקשורת, תקשורת קווית, תשתית אלחוטית',
    'מכרז אתר אינטרנט תאריך עדכון אחרון: 14-07-2026',
    'מכרז פומבי למתן שירותי ניהול, תפעול ואחזקת מחשוב ורשת במועצה המקומית',
    'קול קורא לפיילוטים לפתרונות חדשניים בתחום הסייבר'];
  for (const r of real) {
    assert.ok(!R.isNavTitle(r), `"${r}" אינו ניווט`);
    assert.ok(R.looksLikeTender(r, KW), `"${r}" עובר את שער המכרז`);
  }
});

// סבב שני של ניקוי, אחרי מדידה חוזרת: מה שנשאר ברשימת הבדיקה היה שוב תפריטים
// ומכרזי כוח אדם. "מכרזי משאבי אנוש" הוא מכרז אמיתי אבל לא בתחום, ולכן מקומו
// במילות השלילה ולא בזיהוי הניווט.
test('תפריטים ומכרזי כוח אדם אינם מגיעים לרשימת הבדיקה', () => {
  const passes = t => R.looksLikeTender(t, KW) && !R.classify(t, KW).blocked;
  for (const t of ['הצעות ומכרזים', 'מכרזי משאבי אנוש',
                   'נציגי/ות ציבור בוועדות בחינה למכרזי כוח אדם',
                   'מכרזי העמותה לקידום חינוך, תרבות וספורט יישובי דרום השרון',
                   'מכרזי החברה הכלכלית']) {
    assert.ok(!passes(t), `"${t}" אינו מגיע לרשימת הבדיקה`);
  }
  for (const t of ['מכרז משכ"ל לאספקת שירותי תקשורת, תקשורת קווית, תשתית אלחוטית',
                   'מכרז אתר אינטרנט תאריך עדכון אחרון: 14-07-2026',
                   'מכרז פומבי 4/2026 לאספקת ציוד תקשורת ומתגים',
                   'מכרז פומבי למתן שירותי ניהול, תפעול ואחזקת מחשוב ורשת']) {
    assert.ok(passes(t), `"${t}" ממשיך לעבור`);
  }
});

// "מכרז חיצוני" ו"מכרז פנימי" הם המונח העירוני למשרה פנויה, לא לרכש. במועצה
// אזורית דרום השרון חמישה מתוך שישה מועמדים היו כאלה — ספרן, מזכירה, פסיכולוג,
// רכז וחשמלאי. הם מכרזים לכל דבר בשמם, ולכן מילות השלילה לא תפסו אותם: זהו סוג
// פרסום, בדיוק כמו הודעת פטור.
test('מכרז חיצוני/פנימי הוא משרה ולא רכש', () => {
  assert.strictEqual(R.detectKind("מכרז חיצוני מס' 26/2026: ספרן.ית בחט\"ב", ''), 'job');
  assert.strictEqual(R.detectKind("מכרז פנימי מס' 3/2026: רכז נוער", ''), 'job');
  assert.strictEqual(R.detectKind('מכרז פומבי 4/2026 לאספקת ציוד תקשורת', ''), 'tender');
  assert.ok(R.KIND_LABELS.job, 'לסוג יש תווית');
  assert.ok((KW.excludedKinds || []).includes('job'), 'הסוג מוחרג בתצורה');
});

// מקור מוניציפלי הוא discover עם allTenders:false, אבל תווית ניווט אינה מכרז
// גם במקור allTenders — שם נתיב מכרזי לבדו מספיק כדי לעבור את השער.
test('תווית ניווט נדחית גם כשהנתיב מכרזי', () => {
  const nav = 'מכרזי ספקים';
  for (const allTenders of [false, true]) {
    const rec = R.buildRecord({ title: nav, url: 'https://x.muni.il/bids/1', context: '' },
      { id: 's', name: 'מ', allTenders, keepUndated: true }, KW, { near: true });
    assert.strictEqual(rec, null, `נדחה גם עם allTenders=${allTenders}`);
  }
  // ומכרז אמיתי עם אותו נתיב נשאר
  assert.ok(R.buildRecord(
    { title: 'מכרז פומבי 4/2026 לאספקת ציוד תקשורת ומתגים', url: 'https://x.muni.il/bids/1', context: '' },
    { id: 's', name: 'מ', allTenders: false, keepUndated: true }, KW, { near: true }));
});
