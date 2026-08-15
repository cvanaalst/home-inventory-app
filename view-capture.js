// Photo capture flow: pick/confirm a container (existing or new), photograph
// or pick photos, upload as attachments. Every photo is saved immediately on
// pick — no separate "save" step — so nothing is lost if the tab is closed
// mid-session. Queues photos for AI batch identification (Review owns
// actually running it) rather than identifying per-photo.

import { queryItems, getItem, putItem, getMeta, setMeta, makeRecord, makeId, nextCode, putMedia, getMedia, deleteMedia } from "./db.js";
import { toast, populateLocationSelect, escapeHtml, resizeImageToBlob } from "./ui.js";
import { t } from "./i18n.js";

export function initCaptureView({ onOpenContainer }) {
  const containerSelect = document.getElementById("capture-container-select");
  const newBtn = document.getElementById("capture-new-container-btn");
  const newForm = document.getElementById("capture-new-container-form");
  const prefixInput = document.getElementById("capture-new-prefix");
  const codeInput = document.getElementById("capture-new-code");
  const nameInput = document.getElementById("capture-new-name");
  const locationSelect = document.getElementById("capture-new-location");
  const createBtn = document.getElementById("capture-new-create");
  const cancelBtn = document.getElementById("capture-new-cancel");
  const errorEl = document.getElementById("capture-new-error");

  const photoSection = document.getElementById("capture-photo-section");
  const photoLabel = document.getElementById("capture-photo-label");
  const photoInput = document.getElementById("capture-photo-input");
  const addBtn = document.getElementById("capture-photo-add-btn");
  const grid = document.getElementById("capture-photo-grid");
  const emptyEl = document.getElementById("capture-photo-empty");
  const doneBtn = document.getElementById("capture-done-btn");

  let containers = [];
  let locations = [];
  let container = null;
  // mediaId -> object URL, so a photo's blob is only fetched/decoded once
  // per view visit rather than on every render.
  const blobUrls = new Map();

  function revokeAllUrls() {
    for (const url of blobUrls.values()) URL.revokeObjectURL(url);
    blobUrls.clear();
  }

  function containerLabel(c) {
    return c.title ? `${c.code} — ${c.title}` : c.code;
  }

  function refreshContainerSelect() {
    const current = containerSelect.value;
    containerSelect.innerHTML = "";
    const none = document.createElement("option");
    none.value = "";
    none.textContent = t("capture.selectContainer");
    containerSelect.appendChild(none);
    for (const c of [...containers].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = containerLabel(c);
      containerSelect.appendChild(opt);
    }
    containerSelect.value = current && containers.some((c) => c.id === current) ? current : "";
  }

  async function selectContainer(id) {
    container = id ? await getItem(id) : null;
    photoSection.hidden = !container;
    if (!container) {
      grid.innerHTML = "";
      return;
    }
    photoLabel.textContent = containerLabel(container);
    await renderPhotoGrid();
  }

  async function urlFor(mediaId) {
    if (blobUrls.has(mediaId)) return blobUrls.get(mediaId);
    const rec = await getMedia(mediaId);
    if (!rec || !rec.blob) return "";
    const url = URL.createObjectURL(rec.blob);
    blobUrls.set(mediaId, url);
    return url;
  }

  async function renderPhotoGrid() {
    const attachments = container.attachments || [];
    emptyEl.hidden = attachments.length > 0;
    grid.innerHTML = attachments
      .map((a) => `<div class="capture-photo-tile" data-media-id="${escapeHtml(a.mediaId)}"><img alt="" /><button type="button" class="capture-photo-remove">×</button></div>`)
      .join("");
    for (const a of attachments) {
      const tile = grid.querySelector(`[data-media-id="${CSS.escape(a.mediaId)}"]`);
      if (!tile) continue;
      const img = tile.querySelector("img");
      img.src = await urlFor(a.mediaId);
      tile.querySelector(".capture-photo-remove").addEventListener("click", () => removePhoto(a.mediaId));
    }
  }

  async function openNewContainerForm() {
    errorEl.hidden = true;
    prefixInput.value = "";
    codeInput.value = nextCode(containers.map((c) => c.code), "BOX");
    nameInput.value = "";
    const lastLocationId = await getMeta("lastLocationId", "");
    populateLocationSelect(locationSelect, locations, lastLocationId, { noneLabel: t("detail.noLocation") });
    newForm.hidden = false;
    newBtn.hidden = true;
  }

  function closeNewContainerForm() {
    newForm.hidden = true;
    newBtn.hidden = false;
  }

  newBtn.addEventListener("click", openNewContainerForm);
  cancelBtn.addEventListener("click", closeNewContainerForm);
  prefixInput.addEventListener("blur", () => {
    codeInput.value = nextCode(containers.map((c) => c.code), prefixInput.value.trim() || "BOX");
  });

  createBtn.addEventListener("click", async () => {
    const code = codeInput.value.trim();
    if (!code) {
      errorEl.textContent = t("search.codeRequired");
      errorEl.hidden = false;
      return;
    }
    if (containers.some((c) => c.code === code)) {
      errorEl.textContent = t("search.codeExists", { code });
      errorEl.hidden = false;
      return;
    }
    const record = makeRecord({
      type: "container",
      code,
      title: nameInput.value.trim(),
      status: "captured",
      linkedIds: locationSelect.value ? [locationSelect.value] : [],
    });
    if (locationSelect.value) await setMeta("lastLocationId", locationSelect.value);
    const saved = await putItem(record);
    containers.push(saved);
    refreshContainerSelect();
    containerSelect.value = saved.id;
    closeNewContainerForm();
    await selectContainer(saved.id);
    toast(t("capture.containerCreated", { code: saved.code }), "info");
  });

  containerSelect.addEventListener("change", () => selectContainer(containerSelect.value));

  addBtn.addEventListener("click", () => photoInput.click());

  photoInput.addEventListener("change", async () => {
    const files = Array.from(photoInput.files || []);
    photoInput.value = "";
    if (!container || files.length === 0) return;
    addBtn.disabled = true;
    try {
      const newAttachments = [];
      for (const file of files) {
        const { blob, width, height } = await resizeImageToBlob(file);
        const mediaId = makeId();
        await putMedia({ id: mediaId, blob, mimeType: "image/jpeg" });
        newAttachments.push({ mediaId, filename: file.name || "", mimeType: "image/jpeg", size: blob.size, width, height });
      }
      container = { ...container, attachments: [...(container.attachments || []), ...newAttachments] };
      container = await putItem(container);
      await renderPhotoGrid();
    } finally {
      addBtn.disabled = false;
    }
  });

  async function removePhoto(mediaId) {
    const attachments = (container.attachments || []).filter((a) => a.mediaId !== mediaId);
    const removed = (container.attachments || []).find((a) => a.mediaId === mediaId);
    container = { ...container, attachments };
    container = await putItem(container);
    await renderPhotoGrid();
    toast(t("capture.photoRemoved"), "info", {
      actionLabel: t("toast.undo"),
      onExpire: () => deleteMedia(mediaId),
      onAction: async () => {
        if (!removed) return;
        container = { ...container, attachments: [...(container.attachments || []), removed] };
        container = await putItem(container);
        await renderPhotoGrid();
      },
    });
  }

  doneBtn.addEventListener("click", () => {
    if (container) onOpenContainer(container.id);
  });

  async function show() {
    revokeAllUrls();
    const [{ results: loadedContainers }, { results: loadedLocations }] = await Promise.all([
      queryItems({ type: "container" }),
      queryItems({ type: "location" }),
    ]);
    containers = loadedContainers;
    locations = loadedLocations;
    refreshContainerSelect();
    closeNewContainerForm();
    await selectContainer(containerSelect.value);
  }

  return { show };
}
