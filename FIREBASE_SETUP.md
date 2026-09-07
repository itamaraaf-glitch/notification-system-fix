# 🔥 Firebase Integration Setup

חיבור הסוכן AI ל-Firebase Realtime Database שלך.

## 1️⃣ קבלת Firebase Credentials

### משימה בצד ה-Firebase:

1. פתח **[console.firebase.google.com](https://console.firebase.google.com)**
2. בחר את הפרויקט שלך (או צור חדש)
3. **Realtime Database** → צור database
4. בחר **Start in test mode** (לפי צרכיך)
5. בטוב ימין, לחץ **Project settings** ⚙️
6. העתק את **Database URL** (משהו כמו):
   ```
   https://my-project-default-rtdb.firebaseio.com
   ```

## 2️⃣ הגדרת Environment Variable

הגדר את כתובת Firebase:

```bash
export FIREBASE_DATABASE_URL="https://your-project-rtdb.firebaseio.com"
```

או ב-.env:
```
FIREBASE_DATABASE_URL=https://your-project-rtdb.firebaseio.com
```

## 3️⃣ מבנה ה-Data ב-Firebase

הסוכן מצפה לרכב כזה:

```json
{
  "notifications": {
    "notif-1": {
      "id": "notif-1",
      "entity_type": "deal",
      "entity_id": "deal-123",
      "severity": "HIGH",
      "title": "עסקה חדשה",
      "message": "עסקה בעלות 50,000 שח נוצרה",
      "created_at": "2026-09-07T10:00:00Z"
    },
    "notif-2": {
      "id": "notif-2",
      "entity_type": "client",
      "entity_id": "client-456",
      "severity": "MEDIUM",
      "title": "קשר חדש",
      "message": "קשר חדש עם דן כהן",
      "created_at": "2026-09-07T10:05:00Z"
    }
  }
}
```

### שדות נדרשים:
- `entity_type` — סוג (deal, client, task, etc.)
- `entity_id` — מזהה תוך המערכת שלך
- `severity` — HIGH / MEDIUM / LOW
- `title` — כותרת קצרה
- `message` — תיאור מלא

### שדות אופציונליים:
- `category` — סיווג (sales, support, etc.)
- `created_at` — timestamp ISO 8601
- `tags` — array של תגים

## 4️⃣ הפעלת Firebase Sync

### אפשרות א: Sync בלבד

```bash
FIREBASE_DATABASE_URL="https://your-project-rtdb.firebaseio.com" \
npm run firebase:sync
```

זה יעדכן את `notifications.db` מ-Firebase כל 30 שניות.

### אפשרות ב: Sync + Dashboard

**Terminal 1:**
```bash
FIREBASE_DATABASE_URL="https://your-project-rtdb.firebaseio.com" \
npm run firebase:sync
```

**Terminal 2:**
```bash
npm run dashboard
```

ואז: **http://localhost:3000/ai-dashboard.html**

### אפשרות ג: Sync + Proactive Agent

**Terminal 1:**
```bash
FIREBASE_DATABASE_URL="https://your-project-rtdb.firebaseio.com" \
npm run firebase:sync
```

**Terminal 2:**
```bash
npm run ai-agent:proactive
```

## 5️⃣ זרימה מלאה (מומלץ)

**Terminal 1: Firebase Sync**
```bash
FIREBASE_DATABASE_URL="https://your-project-rtdb.firebaseio.com" \
npm run firebase:sync
```

**Terminal 2: Dashboard**
```bash
npm run dashboard
```

**Terminal 3: Proactive Agent**
```bash
npm run ai-agent:proactive
```

**ב-Browser:**
```
http://localhost:3000/ai-dashboard.html
```

**בדוק את הזרימה:**
1. 🟢 הפעל סוכן בדשבורד
2. צפה בלוגים
3. הוסף התראה חדשה ל-Firebase
4. צפה בסינכרון (Firebase → SQLite → Analysis)

## 📊 מה קורה?

```
Firebase Database
       ↓
   firebase-sync.js
       ↓
notifications.db (SQLite)
       ↓
ai-agent.js / ai-proactive-agent.js
       ↓
   תוצאות ניתוח
       ↓
   Dashboard / API
```

## 🔍 בדיקת החיבור

```bash
# 1. בדוק שה-URL נכון
echo $FIREBASE_DATABASE_URL

# 2. בדוק חיבור ל-Firebase
curl "${FIREBASE_DATABASE_URL}/notifications.json"

# 3. הפעל sync
FIREBASE_DATABASE_URL="..." npm run firebase:sync

# 4. בדוק SQLite
sqlite3 notifications.db "SELECT COUNT(*) FROM notifications;"
```

## 🆘 בעיות נפוצות

### "Connection refused"
```bash
# בדוק ש-URL נכון
echo $FIREBASE_DATABASE_URL

# אם לא מוגדר:
export FIREBASE_DATABASE_URL="https://your-project-rtdb.firebaseio.com"
```

### "No notifications showing"
```bash
# בדוק בדאטאבייס
sqlite3 notifications.db "SELECT * FROM notifications LIMIT 5;"

# בדוק ב-Firebase
curl "${FIREBASE_DATABASE_URL}/notifications.json"
```

### "Sync not working"
```bash
# בדוק לוגים
tail -f firebase-sync.log

# או הרץ ללא daemon
npm run firebase:sync
```

### "Firebase security rules blocked"
ודא שב-Firebase Database Rules מוגדר:
```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

⚠️ **הערה:** זה test mode בלבד! לפרודקשן, הגדר rules מתאימים.

## 🔐 Security Rules (פרודקשן)

```json
{
  "rules": {
    "notifications": {
      ".read": "auth != null",
      ".write": "auth != null"
    }
  }
}
```

## 📚 תיעוד מלא

- **QUICKSTART.md** — התחלה מהירה
- **DASHBOARD_GUIDE.md** — דשבורד + API
- **firebase-sync.js** — קוד הסינכרון

## 🚀 הבא?

אחרי חיבור Firebase:

1. ✅ סוכן קורא התראות מ-Firebase
2. ✅ ניתוח עם Claude AI
3. ✅ החלטות אוטונומיות
4. ✅ דשבורד בזמן אמת

---

**מוכן?**
```bash
FIREBASE_DATABASE_URL="https://your-project-rtdb.firebaseio.com" npm run firebase:sync
```

ואז:
```bash
npm run dashboard
```

🎉 **זה הכל!**
