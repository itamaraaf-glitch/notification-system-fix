// תקציר יומי אוטומטי: קורא את נתוני ה-CRM מענן הסנכרון ופותח Issue —
// GitHub שולח אותו למייל של בעל המאגר. רץ מ-GitHub Actions לפי לו"ז.
const crypto = require('crypto');

const DB_URL = (process.env.FIREBASE_DB_URL || '').trim().replace(/\/+$/, '');
const SYNC_CODE = (process.env.SYNC_CODE || '').trim();
const GH_TOKEN = process.env.GH_TOKEN;
const REPO = process.env.REPO;
const OWNER = process.env.OWNER;
const GH_API = process.env.GH_API || 'https://api.github.com';

const sha256 = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const fmtN = n => !n ? '–' : '₪' + Number(n).toLocaleString('he-IL');
const fmtD = s => { if (!s) return '–'; const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };

async function main() {
  if (!DB_URL || !SYNC_CODE) {
    console.log('FIREBASE_DB_URL / SYNC_CODE not configured — skipping (add repo secrets to enable the daily email digest).');
    return;
  }
  const hash = sha256('cem:' + SYNC_CODE);
  // שני מסלולי אחסון אפשריים: מצב REST פשוט ומצב Firebase SDK מלא
  const paths = ['cem_hot_' + hash.substring(0, 24), 'crm/' + hash.substring(0, 32)];
  let D = null;
  for (const p of paths) {
    try {
      const r = await fetch(`${DB_URL}/${p}.json`);
      if (!r.ok) continue;
      const j = await r.json();
      if (j && j.data) { D = j.data; break; }
    } catch (e) { /* try next path */ }
  }
  if (!D) { console.log('No CRM data found in cloud — nothing to digest.'); return; }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  const heDate = new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

  const mtgs = (D.meetings || []).filter(m => m.dt === today && m.hl !== 'מבוטל')
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const tenders = (D.tenders || []).filter(t => t.deadline && t.submitted !== 'כן' &&
    dayDiff(today, t.deadline) >= 0 && dayDiff(today, t.deadline) <= 5);
  const stuckDeals = (D.deals || []).filter(d => d.date && d.st !== 'נסגר' &&
    (new Date(today) - new Date(d.date)) / (30 * 86400000) > 3);
  const stuckDists = (D.dists || []).filter(d => d.dt && d.st !== 'הושלם' && dayDiff(d.dt, today) > 7);
  const openSalary = (D.salary || []).filter(s => s.st !== 'סגור' && (s.pv || 0) > 0);
  const openSalarySum = openSalary.reduce((s, x) => s + (x.pv || 0), 0);

  const L = [];
  L.push(`## 📣 תקציר בוקר — ${heDate}`);
  L.push('');
  L.push('### 📅 פגישות היום');
  L.push(mtgs.length
    ? mtgs.map(m => `- **${m.time || 'ללא שעה'}** — ${m.cl || ''}${m.mtype && m.mtype !== 'פגישה' ? ` (${m.mtype})` : ''}${m.no ? ` — ${m.no}` : ''}`).join('\n')
    : '- אין פגישות ביומן היום');
  if (tenders.length) {
    L.push('', '### 📋 מכרזים לפני מועד הגשה');
    L.push(tenders.map(t => `- **${t.name}** — הגשה עד ${fmtD(t.deadline)} (${dayDiff(today, t.deadline)} ימים)${t.amount ? ` | היקף: ${fmtN(t.amount)}` : ''}`).join('\n'));
  }
  if (stuckDeals.length) {
    L.push('', `### 💼 עסקאות תקועות מעל 3 חודשים (${stuckDeals.length})`);
    L.push(stuckDeals.slice(0, 8).map(d => `- ${d.co || ''}${d.srv ? ` · ${d.srv}` : ''} — ${d.st || 'פתוח'} מאז ${fmtD(d.date)} | ${fmtN(d.v)}`).join('\n'));
    if (stuckDeals.length > 8) L.push(`- _ועוד ${stuckDeals.length - 8}..._`);
  }
  if (stuckDists.length) {
    L.push('', `### 🚀 פרויקטי הפצה תקועים (${stuckDists.length})`);
    L.push(stuckDists.slice(0, 8).map(d => `- ${d.co || ''}${d.no ? ` · #${d.no}` : ''} — ${d.st || ''}${d.hd ? ` | מנהל: ${d.hd}` : ''}${d.mi ? ` | חוסרים: ${d.mi}` : ''}`).join('\n'));
  }
  if (openSalary.length) {
    L.push('', `### 💰 שכר לא ממומש — ${openSalary.length} פרויקטים, יתרה ${fmtN(openSalarySum)}`);
  }
  L.push('', '---', `[פתח את המערכת ←](https://${(REPO || '').split('/')[0]}.github.io/${(REPO || '').split('/')[1]}/crm.html)`);
  const body = L.join('\n');

  const gh = (path, method, payload) => fetch(`${GH_API}/repos/${REPO}${path}`, {
    method: method || 'GET',
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'hot-crm-digest' },
    body: payload ? JSON.stringify(payload) : undefined,
  });

  // סוגרים תקצירים קודמים כדי שלא יצטברו
  try {
    const prev = await (await gh('/issues?labels=daily-digest&state=open&per_page=20')).json();
    for (const iss of (Array.isArray(prev) ? prev : [])) await gh(`/issues/${iss.number}`, 'PATCH', { state: 'closed' });
  } catch (e) { /* non-fatal */ }

  const res = await gh('/issues', 'POST', {
    title: `📣 תקציר יומי — ${fmtD(today)} | ${mtgs.length} פגישות · ${tenders.length + stuckDeals.length + stuckDists.length} דורשי טיפול`,
    body,
    labels: ['daily-digest'],
    assignees: OWNER ? [OWNER] : [],
  });
  if (!res.ok) throw new Error('issue creation failed: HTTP ' + res.status + ' ' + await res.text());
  const iss = await res.json();
  console.log('Digest issue created:', iss.number, '- GitHub will email the owner.');
}

main().catch(e => { console.error(e); process.exit(1); });
