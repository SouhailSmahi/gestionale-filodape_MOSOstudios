// Service worker minimo: rende l'app installabile e veloce da riaprire.
// Niente modalità offline per i dati (non serve): le pagine e i file dell'app
// si prendono sempre dalla rete se c'è, dalla copia salvata se manca.
const CACHE = 'filodape-v1';

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
