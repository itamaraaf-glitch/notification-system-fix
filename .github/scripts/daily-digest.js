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
// פענוח AES-256-GCM — תואם להצפנה מקצה-לקצה של המערכת (WebCrypto)
function decryptCloud(b64, code) {
  const key = crypto.pbkdf2Sync('cem_e2e:' + code, 'cem_hot_e2e_salt_v1', 150000, 32, 'sha256');
  const raw = Buffer.from(b64, 'base64');
  const iv = raw.subarray(0, 12), tag = raw.subarray(raw.length - 16), ct = raw.subarray(12, raw.length - 16);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString('utf8'));
}
const fmtN = n => !n ? '–' : '₪' + Number(n).toLocaleString('he-IL');
const fmtD = s => { if (!s) return '–'; const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };

const VAPID_PUBLIC = 'BPy0QcdZss3O2bNqA0lXYkj04Xy-4GZWCaDBt5U3P0Y7pL0cewxshdQQaN8Poy59SraiARDf9O7MDbjgnfks9cU';

// שליחת דחיפת Web Push לכל המכשירים הרשומים (המינויים שמורים מוצפנים בענן)
async function sendPush(title, body, tag) {
  const priv = (process.env.VAPID_PRIVATE_KEY || '').trim();
  if (!priv) { console.log('VAPID_PRIVATE_KEY not set — skipping phone push'); return 0; }
  let webpush;
  try { webpush = require('web-push'); } catch (e) { console.log('web-push module missing — skipping'); return 0; }
  const hash = sha256('cem:' + SYNC_CODE);
  let subs = null;
  try {
    const r = await fetch(`${DB_URL}/cem_hot_push_${hash.substring(0, 16)}.json`);
    if (r.ok) { const j = await r.json(); if (j && j.enc === 1) subs = decryptCloud(j.data, SYNC_CODE); }
  } catch (e) {}
  if (!subs) { console.log('no push subscriptions registered yet'); return 0; }
  webpush.setVapidDetails('mailto:noreply@users.noreply.github.com', VAPID_PUBLIC, priv);
  const list = subs.endpoint ? [subs] : Object.values(subs);
  const payload = JSON.stringify({ title, body, tag });
  let sent = 0;
  for (const sub of list) {
    try { await webpush.sendNotification(sub, payload, { TTL: 3600 }); sent++; }
    catch (e) { console.log('push failed:', e.statusCode || e.message); }
  }
  console.log('pushes sent:', sent, '/', list.length);
  return sent;
}

// השעה בישראל כרגע (עשרוני: 9.5 = 09:30)
function ilNow() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  const [h, m] = p.split(':').map(Number);
  return h + m / 60;
}

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
      if (!j) continue;
      // פורמט מוצפן מקצה-לקצה (enc:1) — פענוח עם מפתח הנגזר מקוד הסנכרון
      if (j.enc === 1 && typeof j.data === 'string') {
        try { D = decryptCloud(j.data, SYNC_CODE); break; } catch (e) { console.log('decrypt failed for', p); }
      } else if (j.data && typeof j.data === 'object') { D = j.data; break; }
    } catch (e) { /* try next path */ }
  }
  if (!D) { console.log('No CRM data found in cloud — nothing to digest.'); return; }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  const heDate = new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

  const mtgs = (D.meetings || []).filter(m => m.dt === today && m.hl !== 'מבוטל')
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  const nowIL = ilNow();
  const force = !!process.env.FORCE_DIGEST;
  // תזכורות פגישה לטלפון: פגישות שמתחילות בעוד 5–35 דקות (הריצה כל 30 דק׳ — בלי כפילויות)
  for (const m of mtgs) {
    if (!m.time || m.hl === 'כן') continue;
    const [h, mi] = m.time.split(':').map(Number);
    const diffMin = (h + mi / 60 - nowIL) * 60;
    if (diffMin > 5 && diffMin <= 35) {
      await sendPush('⏰ פגישה בעוד ' + Math.round(diffMin) + ' דק׳ — ' + (m.cl || ''), m.time + (m.no ? '\n' + m.no : ''), 'meet-' + (m.id || m.time));
    }
  }
  // תקציר בוקר: רק בריצה של חלון 07:00–08:00 (או בהרצה ידנית)
  const morning = nowIL >= 7 && nowIL < 8;
  if (!morning && !force) { console.log('not the morning window — reminders only'); return; }
  const pushBody = (mtgs.length
    ? '📅 ' + mtgs.length + ' פגישות היום: ' + mtgs.map(m => (m.time ? m.time + ' ' : '') + (m.cl || '')).join(', ')
    : '📅 אין פגישות ביומן היום');
  await sendPush('📣 תקציר בוקר — HOT CRM', pushBody, 'daily-digest');
  const tenders = (D.tenders || []).filter(t => t.deadline && t.submitted !== 'כן' &&
    dayDiff(today, t.deadline) >= 0 && dayDiff(today, t.deadline) <= 5);
  const stuckDeals = (D.deals || []).filter(d => d.date && d.st !== 'נסגר' &&
    (new Date(today) - new Date(d.date)) / (30 * 86400000) > 3);
  const stuckDists = (D.dists || []).filter(d => d.dt && d.st !== 'הושלם' && dayDiff(d.dt, today) > 7);
  const openSalary = (D.salary || []).filter(s => s.st !== 'סגור' && (s.pv || 0) > 0);
  const openSalarySum = openSalary.reduce((s, x) => s + (x.pv || 0), 0);

  // אבטחה: במאגר ציבורי ה-Issues גלויים לכולם — מפרסמים מספרים בלבד, בלי שמות לקוחות
  const gh0 = (path, method, payload) => fetch(`${GH_API}/repos/${REPO}${path}`, {
    method: method || 'GET',
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'hot-crm-digest' },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  let isPublic = true;
  try { const info = await (await gh0('')).json(); isPublic = !info.private; } catch (e) {}

  if (isPublic) {
    const L2 = [];
    L2.push(`## 📣 תקציר בוקר — ${heDate}`);
    L2.push('', '_המאגר ציבורי — התקציר מציג מספרים בלבד; הפרטים המלאים במערכת._', '');
    L2.push(`- 📅 פגישות היום: **${mtgs.length}**${mtgs.length ? ' (ראשונה ב-' + (mtgs[0].time || 'ללא שעה') + ')' : ''}`);
    if (tenders.length) L2.push(`- 📋 מכרזים לפני מועד הגשה: **${tenders.length}**`);
    if (stuckDeals.length) L2.push(`- 💼 עסקאות תקועות מעל 3 חודשים: **${stuckDeals.length}**`);
    if (stuckDists.length) L2.push(`- 🚀 פרויקטי הפצה תקועים: **${stuckDists.length}**`);
    if (openSalary.length) L2.push(`- 💰 שכר לא ממומש: **${openSalary.length} פרויקטים**, יתרה ${fmtN(openSalarySum)}`);
    L2.push('', '---', `[פתח את המערכת לפרטים המלאים ←](https://${(REPO || '').split('/')[0]}.github.io/${(REPO || '').split('/')[1]}/crm.html)`);
    return await publishIssue(gh0, `📣 תקציר יומי — ${fmtD(today)} | ${mtgs.length} פגישות · ${tenders.length + stuckDeals.length + stuckDists.length} דורשי טיפול`, L2.join('\n'));
  }

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

  await publishIssue(gh0, `📣 תקציר יומי — ${fmtD(today)} | ${mtgs.length} פגישות · ${tenders.length + stuckDeals.length + stuckDists.length} דורשי טיפול`, body);
}

async function publishIssue(gh, title, body) {
  // סוגרים תקצירים קודמים כדי שלא יצטברו
  try {
    const prev = await (await gh('/issues?labels=daily-digest&state=open&per_page=20')).json();
    for (const iss of (Array.isArray(prev) ? prev : [])) await gh(`/issues/${iss.number}`, 'PATCH', { state: 'closed' });
  } catch (e) { /* non-fatal */ }
  const res = await gh('/issues', 'POST', {
    title, body,
    labels: ['daily-digest'],
    assignees: OWNER ? [OWNER] : [],
  });
  if (!res.ok) throw new Error('issue creation failed: HTTP ' + res.status + ' ' + await res.text());
  const iss = await res.json();
  console.log('Digest issue created:', iss.number, '- GitHub will email the owner.');
}

main().catch(e => { console.error(e); process.exit(1); });
