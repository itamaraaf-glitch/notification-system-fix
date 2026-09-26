// הגנות משותפות לשרתי הדשבורד והייצוא (start-dashboard.js, export-server.js).
//
// לפני כן שני השרתים:
//  • האזינו לכל ממשקי הרשת — כל מחשב ברשת (Wi-Fi במשרד) יכול היה לגשת אליהם;
//  • הגישו את כל תיקיית הפרויקט (express.static('.')) — כולל notifications.db ויומני
//    הריצה, כך ש-http://<כתובת-המחשב>:3000/notifications.db הוריד את כל מסד הנתונים;
//  • ענו לכל אתר עם Access-Control-Allow-Origin: * — כל דף פתוח בדפדפן יכול היה לקרוא
//    את ה-API, ולשלוח POST שעוצר או מפעיל את הסוכן.
// עכשיו: האזנה למחשב הזה בלבד (HOST לשינוי מפורש), הגשת קבצי תצוגה בלבד, ו-API
// שנגיש רק לדשבורד עצמו ולאתר ה-Pages של הפרויקט.

const PAGES_ORIGIN = 'https://itamaraaf-glitch.github.io';

// קבצים שאסור להגיש גם אם הם יושבים בתיקייה: נתונים, יומנים, קוד צד-שרת וסודות
const BLOCKED = /\.(db|sqlite3?|db-journal|db-wal|db-shm|log|py|pyc|sh|env|pem|key|crt)$|(^|\/)(node_modules|__pycache__|test|tenders\/test|agent\/test)(\/|$)|(^|\/)\./i;
// קבצי שרת/הגדרות בשורש — קוד שאין לדפדפן סיבה לקבל
const SERVER_FILES = /^\/(server-security|export-server|start-dashboard|firebase-sync|excel-export-service|db-schema|ai-agent|ai-agent-daemon|ai-proactive-agent|ai-config|ai_advanced_analyzer_wrapper|test-data-generator)\.js$|^\/(package(-lock)?\.json|requirements\.txt)$/i;

function allowedOrigins(port) {
  return new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`, PAGES_ORIGIN]);
}

// יש לקרוא לפני express.static
function secure(app, port) {
  const ok = allowedOrigins(port);
  app.use((req, res, next) => {
    let p = req.path;
    try { p = decodeURIComponent(p); } catch (e) { return res.status(400).end(); }
    if (BLOCKED.test(p) || SERVER_FILES.test(p)) return res.status(404).end();
    const origin = req.headers.origin;
    if (origin && ok.has(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Vary', 'Origin');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    } else if (origin && req.method !== 'GET' && req.method !== 'HEAD') {
      // בקשת POST "פשוטה" מאתר זר עוברת בדפדפן בלי preflight — חוסמים כאן
      return res.status(403).json({ success: false, error: 'origin not allowed' });
    }
    if (req.method === 'OPTIONS') return res.status(origin && ok.has(origin) ? 204 : 403).end();
    res.header('X-Content-Type-Options', 'nosniff');
    next();
  });
}

// ברירת מחדל: המחשב הזה בלבד. HOST=0.0.0.0 פותח לרשת — רק בהחלטה מפורשת.
const HOST = process.env.HOST || '127.0.0.1';

module.exports = { secure, HOST };
