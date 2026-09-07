# 📊 מדריך ייצוא דוחות אקסל

## התקנה

```bash
npm install
```

זה יתקין את כל התלויות הנדרשות:
- `express` - שרת web
- `exceljs` - ייצור קבצי Excel
- `sqlite3` - חיבור למסד הנתונים

## הפעלה

### דרך 1: שרת ייצוא (מומלץ)

```bash
npm run export-server
```

השרת יפעל ב-`http://localhost:3000`

פתח בדפדפן: `http://localhost:3000/export.html`

### דרך 2: שימוש בממשק הרשת

בתוך `crm.html` או `index.html`, הוסף קישור:

```html
<a href="/export.html" target="_blank" class="btn">📊 ייצוא דוחות</a>
```

## סוגי דוחות

### 1️⃣ דוח התראות
- **מה**: כל התראות עם פרטים מלאים
- **שדות**: תאריך, כותרת, הודעה, סוג ישות, ID ישות, חומרה, סטטוס
- **סינונים**:
  - סוג ישות (לדוגמה: "deals")
  - ID ישות
  - רמת חומרה (HIGH/MEDIUM/LOW)
  - טווח תאריכים

**דוגמה URL**:
```
GET /api/export/notifications?entityType=deals&severity=HIGH&startDate=2026-08-01
```

### 2️⃣ דוח טרנדים
- **מה**: ניתוח התראות לפי ישויות
- **שדות**: סוג ישות, ID ישות, מספר התראות, חומרה ממוצעת, חומרה מקסימום
- **סינונים**: טווח תאריכים

**דוגמה URL**:
```
GET /api/export/trends?startDate=2026-08-01&endDate=2026-08-31
```

### 3️⃣ דוח התפלגות חומרה
- **מה**: התפלגות התראות לפי רמת חומרה
- **שדות**: חומרה, מספר התראות, אחוז
- **סינונים**: טווח תאריכים

**דוגמה URL**:
```
GET /api/export/severity?startDate=2026-08-01
```

## API

### POST `/api/export`

ייצוא דוח עם סינונים בתוך request body.

**Request**:
```json
{
  "reportType": "notifications",
  "filters": {
    "entityType": "deals",
    "severity": "HIGH",
    "startDate": "2026-08-01",
    "endDate": "2026-08-31"
  }
}
```

**Response**: Excel file (xlsx)

### GET `/api/export/:type`

ייצוא מהיר עם query params.

**Parameters**:
- `type` - סוג דוח (notifications|trends|severity)
- `entityType` - סוג ישות (optional)
- `entityId` - ID ישות (optional)
- `severity` - חומרה (optional)
- `startDate` - תאריך התחלה (optional)
- `endDate` - תאריך סיום (optional)

**דוגמה**:
```
GET /api/export/notifications?severity=HIGH&entityType=deals
```

## שיקול דברים

### טיבולי עיצוב

✅ **Excel files**:
- כותרות בהודגשה וצבע כחול
- שדות בהתאמה RTL (ימין לשמאל)
- שורות בצבע לסירוגין לקריאה קלה
- Freeze pane על שורת הכותרת

### ביצועים

- מקסימום 1000 רשומות לדוח
- סינונים משפרים ביצועים
- טווח תאריכים מצומצם מומלץ

### בעיות אפשריות

**"no such table: notifications"**
- ודא שהמסד קיים ודוח התראות אחד לפחות
- בדוק את ה-`dbPath` ב-`excel-export-service.js`

**"Cannot find module 'exceljs'"**
```bash
npm install exceljs
```

## דוגמות שימוש

### JavaScript API

```javascript
// יצור דוח התראות גבוה חומרה
const response = await fetch('/api/export', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    reportType: 'notifications',
    filters: { severity: 'HIGH' }
  })
});

const blob = await response.blob();
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'report.xlsx';
a.click();
```

### שורת פקודה (cURL)

```bash
# דוח טרנדים לחודש האחרון
curl "http://localhost:3000/api/export/trends?startDate=2026-07-31"

# דוח התפלגות עם סינון
curl "http://localhost:3000/api/export/severity?startDate=2026-08-01&endDate=2026-08-31"
```

## סיומות עתידיות

אפשר להוסיף:
- 📋 דוח משוב AI (accuracy/improvement)
- 🎯 דוח חריגויות (anomalies)
- 📊 דוח יומי מתוכנן
- 🔄 ייצוא CSV
- 📱 תמונות דוחות

## תמיכה

בעיות או הצעות? צור issue או שנה את הקוד לפי צרכך.
