import type { NextRequest } from "next/server";

/**
 * /sw.js — the offline-shell worker, served by a route handler so dev and
 * production can differ.
 *
 * Production gets the real shell worker: navigations fall back to the cached
 * shell offline, static assets are stale-while-revalidate, and /api is never
 * cached. This is what makes installed apps survive a dead train network.
 *
 * Dev/preview gets a "retirement" worker instead. Dev chunks change on every
 * server restart, so a worker left over from an earlier build would keep
 * feeding the browser dead code (blank previews, "(stale)" SyntaxErrors the
 * in-app healing could never reach — it travelled in the stale chunks). The
 * browser re-checks /sw.js on every navigation outside any cache, so the old
 * worker installs this, deletes its own caches, unregisters itself, and
 * reloads the open tabs. One refresh fully heals the preview.
 */

const PROD_WORKER = `/*
 * SkOiT offline shell (production).
 *
 * The app is local-first: cases, keys and preferences live in the browser,
 * the Document Workshop and QR Studio never touch the network. The service
 * worker keeps the shell loadable when the signal drops — the last case, the
 * last papers shelf, the last briefing and the QR studio still open offline.
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
`;

const DEV_RETIREMENT_WORKER = `// SkOiT dev/preview: no offline shell. Any worker from an older build
// retires itself here and reloads the tabs it was holding onto.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("skoit-"))
          .map((key) => caches.delete(key)),
      );
      await self.registration.unregister();
      const clientList = await self.clients.matchAll();
      for (const client of clientList) {
        client.navigate(client.url);
      }
    })(),
  );
});
`;

export async function GET(_request: NextRequest) {
  const body =
    process.env.NODE_ENV === "production" ? PROD_WORKER : DEV_RETIREMENT_WORKER;
  return new Response(body, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      // The browser update-check already bypasses the HTTP cache; this keeps
      // any intermediary from pinning an old worker.
      "cache-control": "no-store",
    },
  });
}
