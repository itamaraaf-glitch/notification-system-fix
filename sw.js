const CACHE = 'hot-crm-v11';
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
  // HTML pages: always network — never serve from cache so updates always load
  if (e.request.mode === 'navigate' ||
      e.request.url.endsWith('.html') ||
      e.request.url.endsWith('/')) {
    e.respondWith(fetch(e.request));
    return;
  }
  // Assets: cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
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
