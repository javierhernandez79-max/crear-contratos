// Service worker: guarda la app en caché para que funcione sin conexión.
const CACHE = 'crear-contratos-v79';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/model.js',
  './js/pdf.js',
  './js/templates.js',
  './js/efirma.js',
  './js/parties.js',
  './js/catalog-xlsx.js',
  './js/config.js',
  './js/dropbox.js',
  './js/sync.js',
  './js/letras.js',
  './js/docx-export.js',
  './js/lote.js',
  './js/vencimientos.js',
  './js/molde.js',
  './js/plantilla-word.js',
  './js/alta-pdf.js',
  './js/propagar.js',
  './js/habiles.js',
  './js/servicios.js',
  './js/extraccion.js',
  './js/docusign.js',
  './js/zip.js',
  './js/carpetas.js',
  './js/ia.js',
  './vendor/forge.min.js',
  './vendor/jspdf.umd.min.js',
  './vendor/exceljs.min.js',
  './vendor/docx.iife.js',
  './icons/icon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  // 'reload' evita que la caché HTTP del navegador mezcle archivos de la versión anterior
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
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
  const url = new URL(e.request.url);
  // Las funciones del servidor (/api) nunca se guardan en caché
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        // Solo respuestas buenas: un 404/500 durante un despliegue no debe reemplazar la copia sana
        if (res.ok && res.status !== 206) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })
        .then((r) => r || (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))),
  );
});
