// Storage-info section only — theme/language/density are cross-cutting and
// wired directly in app.js (needed at boot, before any view exists).

import { getStorageEstimate, requestPersistentStorage } from "./db.js";
import { t } from "./i18n.js";

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

  return { show: refreshStorageInfo };
}
