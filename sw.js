// Keeps the game playable offline. The version changes whenever a file changes.
// Games share one github.io origin, so this only ever removes its own old caches.
const CACHE = "pulse-garden-04d1a00297a3";
const FILES = ["./","index.html","manifest.webmanifest","icons/icon-192.png","icons/icon-512.png","src/gamekit.js","src/logic.js","src/main.js"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("pulse-garden-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
