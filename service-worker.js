const CACHE_NAME = "aix-flight-cache-v2";
const urlsToCache = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./flight-follow.js"
];

// Install event: Cache app shell
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    })
  );
});

// Activate event: drop any caches from older versions of this app
// so storage doesn't accumulate stale copies across deploys.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch event
self.addEventListener("fetch", (event) => {
  const url = event.request.url;

  // Never cache live flight data or CORS-proxy calls — always go to network.
  if (
    url.includes("api.flightradar24.com") ||
    url.includes("corsproxy.io") ||
    url.includes("allorigins.win") ||
    url.includes("codetabs.com")
  ) {
    event.respondWith(fetch(event.request));
    return;
  }

  // App shell (index.html / navigations): network-first, so staff get the
  // latest build when online, with the cached shell as an offline fallback.
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

  // Static assets: cache-first, fall back to network.
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
