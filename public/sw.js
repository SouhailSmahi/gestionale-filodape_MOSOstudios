// Service worker minimo: rende l'app installabile e veloce da riaprire.
// Niente modalità offline per i dati (non serve): le pagine e i file dell'app
// si prendono sempre dalla rete se c'è, dalla copia salvata se manca.
const CACHE = 'filodape-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;   // i dati (Supabase) non passano di qui
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && (req.mode === 'navigate' || url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/'))) {
        const copia = res.clone();
        caches.open(CACHE).then((c) => c.put(req.mode === 'navigate' ? '/index.html' : req, copia));
      }
      return res;
    }).catch(() => caches.match(req.mode === 'navigate' ? '/index.html' : req).then((r) => r || Response.error())),
  );
});

// Notifiche sul telefono (solo per il titolare): es. "Backup settimanale pronto"
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { testo: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titolo || 'Filodape', {
    body: d.testo || '', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: d.url || '/' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((tutte) => {
    const aperta = tutte.find((c) => new URL(c.url).origin === self.location.origin);
    if (aperta) return aperta.focus().then((c) => (c && 'navigate' in c ? c.navigate(url) : null));
    return self.clients.openWindow(url);
  }));
});
