'use strict';
/**
 * שכבת הרשת של הסוכן — הבאה אחת, עם תקרת זמן, ניסיון חוזר וזהות מוצהרת.
 *
 * שלושה כללים שנקבעו ממדידה ולא מהערכה:
 *
 * 1. **שגיאת 4xx אינה מנוסה שוב.** היא קבועה (חסימה או דף שאינו קיים), וניסיון
 *    חוזר רק מבזבז זמן. בסריקה של עשרות אתרים, ניסיונות חוזרים על כתובות מתות
 *    הופכים ריצה של דקות לריצה של שעה. 429 הוא היוצא מן הכלל — הוא כן זמני.
 *
 * 2. **הכתובת הסופית אחרי הפניות נשמרת.** www.braude.ac.il מפנה ל-w3.braude.ac.il,
 *    ובלי הכתובת הסופית קישורים יחסיים נבנים מול הדומיין הלא נכון והמסנן
 *    "אותו אתר" פוסל את העמוד האמיתי.
 *
 * 3. **הסוכן מזהה את עצמו.** ה-User-Agent מפנה למאגר, כדי שמפעיל אתר שרואה את
 *    התעבורה יוכל לדעת מי זה ולפנות. אין ולא יהיה ניסיון להתחזות לדפדפן כדי
 *    לעקוף הגנות בוט.
 */

const DEFAULTS = {
  timeoutMs: 15000,
  retries: 1,
  userAgent: 'Mozilla/5.0 (compatible; HotBusinessWebAgent/1.0; +https://github.com/itamaraaf-glitch/notification-system-fix)',
  acceptLanguage: 'he-IL,he;q=0.9,en;q=0.8'
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * לקוח HTTP קטן. כל משימה מקבלת מופע משלה, כך שתקרות הזמן והנימוס שלה אינן
 * משפיעות על משימה אחרת שרצה באותו תהליך.
 */
/**
 * "fetch failed" הוא כל מה ש-undici מוסר על כשל רשת, והסיבה האמיתית — DNS,
 * אישור פג תוקף, חיבור שנסגר — יושבת ב-cause. בלי לצרף אותה, עשרה מקורות
 * שנופלים מסיבות שונות נראים בדוח כתקלה אחת, ואי אפשר לדעת מה לתקן.
 */
function withCause(err) {
  const code = err && err.cause && (err.cause.code || err.cause.message);
  if (code && err.message === 'fetch failed') err.message = `fetch failed (${code})`;
  return err;
}

function createClient(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  // הכתובת הסופית של כל הבאה, אחרי הפניות
  const finalUrls = new Map();

  async function fetchText(url, { retries = cfg.retries } = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs);
      try {
        const res = await fetch(url, {
          signal: ctl.signal,
          redirect: 'follow',
          headers: {
            'User-Agent': cfg.userAgent,
            'Accept': 'text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8',
            'Accept-Language': cfg.acceptLanguage
          }
        });
        if (!res.ok) {
          const err = new Error('HTTP ' + res.status);
          if (res.status >= 400 && res.status < 500 && res.status !== 429) err.permanent = true;
          throw err;
        }
        const body = await res.text();
        finalUrls.set(url, res.url || url);
        return body;
      } catch (e) {
        lastErr = e;
        if (e.permanent) break;
        if (attempt < retries) await sleep(1500 * (attempt + 1));
      } finally {
        clearTimeout(timer);
      }
    }
    throw withCause(lastErr);
  }

  const finalUrlOf = url => finalUrls.get(url) || url;

  return { fetchText, finalUrlOf, config: cfg };
}

/**
 * מריץ הבטחה עם תקרת זמן קשיחה. בלעדיה אתר איטי אחד עם הרבה כתובות בולע את כל
 * תקציב הריצה, והמקורות שאחריו לא נסרקים בכלל. חריגה נזרקת כשגיאה רגילה
 * ומדווחת ככשל של המקור.
 */
function withDeadline(promise, ms, message) {
  let timer;
  const guard = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

/**
 * מריץ משימות במקביל מוגבל. כל מקור הוא אתר אחר, ובתוך מקור הבקשות נשארות
 * טוריות עם השהיה — כך הנימוס מול כל שרת נשמר, אבל עשרות מקורות לא נסרקים
 * בטור אחד ארוך שחורג מזמן הריצה.
 */
async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

module.exports = { createClient, withDeadline, mapLimit, sleep, DEFAULTS };
