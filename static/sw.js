/* Service worker: la app se puede instalar en el móvil o la tableta y, sin conexión, abre lo último
   que se cargó. Siempre se pide primero a la red (nunca se sirve una versión vieja si hay conexión). */
const CACHE = 'diagramas-v1';
const SKIP = /\/api\/sim\/|\/events|\/cmd$|\/stop$/;   // compilación y simulación: solo en vivo

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || SKIP.test(url.pathname)) return;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate'
    ? new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font:16px system-ui;padding:24px">' +
      '<h2>Sin conexión</h2><p>Esta página no se había abierto antes en este dispositivo. Vuelve a conectarte al servidor.</p>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    : Response.error()))));
});
