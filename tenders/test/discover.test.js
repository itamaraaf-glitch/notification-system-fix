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
  const stored = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'data', 'tenders.json'), 'utf8'));
  assert.strictEqual(payload.counts.total, (stored.tenders || []).length,
    'המכרזים שבמאגר נשמרים גם כשאף מקור לא נסרק');
});
