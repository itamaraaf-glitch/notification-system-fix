# 🤖 סוכן AI - מערכת התראות חכמה

מערכת ניתוח וניהול התראות בהנעת AI עם שלוש יכולות עיקריות:

1. **🧠 ניתוח AI** — סיווג ודיוק עם Claude AI
2. **🤖 סוכן אוטונומי** — למידה והשתפרות מתוך משוב
3. **🎯 סוכן יוזם** — החלטות אוטונומיות וביצוע פעולות

---

## 🚀 התחלה מהירה

### דשבורד בשתי שניות

```bash
npm run dashboard
```

פתח: **http://localhost:3000/ai-dashboard.html**

זה הכל! דשבורד בזמן אמת + API + יצוא דוחות.

---

## 🎯 שלוש המערכות

### 1. 🧠 ניתוח AI (Autonomous Agent)

**מה:** מנתח התראות עם Claude API, למידה מתוך משוב, גילוי חריגויות

```bash
npm run ai-agent           # ניתוח חד-פעמי
npm run ai-agent:daemon    # שירות רקע
```

**עיקרי:**
- סווג התראות לפי דחיפות (0-1)
- קטגוריה (דחוף, פעולה נדרשת, וכו')
- גילוי spam
- ניתוח עיצורים בתאריכים

### 2. 🤖 סוכן יוזם (Proactive Agent)

**מה:** קובל החלטות אוטונומיות בהתאם למצב

```bash
npm run ai-agent:proactive           # ריצה חד-פעמית
npm run ai-agent:proactive:daemon    # שירות רקע
```

**החלטות אוטונומיות:**
- 🚨 **Escalate** — כ- קריטיים > 5
- 📊 **Investigate** — כאשר חריגויות > 3
- 🧠 **Retrain** — כאשר דיוק < 70%
- ⚙️ **Auto-Process** — עיבוד נמוכים (מערכת יציבה)

### 3. 📊 דשבורד בזמן אמת (Dashboard)

**מה:** ממשק בזמן אמת לניטור וביצוע בקרה

```bash
npm run dashboard
```

**מכיל:**
- 📈 מדדים בזמן אמת
- 🧠 החלטות אחרונות
- ✅ פעולות שבוצעו
- 📋 לוגים חי
- 🎮 כפתורי בקרה (Start/Stop)

---

## 📊 מדדים וניטור

### סטטיסטיקות
- **התראות שנותחו** — כמה עברו ניתוח AI
- **משובים שנלמדו** — כמה משוב נאסף
- **חריגויות** — כמה דפוסים חריגים
- **דיוק** — כמה נכון ניתחנו

### מצב המערכת
- **קריטיים בשעה** — התראות HIGH בשעה האחרונה
- **גבוהים בשעה** — התראות MEDIUM בשעה האחרונה
- **חריגויות** — ספירה של חריגויות מזוהות
- **מצב בריאות** — סטטוס כללי

### חלטות & פעולות
- רשימת החלטות אוטונומיות
- רשימת פעולות שבוצעו
- לוגים בזמן אמת של כל המחדשים

---

## 🔧 API Endpoints

### ניטור

| Endpoint | תיאור |
|----------|-------|
| `GET /api/agent/status` | מצב מלא + לוגים |
| `GET /api/agent/metrics` | מדדים עיקריים |
| `GET /api/agent/decisions` | החלטות אחרונות |
| `GET /api/agent/actions` | פעולות שבוצעו |
| `GET /api/agent/logs?limit=20` | לוגים עם limit |

### בקרה

| Endpoint | תיאור |
|----------|-------|
| `POST /api/agent/start` | הפעל סוכן |
| `POST /api/agent/stop` | עצור סוכן |

### יצוא

| Endpoint | תיאור |
|----------|-------|
| `POST /api/export` | יצור דוח (JSON body) |
| `GET /api/export/:type` | דוח עם query params |

---

## 📁 מבנה הפרויקט

```
notification-system-fix/
├── 📊 Dashboard & API
│   ├── ai-dashboard.html          # דשבורד בזמן אמת
│   ├── start-dashboard.js         # שרת מאומת
│   ├── export-server.js           # שרת export (legacy)
│   └── DASHBOARD_GUIDE.md         # תיעוד מלא
│
├── 🧠 AI Agents
│   ├── ai-agent.js                # סוכן ניתוח (autonomous)
│   ├── ai-proactive-agent.js      # סוכן יוזם (proactive)
│   ├── ai-advanced-analyzer.js    # ניתוח מתקדם (Python)
│   ├── AI_AGENT_GUIDE.md          # תיעוד
│   └── PROACTIVE_AGENT_GUIDE.md   # תיעוד
│
├── 📈 Export & Reports
│   ├── excel-export-service.js    # שירות יצוא
│   ├── export.html                # UI ליצוא
│   └── EXPORT_GUIDE.md            # תיעוד
│
├── 🕷️ Web Scraping Agent (Optional)
│   ├── agent/                     # framework סורק
│   ├── tenders/                   # יישום - מכרזים
│   └── agent/README.md            # תיעוד
│
└── 📚 Documentation
    ├── CLAUDE.md                  # להנדסה
    ├── QUICKSTART.md              # התחלה מהירה
    ├── README.md                  # זה הקובץ
    └── package.json               # Dependencies & scripts
```

---

## 💻 Scripts

```bash
# 🚀 התחלה
npm run dashboard              # דשבורד + API (התחלה מהירה)
npm run export-server          # Export בלבד

# 🧠 סוכנים
npm run ai-agent              # ניתוח חד-פעמי
npm run ai-agent:daemon       # שירות רקע (ניתוח)
npm run ai-agent:proactive    # החלטות חד-פעמיות
npm run ai-agent:proactive:daemon  # שירות יוזם

# 🧪 בדיקות
npm test                      # כל הבדיקות
npm run test:agent           # בדיקות סוכן (115)

# 🕷️ Web Scraping
npm run agent                # סורק אתרים (optional)
```

---

## 📖 תיעוד מלא

- **QUICKSTART.md** — התחלה בשתי שניות
- **DASHBOARD_GUIDE.md** — דשבורד + API מלא
- **AI_AGENT_GUIDE.md** — סוכן ניתוח
- **PROACTIVE_AGENT_GUIDE.md** — החלטות אוטונומיות
- **EXPORT_GUIDE.md** — יצוא דוחות
- **CLAUDE.md** — ההנדסה (למפתחים)

---

## 🎬 דוגמה: זרימה מלאה

```bash
# Terminal 1: דשבורד
npm run dashboard

# Terminal 2: טעינת נתונים
npm run ai-agent

# ב-Browser:
# 1. פתח http://localhost:3000/ai-dashboard.html
# 2. לחץ 🟢 הפעל
# 3. צפה בלוגים ומדדים בזמן אמת
# 4. ראה החלטות אוטונומיות
```

---

## 🔑 תכונות עיקריות

✅ **AI-Powered** — Claude API לניתוח סמנטי  
✅ **Autonomous** — לימוד ושיפור רציף  
✅ **Proactive** — החלטות עצמאיות וביצוע  
✅ **Real-time** — דשבורד בזמן אמת  
✅ **API-First** — זמין לשיתוף פעולה  
✅ **Export** — דוחות Excel דינמיים  
✅ **Logging** — ניטור מלא של כל אירוע  

---

## 🛠️ Requirements

- **Node.js 18+**
- **npm 9+**
- **SQLite3** (npm package included)
- **Anthropic API key** (for AI features)

---

## 🚀 שדרוג בעתיד

- [ ] WebSocket support (real-time push)
- [ ] Historical data persistence
- [ ] Admin panel for thresholds
- [ ] Slack/Email escalations
- [ ] User feedback UI
- [ ] Decision override capability
- [ ] Performance analytics

---

## 📞 עזרה

בעיות? ראה את **QUICKSTART.md** לתיקונים נפוצים.

---

**מוכן להתחיל? הרץ:** `npm run dashboard`

ואז פתח: **http://localhost:3000/ai-dashboard.html** 🎉

---

*Built with ❤️ for HOT Business CRM*
