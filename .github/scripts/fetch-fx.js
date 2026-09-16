#!/usr/bin/env node
/**
 * מושך את שער הדולר היציג של בנק ישראל וכותב אותו ל-fx-rate.json בשורש המאגר.
 *
 * למה בכלל בצד השרת: הדפדפן לא תמיד יכול לפנות ישירות ל-boi.org.il (מדיניות
 * CORS של האתר, רשתות ארגוניות חוסמות, והאפליקציה גם רצה כ-PWA לא מקוון).
 * ריצה כאן — על מריץ של GitHub עם אינטרנט פתוח — הופכת את השער לקובץ סטטי
 * שה-CRM קורא מאותו מקור (same-origin), בלי CORS ובלי לפתוח את ה-CSP.
 *
 * השדה src מתעד מאיפה הגיע המספר. אין כאן "שער ברירת מחדל": אם אף מקור לא
 * השיב, הקובץ הקיים נשאר כמו שהוא ויוצאים בקוד 1 — עדיף שער ישן עם תאריך
 * גלוי מאשר מספר שהומצא ומוצג כשער יציג.
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '..', 'fx-rate.json');
const TIMEOUT_MS = 20000;

async function getJson(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

/** בנק ישראל — המקור הרשמי לשער היציג. */
async function fromBoi() {
  const j = await getJson('https://boi.org.il/PublicApi/GetExchangeRate?key=USD');
  const rate = Number(j.currentExchangeRate) / (Number(j.unit) || 1);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('שדה שער לא תקין');
  return { rate, date: String(j.lastUpdate || '').slice(0, 10), src: 'boi' };
}

/** גיבוי מסומן במפורש כלא-יציג — כדי שלא ייקרא בטעות כשער הרשמי. */
async function fromMarket() {
  const j = await getJson('https://api.frankfurter.app/latest?from=USD&to=ILS');
  const rate = Number(j.rates && j.rates.ILS);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('שדה שער לא תקין');
  return { rate, date: j.date || new Date().toISOString().slice(0, 10), src: 'market' };
}

(async () => {
  const problems = [];
  for (const [name, fn] of [['בנק ישראל', fromBoi], ['שער שוק', fromMarket]]) {
    try {
      const got = await fn();
      const out = {
        rate: Math.round(got.rate * 10000) / 10000,
        date: got.date,
        src: got.src,
        fetchedAt: new Date().toISOString(),
      };
      const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
      const next = JSON.stringify(out, null, 2) + '\n';
      // כותבים רק כשהשער או התאריך השתנו — כדי לא ליצור commit ריק כל יום
      const same = (() => {
        try { const p = JSON.parse(prev); return p.rate === out.rate && p.date === out.date && p.src === out.src; }
        catch (e) { return false; }
      })();
      if (same) { console.log(`ללא שינוי: ${out.rate} ₪ לדולר (${out.date}, ${out.src})`); process.exit(0); }
      fs.writeFileSync(OUT, next);
      console.log(`נכתב fx-rate.json: ${out.rate} ₪ לדולר · ${out.date} · ${out.src} (${name})`);
      process.exit(0);
    } catch (e) {
      problems.push(`${name}: ${e.message}`);
    }
  }
  console.error('לא התקבל שער מאף מקור — הקובץ הקיים נשאר ללא שינוי');
  problems.forEach(p => console.error('  · ' + p));
  process.exit(1);
})();
