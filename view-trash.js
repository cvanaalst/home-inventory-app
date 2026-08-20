// Recently deleted (§8.5). Restore re-creates the record under a NEW id —
// a resurrected old id would just be re-killed by the next sync that still
// sees its tombstone — and clones any attached media under new ids too.
// Delete forever wipes content but keeps the bare tombstone, so the
// deletion still propagates and the record can never resurrect.

import { getDeletedItems, putItem, makeRecord, deleteMedia, cloneMedia, locationPath, purgeContentFields } from "./db.js";
import { toast, confirmDialog, escapeHtml } from "./ui.js";
import { t } from "./i18n.js";

const ENVELOPE_ONLY = new Set(["id", "createdAt", "updatedAt", "deletedAt", "restoredAt", "purgedAt"]);

function contentFields(record) {
  const out = {};
  for (const key of Object.keys(record)) {
    if (!ENVELOPE_ONLY.has(key)) out[key] = record[key];
  }
  return out;
}

function displayLabel(record) {
  if (record.type === "location") return locationPath(record) || t("detail.noLocation");
  if (record.type === "container") return record.title ? `${record.code} — ${record.title}` : record.code;
  return record.title || t("item.description");
}

function typeLabel(type) {
  return t(`trash.type.${type}`);
}

export function initTrashView() {
  const listEl = document.getElementById("trash-list");
  const emptyEl = document.getElementById("trash-empty");

  const pendingPurge = new Set(); // ids optimistically hidden after "delete forever" confirm
  let currentRecords = [];

  async function restore(record) {
    const clonedAttachments = [];
    for (const att of record.attachments || []) {
      const newMediaId = await cloneMedia(att.mediaId);
      if (newMediaId) clonedAttachments.push({ ...att, mediaId: newMediaId });
    }

    const restored = makeRecord({ ...contentFields(record), attachments: clonedAttachments });
    await putItem(restored);
    await putItem({ ...record, restoredAt: new Date().toISOString() });

    currentRecords = currentRecords.filter((r) => r.id !== record.id);
    render();
    toast(t("trash.restored"), "info");
  }

  async function purgeForever(record) {
    const ok = await confirmDialog(t("trash.confirmPurge"), t("action.delete"));
    if (!ok) return;

    for (const att of record.attachments || []) await deleteMedia(att.mediaId);

    await putItem({ ...purgeContentFields(record), purgedAt: new Date().toISOString() });

    currentRecords = currentRecords.filter((r) => r.id !== record.id);
    render();
  }

  function render() {
    emptyEl.hidden = currentRecords.length > 0;
    listEl.innerHTML = currentRecords
      .map(
        (r) => `
        <div class="row-card trash-row" data-id="${r.id}">
          <span class="row-main">
            <span class="row-title">${escapeHtml(displayLabel(r))}</span>
            <span class="row-sub">${escapeHtml(typeLabel(r.type))}</span>
          </span>
          <div class="trash-row-actions">
            <button type="button" class="btn btn-sm trash-restore-btn">${escapeHtml(t("trash.restore"))}</button>
            <button type="button" class="btn btn-sm btn-danger trash-purge-btn">${escapeHtml(t("trash.purge"))}</button>
          </div>
        </div>`,
      )
      .join("");

    for (const record of currentRecords) {
      const row = listEl.querySelector(`[data-id="${record.id}"]`);
      if (!row) continue;
      row.querySelector(".trash-restore-btn").addEventListener("click", () => restore(record));
      row.querySelector(".trash-purge-btn").addEventListener("click", () => purgeForever(record));
    }
  }

  async function show() {
    currentRecords = await getDeletedItems();
    render();
  }

  return { show };
}
