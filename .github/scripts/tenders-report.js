#!/usr/bin/env node
'use strict';
/**
 * דיווח על תוצאות ראדאר המכרזים.
 *   --summary : מדפיס סיכום Markdown (לשימוש ב-GITHUB_STEP_SUMMARY)
 *   --issue   : פותח Issue עם המכרזים החדשים (רק אם נמצאו חדשים)
 *
 * דורש GH_TOKEN ו-REPO עבור --issue.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA_FILE = path.join(ROOT, 'tenders', 'data', 'tenders.json');
const MODE_SUMMARY = process.argv.includes('--summary');
const MODE_ISSUE = process.argv.includes('--issue');

function load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (e) { return null; }
}

function fmtDate(ymd) {
  if (!ymd) return '–';
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}
function daysLeft(ymd) {
  if (!ymd) return null;
  const t = Date.parse(ymd + 'T00:00:00Z');
  if (isNaN(t)) return null;
  const now = Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  return Math.round((t - now) / 86400000);
}
function topicLabels(data, topics) {
  return (topics || []).map(id => {
    const t = data.topics && data.topics[id];
    return t ? `${t.icon} ${t.label}` : id;
  }).join(' · ');
}

function summary(data) {
  const c = data.counts || {};
  const lines = [];
  lines.push('## 📡 ראדאר מכרזים');
  lines.push('');
  lines.push(`עודכן: ${data.generatedDate || '–'}`);
  lines.push('');
  lines.push(`| סה"כ במאגר | חדשים היום | פתוחים | נסגרים בשבוע הקרוב |`);
  lines.push(`| --- | --- | --- | --- |`);
  lines.push(`| ${c.total || 0} | ${c.new || 0} | ${c.open || 0} | ${c.closingSoon || 0} |`);
  lines.push('');

  const byTopic = c.byTopic || {};
  if (Object.keys(byTopic).length) {
    lines.push('### לפי נושא');
    lines.push('');
    lines.push('| נושא | כמות |');
    lines.push('| --- | --- |');
    for (const [id, n] of Object.entries(byTopic).sort((a, b) => b[1] - a[1])) {
      const t = data.topics && data.topics[id];
      lines.push(`| ${t ? t.icon + ' ' + t.label : id} | ${n} |`);
    }
    lines.push('');
  }

  lines.push('### בריאות המקורות');
  lines.push('');
  lines.push('| מקור | מצב | נסרקו | רלוונטיים | הערה |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const s of (data.sources || [])) {
    lines.push(`| ${s.name} | ${s.ok ? '✅' : '❌'} | ${s.scanned || 0} | ${s.count || 0} | ${s.error || ''} |`);
  }
  const failed = (data.sources || []).filter(s => !s.ok);
  if (failed.length) {
    const subject = failed.length === 1 ? 'מקור אחד לא נסרק' : `${failed.length} מקורות לא נסרקו`;
    lines.push('');
    lines.push(`> ${subject}. מקור שמוגש כיישום JavaScript לא ניתן לקצירה אוטומטית — יש לבדוק אותו ידנית דרך הקישור בממשק הראדאר, או להחליף אותו במקור חלופי ב-\`tenders/config/sources.json\`.`);
  }
  return lines.join('\n');
}

function issueBody(data, fresh) {
  const lines = [];
  lines.push(`נמצאו **${fresh.length}** מכרזים חדשים הרלוונטיים לתקשורת, ציוד תקשורת, אבטחת מידע ו-IT.`);
  lines.push('');

  const groups = new Map();
  for (const t of fresh) {
    const key = (t.topics && t.topics[0]) || 'other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  for (const [topicId, items] of groups) {
    const t = data.topics && data.topics[topicId];
    lines.push(`### ${t ? t.icon + ' ' + t.label : topicId}`);
    lines.push('');
    for (const item of items) {
      const dl = daysLeft(item.deadlineAt);
      const dlText = item.deadlineAt
        ? `${fmtDate(item.deadlineAt)}${dl !== null ? (dl < 0 ? ' (חלף)' : dl === 0 ? ' (היום!)' : ` (בעוד ${dl} ימים)`) : ''}`
        : 'לא אותר';
      lines.push(`- **[${item.title}](${item.url})**`);
      lines.push(`  - מפרסם: ${item.publisher || item.sourceName}${item.tenderNumber ? ` | מס׳ מכרז: ${item.tenderNumber}` : ''}`);
      lines.push(`  - מועד הגשה: ${dlText}${item.publishedAt ? ` | פורסם: ${fmtDate(item.publishedAt)}` : ''}`);
      if (item.matched && item.matched.length) {
        lines.push(`  - התאמות: ${item.matched.slice(0, 6).join(', ')}`);
      }
    }
    lines.push('');
  }

  const failed = (data.sources || []).filter(s => !s.ok);
  if (failed.length) {
    lines.push('---');
    lines.push('');
    lines.push(`**מקורות שלא נסרקו הפעם:** ${failed.map(s => s.name).join(', ')} — כדאי לבדוק אותם ידנית.`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('_נוצר אוטומטית על ידי ראדאר המכרזים. הרשימה המלאה, כולל סינון לפי נושא וייצוא ל-CRM, זמינה בעמוד `tenders.html`._');
  return lines.join('\n');
}

async function openIssue(data, fresh) {
  const token = process.env.GH_TOKEN;
  const repo = process.env.REPO;
  if (!token || !repo) {
    console.error('חסרים GH_TOKEN או REPO — לא נפתח Issue');
    return;
  }
  const title = `📡 ראדאר מכרזים — ${fresh.length} מכרזים חדשים (${data.generatedDate})`;
  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'tenders-radar'
    },
    body: JSON.stringify({ title, body: issueBody(data, fresh) })
  });
  if (!res.ok) {
    console.error(`פתיחת Issue נכשלה: HTTP ${res.status} ${await res.text()}`);
    process.exitCode = 1;
    return;
  }
  const created = await res.json();
  console.error(`✔ נפתח Issue #${created.number}`);
}

async function main() {
  const data = load();
  if (!data) {
    const msg = 'לא נמצא tenders/data/tenders.json — הריצה הקודמת לא הפיקה נתונים.';
    if (MODE_SUMMARY) console.log('## 📡 ראדאר מכרזים\n\n' + msg);
    else console.error(msg);
    return;
  }

  if (MODE_SUMMARY) {
    console.log(summary(data));
    return;
  }

  if (MODE_ISSUE) {
    const fresh = (data.tenders || []).filter(t => t.firstSeen === data.generatedDate);
    if (!fresh.length) {
      console.error('אין מכרזים חדשים — לא נפתח Issue');
      return;
    }
    await openIssue(data, fresh);
  }
}

if (require.main === module) {
  main().catch(e => {
    console.error('✖ הדיווח נכשל:', e && e.stack || e);
    process.exit(1);
  });
}

module.exports = { summary, issueBody, fmtDate, daysLeft, topicLabels };
