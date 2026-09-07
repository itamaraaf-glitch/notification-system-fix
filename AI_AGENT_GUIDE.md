# 🤖 סוכן AI עצמאי - מדריך שימוש

סוכן אוטונומי שמנתח התראות, לומד מתוך קבלת משוב, וזיהוי חריגויות.

## התקנה

```bash
npm install
```

## הפעלה מהירה

### דרך 1: ישיר (עבור בדיקה)

```bash
npm run ai-agent
```

צפה בתפוקה בזמן אמת בטרמינל.

### דרך 2: Daemon (לטווח ארוך)

```bash
node ai-agent-daemon.js start
```

הרץ ברקע עם logging.

### בדיקת סטטוס

```bash
node ai-agent-daemon.js status
```

### עצירה

```bash
node ai-agent-daemon.js stop
```

---

## מה הסוכן עושה?

### 🔄 מחזור עדכון (Cycle)

בכל 5 דקות (ניתן להגדרה):

1. **ניתוח** — מנתח התראות חדשות שלא נותחו
2. **למידה** — מקליט משוב ושיפורים בדיוק
3. **גילוי חריגויות** — מגלה דפוסים חריגים
4. **בדיקת קריטיים** — חוקר התראות HIGH בשעה האחרונה
5. **עדכון מדדים** — מחשב דיוק וכלי למידה

### 📊 תוצרי כל מחזור

```
سטטיסטיקות:
  • התראות שנותחו
  • משובים שנלמדו
  • חריגויות שהתגלו
  • דיוק עדכני

מדדי למידה:
  • משובים כוללים
  • דיוק כללי
  • שיפור (אם החיובי)
  • Mean Absolute Error (MAE)
```

---

## דוגמאות שימוש

### תוכנה (Node.js)

```javascript
const NotificationAIAgent = require('./ai-agent');

// יצור סוכן בהגדרות מותאמות
const agent = new NotificationAIAgent({
  autoAnalyzeInterval: 60000, // כל דקה
  batchSize: 100, // 100 התראות בכל מחזור
  anomalyCheckInterval: 300000 // חריגויות כל 5 דקות
});

// האזן לאירועים
agent.on('batch-analyzed', (data) => {
  console.log(`נותחו ${data.count} התראות`);
});

agent.on('anomalies-detected', (data) => {
  data.forEach(item => {
    console.log(`⚠️ חריגויות ב-${item.entity}`);
  });
});

agent.on('improvement-detected', (data) => {
  console.log(`📈 ${data.message}`);
});

agent.on('error', (error) => {
  console.error(`שגיאה: ${error.error}`);
});

// הפעל
agent.start();

// עצור אחרי 10 דקות
setTimeout(() => agent.stop(), 600000);
```

### שורת פקודה

```bash
# התחל סוכן ב-daemon mode
node ai-agent-daemon.js start

# בדוק סטטוס
node ai-agent-daemon.js status

# צפה בלוגים
tail -f ai-agent.log

# חפש התראות
grep "ALERT" ai-agent.log

# עצור
node ai-agent-daemon.js stop
```

---

## אירועים (Events)

סוכן פולט אירועים שאתה יכול להאזין להם:

| אירוע | נתונים | משמעות |
|-------|--------|--------|
| `start` | `config` | סוכן התחיל |
| `batch-analyzed` | `count, predictions` | נותחו התראות |
| `anomalies-detected` | `[{entity, anomalies}]` | מצאנו חריגויות |
| `critical-alerts` | `count, alerts` | התראות קריטיות ממצאו |
| `improvement-detected` | `message, metrics` | דיוק השתפר |
| `cycle-complete` | `stats, metrics` | מחזור סיים בהצלחה |
| `error` | `phase, error` | שגיאה בשלב כלשהו |
| `stop` | `stats` | סוכן עוצר |

---

## הגדרות (Configuration)

```javascript
{
  autoAnalyzeInterval: 300000,      // זמן בין מחזורים (מילישניות)
  feedbackThreshold: 0.7,           // קביעת משוב על סמך ביטחון
  anomalyCheckInterval: 600000,     // בדיקת חריגויות (מילישניות)
  batchSize: 50,                    // התראות לניתוח בכל פעם
  dbPath: 'notifications.db',       // נתיב לבסיס הנתונים
  logFile: 'ai-agent.log',          // קובץ לוג
  pidFile: 'ai-agent.pid'           // קובץ Process ID
}
```

---

## בעיות ותיקונים

### "Cannot find module 'sqlite3'"

```bash
npm install sqlite3
```

### "No database found"

ודא שיש לך לפחות notification אחד:

```bash
sqlite3 notifications.db "SELECT COUNT(*) FROM notifications;"
```

### Daemon לא מגיב

```bash
# בדוק PID
cat ai-agent.pid

# בדוק תהליך
ps aux | grep node

# בדוק לוגים
tail ai-agent.log
```

---

## הרחבות עתידיות

סוכן יכול להיות משופר:

- 🔗 **Integration** — תקשורת עם CRM וERP
- 📈 **Predictive Analytics** — חזוי מה שיקרה לאחר מכן
- 🎯 **Auto-Actions** — בצע פעולות אוטומטיות על בסיס החלטות
- 📧 **Notifications** — שלח אלרטים לdistribution lists
- 📊 **Dashboard** — דשבורד עבור ניטור סוכן
- 🧠 **Model Tuning** — שיפור מודל AI עם זמן

---

## דוגמה: הגדרת Daemon עם Systemd

```ini
# /etc/systemd/system/ai-agent.service
[Unit]
Description=AI Notification Agent
After=network.target

[Service]
Type=simple
User=appuser
WorkingDirectory=/path/to/notification-system-fix
ExecStart=/usr/bin/node ai-agent-daemon.js start
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
```

הפעלה:

```bash
sudo systemctl enable ai-agent
sudo systemctl start ai-agent
sudo systemctl status ai-agent
sudo journalctl -u ai-agent -f
```

---

## מאפיינים

✅ **עצמאות** — רץ בלא צורך בקיום משתמש  
✅ **למידה** — משתפר עם הזמן מתוך משוב  
✅ **גילוי חריגויות** — מקפיד על דפוסים חידוש  
✅ **Logging מלא** — כל פעולה תעודה  
✅ **Event-driven** — קל להשתלב עם מערכות אחרות  
✅ **Configurable** — הגדר לפי צרכיך  

---

**סוכן AI שלך עכשיו פעיל וחכם! 🚀**
