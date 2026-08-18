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
