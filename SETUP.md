# הפעלת מערכת ה-AI

מה שצריך כדי שהמערכת תרוץ — ומה עובד גם בלי הגדרה נוספת.

---

## הרצה בשלוש פקודות

```bash
npm install                 # תלויות JavaScript
pip install -r requirements.txt   # תלות פייתון אחת (anthropic) — רק לצד הניתוח
npm run demo                # יוצר נתוני בדיקה ומעלה את הדשבורד
```

ואז נפתחים ב־<http://localhost:3000/ai-dashboard.html>.

הסוכן מופעל אוטומטית עם השרת, כך שהדף מציג נתונים חיים מיד. לביטול:
`AUTO_START=0 npm run dashboard`.

---

## מה עובד בלי שום מפתח

| רכיב | פקודה | דורש מפתח? |
|---|---|---|
| דשבורד + API | `npm run dashboard` | לא |
| סוכן יוזם (החלטות אוטונומיות) | `npm run ai-agent:proactive` | לא |
| ייצוא לאקסל | `npm run export-server` · `/api/export/notifications` | לא |
| נתוני בדיקה | `node test-data-generator.js` | לא |
| הרצה מלאה ב-tmux | `bash start-demo.sh` | לא |
| ראדאר מכרזים + סוכן הרשת | `npm run agent -- --list` | לא |

הסוכן היוזם קורא ישירות מ-`notifications.db` ומקבל החלטות לפי הספים המתועדים
ב-`PROACTIVE_AGENT_GUIDE.md`. הוא לא פונה לשום שירות חיצוני.

---

## מה שדורש הגדרה — ורק אתה יכול לספק

### 1. ניתוח AI של התראות (אופציונלי)

הניתוח החכם (`ai_notification_analyzer.py`, `ai_advanced_analyzer.py`) פונה ל-Claude.

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

בלי המפתח, שאר המערכת עובדת — הניתוח פשוט מדולג.

**ב-GitHub Actions:** Settings → Secrets and variables → Actions → New repository
secret, בשם `ANTHROPIC_API_KEY`. אותו סוד משמש גם את סקירת ה-AI של ראדאר המכרזים.

### 2. סנכרון מ-Firebase (אופציונלי)

```bash
FIREBASE_DATABASE_URL="https://<הפרויקט-שלך>-default-rtdb.firebaseio.com" npm run firebase:sync
```

את הכתובת מוצאים ב-Firebase Console → Realtime Database. בלי הכתובת הסנכרון
מדווח שהוא מדולג ויוצא בשקט — הוא לא מנסה להתחבר לשום מקום.

זו אותה כתובת שה-CRM משתמש בה, ואותו סוד `FIREBASE_DB_URL` שכבר מוגדר
ב-workflow של `daily-digest`.

---

## בדיקות

```bash
npm test          # 178 בדיקות JavaScript (סוכן הרשת + ראדאר המכרזים)
npm run test:py   # 17 בדיקות פייתון (מנהל ההתראות + מנתח ה-AI)
npm run test:all  # שתיהן
```

---

## מבנה מסד הנתונים

`db-schema.js` הוא **המקור היחיד** למבנה. כל רכיב קורא לו כשהוא פותח את מסד
הנתונים, ולכן הטבלאות נוצרות תמיד — גם בהרצה שלא נגעה בצד הפייתון.
`notification_system.py` מחזיק את אותו מבנה בצד הפייתון.

טבלאות: `notifications` · `analyzer_feedback` · `entity_trends` ·
`category_patterns` · `firebase_sync` · `registered_entities`.

---

## מה זה **לא**

זו מערכת נפרדת מה-CRM (`crm.html`). ה-CRM מתפרסם דרך GitHub Pages ואינו
דורש שרת, npm או מסד נתונים. שתי המערכות חיות באותו מאגר אבל אינן תלויות זו בזו.
