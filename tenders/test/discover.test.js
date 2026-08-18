'use strict';
/**
 * בדיקת אינטגרציה למתאם הגילוי: מרימה אתר רשות מדומה ומריצה עליו את המסלול
 * המלא — דף בית → איתור עמוד המכרזים → קציר → סיווג.
 * הרצה:  node --test tenders/test/discover.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('fs');
const path = require('path');

const R = require('../../.github/scripts/tenders-fetch.js');
const KW = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'keywords.json'), 'utf8'));

const HOME = `<!doctype html><html><body>
  <nav>
    <a href="/he/residents">תושבים</a>
    <a href="/he/education">חינוך וגני ילדים</a>
    <a href="/he/business/michrazim">מכרזים</a>
    <a href="/he/contact">צור קשר</a>
  </nav></body></html>`;

const TENDERS = `<!doctype html><html><body><table>
  <tr><td scope="row"><a href="/he/business/michrazim/14-2026">מכרז פומבי 14/2026 – אספקה והתקנה של ציוד תקשורת ומתגים במוסדות העירייה</a>
    <button type="button" class="btn collapsed" data-bs-toggle="collapse" aria-expanded="false"><span class="visually-hidden">פרטים</span></button></td>
    <td class="text-nowrap"><span class="lbl">תאריך פרסום</span> 01/08/2026</td>
    <td class="text-nowrap"><span class="lbl">מועד אחרון להגשה</span> 15/09/2026</td></tr>
  <tr><td><a href="/he/business/michrazim/15-2026">מכרז 15/2026 – שירותי קלינאי תקשורת במסגרות החינוך</a></td>
    <td><span class="lbl">מועד אחרון להגשה</span> 20/09/2026</td></tr>
  <tr><td><a href="/he/business/michrazim/16-2026">מכרז 16/2026 – עבודות גינון וניקיון בשצ״פים</a></td>
    <td><span class="lbl">מועד אחרון להגשה</span> 05/10/2026</td></tr>
</table></body></html>`;

function startServer(routes) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const body = routes[req.url.split('?')[0]];
      if (body == null) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

test('מתאם הגילוי מאתר את עמוד המכרזים וקוצר ממנו רק את הרלוונטיים', async () => {
  const srv = await startServer({ '/': HOME, '/he/business/michrazim': TENDERS });
  const base = `http://127.0.0.1:${srv.address().port}/`;
  try {
    const source = { id: 'muni-test', name: 'עיריית בדיקה', category: 'רשויות מקומיות', kind: 'discover', allTenders: true, home: base };
    const raw = await R.adapterDiscover(source);

    assert.ok(raw.discovered && raw.discovered.length, 'הגילוי מדווח איזה עמוד אותר');
    assert.ok(raw.discovered[0].includes('/he/business/michrazim'), 'אותר עמוד המכרזים הנכון');

    const kept = raw.map(i => R.buildRecord(i, source, KW)).filter(Boolean);
    assert.deepStrictEqual(kept.map(t => t.tenderNumber), ['14/2026'],
      'רק מכרז ציוד התקשורת נשמר. קיבלנו: ' + JSON.stringify(kept.map(t => t.title)));
    assert.strictEqual(kept[0].deadlineAt, '2026-09-15');
    assert.strictEqual(kept[0].publishedAt, '2026-08-01');
    assert.ok(kept[0].topics.includes('equipment'));
  } finally { srv.close(); }
});

test('דף בית בלי קישור למכרזים מדווח כשגיאה מובנת', async () => {
  const srv = await startServer({ '/': '<a href="/he/education">חינוך</a>' });
  const base = `http://127.0.0.1:${srv.address().port}/`;
  try {
    await assert.rejects(
      () => R.adapterDiscover({ id: 'x', name: 'x', kind: 'discover', home: base }),
      /לא נמצא קישור לעמוד מכרזים/);
  } finally { srv.close(); }
});

test('עמוד מכרזים שמחזיר שגיאה מדווח, ולא מתפרש כאפס ממצאים', async () => {
  const srv = await startServer({ '/': HOME }); // עמוד המכרזים יחזיר 404
  const base = `http://127.0.0.1:${srv.address().port}/`;
  try {
    await assert.rejects(
      () => R.adapterDiscover({ id: 'x', name: 'x', kind: 'discover', home: base }),
      /עמוד המכרזים שאותר לא נטען/);
  } finally { srv.close(); }
});

test('כתובת אחת שנכשלת אינה מפילה מקור עם כמה כתובות', async () => {
  const srv = await startServer({ '/ok': TENDERS });
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const items = await R.adapterHtml({ id: 'x', name: 'x', kind: 'html', urls: [base + '/dead', base + '/ok'] });
    assert.ok(items.length > 0, 'נקצרו פריטים מהכתובת שעבדה');
    assert.ok((items.warnings || []).some(w => w.includes('404')), 'הכתובת שנכשלה נרשמה כאזהרה');
  } finally { srv.close(); }
});

test('מקור שכל כתובותיו נכשלות נחשב כנכשל', async () => {
  const srv = await startServer({});
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    await assert.rejects(() => R.adapterHtml({ id: 'x', name: 'x', kind: 'html', urls: [base + '/a', base + '/b'] }), /404/);
  } finally { srv.close(); }
});

test('חריגה מתקציב הזמן עוצרת את הסריקה ומדווחת על המקורות שלא נסרקו', async () => {
  // מריצים את הסורק עם תקציב אפסי — אף מקור לא אמור להיסרק, וכולם ידווחו
  const { execFileSync } = require('node:child_process');
  const out = execFileSync(process.execPath,
    [path.join(__dirname, '..', '..', '.github', 'scripts', 'tenders-fetch.js'), '--dry-run'],
    { env: { ...process.env, TENDERS_BUDGET_MS: '0' }, encoding: 'utf8' });
  const payload = JSON.parse(out);
  assert.ok(payload.sources.length > 0);
  assert.ok(payload.sources.every(s => !s.ok && /תקציב הזמן/.test(s.error || '')),
    'כל המקורות אמורים להיות מדווחים כלא-נסרקו');

  // מקור שלא נסרק אינו מוחק את מה שכבר נמצא בו — ההיסטוריה נשמרת,
  // אחרת ריצה שנקטעה הייתה מרוקנת את המאגר.
  // (הספירה לא בהכרח זהה למאגר: רשומות ההיסטוריה נבדקות מחדש מול הסינון הנוכחי,
  //  ולכן רשומה שהסינון המעודכן דוחה יורדת גם בריצה שלא סרקה כלום.)
  const stored = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'data', 'tenders.json'), 'utf8'));
  if ((stored.tenders || []).length) {
    assert.ok(payload.counts.total > 0, 'המכרזים שבמאגר לא נמחקים כשאף מקור לא נסרק');
    assert.ok(payload.counts.total <= stored.tenders.length);
  }
});

test('מועד הגשה נשלף מדף המכרז כשהוא חסר בדף הרשימה', async () => {
  const DETAIL = `<h1>מכרז פומבי 14/2026</h1><dl>
    <dt>תאריך פרסום</dt><dd>01/08/2026</dd>
    <dt>מועד אחרון להגשת הצעות</dt><dd>15/09/2026 בשעה 12:00</dd></dl>`;
  const srv = await startServer({ '/t/14': DETAIL });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const today = new Date().toISOString().slice(0, 10);
  try {
    const rec = { id: 'x', title: 'מכרז פומבי 14/2026 – אספקת ציוד תקשורת', url: base + '/t/14',
                  deadlineAt: '', publishedAt: '', tenderNumber: '', lastSeen: today };
    await R.enrichDeadlines([rec]);
    assert.strictEqual(rec.deadlineAt, '2026-09-15', 'המועד נשלף מדף המכרז');
    assert.strictEqual(rec.deadlineFrom, 'detail', 'מסומן שהמועד הגיע מדף המכרז ולא מדף הרשימה');
    assert.strictEqual(rec.publishedAt, '2026-08-01');
    assert.strictEqual(rec.deadlineChecked, true, 'מסומן כנבדק כדי לא לחזור על כך יום־יום');
  } finally { srv.close(); }
});

test('העשרה אינה חוזרת על מכרז שכבר נבדק, ולא נוגעת במי שיש לו מועד', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const srv = await startServer({});   // כל בקשה תיכשל — אם תישלח בקשה, ניכשל
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const checked = { id: 'a', title: 'א', url: base + '/x', deadlineAt: '', deadlineChecked: true, lastSeen: today };
    const hasDl  = { id: 'b', title: 'ב', url: base + '/x', deadlineAt: '2026-09-01', lastSeen: today };
    const oldRec = { id: 'c', title: 'ג', url: base + '/x', deadlineAt: '', lastSeen: '2020-01-01' };
    await R.enrichDeadlines([checked, hasDl, oldRec]);
    assert.strictEqual(hasDl.deadlineAt, '2026-09-01', 'מועד קיים לא נדרס');
    assert.ok(!oldRec.deadlineChecked, 'רשומה שלא נראתה בסריקה הזו לא נבדקת');
  } finally { srv.close(); }
});

test('מדידת נגישות מבדילה בין מקור שעונה, מקור חוסם ודף בית בלי עמוד מכרזים', async () => {
  const NO_TENDERS = `<!doctype html><html><body><nav>
    <a href="/he/residents">תושבים</a><a href="/he/contact">צור קשר</a></nav></body></html>`;
  const srv = await startServer({
    '/': HOME, '/he/business/michrazim': TENDERS, '/plain/': NO_TENDERS
  });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const lines = [];
  const realLog = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    await R.probeSources({ sources: [
      { id: 'good', name: 'רשות שעונה', category: 'רשויות מקומיות', kind: 'discover', home: base + '/' },
      { id: 'bare', name: 'רשות בלי עמוד מכרזים', category: 'רשויות מקומיות', kind: 'discover', home: base + '/plain/' },
      { id: 'dead', name: 'רשות שלא קיימת', category: 'רשויות מקומיות', kind: 'discover', home: base + '/missing' },
      { id: 'off',  name: 'מקור מושבת', category: 'רשויות מקומיות', kind: 'discover', home: base + '/', enabled: false }
    ] });
  } finally { console.log = realLog; srv.close(); }

  const out = lines.join('\n');
  const json = JSON.parse(out.match(/<!--PROBE-JSON\n([\s\S]*?)\nPROBE-JSON-->/)[1]);
  const by = Object.fromEntries(json.map(r => [r.id, r]));
  assert.strictEqual(json.length, 3, 'מקור מושבת אינו נמדד');
  assert.strictEqual(by.good.verdict, 'ok');
  assert.ok(by.good.tendersUrl.endsWith('/he/business/michrazim'), 'אותר עמוד המכרזים עצמו');
  assert.ok(by.good.tendersAnchors > 0, 'נמדדו קישורים בעמוד המכרזים');
  assert.strictEqual(by.bare.verdict, 'no-tenders-link');
  assert.strictEqual(by.dead.verdict, 'http-404');
  assert.ok(/מדידת נגישות מקורות — 1\/3 נגישים/.test(out), 'הסיכום מונה רק את הנגישים');
});

// באתרים רבים עמוד המכרזים לא מקושר מדף הבית (ניווט JavaScript, תת־דומיין נפרד),
// ולכן הגילוי לבדו מחמיץ אותם. tendersUrls הוא רמז לכתובת ידועה — נבדק ראשון,
// עם נפילה חזרה לגילוי אם הרמז לא נענה.
test('כתובת מכרזים ידועה נבדקת לפני דף הבית, עם נפילה חזרה לגילוי', async () => {
  const srv = await startServer({ '/': HOME, '/he/business/michrazim': TENDERS, '/known/tenders': TENDERS });
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const viaHint = await R.adapterDiscover({
      id: 'h', name: 'רמז תקין', kind: 'discover',
      home: base + '/', tendersUrls: [base + '/known/tenders']
    });
    assert.deepStrictEqual(viaHint.discovered, [base + '/known/tenders'], 'הרמז שימש ישירות');
    assert.ok(viaHint.length >= 3);

    const viaFallback = await R.adapterDiscover({
      id: 'f', name: 'רמז שבור', kind: 'discover',
      home: base + '/', tendersUrls: [base + '/nope', base + '/also-nope']
    });
    assert.ok(viaFallback.discovered[0].endsWith('/he/business/michrazim'),
      'רמז שלא נענה לא מפיל את המקור — הגילוי מדף הבית ממשיך');
  } finally { srv.close(); }
});

// אתר איטי אחד עם הרבה כתובות יכול לבלוע את כל תקציב הריצה, וכל המקורות
// שאחריו לא נסרקים. תקרת זמן קשיחה לכל מקור הופכת את זה לכשל של מקור אחד.
test('לכל מקור יש תקרת זמן קשיחה, שגדלה עם מספר הכתובות וחסומה מלמעלה', () => {
  assert.strictEqual(R.sourceBudget({ id: 'a' }), 80000, 'מקור בלי רשימת כתובות מקבל מינימום');
  assert.ok(R.sourceBudget({ urls: ['a', 'b', 'c'] }) > R.sourceBudget({ urls: ['a'] }),
    'יותר כתובות = יותר זמן');
  assert.strictEqual(R.sourceBudget({ urls: new Array(50).fill('u') }), 300000, 'חסום ב-5 דקות');
  assert.ok(R.sourceBudget({ home: 'h', tendersUrls: ['x', 'y'] }) > R.sourceBudget({ home: 'h' }),
    'גם רמזי כתובת נספרים בתקרה');
});

test('מקור שנתקע נכשל בתקרת הזמן ולא עוצר את הריצה', async () => {
  const never = new Promise(() => {});          // לעולם אינה מסתיימת
  await assert.rejects(
    () => R.withDeadline(never, 60, 'חריגה מזמן הסריקה של המקור'),
    /חריגה מזמן הסריקה/);
  // הבטחה שמסתיימת בזמן עוברת כרגיל, והשעון מנוקה
  assert.strictEqual(await R.withDeadline(Promise.resolve('ok'), 5000, 'לא אמור לקרות'), 'ok');
});

// עמוד המכרזים יושב פעמים רבות בתת־דומיין נפרד (tenders.huji.ac.il,
// w3.braude.ac.il) או בלי www. מסנן "אותו host בדיוק" פסל אותם, ושלושה
// מקורות שהמדידה מצאה נגישים נכשלו יום־יום ב"לא נמצא קישור לעמוד מכרזים".
test('תת־דומיין ו-www נחשבים אותו אתר, אתר זר לא', () => {
  const same = [
    ['https://w3.braude.ac.il/about/tenders/', 'https://www.braude.ac.il/'],
    ['https://tenders.huji.ac.il/', 'https://www.huji.ac.il/'],
    ['https://yehud-monosson.muni.il/bids/', 'https://www.yehud-monosson.muni.il/'],
    ['https://www.tau.ac.il/bidding', 'https://www.tau.ac.il/']
  ];
  for (const [a, b] of same) assert.ok(R.sameSite(a, b), `${a} ⟷ ${b}`);

  const diff = [
    ['https://www.facebook.com/x', 'https://www.huji.ac.il/'],
    ['https://www.ramla.muni.il/x', 'https://www.lod.muni.il/'],
    ['https://michrazim.org.il/x', 'https://www.lod.muni.il/']
  ];
  for (const [a, b] of diff) assert.ok(!R.sameSite(a, b), `${a} ⟷ ${b} אינם אותו אתר`);

  // סיומות ישראליות דו־שלביות לא מקצרות יתר על המידה
  assert.strictEqual(R.registrableDomain('www.lod.muni.il'), 'lod.muni.il');
  assert.strictEqual(R.registrableDomain('w3.braude.ac.il'), 'braude.ac.il');
  assert.strictEqual(R.registrableDomain('sub.example.com'), 'example.com');
});

test('גילוי עמוד המכרזים עוקב אחרי הפניה של דף הבית', async () => {
  const srv = await startServer({ '/': HOME, '/he/business/michrazim': TENDERS });
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const items = await R.adapterDiscover({ id: 'r', name: 'עם הפניה', kind: 'discover', home: base + '/' });
    assert.ok(items.discovered[0].endsWith('/he/business/michrazim'));
    assert.ok(items.length >= 3, 'הפריטים נקצרו מעמוד המכרזים');
  } finally { srv.close(); }
});

// "תוצאות מכרזים" הוא עמוד מכרזים לכל דבר מבחינת הגילוי, אבל אין בו מה
// להגיש — הוא מפרסם מי זכה. באתר עיריית אריאל הגילוי בחר בדיוק אותו.
test('הגילוי מעדיף מכרזים פעילים ולא יורד לתוצאות או לארכיון', () => {
  const html = `
    <a href="/tenders-results/">תוצאות מכרזים</a>
    <a href="/archive/michrazim/">ארכיון מכרזים</a>
    <a href="/bids/">מכרזים</a>
    <a href="/active-bids/">מכרזים פעילים</a>
    <a href="/michrazim-protocols/">פרוטוקולים של ועדת מכרזים</a>`;
  const links = R.findTenderLinks(html, 'https://www.x.muni.il/');
  const urls = links.map(l => l.url);
  assert.ok(urls[0].endsWith('/bids/'), 'עמוד המכרזים הראשי נבחר ראשון');
  assert.ok(!urls.some(u => /results|archive|protocol/.test(u)),
    'תוצאות, ארכיון ופרוטוקולים אינם נבחרים כשיש חלופה חיה: ' + urls.join(' , '));

  // כשאין חלופה — עדיף עמוד תוצאות מכלום, אבל הוא לא מדורג ראשון בטעות
  const onlyArchive = R.findTenderLinks('<a href="/tenders-results/">תוצאות מכרזים</a>',
    'https://www.x.muni.il/');
  assert.strictEqual(onlyArchive.length, 1, 'בהיעדר חלופה עדיין מוחזר משהו');
});

// שני מקרים שנצפו בסריקה אמיתית: באתר אוניברסיטת תל אביב הגילוי נחת על דף
// הבית עצמו, ובאתר הדסה האקדמית על "דרושים במכללה" — עמוד משרות, לא מכרזים.
test('הגילוי מדלג על קישור לעמוד עצמו ועל דפי דרושים', () => {
  const html = `
    <a href="/">מכרזים</a>
    <a href="#">מכרזים ומידע</a>
    <a href="/bidding">מכרזי רכש</a>
    <a href="/careers/jobs">דרושים במכללה</a>
    <a href="/michrazim-vedrushim/">מכרזים ודרושים</a>`;
  // דף הבית של האתר מוגש מ-"/he" בעוד שקישור התפריט מצביע על "/" — לכן גם
  // השוואה לעמוד הנוכחי וגם פסילת שורש האתר נדרשות
  const urls = R.findTenderLinks(html, 'https://www.tau.ac.il/he').map(l => l.url);
  assert.ok(!urls.some(u => R.isSiteRoot(u)),
    'שורש האתר אינו נבחר כעמוד מכרזים: ' + urls.join(' , '));
  assert.ok(urls[0].endsWith('/bidding'), 'עמוד המכרזים נבחר ראשון');
  assert.ok(!urls.some(u => u.includes('/careers/')), 'עמוד דרושים בלבד אינו נבחר');
  // הדסה האקדמית: הנתיב מכיל "דרושים-ומכרזים" אבל העמוד עצמו הוא "דרושים-במכללה"
  const hac = R.findTenderLinks(
    '<a href="/דרושים-ומכרזים/דרושים-במכללה/">דרושים ומכרזים</a><a href="/tenders/">מכרזים</a>',
    'https://www.hac.ac.il/').map(l => decodeURIComponent(l.url));
  assert.ok(hac[0].endsWith('/tenders/'), 'עמוד המכרזים נבחר, לא עמוד הדרושים: ' + hac.join(' , '));
  assert.ok(!hac.some(u => u.includes('דרושים-במכללה')), 'עמוד דרושים לפי שם העמוד נפסל');
  assert.ok(urls.some(u => u.includes('michrazim-vedrushim')),
    'עמוד משולב "מכרזים ודרושים" כן נשאר — ברשויות רבות זה אותו עמוד');

  assert.ok(R.sameUrl('https://x.co.il/a/', 'https://x.co.il/a'));
  assert.ok(R.sameUrl('https://x.co.il/#top', 'https://x.co.il/'));
  assert.ok(!R.sameUrl('https://x.co.il/a', 'https://x.co.il/b'));
});
