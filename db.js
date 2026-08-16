// IndexedDB wrapper + pure data helpers. See BLUEPRINT.md §5/§6 for the
// contract this implements. Four stores: items, media, meta, versions.
//
// Record types for this app: "location" | "container" | "item". `kind`
// stays in the envelope per the blueprint's contract but is always
// "record" here — this app has no event axis.
//
// Split deliberately: everything above the "pure helpers" marker touches
// IndexedDB and must be tested against a separate database name
// (useDatabase()); everything below is dependency-free and DOM-free, so it
// is tested directly.

const DB_VERSION = 1;
const STORES = ["items", "media", "meta", "versions"];

export const TYPES = ["location", "container", "item"];
export const CONTAINER_STATUSES = ["captured", "drafted", "confirmed"];
export const ITEM_STATES = ["draft", "confirmed"];
export const ITEM_SOURCES = ["ai", "manual"];
export const VERSION_KEEP = 20;

const TITLE_MAX = { location: 60, container: 60, item: 100 };
const COMMENT_MAX = 2000;
const CATEGORY_MAX = 30;
const CODE_MAX = 32;
const TAG_MAX = 30;
const TAGS_CAP = 20;
const FIELDS_CAP = 40;
const FIELD_KEY_MAX = 40;
const FIELD_VALUE_MAX = 500;
const LINKS_CAP = 20;
const LINK_LABEL_MAX = 60;

// Fields a revision snapshot restores. Envelope bookkeeping (id, type, kind,
// createdAt, updatedAt, deletedAt, restoredAt, purgedAt) is never diffed or
// restored — restoring a version is an ordinary edit under the same id.
export const DIFFABLE_FIELDS = [
  "title",
  "comment",
  "tags",
  "pinned",
  "linkedIds",
  "fields",
  "links",
  "attachments",
  "room",
  "storage",
  "section",
  "code",
  "status",
  "labeledAt",
  "quantity",
  "category",
  "state",
  "source",
];

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "fbclid",
  "gclid",
  "gclsrc",
  "mc_cid",
  "mc_eid",
  "igshid",
  "ref",
  "ref_src",
]);

// ────────────────────────────────────────────────────────────────────────
// lifecycle & identity
// ────────────────────────────────────────────────────────────────────────

let dbName = "inventory";
let dbPromise = null;

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("transaction aborted"));
  });
}

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, DB_VERSION);
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
  return dbPromise;
}

function closeDB() {
  if (dbPromise) {
    dbPromise.then((db) => db.close()).catch(() => {});
    dbPromise = null;
  }
}

/** Switches to a different database name (and closes any open connection).
 * Used by tests.html so the suite never touches real data. */
function useDatabase(name) {
  closeDB();
  dbName = name;
}

/** Test-only cleanup: fully deletes a named database. */
function deleteDatabase(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(); // best-effort; a stale connection elsewhere shouldn't hang tests
  });
}

function makeId() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

async function getStorageEstimate() {
  if (!navigator.storage?.estimate) return { usage: 0, quota: 0, supported: false };
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota, supported: true };
  } catch {
    return { usage: 0, quota: 0, supported: false };
  }
}

// ────────────────────────────────────────────────────────────────────────
// items
// ────────────────────────────────────────────────────────────────────────

async function getAllItems() {
  const db = await openDB();
  const raw = await reqToPromise(db.transaction("items", "readonly").objectStore("items").getAll());
  return raw.map(hydrateRecord);
}

async function getItem(id) {
  const db = await openDB();
  const raw = await reqToPromise(db.transaction("items", "readonly").objectStore("items").get(id));
  return raw ? hydrateRecord(raw) : null;
}

/** Snapshots `oldRecord` into the versions store (same transaction as the
 * write) when a diffable field actually changed, then trims to VERSION_KEEP.
 * Not exported — putItem's internal write-time hook.
 *
 * Content (diffRecords), not updatedAt, is the only "did this actually
 * change" signal — an updatedAt-equality shortcut used to sit in front of
 * it, meant to skip a sync rewrite that put the exact same record back.
 * That protection was already redundant (an unchanged record also diffs
 * empty) and actively wrong for the normal touch:true path: nowIso() is
 * millisecond-resolution, so two genuinely different edits landing in the
 * same millisecond compared equal and silently lost the earlier one's
 * snapshot — a real revision-history gap, not just a theoretical one. */
async function snapshotIfChanged(tx, oldRecord, newRecord) {
  if (!oldRecord) return; // first write — nothing to snapshot
  const diff = diffRecords(oldRecord, newRecord);
  if (Object.keys(diff).length === 0) return;

  const store = tx.objectStore("versions");
  const range = versionKeyRange(oldRecord.id);
  const existingKeys = await reqToPromise(store.getAllKeys(range));
  const nextSeq = existingKeys.length
    ? Number(existingKeys[existingKeys.length - 1].split("#")[1]) + 1
    : 0;
  store.put({ key: versionKey(oldRecord.id, nextSeq), snapshot: oldRecord, at: nowIso() });

  const overflow = existingKeys.length + 1 - VERSION_KEEP;
  for (let i = 0; i < overflow; i++) store.delete(existingKeys[i]);
}

/** Writes a record. `touch: false` preserves a caller-supplied updatedAt
 * (used by sync, writing back an already-resolved merge). */
async function putItem(item, { touch = true } = {}) {
  const db = await openDB();
  const tx = db.transaction(["items", "versions"], "readwrite");
  const itemsStore = tx.objectStore("items");

  const existingRaw = await reqToPromise(itemsStore.get(item.id));
  const existing = existingRaw ? hydrateRecord(existingRaw) : null;

  const record = hydrateRecord({
    ...item,
    updatedAt: touch ? nowIso() : item.updatedAt,
  });

  await snapshotIfChanged(tx, existing, record);
  itemsStore.put(record);
  await txDone(tx);
  return record;
}

async function putItems(items) {
  const db = await openDB();
  const tx = db.transaction(["items", "versions"], "readwrite");
  const itemsStore = tx.objectStore("items");
  const results = [];
  for (const item of items) {
    const existingRaw = await reqToPromise(itemsStore.get(item.id));
    const existing = existingRaw ? hydrateRecord(existingRaw) : null;
    const record = hydrateRecord(item);
    await snapshotIfChanged(tx, existing, record);
    itemsStore.put(record);
    results.push(record);
  }
  await txDone(tx);
  return results;
}

async function queryItems(opts = {}) {
  return queryItemSet(await getAllItems(), opts);
}

async function getDeletedItems() {
  return queryItems({ onlyDeleted: true, sortBy: "deletedAt", sortDir: "desc" }).then((r) => r.results);
}

async function softDeleteItem(id) {
  const record = await getItem(id);
  if (!record) return null;
  return putItem({ ...record, deletedAt: nowIso() });
}

async function clearItems() {
  const db = await openDB();
  const tx = db.transaction(["items", "versions"], "readwrite");
  tx.objectStore("items").clear();
  tx.objectStore("versions").clear();
  await txDone(tx);
}

// ────────────────────────────────────────────────────────────────────────
// revision history (local only, never synced)
// ────────────────────────────────────────────────────────────────────────

function versionKey(id, seq) {
  return `${id}#${String(seq).padStart(6, "0")}`;
}

function versionKeyRange(id) {
  return IDBKeyRange.bound(`${id}#`, `${id}#\uffff`);
}

/** Returns snapshots oldest-first; the caller reverses for a newest-first UI. */
async function getVersions(recordId) {
  const db = await openDB();
  const rows = await reqToPromise(
    db.transaction("versions", "readonly").objectStore("versions").getAll(versionKeyRange(recordId)),
  );
  return rows;
}

async function clearVersions(recordId) {
  const db = await openDB();
  const tx = db.transaction("versions", "readwrite");
  const store = tx.objectStore("versions");
  const keys = await reqToPromise(store.getAllKeys(versionKeyRange(recordId)));
  keys.forEach((k) => store.delete(k));
  await txDone(tx);
}

/** Every snapshot across every record, unsorted — there is no secondary
 * index on `at`, so a global revision-history screen reads the whole store
 * and sorts in memory. Fine at this app's scale (a personal inventory, not
 * a fleet); revisit with an index if that stops being true. */
async function getAllVersions() {
  const db = await openDB();
  return reqToPromise(db.transaction("versions", "readonly").objectStore("versions").getAll());
}

// ────────────────────────────────────────────────────────────────────────
// media
// ────────────────────────────────────────────────────────────────────────

async function putMedia(rec) {
  const db = await openDB();
  const tx = db.transaction("media", "readwrite");
  tx.objectStore("media").put(rec);
  await txDone(tx);
  return rec;
}

async function getMedia(id) {
  const db = await openDB();
  return reqToPromise(db.transaction("media", "readonly").objectStore("media").get(id));
}

async function deleteMedia(id) {
  const db = await openDB();
  const tx = db.transaction("media", "readwrite");
  tx.objectStore("media").delete(id);
  await txDone(tx);
}

async function getAllMediaIds() {
  const db = await openDB();
  return reqToPromise(db.transaction("media", "readonly").objectStore("media").getAllKeys());
}

async function clearMedia() {
  const db = await openDB();
  const tx = db.transaction("media", "readwrite");
  tx.objectStore("media").clear();
  await txDone(tx);
}

/** Copies a media record under a brand-new id and returns that id. Used by
 * trash restore (§8.5): a restored record gets a new id, so any attachment
 * it carries needs its own new-id media copy — sharing the old blob would
 * mean deleting the (still-tombstoned) original later also deletes the
 * restored copy's picture out from under it. */
async function cloneMedia(id) {
  const rec = await getMedia(id);
  if (!rec) return null;
  const newId = makeId();
  await putMedia({ ...rec, id: newId });
  return newId;
}

// makeThumbnail / makeFullImage: canvas-dependent, added alongside the
// capture UI in a later phase.

// ────────────────────────────────────────────────────────────────────────
// meta + sync log
// ────────────────────────────────────────────────────────────────────────

async function getMeta(key, fallback = null) {
  const db = await openDB();
  const row = await reqToPromise(db.transaction("meta", "readonly").objectStore("meta").get(key));
  return row ? row.value : fallback;
}

async function setMeta(key, value) {
  const db = await openDB();
  const tx = db.transaction("meta", "readwrite");
  tx.objectStore("meta").put({ key, value });
  await txDone(tx);
}

async function deleteMeta(key) {
  const db = await openDB();
  const tx = db.transaction("meta", "readwrite");
  tx.objectStore("meta").delete(key);
  await txDone(tx);
}

const ACTIVITY_LOG_KEY = "activityLog";
const ACTIVITY_LOG_CAP = 60;

async function logActivity(kind, outcome, detail = "") {
  const log = (await getMeta(ACTIVITY_LOG_KEY, [])) || [];
  const next = appendActivity(
    log,
    { at: nowIso(), kind, outcome, detail: String(detail).slice(0, 200) },
    ACTIVITY_LOG_CAP,
  );
  await setMeta(ACTIVITY_LOG_KEY, next);
  return next;
}

async function getActivityLog() {
  return (await getMeta(ACTIVITY_LOG_KEY, [])) || [];
}

async function clearActivityLog() {
  await setMeta(ACTIVITY_LOG_KEY, []);
}

// ══════════════════════════════════════════════════════════════════════
// PURE HELPERS — no DOM, no storage, no imports. Unit-tested directly.
// ══════════════════════════════════════════════════════════════════════

function normalizeType(raw) {
  return TYPES.includes(raw) ? raw : "item";
}

function normalizeKind(raw) {
  return raw === "event" ? "event" : "record";
}

function normalizeTitle(raw, maxLen = 100) {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, maxLen);
}

function normalizeComment(raw) {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, COMMENT_MAX);
}

function normalizeCategory(raw) {
  if (typeof raw !== "string") return "";
  return raw.trim().toLowerCase().slice(0, CATEGORY_MAX);
}

function normalizeQuantity(raw) {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function normalizeCode(raw) {
  if (typeof raw !== "string") return "";
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, CODE_MAX);
}

function normalizeStatus(raw) {
  return CONTAINER_STATUSES.includes(raw) ? raw : "captured";
}

function normalizeItemState(raw) {
  return ITEM_STATES.includes(raw) ? raw : "confirmed";
}

function normalizeSource(raw) {
  return ITEM_SOURCES.includes(raw) ? raw : "manual";
}

function normalizeIsoOrNull(raw) {
  if (typeof raw !== "string") return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? raw : null;
}

function normalizeTags(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const clean = t.trim().toLowerCase().slice(0, TAG_MAX);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= TAGS_CAP) break;
  }
  return out;
}

function normalizeLinkedIds(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const id of raw) {
    if (typeof id !== "string" || !id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Strips known tracking params. Never throws — an unparsable URL is
 * returned trimmed as-is rather than dropped. */
function stripTrackingParams(url) {
  if (typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const u = new URL(trimmed);
    [...u.searchParams.keys()].forEach((k) => {
      if (TRACKING_PARAMS.has(k.toLowerCase())) u.searchParams.delete(k);
    });
    return u.toString();
  } catch {
    return trimmed;
  }
}

function normalizeUrl(raw) {
  return stripTrackingParams(raw).slice(0, 1000);
}

function normalizeFields(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const f of raw) {
    if (!f || typeof f !== "object") continue;
    const key = typeof f.key === "string" ? f.key.trim().slice(0, FIELD_KEY_MAX) : "";
    if (!key) continue;
    const value = typeof f.value === "string" ? f.value.trim().slice(0, FIELD_VALUE_MAX) : "";
    out.push({ id: typeof f.id === "string" && f.id ? f.id : makeId(), key, value });
    if (out.length >= FIELDS_CAP) break;
  }
  return out;
}

function normalizeLinks(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const l of raw) {
    if (!l || typeof l !== "object") continue;
    const url = normalizeUrl(l.url);
    if (!url) continue;
    const label = typeof l.label === "string" ? l.label.trim().slice(0, LINK_LABEL_MAX) : "";
    out.push({ id: typeof l.id === "string" && l.id ? l.id : makeId(), label, url });
    if (out.length >= LINKS_CAP) break;
  }
  return out;
}

function normalizeAttachments(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    if (typeof a.mediaId !== "string" || !a.mediaId) continue;
    out.push({
      mediaId: a.mediaId,
      filename: typeof a.filename === "string" ? a.filename.slice(0, 200) : "",
      mimeType: typeof a.mimeType === "string" ? a.mimeType.slice(0, 100) : "",
      size: Number.isFinite(a.size) ? a.size : 0,
      // Pixel dimensions of the stored image, when it is one — used by
      // aiplan.js to estimate identification cost without re-decoding the
      // blob. Absent/0 for non-image attachments or pre-AI-feature records.
      width: Number.isFinite(a.width) ? a.width : 0,
      height: Number.isFinite(a.height) ? a.height : 0,
    });
  }
  return out;
}

/** Diacritic- and case-insensitive normalisation for search matching. */
function normalizeSearchText(str) {
  if (typeof str !== "string") return "";
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/** One normalized haystack per record: title + comment + tags + every
 * type-specific text field. */
function buildHaystack(record) {
  const parts = [record.title, record.comment, (record.tags || []).join(" ")];
  if (record.type === "location") {
    parts.push(record.room, record.storage, record.section);
  } else if (record.type === "container") {
    parts.push(record.code);
  } else if (record.type === "item") {
    parts.push(record.category);
    (record.fields || []).forEach((f) => parts.push(f.key, f.value));
  }
  (record.links || []).forEach((l) => parts.push(l.label));
  return normalizeSearchText(parts.filter(Boolean).join(" "));
}

/** Read-time migration safety net: fills every missing field with a safe
 * default. Never throws, never half-builds, and — critically — never
 * invents a fresher updatedAt than what was stored (that would make every
 * device believe it holds the newest copy of everything). */
function hydrateRecord(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const type = normalizeType(r.type);
  const createdAt = normalizeIsoOrNull(r.createdAt) || nowIso();
  const updatedAt = normalizeIsoOrNull(r.updatedAt) || createdAt;

  const record = {
    id: typeof r.id === "string" && r.id ? r.id : makeId(),
    type,
    kind: normalizeKind(r.kind),

    createdAt,
    updatedAt,
    deletedAt: normalizeIsoOrNull(r.deletedAt),
    restoredAt: normalizeIsoOrNull(r.restoredAt),
    purgedAt: normalizeIsoOrNull(r.purgedAt),

    title: normalizeTitle(r.title, TITLE_MAX[type]),
    comment: normalizeComment(r.comment),
    tags: normalizeTags(r.tags),
    pinned: !!r.pinned,
    linkedIds: normalizeLinkedIds(r.linkedIds),
    fields: normalizeFields(r.fields),

    links: normalizeLinks(r.links),
    attachments: normalizeAttachments(r.attachments),
  };

  if (type === "location") {
    record.room = normalizeTitle(r.room, 60);
    record.storage = normalizeTitle(r.storage, 60);
    record.section = normalizeTitle(r.section, 60);
  } else if (type === "container") {
    record.code = normalizeCode(r.code);
    record.status = normalizeStatus(r.status);
    record.labeledAt = normalizeIsoOrNull(r.labeledAt);
  } else if (type === "item") {
    record.quantity = normalizeQuantity(r.quantity);
    record.category = normalizeCategory(r.category);
    record.state = normalizeItemState(r.state);
    record.source = normalizeSource(r.source);
  }

  return record;
}

/** Builds a brand-new, fully-defaulted record. Goes through the same
 * normalisation as hydrateRecord, so there is exactly one source of truth
 * for "what a valid record looks like". */
function makeRecordPure(fields = {}) {
  const now = nowIso();
  return hydrateRecord({ id: makeId(), createdAt: now, updatedAt: now, ...fields });
}

/** "Office › Cupboard left wall › Right section › Shelf 1" — blank levels
 * skipped. Used for both display and sorting a location list. */
function locationPath(location) {
  if (!location) return "";
  return [location.room, location.storage, location.section, location.title].filter(Boolean).join(" › ");
}

/** Next free "<PREFIX>-NNN" code given the codes already in use. Replaces
 * the legacy server's /containers/next-code endpoint. */
function nextCode(existingCodes, prefix) {
  const p = (prefix || "BOX").toUpperCase().replace(/[^A-Z0-9]/g, "") || "BOX";
  const re = new RegExp(`^${p}-(\\d+)$`, "i");
  let highest = 0;
  for (const code of existingCodes || []) {
    const m = re.exec(code);
    if (m) highest = Math.max(highest, Number.parseInt(m[1], 10));
  }
  return `${p}-${String(highest + 1).padStart(3, "0")}`;
}

const RANGE_MAX = 200;

/** Expands a "{n}"-containing name pattern over an inclusive numeric range
 * — "RIJ {n}", 1, 5 -> ["RIJ 1", ..., "RIJ 5"] — for bulk location
 * creation. Never throws: a pattern missing the token, or a nonsensical
 * range, normalizes to an empty list rather than guessing what the caller
 * meant. Capped at RANGE_MAX so a typo (e.g. "to" 100000) can't silently
 * queue an enormous batch write. */
function expandNameRange(pattern, from, to, max = RANGE_MAX) {
  if (typeof pattern !== "string" || !pattern.includes("{n}")) return [];
  const start = Number.parseInt(from, 10);
  const end = Number.parseInt(to, 10);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const count = Math.min(end - start + 1, max);
  return Array.from({ length: count }, (_, i) => pattern.replace("{n}", String(start + i)));
}

function compareValues(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true, sensitivity: "base" });
}

function makeComparator(sortBy = "updatedAt", sortDir = "desc", pinnedFirst = false) {
  const dir = sortDir === "asc" ? 1 : -1;
  return (a, b) => {
    if (pinnedFirst && a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return compareValues(a[sortBy], b[sortBy]) * dir;
  };
}

/** The pure query engine: search/filter/sort/pagination over an in-memory
 * item set. queryItems() = queryItemSet(await getAllItems(), opts). */
function queryItemSet(items, opts = {}) {
  const {
    search = "",
    type,
    tags,
    linkedId,
    category,
    itemState,
    status,
    dateField = "updatedAt",
    dateFrom,
    dateTo,
    sortBy = "updatedAt",
    sortDir = "desc",
    pinnedFirst = false,
    offset = 0,
    limit,
    onlyDeleted = false,
  } = opts;

  const needle = normalizeSearchText(search);

  let filtered = items.filter((r) => {
    if (onlyDeleted) {
      if (!r.deletedAt || r.restoredAt || r.purgedAt) return false;
    } else if (r.deletedAt) {
      return false;
    }
    if (type && r.type !== type) return false;
    if (linkedId && !(r.linkedIds || []).includes(linkedId)) return false;
    if (category && normalizeSearchText(r.category) !== normalizeSearchText(category)) return false;
    if (itemState && r.state !== itemState) return false;
    if (status && r.status !== status) return false;
    if (tags && tags.length && !tags.some((t) => (r.tags || []).includes(t))) return false;
    if (dateFrom && (r[dateField] || "") < dateFrom) return false;
    if (dateTo && (r[dateField] || "") > dateTo) return false;
    if (needle && !buildHaystack(r).includes(needle)) return false;
    return true;
  });

  filtered.sort(makeComparator(sortBy, sortDir, pinnedFirst));

  const total = filtered.length;
  const results = limit == null ? filtered.slice(offset) : filtered.slice(offset, offset + limit);
  const hasMore = limit != null && offset + limit < total;

  return { results, total, hasMore };
}

function diffRecords(a, b) {
  const diff = {};
  for (const field of DIFFABLE_FIELDS) {
    const av = a ? a[field] : undefined;
    const bv = b ? b[field] : undefined;
    const equal =
      Array.isArray(av) || Array.isArray(bv) || (av && typeof av === "object")
        ? JSON.stringify(av) === JSON.stringify(bv)
        : av === bv;
    if (!equal) diff[field] = { from: av, to: bv };
  }
  return diff;
}

/** Restores a version's diffable fields onto `current`, under the same id.
 * Envelope timestamps are left for the caller (a normal write bumps
 * updatedAt) — this function is pure and touches nothing else. */
function applyVersion(current, version) {
  const restored = { ...current };
  for (const field of DIFFABLE_FIELDS) {
    if (field in version) restored[field] = version[field];
  }
  return restored;
}

/** Capped ring buffer: appends `entry`, then trims to the oldest `cap`. */
function appendActivity(log, entry, cap) {
  const next = [...(log || []), entry];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

// ────────────────────────────────────────────────────────────────────────
// exports
// ────────────────────────────────────────────────────────────────────────

export {
  // lifecycle & identity
  openDB,
  closeDB,
  useDatabase,
  deleteDatabase,
  makeId,
  makeRecordPure as makeRecord,
  hydrateRecord,
  requestPersistentStorage,
  getStorageEstimate,
  // items
  putItem,
  getItem,
  putItems,
  getAllItems,
  queryItems,
  getDeletedItems,
  softDeleteItem,
  clearItems,
  // revision history
  getVersions,
  clearVersions,
  getAllVersions,
  versionKey,
  versionKeyRange,
  // media
  putMedia,
  getMedia,
  deleteMedia,
  getAllMediaIds,
  cloneMedia,
  clearMedia,
  // meta + sync log
  getMeta,
  setMeta,
  deleteMeta,
  logActivity,
  getActivityLog,
  clearActivityLog,
  // pure helpers
  normalizeType,
  normalizeKind,
  normalizeTitle,
  normalizeComment,
  normalizeCategory,
  normalizeQuantity,
  normalizeCode,
  normalizeStatus,
  normalizeItemState,
  normalizeSource,
  normalizeTags,
  normalizeLinkedIds,
  normalizeFields,
  normalizeLinks,
  normalizeAttachments,
  normalizeUrl,
  stripTrackingParams,
  normalizeSearchText,
  buildHaystack,
  queryItemSet,
  makeComparator,
  diffRecords,
  applyVersion,
  appendActivity,
  locationPath,
  nextCode,
  expandNameRange,
};
