/**
 * OpenMermaid Studio — Service Worker
 * Proporciona soporte offline completo (PWA) y resiliencia frente a fallos de red.
 * Estrategia: Network-First con Fallback automático a Caché.
 */

const CACHE_NAME = 'openmermaid-v1.1.1';

// Lista de recursos esenciales para funcionamiento offline
const RECURSOS_PRECACHE = [
  '/',
  '/index.html',
  '/site.webmanifest',
  '/img/favicon.ico',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/apple-touch-icon.png',
  '/css/styles.css?v=1.1.1',
  '/js/color-algorithms.js?v=1.1.1',
  '/js/templates.js?v=1.1.1',
  '/js/diagram-styler.js?v=1.1.1',
  '/js/file-system.js?v=1.1.1',
  '/js/mermaid-renderer.js?v=1.1.1',
  '/js/exporter.js?v=1.1.1',
  '/js/docs-viewer.js?v=1.1.1',
  '/js/keyboard-shortcuts.js?v=1.1.1',
  '/js/history-manager.js?v=1.1.1',
  '/js/minimap.js?v=1.1.1',
  '/js/find-replace.js?v=1.1.1',
  '/js/alerts.js?v=1.1.1',
  '/js/export-dialog.js?v=1.1.1',
  '/js/canvas-viewport.js?v=1.1.1',
  '/js/app.js?v=1.1.1',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js',
  'https://cdn.jsdelivr.net/npm/mermaid@12/dist/mermaid.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.all.min.js'
];

// Instalación: precarga recursos y activa inmediatamente
self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        RECURSOS_PRECACHE.map((recurso) =>
          cache.add(recurso).catch((err) => {
            console.warn(`[SW] No se pudo precachear ${recurso}:`, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// Activación: limpia versiones viejas de caché y toma control de clientes
self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys().then((nombres) => {
      return Promise.all(
        nombres
          .filter((nombre) => nombre !== CACHE_NAME)
          .map((nombre) => {
            console.info(`[SW] Eliminando caché obsoleta: ${nombre}`);
            return caches.delete(nombre);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Peticiones: Network-First con fallback a Caché
self.addEventListener('fetch', (evento) => {
  const request = evento.request;

  // Solo gestionar peticiones GET HTTP/HTTPS
  if (request.method !== 'GET') {
    return;
  }
  const url = new URL(request.url);
  if (!url.protocol.startsWith('http')) {
    return;
  }

  evento.respondWith(
    fetch(request)
      .then((respuestaRed) => {
        // Si la red responde correctamente (200), actualizamos la caché
        if (respuestaRed && respuestaRed.status === 200) {
          const clonRespuesta = respuestaRed.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, clonRespuesta).catch(() => {});
          });
        }
        return respuestaRed;
      })
      .catch(async () => {
        // Red no disponible o fallo de servidor: buscar en caché
        const respuestaEnCache = await caches.match(request);
        if (respuestaEnCache) {
          return respuestaEnCache;
        }

        // Si es una navegación (página HTML) y no coincide exacta, entregar index.html
        if (request.mode === 'navigate') {
          const indexFallback = (await caches.match('/index.html')) || (await caches.match('/'));
          if (indexFallback) {
            return indexFallback;
          }
        }

        // Si no se encuentra nada
        return new Response('Sin conexión a Internet y recurso no disponible en caché.', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: new Headers({ 'Content-Type': 'text/plain; charset=utf-8' })
        });
      })
  );
});
