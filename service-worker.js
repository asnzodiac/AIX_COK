const CACHE_NAME = "aix-flight-cache-v2";
const urlsToCache = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./flight-follow.js"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = event.request.url;

  if (
    url.includes("api.flightradar24.com") ||
    url.includes("corsproxy.io") ||
    url.includes("allorigins.win") ||
    url.includes("codetabs.com") ||
    url.includes("maps.googleapis.com") ||
    url.includes("maps.gstatic.com")
  ) {
    event.respondWith(fetch(event.request));
    return;
  }

  const isNavigation =
    event.request.mode === "navigate" || url.endsWith("/index.html");
  if (isNavigation) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => response || fetch(event.request))
  );
});
