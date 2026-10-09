// Service worker: guarda la app en caché para que funcione sin conexión.
const CACHE = 'crear-contratos-v5';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/model.js',
  './js/pdf.js',
  './js/signature.js',
  './js/templates.js',
  './js/efirma.js',
  './js/parties.js',
  './js/catalog-xlsx.js',
  './js/config.js',
  './js/dropbox.js',
  './js/sync.js',
  './vendor/forge.min.js',
  './vendor/jspdf.umd.min.js',
  './vendor/exceljs.min.js',
  './icons/icon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Red primero para tener siempre la última versión; si no hay conexión, caché.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))),
  );
});
