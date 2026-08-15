// Google Drive sync: OAuth (Google Identity Services token client, with a
// redirect fallback for iOS standalone PWAs where popups fail), the Drive
// v3 REST API called directly via fetch (no SDK — zero dependencies), and
// the sync/backup/restore sequences from BLUEPRINT.md §7/§8.1-8.3.
//
// The remote payload is PLAIN JSON, not encrypted (a deliberate scope
// decision for this app — component inventory data isn't sensitive enough
// to justify the passphrase-recovery risk described in §7).
//
// Everything that touches the network is impure by nature; the merge
// itself is delegated entirely to the pure, separately-tested merge.js.
// parseItemsPayload/buildMultipartBody are kept pure and exported so they
// can still be unit-tested directly, same as any other pure helper.

import {
  getMeta,
  setMeta,
  deleteMeta,
  getAllItems,
  putItems,
  getAllMediaIds,
  getMedia,
  putMedia,
  deleteMedia,
  hydrateRecord,
  logActivity,
} from "./db.js";
import { mergeItemSets, computeMediaActions } from "./merge.js";

// Paste your own client ID here to hardcode it (safe in a public repo —
// it is not a secret, §17), or leave blank and set it via Settings ▸ Sync
// instead. The Settings field always overrides this constant.
export const DEFAULT_CLIENT_ID = "";

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const GIS_SRC = "https://accounts.google.com/gsi/client";
const APP_FOLDER_NAME = "Inventory";
const WIRE_VERSION = 1;
const MULTIPART_BOUNDARY = "inventory-sync-boundary";
const PENDING_ACTION_KEY = "syncPendingAction";

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

function syncError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// ────────────────────────────────────────────────────────────────────────
// the payload guard (§7 "ship it before you need it") — pure, testable
// ────────────────────────────────────────────────────────────────────────

/** Parses a remote items.json body. Refuses what it cannot read rather
 * than ever returning an empty list for a NON-empty, unreadable payload —
 * an older build treating "can't parse this" as "no records" would merge
 * that as an empty remote and then write its own (smaller) set straight
 * over whatever was actually there. A genuinely empty/zero-byte file is
 * the one benign empty case (first sync, nothing uploaded yet). */
export function parseItemsPayload(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return { ok: true, items: [] };

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, reason: "unreadable", detail: "payload is not valid JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "unreadable", detail: "payload is not a JSON object" };
  }
  if (parsed.v !== WIRE_VERSION) {
    return {
      ok: false,
      reason: "unsupported-format",
      detail: `payload is wire version ${parsed.v}, this build only reads version ${WIRE_VERSION}`,
    };
  }
  if (!Array.isArray(parsed.items)) {
    return { ok: false, reason: "unreadable", detail: "payload has no items array" };
  }
  return { ok: true, items: parsed.items };
}

/** Builds a multipart/related body for a small text/JSON upload. Kept
 * separate from the Blob-based media variant below because a plain string
 * body is simpler to construct and to unit-test. */
export function buildMultipartBody(metadata, content, contentType) {
  return (
    `--${MULTIPART_BOUNDARY}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${MULTIPART_BOUNDARY}\r\n` +
    `Content-Type: ${contentType}\r\n\r\n` +
    `${content}\r\n` +
    `--${MULTIPART_BOUNDARY}--`
  );
}

function buildMultipartBlob(metadata, contentBlob) {
  const head = `--${MULTIPART_BOUNDARY}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${MULTIPART_BOUNDARY}\r\nContent-Type: ${contentBlob.type || "application/octet-stream"}\r\n\r\n`;
  const tail = `\r\n--${MULTIPART_BOUNDARY}--`;
  return new Blob([head, contentBlob, tail], { type: `multipart/related; boundary=${MULTIPART_BOUNDARY}` });
}

// ────────────────────────────────────────────────────────────────────────
// OAuth — Google Identity Services popup, with a redirect fallback
// ────────────────────────────────────────────────────────────────────────

let gisLoadPromise = null;
function loadGis() {
  if (gisLoadPromise) return gisLoadPromise;
  gisLoadPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(syncError("gis-load-failed", "Could not load Google Identity Services"));
    document.head.appendChild(script);
  });
  return gisLoadPromise;
}

async function getClientId() {
  const stored = await getMeta("syncClientId", "");
  return stored || DEFAULT_CLIENT_ID;
}

/** The exact origin (no path) and redirect URL (with trailing slash) that
 * must be registered in Google Cloud Console, character for character
 * (§17). Exposed so Settings ▸ Sync can print them for the user to copy. */
export function oauthOrigin() {
  return location.origin;
}
export function oauthRedirectUri() {
  return location.origin + location.pathname.replace(/[^/]*$/, "");
}

async function getCachedToken() {
  const cached = await getMeta("syncToken", null);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken;
  return null;
}

async function storeToken(accessToken, expiresInSeconds) {
  const seconds = Number(expiresInSeconds);
  const expiresAt = Date.now() + (seconds > 0 ? seconds * 1000 : 3500 * 1000);
  await setMeta("syncToken", { accessToken, expiresAt });
}

function redirectToGoogle(clientId, pendingAction) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: oauthRedirectUri(),
    response_type: "token",
    scope: SCOPE,
    include_granted_scopes: "true",
    prompt: "consent",
  });
  setMeta(PENDING_ACTION_KEY, pendingAction).finally(() => {
    location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  });
}

// Safari's Intelligent Tracking Prevention (and iOS Safari generally) can
// block the popup's postMessage back to this tab entirely — GIS then never
// calls EITHER callback, even after the user completes consent, and the
// promise below would hang forever with nothing to catch. This is worse
// than a *blocked* popup (which GIS does report via error_callback): the
// popup opens and works, the token exchange just never makes it back.
// Generous on purpose — long enough that a real user working through a
// multi-screen consent flow (pick account, "app not verified" warning,
// approve) is never yanked away mid-flow by a false-positive timeout.
const POPUP_CALLBACK_TIMEOUT_MS = 45_000;

/** Resolves to a valid access token: a cached one if still fresh, else the
 * GIS popup flow. Falls back to a full-page redirect if the popup is
 * blocked outright (the normal case for iOS standalone PWAs, which never
 * allow popups at all) OR if the popup completes but its callback never
 * fires (Safari/ITP — see POPUP_CALLBACK_TIMEOUT_MS above). The pending
 * action is stashed first so checkRedirectReturn() can resume it once the
 * page reloads (§7). */
async function requestToken({ pendingAction = "sync" } = {}) {
  const cached = await getCachedToken();
  if (cached) return cached;

  const clientId = await getClientId();
  if (!clientId) throw syncError("no-client-id", "No OAuth client ID is configured yet");

  await loadGis();

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId = null;

    function settle(fn) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      fn();
    }

    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        settle(() => {
          if (resp.error) {
            reject(syncError("401", resp.error));
            return;
          }
          storeToken(resp.access_token, resp.expires_in).then(() => resolve(resp.access_token));
        });
      },
      error_callback: (err) => {
        settle(() => {
          if (err?.type === "popup_failed_to_open" || err?.type === "popup_closed") {
            redirectToGoogle(clientId, pendingAction); // navigates away; nothing after this runs
            return;
          }
          reject(syncError("401", err?.type || "auth-failed"));
        });
      },
    });
    client.requestAccessToken({ prompt: "" });

    timeoutId = setTimeout(() => {
      settle(() => redirectToGoogle(clientId, pendingAction));
    }, POPUP_CALLBACK_TIMEOUT_MS);
  });
}

/** Call once at boot (fire-and-forget). If the page was just reached via
 * the redirect fallback, this pulls the token out of the URL fragment,
 * stores it, cleans the URL, and resumes whatever action was pending —
 * so the round-trip is invisible to the rest of the app. Resolves to null
 * when the page was reached normally (the overwhelmingly common case). */
export async function checkRedirectReturn() {
  if (!location.hash.includes("access_token=")) return null;

  const params = new URLSearchParams(location.hash.slice(1));
  const accessToken = params.get("access_token");
  const expiresIn = params.get("expires_in");
  const error = params.get("error");
  history.replaceState(null, "", location.pathname + location.search);

  const pendingAction = await getMeta(PENDING_ACTION_KEY, null);
  await deleteMeta(PENDING_ACTION_KEY);

  if (error || !accessToken) {
    await logActivity("sync", "error", `redirect auth failed: ${error || "no token returned"}`);
    return { outcome: "error" };
  }
  await storeToken(accessToken, expiresIn);

  if (pendingAction === "backup") return backupNow();
  if (pendingAction === "sync") return syncNow();
  return { outcome: "success" };
}

export async function setClientId(clientId) {
  await setMeta("syncClientId", String(clientId || "").trim());
}

export async function getConnectionStatus() {
  const clientId = await getClientId();
  const lastSyncAt = await getMeta("lastSyncAt", null);
  const token = await getCachedToken();
  return {
    configured: !!clientId,
    clientId,
    signedIn: !!token,
    lastSyncAt,
    origin: oauthOrigin(),
    redirectUri: oauthRedirectUri(),
  };
}

/** Drops the cached token only — does not touch anything on Drive. The
 * next sync/backup simply asks for a fresh sign-in. */
export async function disconnect() {
  await deleteMeta("syncToken");
}

// ────────────────────────────────────────────────────────────────────────
// Drive REST calls — plain fetch, drive.file scope only
// ────────────────────────────────────────────────────────────────────────

async function driveFetch(url, token, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw syncError("401", "token expired or was revoked");
  if (!res.ok) throw syncError(String(res.status), await res.text().catch(() => res.statusText));
  return res;
}

function escapeQueryValue(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findFile(token, { name, parent, mimeType, trashed = false }) {
  const clauses = [`name = '${escapeQueryValue(name)}'`, `trashed = ${trashed}`];
  if (parent) clauses.push(`'${parent}' in parents`);
  if (mimeType) clauses.push(`mimeType = '${mimeType}'`);
  const q = encodeURIComponent(clauses.join(" and "));
  const res = await driveFetch(`${DRIVE_FILES}?q=${q}&spaces=drive&fields=files(id,name)`, token);
  const data = await res.json();
  return data.files?.[0] || null;
}

async function createFolder(token, name, parent) {
  const body = { name, mimeType: "application/vnd.google-apps.folder" };
  if (parent) body.parents = [parent];
  const res = await driveFetch(DRIVE_FILES, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function ensureFolder(token, name, parent) {
  const existing = await findFile(token, { name, parent, mimeType: "application/vnd.google-apps.folder" });
  if (existing) return existing.id;
  const created = await createFolder(token, name, parent);
  return created.id;
}

async function ensureAppFolders(token) {
  const rootId = await ensureFolder(token, APP_FOLDER_NAME);
  const backupsId = await ensureFolder(token, "backups", rootId);
  return { rootId, backupsId };
}

async function downloadItemsJson(token, folderId) {
  const file = await findFile(token, { name: "items.json", parent: folderId });
  if (!file) return { items: [], fileId: null }; // first sync ever — nothing uploaded yet
  const res = await driveFetch(`${DRIVE_FILES}/${file.id}?alt=media`, token);
  const text = await res.text();
  const parsed = parseItemsPayload(text);
  if (!parsed.ok) throw syncError(parsed.reason, parsed.detail);
  return { items: parsed.items, fileId: file.id };
}

async function uploadItemsJson(token, folderId, fileId, items) {
  const payload = JSON.stringify({ v: WIRE_VERSION, items });
  const metadata = { name: "items.json", mimeType: "application/json" };
  if (!fileId) metadata.parents = [folderId];
  const body = buildMultipartBody(metadata, payload, "application/json");
  const url = fileId ? `${DRIVE_UPLOAD}/${fileId}?uploadType=multipart` : `${DRIVE_UPLOAD}?uploadType=multipart`;
  await driveFetch(url, token, {
    method: fileId ? "PATCH" : "POST",
    headers: { "Content-Type": `multipart/related; boundary=${MULTIPART_BOUNDARY}` },
    body,
  });
}

async function listMediaFiles(token, folderId) {
  const files = [];
  let pageToken = "";
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false and name != 'items.json'`);
    const pageParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "";
    const res = await driveFetch(`${DRIVE_FILES}?q=${q}&spaces=drive&fields=nextPageToken,files(id,name)&pageSize=1000${pageParam}`, token);
    const data = await res.json();
    files.push(...(data.files || []));
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return files;
}

async function uploadMedia(token, folderId, mediaId, blob, filename) {
  const metadata = { name: `${mediaId}__${filename || "file"}`, parents: [folderId] };
  const body = buildMultipartBlob(metadata, blob);
  await driveFetch(`${DRIVE_UPLOAD}?uploadType=multipart`, token, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${MULTIPART_BOUNDARY}` },
    body,
  });
}

async function downloadMediaBlob(token, fileId) {
  const res = await driveFetch(`${DRIVE_FILES}/${fileId}?alt=media`, token);
  return res.blob();
}

async function deleteFile(token, fileId) {
  await driveFetch(`${DRIVE_FILES}/${fileId}`, token, { method: "DELETE" });
}

// ────────────────────────────────────────────────────────────────────────
// the sync sequence (§7)
// ────────────────────────────────────────────────────────────────────────

function formatError(err) {
  return err.code ? `${err.code}: ${err.message}` : String(err.message || err);
}

export async function syncNow() {
  if (navigator.onLine === false) {
    await logActivity("sync", "skipped", "offline");
    return { outcome: "skipped", reason: "offline" };
  }
  try {
    const token = await requestToken({ pendingAction: "sync" });
    const { rootId } = await ensureAppFolders(token);

    // 1. download remote, merge against what we have now.
    const local1 = await getAllItems();
    const { items: remoteRaw, fileId } = await downloadItemsJson(token, rootId);
    const remote = remoteRaw.map(hydrateRecord);
    const { merged: merged1 } = mergeItemSets(local1, remote);

    // 2. reconcile media against that first merge.
    const localMediaIds = await getAllMediaIds();
    const remoteMediaFiles = await listMediaFiles(token, rootId);
    const remoteMediaNames = remoteMediaFiles.map((f) => f.name);
    const actions = computeMediaActions(merged1, localMediaIds, remoteMediaNames);

    for (const mediaId of actions.toUpload) {
      const rec = await getMedia(mediaId);
      if (rec?.blob) await uploadMedia(token, rootId, mediaId, rec.blob, rec.filename || "file");
    }
    for (const mediaId of actions.toDownload) {
      const file = remoteMediaFiles.find((f) => f.name.startsWith(`${mediaId}__`));
      if (file) await putMedia({ id: mediaId, blob: await downloadMediaBlob(token, file.id) });
    }
    for (const mediaId of actions.toDeleteLocal) await deleteMedia(mediaId);
    for (const name of actions.toDeleteRemoteNames) {
      const file = remoteMediaFiles.find((f) => f.name === name);
      if (file) await deleteFile(token, file.id);
    }

    // 3. re-read local and re-merge RIGHT BEFORE writing back — media
    // transfer above can take a while, and an edit made during that
    // window must not be clobbered by the now-stale first merge (§7.4).
    const local2 = await getAllItems();
    const { merged: merged2, stats } = mergeItemSets(local2, merged1);

    await putItems(merged2);
    await uploadItemsJson(token, rootId, fileId, merged2);

    await setMeta("lastSyncAt", new Date().toISOString());
    await logActivity("sync", "success", `${stats.added} added, ${stats.updated} updated, ${stats.deleted} deleted`);
    return { outcome: "success", stats };
  } catch (err) {
    await logActivity("sync", "error", formatError(err));
    return { outcome: "error", error: err };
  }
}

// ────────────────────────────────────────────────────────────────────────
// backup / restore (§8.2 / §8.3)
// ────────────────────────────────────────────────────────────────────────

export async function backupNow() {
  if (navigator.onLine === false) {
    await logActivity("backup", "skipped", "offline");
    return { outcome: "skipped", reason: "offline" };
  }
  try {
    const token = await requestToken({ pendingAction: "backup" });
    const { backupsId } = await ensureAppFolders(token);
    const items = await getAllItems();
    const filename = `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    const metadata = { name: filename, parents: [backupsId], mimeType: "application/json" };
    const body = buildMultipartBody(metadata, JSON.stringify({ v: WIRE_VERSION, items }), "application/json");
    await driveFetch(`${DRIVE_UPLOAD}?uploadType=multipart`, token, {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${MULTIPART_BOUNDARY}` },
      body,
    });
    await logActivity("backup", "success", filename);
    return { outcome: "success", filename };
  } catch (err) {
    await logActivity("backup", "error", formatError(err));
    return { outcome: "error", error: err };
  }
}

export async function listBackups() {
  const token = await requestToken({ pendingAction: "backup" });
  const { backupsId } = await ensureAppFolders(token);
  const q = encodeURIComponent(`'${backupsId}' in parents and trashed = false`);
  const res = await driveFetch(`${DRIVE_FILES}?q=${q}&spaces=drive&fields=files(id,name,createdTime)&orderBy=createdTime desc`, token);
  const data = await res.json();
  return data.files || [];
}

/** mode: "merge" runs the backup through the normal LWW merge. "replace"
 * makes the backup the source of truth locally AND re-uploads it
 * immediately, so the next sync can't silently revert the restore (§8.3). */
export async function restoreBackup(fileId, mode) {
  try {
    const token = await requestToken({ pendingAction: "sync" });
    const res = await driveFetch(`${DRIVE_FILES}/${fileId}?alt=media`, token);
    const text = await res.text();
    const parsed = parseItemsPayload(text);
    if (!parsed.ok) throw syncError(parsed.reason, parsed.detail);
    const backupItems = parsed.items.map(hydrateRecord);

    const local = await getAllItems();
    const finalItems = mode === "replace" ? backupItems : mergeItemSets(local, backupItems).merged;

    await putItems(finalItems);

    const { rootId } = await ensureAppFolders(token);

    if (mode === "replace") {
      const existing = await findFile(token, { name: "items.json", parent: rootId });
      await uploadItemsJson(token, rootId, existing?.id || null, finalItems);
    }

    // Both modes re-download any media the restored records reference
    // that this device doesn't already have (§8.3).
    const remoteMediaFiles = await listMediaFiles(token, rootId);
    const localMediaIds = await getAllMediaIds();
    const { toDownload } = computeMediaActions(finalItems, localMediaIds, remoteMediaFiles.map((f) => f.name));
    for (const mediaId of toDownload) {
      const file = remoteMediaFiles.find((f) => f.name.startsWith(`${mediaId}__`));
      if (file) await putMedia({ id: mediaId, blob: await downloadMediaBlob(token, file.id) });
    }

    await logActivity("restore", "success", `${mode}: ${finalItems.length} records`);
    return { outcome: "success" };
  } catch (err) {
    await logActivity("restore", "error", formatError(err));
    return { outcome: "error", error: err };
  }
}
