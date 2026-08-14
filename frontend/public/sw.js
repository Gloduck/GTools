importScripts('/stream-download-sw.js');

const CACHE_VERSION = 'pwa-cache-v3';
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const APP_SHELL_URLS = ['/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then((cache) => Promise.all(APP_SHELL_URLS.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.startsWith('pwa-cache-') && !cacheName.startsWith(CACHE_VERSION))
        .map((cacheName) => caches.delete(cacheName))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.startsWith('/__stream_download__/')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(handleStaticAssetRequest(request));
  }
});

async function handleNavigationRequest(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(APP_SHELL_CACHE);
    cache.put(request, response.clone());
    return response;
  } catch {
    return (await caches.match(request)) || caches.match('/') || Response.error();
  }
}

async function handleStaticAssetRequest(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

function isStaticAsset(url) {
  return url.pathname.startsWith('/assets/') || /\.(?:css|js|ico|svg|webmanifest|woff2?)$/i.test(url.pathname);
}
