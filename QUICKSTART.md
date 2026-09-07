# 🚀 תחילת עבודה מהירה - סוכן AI

דרך מהירה להתחיל עם כל מערכת סוכן ה-AI.

## 1️⃣ דשבורד בזמן אמת (שתי שניות)

```bash
npm run dashboard
```

ואז פתח:
```
http://localhost:3000/ai-dashboard.html
```

וכן! זה הכל. דשבורד + API + Export - הכל ביחד.

## 2️⃣ הפעלת הסוכן

בדשבורד:
1. לחץ על כפתור 🟢 "הפעל"
2. צפה בלוגים בזמן אמת
3. ראה החלטות ופעולות מתבצעות

או ישירות מ-API:
```bash
curl -X POST http://localhost:3000/api/agent/start
```

## 3️⃣ ניטור הביצועים

### דשבורד
- סטטיסטיקות - כמה התראות נותחו
- מדדי למידה - דיוק ושיפור
- מצב המערכת - קריטיים/גבוהים/חריגויות
- החלטות - מה הסוכן החליט
- לוגים - הכל בזמן אמת

### API ישירות
```bash
# סטטוס מלא
curl http://localhost:3000/api/agent/status | jq

# מדדים עיקריים
curl http://localhost:3000/api/agent/metrics | jq

# החלטות אחרונות
curl http://localhost:3000/api/agent/decisions | jq

# לוגים אחרונים
curl http://localhost:3000/api/agent/logs | jq
```

## 4️⃣ יצוא דוחות

בדפדפן: http://localhost:3000/export.html

או דרך API:
```bash
curl -X POST http://localhost:3000/api/export \
  -H "Content-Type: application/json" \
  -d '{"reportType":"notifications"}' \
  > report.xlsx
```

## 📊 מערכות ברי-פעולה

### 1. דשבורד + API
```bash
npm run dashboard      # http://localhost:3000/ai-dashboard.html
```
**כולל:** דשבורד בזמן אמת + API מלאה + יצוא דוחות

### 2. Export בלבד
```bash
npm run export-server  # http://localhost:3000/export.html
```
**כולל:** יצוא דוחות + API

### 3. סוכן בלבד
```bash
npm run ai-agent       # ניתוח כלי של התראות
npm run ai-agent:proactive  # עם החלטות אוטונומיות
```

## 🎯 משימות נפוצות

### "אני רוצה לראות את הסוכן בעבודה"
```bash
npm run dashboard
# פתח http://localhost:3000/ai-dashboard.html
# לחץ 🟢 הפעל
# צפה בלוגים תוך כדי
```

### "אני רוצה לטעון נתונים לסוכן"
```bash
npm run ai-agent          # ניתוח חד פעמי
npm run ai-agent:proactive # מחזורים עם החלטות
```

### "אני רוצה יצוא דוחות"
```bash
npm run dashboard         # כולל export
# או
npm run export-server     # export בלבד
```

### "אני רוצה API לעצמי"
```bash
npm run dashboard         # כל API endpoints זמינים
curl http://localhost:3000/api/agent/metrics
```

## 🔌 API Endpoints

| Endpoint | שיטה | תיאור |
|----------|------|-------|
| `/api/agent/status` | GET | מצב מלא + לוגים |
| `/api/agent/metrics` | GET | מדדים (analyzed, accuracy, etc) |
| `/api/agent/decisions` | GET | החלטות אחרונות |
| `/api/agent/actions` | GET | פעולות שבוצעו |
| `/api/agent/logs` | GET | לוגים עם limit |
| `/api/agent/start` | POST | הפעל סוכן |
| `/api/agent/stop` | POST | עצור סוכן |
| `/api/export` | POST | יצור דוח |
| `/export.html` | GET | UI ליצוא |
| `/ai-dashboard.html` | GET | דשבורד |

## 📚 מסמכים מלאים

- **DASHBOARD_GUIDE.md** — דשבורד + API מלא
- **PROACTIVE_AGENT_GUIDE.md** — החלטות אוטונומיות
- **AI_AGENT_GUIDE.md** — סוכן ניתוח
- **EXPORT_GUIDE.md** — יצוא דוחות
- **CLAUDE.md** — התיעוד המלא

## 🆘 בעיות נפוצות

| בעיה | פתרון |
|------|--------|
| "Cannot connect to server" | בדוק `npm run dashboard` רץ |
| "Port 3000 already in use" | `PORT=5000 npm run dashboard` |
| "Database error" | ודא שיש `notifications.db` |
| "No data showing" | הרץ `npm run ai-agent` קודם |

## ⚡ Pro Tips

1. **Start in separate terminals**
   ```bash
   # Terminal 1
   npm run dashboard
   
   # Terminal 2
   npm run ai-agent
   ```

2. **Monitor with watch**
   ```bash
   watch -n 2 'curl -s http://localhost:3000/api/agent/metrics | jq'
   ```

3. **Quick test**
   ```bash
   npm run dashboard &
   sleep 2
   curl http://localhost:3000/api/agent/status | jq
   ```

4. **Full system test**
   ```bash
   npm test  # All 115 agent tests
   npm run test:agent
   ```

---

**מוכן? התחל עם:** `npm run dashboard`

ואז: `http://localhost:3000/ai-dashboard.html` 🎉
