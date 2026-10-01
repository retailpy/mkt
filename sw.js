// Retail MKT Hub · service worker: la app abre aunque no haya internet (muestra lo último que se cargó).
const CACHE = "mkthub-v28";
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png", "./logo.png", "./logo-wide.png", "./marcas.png", "./config.js", "./sync.js", "./vendor/supabase.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Los datos en vivo (clima, API) nunca salen del caché.
  if (url.hostname.includes("open-meteo") || url.hostname.endsWith(".supabase.co") || url.pathname.startsWith("/api/")) return;
  // El código propio (config.js, sync.js): primero internet, para no quedar con una versión vieja.
  if (url.origin === location.origin && url.pathname.endsWith(".js") && !url.pathname.includes("/vendor/")){ e.respondWith(fetch(req).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); return r; }).catch(() => caches.match(req))); return; }
  // La página: primero internet (para tener siempre la última versión); si no hay, la guardada.
  if (req.mode === "navigate"){ e.respondWith(fetch(req).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put("./index.html", cp)); return r; }).catch(() => caches.match("./index.html"))); return; }
  // Íconos, fuentes y librerías: lo guardado primero, y se actualiza por detrás.
  e.respondWith(caches.match(req).then(hit => { const net = fetch(req).then(r => { if (r.ok || r.type === "opaque"){ const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); } return r; }).catch(() => hit); return hit || net; }));
});
