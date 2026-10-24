'use strict';
/*
 * 离线缓存（Service Worker）
 * 首次联网访问后，所有页面资源缓存在手机本地，
 * 之后即使断网也能正常打开和使用。
 *
 * 注意：更新了 css/js 等文件后，请把 CACHE_NAME 的版本号 +1
 * （如 v1 改为 v2），用户下次打开时会自动获取新版本。
 */
var CACHE_NAME = 'cuotiben-v2';
var ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/db.js',
  './js/pdf.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; })
          .map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (resp) {
        /* 同源且成功的响应顺手缓存（如在线时新加载的资源） */
        if (resp && resp.ok && new URL(req.url).origin === self.location.origin) {
          var copy = resp.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
        }
        return resp;
      }).catch(function () {
        if (req.mode === 'navigate') return caches.match('./index.html');
        throw new Error('offline');
      });
    })
  );
});
