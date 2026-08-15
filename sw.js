// Service worker: explicit precache list, one CACHE_VERSION bumped with it.
// Precached with {cache: "reload"} so a host's HTTP cache (GitHub Pages sends
// max-age=600) never freezes a stale file into a brand-new version cache
// (BLUEPRINT.md §13.24 / §19.1).
//
// IMPORTANT: every new module must be added to PRECACHE below, and
// CACHE_VERSION must be bumped, or offline breaks silently for existing
// installs (§13.13 / §19.5).

const CACHE_VERSION = "v9";
const CACHE_NAME = `inventory-${CACHE_VERSION}`;

const PRECACHE = [
  "./",
  "./index.html",
  "./tests.html",
  "./style.css",
  "./manifest.webmanifest",
  "./version.js",
  "./state.js",
  "./i18n.js",
  "./icons.js",
  "./app.js",
  "./db.js",
  "./sync.js",
  "./merge.js",
  "./report.js",
  "./ui.js",
  "./markdown.js",
  "./help.js",
  "./ai.js",
  "./aiplan.js",
  "./view-search.js",
  "./view-items.js",
  "./view-capture.js",
  "./view-review.js",
  "./view-more.js",
  "./view-detail.js",
  "./view-locations.js",
  "./view-labels.js",
  "./view-report.js",
  "./view-settings.js",
  "./view-trash.js",
  "./view-synclog.js",
  "./view-help.js",
  "./view-about.js",
  "./fonts/space-grotesk-700-latin.woff2",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  // No skipWaiting(): claiming clients mid-session would hand new assets to
  // an already-loaded old page, leaving it half one build and half another.
  // The worker waits until the app (app.js's registerServiceWorker) offers
  // the user a reload and they accept, which posts SKIP_WAITING below.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      const requests = PRECACHE.map((url) => new Request(url, { cache: "reload" }));
      return cache.addAll(requests);
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key.startsWith("inventory-") && key !== CACHE_NAME).map((key) => caches.delete(key)),
      ),
    ),
  );
});

/** The app asks for the swap once the user has agreed to reload. */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin (Anthropic/Drive APIs)

  if (req.mode === "navigate") {
    // Two HTML documents share this origin: index.html (the app) and
    // tests.html (the dev harness). Route each navigation to its own
    // document — an unconditional index.html fallback would hijack a
    // direct visit to tests.html into serving the app shell instead (§19.5).
    const target = url.pathname.endsWith("/tests.html") ? "./tests.html" : "./index.html";
    event.respondWith(caches.match(target).then((cached) => cached || fetch(req)));
    return;
  }

  event.respondWith(caches.match(req).then((cached) => cached || fetch(req)));
});
