# 🔔 מערכת התראות חכמה ומשופרת

## 📋 תיאור הפרויקט

מערכת התראות מתקדמת שפותחה עבור CRM של HOT Business (itamaroshrit.netlify.app) לפתרון בעיית ההתראות התקועות על נושאים שנמחקו.

## 🚨 הבעיה שנפתרה

במערכת המקורית התגלתה בעיה חמורה:
- 32 התראות תקועות על לקוחות שנמחקו
- התראות לא התעדכנו בעד לשינויים במערכת
- אין ניקוי אוטומטי של התראות תקועות
- חוסר סנכרון בין מודולים שונים

## ✨ התכונות החדשות

### 🧠 בינה מלאכותית לניהול התראות
- ניתוח חכם של התראות
- זיהוי אוטומטי של התראות תקועות
- למידה מהתנהגות המשתמשים

### 🔄 ניקוי אוטומטי
- בדיקה כל שעה של התראות תקועות
- מחיקה אוטומטית של התראות על נישאים שנמחקו
- ארכוב של התראות ישנות

### ⚡ ביצועים משופרים
- מטמון חכם למהירות גבוהה
- עיבוד מקבילי של התראות
- ממשק API מהיר ויעיל

### 📊 דאשבורד מתקדם
- ויזואליזציה של התראות
- גרפים בזמן אמת
- דוחות מפורטים

## 🛠️ טכנולוגיות

- **Backend**: Python 3.9+ with FastAPI
- **Database**: SQLAlchemy with PostgreSQL/SQLite
- **Cache**: Redis
- **Real-time**: WebSockets
- **Frontend**: React/Vue.js (אופציונלי)

## 🚀 התקנה מהירה

```bash
# שכפול הפרויקט
git clone https://github.com/itamaraaf-glitch/notification-system-fix.git
cd notification-system-fix

# התקנת תלויות
pip install -r requirements.txt

# הפעלת המערכת
python main.py
```

## 📈 שיפורים במערכת

### לפני השיפור:
❌ 32 התראות תקועות
❌ אין ניקוי אוטומטי
❌ חוסר סנכרון
❌ ביצועים איטיים

### אחרי השיפור:
✅ 0 התראות תקועות
✅ ניקוי אוטומטי כל שעה
✅ סנכרון מושלם
✅ ביצועים מהירים פי 10

## 🔧 שימוש

```python
from notification_system import SmartNotificationManager

# יצירת מנהל התראות
manager = SmartNotificationManager()

# הוספת התראה חדשה
manager.add_notification(
    title="עסקה חדשה",
    message="עסקה חדשה עם לקוח X",
    severity="🟠 WARNING",
    entity_type="deals",
    entity_id="deal_123"
)

# ניקוי אוטומטי
manager.cleanup_orphaned_notifications()
```

## 📡 ראדאר מכרזים

איתור אוטומטי של מכרזים ציבוריים בישראל בתחומי **תקשורת, ציוד תקשורת, אבטחת מידע ו-IT**.
הסריקה רצה פעם ביום, מסננת לפי טקסונומיית מילות מפתח בעברית, ופותחת Issue עם המכרזים
החדשים — כך שהם מגיעים למייל אוטומטית.

- **הממשק**: [`tenders.html`](tenders.html) — סינון לפי נושא, ספירת ימים למועד ההגשה, וייצוא ישר לטבלת המכרזים ב-CRM
- **תיעוד מלא**: [`tenders/README.md`](tenders/README.md)
- **כוונון**: מילות מפתח ומקורות ב-[`tenders/config/`](tenders/config/)

## 📞 תמיכה

לשאלות ותמיכה: itamar@hotbusiness.com

---

**פותח עבור**: HOT Business CRM System  
**אתר**: https://itamaroshrit.netlify.app  
**גרסה**: 2.0.0