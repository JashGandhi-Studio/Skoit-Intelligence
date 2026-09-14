/*
 * SkOiT offline shell.
 *
 * The app itself is local-first: cases, keys and preferences live in the
 * browser, the Document Workshop and QR Studio never touch the network. The
 * service worker's only job is to keep the shell loadable when the signal
 * drops — so the last case, the last papers shelf, the last briefing and the
 * QR studio all still open on a dead train network.
 */

const CACHE = "skoit-shell-v3";
const SHELL = ["/", "/icon.svg", "/icon-192.png", "/icon-512.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return; // relay traffic and media never pass through the shell cache
  }
  if (url.pathname.startsWith("/api/")) {
    return; // live collection must never answer from a cache
  }

  // Navigations: network first (fresher is better), cached shell offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("/", copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match("/").then((cached) => cached ?? Response.error())),
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => cached ?? Response.error());
      return cached ?? network;
    }),
  );
});
