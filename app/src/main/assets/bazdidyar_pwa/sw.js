const CACHE = 'pang-v2-0-brand-foundation';
const CORE = [
  './',
  './index.html',
  './stabilization.js',
  './fire-module.js',
  './dynamic-foundation.js',
  './engine/domain-loader.js',
  './engine/coverage-engine.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon.svg'
];

async function precacheDomain(cache) {
  try {
    const response = await fetch('./domain/manifest.json', {cache: 'no-cache'});
    if (!response.ok) return;
    const manifest = await response.clone().json();
    await cache.put('./domain/manifest.json', response);
    if (!Array.isArray(manifest.files)) return;
    const paths = manifest.files
      .map(item => item && item.path)
      .filter(path => typeof path === 'string' && /^[a-zA-Z0-9._/-]+\.json$/.test(path) && !path.includes('..'))
      .map(path => './domain/' + path);
    await Promise.all(paths.map(path => cache.add(path)));
  } catch (error) {
    // The legacy PWA remains usable when source-domain files have not been staged.
  }
}

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(async cache => {
    await cache.addAll(CORE);
    await precacheDomain(cache);
  }));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key !== CACHE).map(key => caches.delete(key))
  )));
});

self.addEventListener('fetch', event => {
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
