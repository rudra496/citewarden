// CiteWarden service worker — cache-first for app shell, network-first for data.
const CACHE = "citewarden-v3";
const SHELL = [
  "./",
  "index.html",
  "favicon.ico",
  "icon-192.png",
  "manifest.json",
  "assets/css/style.css",
  "assets/js/app.js",
  "assets/js/analysis.js",
  "assets/js/extract.js",
  "assets/js/patterns.js",
  "assets/js/verify.js",
  "assets/js/landmark.js",
  "assets/js/selfaudit.js",
  "assets/js/data/landmarks.json",
  "assets/js/data/uk_eu_acts.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Live verification APIs are always network (offline falls back to amber verdicts in-app).
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then((hit) =>
      hit ||
      fetch(e.request).then((r) => {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return r;
      })
    )
  );
});
