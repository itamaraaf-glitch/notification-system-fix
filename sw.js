const CACHE = 'hot-crm-v13';   // v13: עותק HTML לשימוש לא מקוון — גרסה חדשה כדי שהעובד הקודם יוחלף וינוקה
const META_CACHE = 'hot-crm-meta';
const ASSETS = ['./manifest.json', './office-bg.jpg', './mountains-bg.mp4', './icon-192.png', './icon-512.png', './badge-96.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE && k !== META_CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // אבטחה/פרטיות: מטפלים אך ורק בבקשות מאותו מקור (same-origin). בקשות חוצות-מקור
  // (Firebase API עם נתונים מוצפנים, ספריות CDN) עוברות ישירות לרשת ולא נשמרות
  // ב-CacheStorage — כדי לא לשמר תגובות API רגישות/דינמיות או קוד חיצוני במטמון.
  let url;
  try { url = new URL(e.request.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;
  // דפי HTML: הרשת קודם, והעותק השמור רק כשהרשת נכשלה.
  //
  // בעבר זה היה "רשת בלבד" — כדי שכל דיפלוי יגיע מיד. אבל בלי שום נפילה לעותק,
  // האפליקציה המותקנת לא נפתחה בכלל בלי חיבור (net::ERR_FAILED): באתר לקוח, במרתף,
  // בנסיעה. עכשיו, כשיש רשת, מקבלים תמיד את הגרסה החדשה ושומרים ממנה עותק;
  // כשאין רשת, מקבלים את הגרסה האחרונה שנטענה. הנתונים עצמם יושבים ממילא ב-localStorage.
  if (e.request.mode === 'navigate' ||
      url.pathname.endsWith('.html') ||
      url.pathname.endsWith('/')) {
    // מפתח אחד לכל דף, בלי פרמטרים: ?fresh=… משתנה בכל רענון כפוי ו-?vchk=… בכל
    // בדיקת גרסה. בלי נרמול כל טעינה הייתה נשמרת כרשומה נפרדת ושום רשומה לא
    // הייתה נמצאת כשאין חיבור.
    const key = url.origin + (url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname);
    e.respondWith(
      fetch(e.request).then(res => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();                      // לפני שהגוף נצרך — ראו למטה
          caches.open(CACHE).then(c => c.put(key, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match(key).then(hit => hit || Response.error()))
    );
    return;
  }
  // Same-origin assets: cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        // השכפול חייב לקרות מיד. בעבר הוא קרה בתוך then של caches.open — אחרי שהתגובה
        // כבר נמסרה לדף — ואם הדף הספיק להתחיל לקרוא את הגוף, clone() זרק והנכס פשוט
        // לא נשמר, בשקט.
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {}); }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

// דחיפת Web Push מהענן (GitHub Actions) — מגיעה גם כשהאפליקציה סגורה לגמרי
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { try { d = { body: e.data.text() }; } catch (e2) {} }
  e.waitUntil(self.registration.showNotification(d.title || '📣 HOT CRM', {
    body: d.body || '', tag: d.tag || 'hot-push', dir: 'rtl', lang: 'he',
    icon: './icon-192.png', badge: './badge-96.png'
  }));
});

// לחיצה על התראת מערכת — פתיחת/מיקוד האפליקציה
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      return clients.openWindow('./crm.html');
    })
  );
});

// תקציר יומי גם כשהאפליקציה סגורה (אנדרואיד, PWA מותקן):
// הדפדפן מעיר את ה-service worker תקופתית; קוראים את הגיבוי המקומי
// האחרון (IndexedDB) ושולחים התראה עם פגישות היום — פעם אחת ביום.
self.addEventListener('periodicsync', e => {
  if (e.tag === 'hot-crm-digest') e.waitUntil(digestFromBackup());
});

async function digestFromBackup() {
  try {
    const today = new Date().toISOString().split('T')[0];
    const meta = await caches.open(META_CACHE);
    if (await meta.match('/digest-' + today)) return; // כבר נשלח היום
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('cem_hot_backups', 2);
      r.onupgradeneeded = () => {}; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    if (!db.objectStoreNames.contains('snapshots')) return;
    const snaps = await new Promise((res, rej) => {
      const rq = db.transaction('snapshots', 'readonly').objectStore('snapshots').getAll();
      rq.onsuccess = () => res(rq.result || []); rq.onerror = () => rej(rq.error);
    });
    if (!snaps.length) return;
    const D = JSON.parse(snaps[snaps.length - 1].data);
    const mtgs = (D.meetings || []).filter(m => m.dt === today && m.hl !== 'מבוטל')
      .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    // רק אחרי 07:00 בבוקר מקומי
    if (new Date().getHours() < 7) return;
    await meta.put('/digest-' + today, new Response('1'));
    const body = mtgs.length
      ? '📅 ' + mtgs.length + ' פגישות היום: ' + mtgs.map(m => (m.time ? m.time + ' – ' : '') + (m.cl || '')).join(', ') + '\nפתח את המערכת לפרטים ולהתראות'
      : '📅 אין פגישות ביומן היום — פתח את המערכת להתראות ומשימות';
    await self.registration.showNotification('📣 תקציר בוקר — HOT CRM', {
      body, tag: 'daily-digest', dir: 'rtl', lang: 'he',
      icon: './icon-192.png', badge: './badge-96.png'
    });
  } catch (e) {}
}
