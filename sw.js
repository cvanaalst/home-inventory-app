// Service worker: explicit precache list, one CACHE_VERSION bumped with it.
// Precached with {cache: "reload"} so a host's HTTP cache (GitHub Pages sends
// max-age=600) never freezes a stale file into a brand-new version cache
// (BLUEPRINT.md §13.24 / §19.1).
//
// IMPORTANT: every new module must be added to PRECACHE below, and
// CACHE_VERSION must be bumped, or offline breaks silently for existing
// installs (§13.13 / §19.5).

const CACHE_VERSION = "v45";
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
  "./view-bulk-containers.js",
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

// ────────────────────────────────────────────────────────────────────────
// share_target (manifest.webmanifest) — the OS share sheet POSTs shared
// image files to SHARE_TARGET_PATH; there's no server to receive them, so
// this fetch handler IS the receiving end. Self-contained raw IndexedDB
// (no import of db.js: this file registers as a classic, not a module,
// script) that matches db.js's own schema and media-record shape exactly
// — see openShareDb()'s comment for what has to stay in sync if that
// schema ever changes.
// ────────────────────────────────────────────────────────────────────────

const SHARE_TARGET_PATH = "/share-target/";
const SHARE_DB_NAME = "inventory";
const SHARE_DB_VERSION = 1;
const PENDING_SHARE_META_KEY = "pendingShareMediaIds";

function openShareDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SHARE_DB_NAME, SHARE_DB_VERSION);
    // A share can arrive before the app has ever been opened once, so
    // this connection may be the one that first creates the database —
    // mirrors db.js's openDB() onupgradeneeded exactly. Keep these two
    // in sync if db.js's schema ever changes.
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("items")) db.createObjectStore("items", { keyPath: "id" });
      if (!db.objectStoreNames.contains("media")) db.createObjectStore("media", { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
      if (!db.objectStoreNames.contains("versions")) db.createObjectStore("versions", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Stores each shared file as an ordinary media record (matching db.js's
 * putMedia shape: {id, blob, mimeType}) under a fresh id, unresized — the
 * app's own resizeImageToBlob runs once view-capture.js picks these up,
 * same as any other photo; this handler's only job is to not lose what
 * the OS handed over. Returns the new ids. */
async function storeSharedFiles(files) {
  const db = await openShareDb();
  const tx = db.transaction("media", "readwrite");
  const store = tx.objectStore("media");
  const ids = files.map((file) => {
    const id = crypto.randomUUID();
    store.put({ id, blob: file, mimeType: file.type || "image/jpeg" });
    return id;
  });
  await txDone(tx);
  db.close();
  return ids;
}

async function setPendingShare(mediaIds) {
  const db = await openShareDb();
  const tx = db.transaction("meta", "readwrite");
  tx.objectStore("meta").put({ key: PENDING_SHARE_META_KEY, value: mediaIds });
  await txDone(tx);
  db.close();
}

/** No server means the redirect this always ends with is what actually
 * "returns" control to the app — the browser navigates there next, per
 * the Web Share Target spec. app.js's boot() reads pendingShareMediaIds
 * back out of meta and routes into Capture with them already attached. */
async function handleShareTarget(event) {
  try {
    const formData = await event.request.formData();
    const files = formData.getAll("photos").filter((f) => f && typeof f === "object" && f.size > 0);
    if (files.length) {
      const ids = await storeSharedFiles(files);
      await setPendingShare(ids);
    }
  } catch (err) {
    // Bad multipart body, storage failure, whatever — still redirect into
    // the app rather than leaving the browser showing a raw POST response
    // with no UI to recover from.
  }
  return Response.redirect("./#shared-photos", 303);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin (Anthropic/Drive APIs)

  if (req.method === "POST" && url.pathname.endsWith(SHARE_TARGET_PATH)) {
    event.respondWith(handleShareTarget(event));
    return;
  }

  if (req.method !== "GET") return;

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
