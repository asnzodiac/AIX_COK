const CACHE_NAME = "aix-flight-cache-v3";
const urlsToCache = [
  "./",
  "./AIXindex.html",
  "./map.html",
  "./manifest.json",
  "./flight-follow.js"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache).catch(() => {}))
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

  // Always network for live data & maps
  if (
    url.includes("api.flightradar24.com") ||
    url.includes("corsproxy.io") ||
    url.includes("allorigins.win") ||
    url.includes("codetabs.com") ||
    url.includes("basemaps.cartocdn.com") ||
    url.includes("openstreetmap.org") ||
    url.includes("unpkg.com") ||
    url.includes("brandfetch.io") ||
    url.includes("flightradar24.com/assets") ||
    url.includes("fonts.googleapis.com") ||
    url.includes("fonts.gstatic.com")
  ) {
    event.respondWith(fetch(event.request));
    return;
  }

  const isNavigation =
    event.request.mode === "navigate" ||
    url.endsWith("/AIXindex.html") ||
    url.endsWith("/map.html") ||
    url.endsWith("/");

  if (isNavigation) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match("./AIXindex.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => response || fetch(event.request))
  );
});
