# 📊 סוכן AI - מדריך דשבורד

דשבורד בזמן אמת לניטור וניהול הסוכן AI היוזם.

## הפעלה מהירה

### דרך 1: דשבורד + שרת API

```bash
npm run dashboard
```

ואז פתח את הדשבורד:
```
http://localhost:3000/ai-dashboard.html
```

### דרך 2: שרת עם שרת export (ישן)

```bash
npm run export-server
```

כולל כל endpoints ה-API וגם את ה-export.

---

## מה הדשבורד מראה?

### 📊 סטטיסטיקות
- **התראות שנותחו** — כמה התראות עברו ניתוח
- **משובים שנלמדו** — כמה משובים נרשמו מהמשתמש
- **חריגויות** — כמה חריגויות גילה הסוכן
- **דיוק** — אחוז דיוק החיזוי הנוכחי

### 🧠 מדדי למידה
- **משובים כוללים** — סך המשובים שנאספו
- **דיוק כללי** — דיוק כללי על כל הנתונים
- **שיפור** — שיפור בדיוק מהמחזור הקודם
- **MAE** — Mean Absolute Error (שגיאה ממוצעת)

### ⚙️ מצב המערכת
- **קריטיים בשעה** — כמה התראות HIGH בשעה האחרונה
- **גבוהים בשעה** — כמה התראות MEDIUM בשעה האחרונה
- **חריגויות** — מספר חריגויות שהתגלו
- **מצב** — סטטוס בריאות המערכת (בריא/זהירות/קריטי)

### 🧠 החלטות אחרונות
רשימה של ההחלטות האוטונומיות שהסוכן קבע בתאריך הנוכחי:

- **escalate** — דרוג לניהול (קריטיים > 5)
- **investigate** — חקירה עמוקה (חריגויות > 3)
- **retrain** — בקשת משוב (דיוק < 70%)
- **auto_process** — עיבוד אוטומטי (מערכת יציבה)

### ✅ פעולות שבוצעו
פעולות שהסוכן ביצע בפועל:
- שליחת אלרטים
- יצירת דוחות
- בקשות משוב
- עיבוד התראות נמוכות

### 📋 לוגים בזמן אמת
רישום של כל אירוע:
- 🟢 **ירוק** — מידע רגיל (✅)
- 🟡 **צהוב** — אזהרה (⚠️)
- 🔴 **אדום** — שגיאה (❌)

---

## API Endpoints

### סטטוס ומדדים

#### `GET /api/agent/status`
מצב מלא של הסוכן:
```json
{
  "isRunning": true,
  "uptime": 3600000,
  "situation": { "criticalCount": 2, "highCount": 5 },
  "recentDecisions": [...],
  "recentActions": [...],
  "logs": [...],
  "stats": { "analyzed": 100, "learned": 25 }
}
```

#### `GET /api/agent/metrics`
מדדים קבילים עבור דשבורד:
```json
{
  "analyzed": 100,
  "learned": 25,
  "anomalies": 3,
  "accuracy": 0.78,
  "criticalCount": 2,
  "highCount": 5,
  "isRunning": true
}
```

#### `GET /api/agent/decisions`
רשימת החלטות אחרונות

#### `GET /api/agent/actions`
רשימת פעולות שבוצעו

#### `GET /api/agent/logs?limit=20`
לוגים עם אפשרות limit

### שליטה בסוכן

#### `POST /api/agent/start`
הפעל את הסוכן:
```bash
curl -X POST http://localhost:3000/api/agent/start
```

#### `POST /api/agent/stop`
עצור את הסוכן:
```bash
curl -X POST http://localhost:3000/api/agent/stop
```

---

## דוגמות שימוש

### 1. טעינה ממלונה בעצמך

```javascript
// טוען נתונים מה-API
fetch('http://localhost:3000/api/agent/metrics')
  .then(r => r.json())
  .then(metrics => {
    console.log(`דיוק: ${metrics.accuracy * 100}%`);
    console.log(`קריטיים: ${metrics.criticalCount}`);
  });
```

### 2. הפעלת סוכן מקוד

```javascript
// הפעל סוכן
fetch('http://localhost:3000/api/agent/start', { method: 'POST' })
  .then(r => r.json())
  .then(result => console.log(result.message));

// חכה 10 דקות
setTimeout(() => {
  // עצור סוכן
  fetch('http://localhost:3000/api/agent/stop', { method: 'POST' });
}, 600000);
```

### 3. ניטור בזמן אמת

```javascript
// Polling כל 5 שניות
setInterval(() => {
  fetch('http://localhost:3000/api/agent/logs?limit=5')
    .then(r => r.json())
    .then(logs => {
      logs.forEach(log => {
        console.log(`[${log.timestamp}] ${log.message}`);
      });
    });
}, 5000);
```

---

## חלונות הדשבורד

### סטטוס הסוכן
חלון בחלק העליון של הדשבורד המראה:
- 🟢 **סוכן פעיל** — הסוכן רץ בעבודתו
- 🔴 **סוכן עצור** — הסוכן כבוי

### כפתורים

| כפתור | תיאור |
|-------|-------|
| 🟢 הפעל | התחל מחזור יוזם חדש |
| 🛑 עצור | עצור את הסוכן |
| 🔄 רענן | טען נתונים טריים מ-API |

---

## הגדרות מתקדמות

### שינוי interval בדיקה

בקובץ `start-dashboard.js`:
```javascript
let agent = new ProactiveAIAgent({
  decisionInterval: 30000,  // כל 30 שניות (ברירת מחדל)
  batchSize: 20
});
```

סטימות נפוצות:
- `10000` — כל 10 שניות (בדיקה תכופה)
- `30000` — כל 30 שניות (ברירת מחדל)
- `60000` — כל דקה (בדיקה ריכוכה)
- `300000` — כל 5 דקות (בדיקה מינימלית)

### שינוי port

```bash
PORT=5000 npm run dashboard
```

---

## בעיות ותיקונים

### "Cannot connect to API"

ודא שהשרת רץ:
```bash
npm run dashboard
```

בדוק שפורט 3000 זמין:
```bash
lsof -i :3000
```

### "Dashboard shows empty data"

1. ודא שיש נתונים בבסיס הנתונים
2. בדוק את הלוגים: http://localhost:3000/api/agent/logs
3. כדי לטעון דיווח של ניתוח:
   ```bash
   npm run ai-agent
   ```

### "Agent won't start"

בדוק שהסוכן מתוחזק בהתקנה:
```bash
node -e "const A = require('./ai-proactive-agent'); console.log('OK')"
```

---

## שדרוג לעתיד

- [ ] WebSocket support for real-time updates
- [ ] Historical data persistence
- [ ] Admin panel for threshold configuration
- [ ] Email/Slack integration for escalations
- [ ] User feedback collection UI
- [ ] Decision override capability
- [ ] Performance analytics

---

## הפניות

- **AI Agent Guide** — `AI_AGENT_GUIDE.md`
- **Proactive Agent** — `PROACTIVE_AGENT_GUIDE.md`
- **Export System** — `EXPORT_GUIDE.md`

---

**סוכן AI שלך עכשיו עם דשבורד בזמן אמת! 🚀**
