# 🤖 סוכן AI יוזם - מדריך מלא

סוכן עצמאי שלא רק מנתח, אלא **יוזם פעולות בעצמו** בהתאם למצב המערכת.

## הבדלים: סוכן רגיל vs יוזם

| תכונה | רגיל | יוזם |
|-------|------|------|
| **ניתוח** | ✅ מנתח התראות | ✅ מנתח התראות |
| **למידה** | ✅ לומד מתוך משוב | ✅ לומד מתוך משוב |
| **יוזמה** | ❌ מגיב בלבד | ✅ **יוזם פעולות** |
| **החלטות** | ❌ תיעוד בלבד | ✅ **מחליט ופועל** |
| **אקלות** | ❌ לא משדר | ✅ **שולח הודעות** |
| **שחזור** | ❌ רב-טיפול | ✅ **מתקן בעצמו** |

---

## מצבי פעולה יוזמה

הסוכן יוזם פעולות ב-4 מצבים:

### 1️⃣ **Escalation (דרוג)**
**כש:** `מספר קריטיים > 5 בשעה`
**פעולה:** 🚨 שלח אלרט לניהול וצוות
```json
{
  "type": "escalate",
  "reason": "5 critical alerts in last hour",
  "action": "escalate_to_management",
  "recipients": ["manager@company.com"]
}
```

### 2️⃣ **Investigation (חקירה)**
**כש:** `3+ חריגויות שגילו`
**פעולה:** 📋 יצור דוח חריגויות מפורט
```json
{
  "type": "investigate",
  "reason": "3 anomalies detected",
  "action": "generate_anomaly_report"
}
```

### 3️⃣ **Retrain (שיפור מודל)**
**כש:** `דיוק < 70%`
**פעולה:** 🧠 בקש משוב מהמשתמש
```json
{
  "type": "retrain",
  "reason": "Accuracy below 70%",
  "action": "request_feedback_loop"
}
```

### 4️⃣ **Auto-Process (עיבוד אוטומטי)**
**כש:** `0 קריטיים, מעט גבוהים`
**פעולה:** ⚙️ עבד התראות נמוכות בעצמך
```json
{
  "type": "auto_process",
  "reason": "System stable",
  "action": "auto_categorize_low_priority"
}
```

### 5️⃣ **Recovery (שחזור)**
**כש:** `הסוכן לא פעיל`
**פעולה:** 🔄 הפעל את עצמך מחדש
```json
{
  "type": "recovery",
  "reason": "Agent not running",
  "action": "restart_agent"
}
```

---

## הפעלה

### דרך 1: בדיקה מהירה
```bash
npm run ai-agent:proactive
```
צפה בהחלטות והפעולות בזמן אמת

### דרך 2: Daemon (ייצור)
```bash
node ai-proactive-agent.js start
node ai-proactive-agent.js status
node ai-proactive-agent.js stop
```

### דרך 3: עם NPM Scripts
```bash
npm run ai-agent:proactive:daemon  # תנע
tail -f ai-agent-proactive.log     # צפה בלוגים
```

---

## אירועים שמשדר

| אירוע | נתונים | משמעות |
|-------|--------|--------|
| `situation-analyzed` | `{criticalCount, highCount}` | ניתוח מצב המערכת |
| `decisions-made` | `[{type, reason}]` | החלטות שהתקבלו |
| `action-taken` | `{decision, status}` | פעולה בוצעה |
| `notification` | `{level, title, message}` | שיגור הודעה |
| `report-generated` | `{type, report}` | דוח נוצר |
| `feedback-request` | `{title, message}` | בקשת משוב |
| `proactive-cycle-complete` | `timestamp` | מחזור הסתיים |

---

## דוגמה: שימוש בתוכנה

```javascript
const ProactiveAIAgent = require('./ai-proactive-agent');

const agent = new ProactiveAIAgent({
  escalationThreshold: 0.8,
  autoResponseThreshold: 0.75,
  emergencyThreshold: 0.9,
  decisionInterval: 60000 // כל דקה
});

// האזן להחלטות
agent.on('decisions-made', (data) => {
  console.log(`🧠 ${data.count} החלטות:`);
  data.decisions.forEach(d => {
    console.log(`   • ${d.type}: ${d.reason}`);
  });
});

// האזן לפעולות
agent.on('action-taken', (result) => {
  console.log(`✅ פעולה בוצעה: ${result.action}`);
});

// האזן לתראות
agent.on('notification', (notif) => {
  console.log(`📢 ${notif.level}: ${notif.message}`);
});

// האזן לדוחות
agent.on('report-generated', (data) => {
  console.log(`📋 דוח: ${data.type}`);
});

// הפעל
agent.startProactive();

// עצור
setTimeout(() => agent.stopProactive(), 3600000); // שעה
```

---

## תהליך החלטה (Decision Flow)

```
┌─────────────────────────────────────┐
│  1. ניתוח מצב (Situation Analysis)  │
│  ─────────────────────────────────  │
│  • כמה קריטיים?                     │
│  • כמה חריגויות?                    │
│  • מה הדיוק?                        │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  2. קבלת החלטות (Decision Making)  │
│  ─────────────────────────────────  │
│  IF קריטיים > 5 THEN דרוג           │
│  IF חריגויות > 3 THEN חקירה         │
│  IF דיוק < 70% THEN שיפור          │
│  IF יציב THEN עיבוד אוטומטי        │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  3. ביצוע פעולות (Execution)        │
│  ─────────────────────────────────  │
│  • שלח אלרטים                       │
│  • יצור דוחות                       │
│  • בקש משוב                         │
│  • עבד התראות                       │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  4. ניתוח רגיל (Standard Analysis)  │
│  ─────────────────────────────────  │
│  • ניתוח התראות חדשות              │
│  • גילוי חריגויות                   │
│  • עדכון מדדים                      │
└─────────────────────────────────────┘
```

---

## סינריוים לדוגמה

### סינריו 1: בעיה קריטית
```
⏰ 09:00
  - 8 התראות HIGH בשעה
  
🤖 סוכן יוזם:
  1. מזהה: קריטיים > 5
  2. מחליט: escalate
  3. שולח: אלרט לניהול 📢
  4. דוח: 📋 דוח מפורט
```

### סינריו 2: מערכת יציבה
```
⏰ 14:00
  - 0 קריטיים
  - 2 התראות בינוניות
  
🤖 סוכן יוזם:
  1. מזהה: יציב
  2. מחליט: auto_process
  3. עובד: 15 התראות נמוכות
  4. סיום: מערכת ניקיה ✅
```

### סינריו 3: דיוק נמוך
```
⏰ 11:00
  - דיוק: 65%
  - 20 משובים זמינים
  
🤖 סוכן יוזם:
  1. מזהה: דיוק < 70%
  2. מחליט: retrain
  3. בקש: משוב מהמשתמש 📧
  4. שיפור: מדגם חדש של היסטוריה
```

---

## הגדרות מתקדמות

```javascript
{
  // סף לדרוג בעיות
  escalationThreshold: 0.8,
  
  // סף לתגובה אוטומטית
  autoResponseThreshold: 0.75,
  
  // סף חירום (לעיתיד)
  emergencyThreshold: 0.9,
  
  // כמה פעמים לקחת החלטות
  decisionInterval: 60000,
  
  // בסיס נתונים
  dbPath: 'notifications.db',
  
  // גודל batch בניתוח
  batchSize: 50,
  
  // לוגים
  logFile: 'ai-agent-proactive.log'
}
```

---

## מדדים ודוחות

כל מחזור יוזם מייצר:

```json
{
  "timestamp": "2026-09-07T10:00:00Z",
  "phase": "proactive-cycle",
  
  "situation": {
    "criticalCount": 3,
    "highCount": 7,
    "anomalies": 2,
    "accuracy": 0.78,
    "trend": "stable"
  },
  
  "decisions": {
    "count": 1,
    "types": ["escalate"],
    "executed": 1
  },
  
  "actions": {
    "escalations": 1,
    "reports": 0,
    "feedbackRequests": 0,
    "autoProcessed": 0
  },
  
  "stats": {
    "analyzed": 15,
    "learned": 8,
    "anomaliesDetected": 2,
    "accuracy": 0.78
  }
}
```

---

## בעיות ותיקונים

### "Agent keeps restarting"
בדוק ב-`ai-agent-proactive.log` מה הבעיה.

### "Notifications not sent"
ודא שרכיבי האלרט מחוברים (email, Slack, וכו').

### "Auto-process not working"
ודא שיש התראות נמוכות וה-DB קיים.

---

## עתידות

סוכן יוכל להיות משופר:

- 🔗 **Slack Integration** — שלח אלרטים לSlack
- 📧 **Email Alerts** — שלח למנהלים
- 💾 **Action History** — שמור כל החלטה
- 📊 **Audit Log** — דוח כל פעולה
- 🎯 **Smart Escalation** — דרוג חכם לפי סוג
- 🔐 **Approval Workflow** — אישור בעיות קריטיות
- 🤝 **Human Feedback Loop** — שיפור מתוך תגובות אדם

---

**סוכן AI יוזם שלך עכשיו פעיל וקובע החלטות בעצמו!** 🚀🧠
