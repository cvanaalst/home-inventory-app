// Storage-info + Sync sections. Theme/language/density are cross-cutting
// and wired directly in app.js (needed at boot, before any view exists);
// everything here is view-local and needs fresh data on every open.

import { getStorageEstimate, requestPersistentStorage } from "./db.js";
import { t } from "./i18n.js";
import { toast, confirmDialog, escapeHtml } from "./ui.js";
import {
  getConnectionStatus,
  setClientId,
  syncNow,
  backupNow,
  listBackups,
  restoreBackup,
  disconnect,
} from "./sync.js";

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit++;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(value >= 10 || unit < 0 ? 0 : 1)} ${units[unit]}`;
}

export function initSettingsView() {
  // ---------- storage ----------

  const usageEl = document.getElementById("settings-storage-usage");
  const barFillEl = document.getElementById("settings-storage-bar-fill");
  const persistStatusEl = document.getElementById("settings-storage-persist-status");
  const persistBtn = document.getElementById("settings-storage-persist-btn");

  async function refreshStorageInfo() {
    const { usage, quota, supported } = await getStorageEstimate();
    if (supported && quota > 0) {
      usageEl.textContent = t("settings.storage.usage", { used: formatBytes(usage), quota: formatBytes(quota) });
      barFillEl.style.width = `${Math.min(100, (usage / quota) * 100)}%`;
    } else {
      usageEl.textContent = t("settings.storage.unsupported");
      barFillEl.style.width = "0%";
    }

    const persisted = (await navigator.storage?.persisted?.()) ?? false;
    persistStatusEl.textContent = persisted ? t("settings.storage.persisted") : t("settings.storage.notPersisted");
    persistBtn.hidden = persisted;
  }

  persistBtn.addEventListener("click", async () => {
    const granted = await requestPersistentStorage();
    persistStatusEl.textContent = granted ? t("settings.storage.persistGranted") : t("settings.storage.persistDenied");
    persistBtn.hidden = granted;
  });

  // ---------- sync ----------

  const clientIdInput = document.getElementById("sync-clientid-input");
  const clientIdSaveBtn = document.getElementById("sync-clientid-save-btn");
  const originValue = document.getElementById("sync-origin-value");
  const redirectValue = document.getElementById("sync-redirect-value");
  const statusEl = document.getElementById("sync-status");
  const syncNowBtn = document.getElementById("sync-now-btn");
  const backupBtn = document.getElementById("sync-backup-btn");
  const restoreToggleBtn = document.getElementById("sync-restore-toggle-btn");
  const restoreListEl = document.getElementById("sync-restore-list");
  const restoreEmptyEl = document.getElementById("sync-restore-empty");
  const disconnectBtn = document.getElementById("sync-disconnect-btn");

  async function refreshSyncStatus() {
    const status = await getConnectionStatus();
    if (document.activeElement !== clientIdInput) clientIdInput.value = status.clientId;
    originValue.value = status.origin;
    redirectValue.value = status.redirectUri;

    const parts = [
      status.configured ? t("settings.sync.configured") : t("settings.sync.notConfigured"),
      status.signedIn ? t("settings.sync.signedIn") : t("settings.sync.notSignedIn"),
      status.lastSyncAt ? t("settings.sync.lastSync", { when: new Date(status.lastSyncAt).toLocaleString() }) : t("settings.sync.neverSynced"),
    ];
    statusEl.textContent = parts.join(" · ");

    syncNowBtn.disabled = !status.configured;
    backupBtn.disabled = !status.configured;
    restoreToggleBtn.disabled = !status.configured;
    return status;
  }

  clientIdSaveBtn.addEventListener("click", async () => {
    await setClientId(clientIdInput.value);
    await refreshSyncStatus();
    toast(t("settings.sync.saved"), "info");
  });

  syncNowBtn.addEventListener("click", async () => {
    syncNowBtn.disabled = true;
    syncNowBtn.textContent = t("settings.sync.waiting");
    const result = await syncNow();
    syncNowBtn.textContent = t("settings.sync.now");
    await refreshSyncStatus();
    // "skipped" (offline, or a redirect to Google is underway) shows no
    // toast — a redirect navigates the page away almost immediately, so
    // there'd be nothing left to see it.
    if (result.outcome === "success") toast(t("settings.sync.syncSuccess"), "info");
    else if (result.outcome === "error") toast(t("settings.sync.syncError"), "error");
  });

  backupBtn.addEventListener("click", async () => {
    backupBtn.disabled = true;
    backupBtn.textContent = t("settings.sync.waiting");
    const result = await backupNow();
    backupBtn.textContent = t("settings.sync.backupNow");
    await refreshSyncStatus();
    if (result.outcome === "success") toast(t("settings.sync.backupSuccess"), "info");
    else if (result.outcome === "error") toast(t("settings.sync.backupError"), "error");
  });

  async function doRestore(backup, mode) {
    const confirmKey = mode === "replace" ? "settings.sync.confirmReplace" : "settings.sync.confirmMerge";
    const ok = await confirmDialog(t(confirmKey, { name: backup.name }), t("action.confirm"));
    if (!ok) return;
    const result = await restoreBackup(backup.id, mode);
    toast(
      result.outcome === "success" ? t("settings.sync.restoreSuccess") : t("settings.sync.restoreError"),
      result.outcome === "success" ? "info" : "error",
    );
  }

  async function renderBackupsList() {
    let backups = [];
    try {
      backups = await listBackups();
    } catch {
      restoreListEl.innerHTML = "";
      restoreEmptyEl.hidden = false;
      restoreEmptyEl.textContent = t("settings.sync.backupsLoadError");
      return;
    }

    restoreEmptyEl.textContent = t("settings.sync.noBackups");
    restoreEmptyEl.hidden = backups.length > 0;
    restoreListEl.innerHTML = backups
      .map(
        (b) => `
        <div class="row-card trash-row" data-id="${b.id}">
          <span class="row-main">
            <span class="row-title">${escapeHtml(b.name)}</span>
          </span>
          <div class="trash-row-actions">
            <button type="button" class="btn btn-sm sync-restore-merge-btn">${escapeHtml(t("settings.sync.merge"))}</button>
            <button type="button" class="btn btn-sm btn-danger sync-restore-replace-btn">${escapeHtml(t("settings.sync.replace"))}</button>
          </div>
        </div>`,
      )
      .join("");

    for (const b of backups) {
      const row = restoreListEl.querySelector(`[data-id="${b.id}"]`);
      if (!row) continue;
      row.querySelector(".sync-restore-merge-btn").addEventListener("click", () => doRestore(b, "merge"));
      row.querySelector(".sync-restore-replace-btn").addEventListener("click", () => doRestore(b, "replace"));
    }
  }

  let restoreListOpen = false;
  restoreToggleBtn.addEventListener("click", async () => {
    restoreListOpen = !restoreListOpen;
    restoreListEl.hidden = !restoreListOpen;
    if (restoreListOpen) await renderBackupsList();
  });

  disconnectBtn.addEventListener("click", async () => {
    await disconnect();
    await refreshSyncStatus();
    toast(t("settings.sync.disconnected"), "info");
  });

  async function show() {
    await refreshStorageInfo();
    await refreshSyncStatus();
  }

  return { show };
}
