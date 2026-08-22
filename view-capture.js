// Photo capture flow: pick/confirm a container (existing or new), photograph
// or pick photos, upload as attachments. Every photo is saved immediately on
// pick — no separate "save" step — so nothing is lost if the tab is closed
// mid-session. Queues photos for AI batch identification (Review owns
// actually running it) rather than identifying per-photo.

import { queryItems, getItem, putItem, getMeta, setMeta, makeRecord, makeId, nextCode, putMedia, getMedia, deleteMedia } from "./db.js";
import { toast, populateLocationSelect, escapeHtml, resizeImageToBlob } from "./ui.js";
import { t } from "./i18n.js";

export function initCaptureView({ onOpenContainer }) {
  const comboInput = document.getElementById("capture-container-input");
  const comboList = document.getElementById("capture-container-list");
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
  // Raw media ids the share_target service-worker handler already stored
  // (sw.js's storeSharedFiles) — set by attachSharedMedia() below, and
  // consumed the moment a container is selected, since sharing always
  // lands here with no container chosen yet.
  let pendingSharedMediaIds = [];

  function revokeAllUrls() {
    for (const url of blobUrls.values()) URL.revokeObjectURL(url);
    blobUrls.clear();
  }

  function containerLabel(c) {
    return c.title ? `${c.code} — ${c.title}` : c.code;
  }

  // Capped so typing something too broad (or an empty/just-focused field)
  // can't dump hundreds of rows into the DOM at once — "cont-0" narrowing
  // 100+ containers down to a handful is the whole point of this filter,
  // but the empty-query "browse recent" case needs a cap too.
  const COMBO_MAX_RESULTS = 30;

  function matchingContainers(query) {
    const q = query.trim().toLowerCase();
    const sorted = [...containers].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const matches = q ? sorted.filter((c) => c.code.toLowerCase().includes(q) || c.title.toLowerCase().includes(q)) : sorted;
    return matches.slice(0, COMBO_MAX_RESULTS);
  }

  function renderComboList(query) {
    const matches = matchingContainers(query);
    if (!matches.length) {
      comboList.innerHTML = `<p class="combo-empty">${escapeHtml(t("search.noResults"))}</p>`;
    } else {
      comboList.innerHTML = matches
        .map((c) => `<button type="button" class="combo-option" data-container-id="${c.id}">${escapeHtml(containerLabel(c))}</button>`)
        .join("");
      comboList.querySelectorAll("[data-container-id]").forEach((btn) => {
        btn.addEventListener("click", () => pickContainer(btn.getAttribute("data-container-id")));
      });
    }
    comboList.hidden = false;
  }

  function closeComboList() {
    comboList.hidden = true;
  }

  async function pickContainer(id) {
    const c = containers.find((x) => x.id === id);
    if (!c) return;
    comboInput.value = containerLabel(c);
    closeComboList();
    await selectContainer(c.id);
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
    await consumePendingSharedMedia();
  }

  /** Turns whatever attachSharedMedia() queued into real attachments, the
   * moment a container becomes selected (share_target always lands here
   * with none chosen yet, so this fires either right after the user picks
   * an existing one or right after createBtn's handler selects a
   * brand-new one). The shared blobs sw.js stored are raw/unresized — run
   * through resizeImageToBlob here exactly like a normal file-input pick,
   * so a shared photo isn't a special case anywhere past this point. */
  async function consumePendingSharedMedia() {
    if (!container || pendingSharedMediaIds.length === 0) return;
    const rawIds = pendingSharedMediaIds;
    pendingSharedMediaIds = [];
    addBtn.disabled = true;
    try {
      const newAttachments = [];
      for (const rawId of rawIds) {
        const rec = await getMedia(rawId);
        if (!rec?.blob) continue;
        const { blob, width, height } = await resizeImageToBlob(rec.blob);
        const mediaId = makeId();
        await putMedia({ id: mediaId, blob, mimeType: "image/jpeg" });
        await deleteMedia(rawId);
        newAttachments.push({ mediaId, filename: "", mimeType: "image/jpeg", size: blob.size, width, height });
      }
      if (newAttachments.length) {
        container = { ...container, attachments: [...(container.attachments || []), ...newAttachments] };
        container = await putItem(container);
        await renderPhotoGrid();
      }
    } finally {
      addBtn.disabled = false;
    }
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
    comboInput.value = containerLabel(saved);
    closeNewContainerForm();
    await selectContainer(saved.id);
    toast(t("capture.containerCreated", { code: saved.code }), "info");
  });

  comboInput.addEventListener("focus", () => renderComboList(comboInput.value));

  comboInput.addEventListener("input", () => {
    // Typing away from the currently-selected container's exact label
    // deselects it — the field's text always mirrors "what's selected",
    // same as the native <select> it replaced, rather than leaving the
    // photo section pointed at a container the field no longer names.
    if (container && comboInput.value !== containerLabel(container)) selectContainer(null);
    renderComboList(comboInput.value);
  });

  comboInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeComboList();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const [first] = matchingContainers(comboInput.value);
      if (first) pickContainer(first.id);
    }
  });

  // Closed on outside pointerdown rather than the input's own blur — blur
  // fires before a click on a .combo-option registers, which would close
  // the list out from under the very tap meant to pick something from it.
  document.addEventListener("pointerdown", (e) => {
    if (!comboList.hidden && !e.target.closest(".field-combo")) closeComboList();
  });

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
    // Always land on "choose a container", not whatever was left selected
    // from the last time this tab was open.
    comboInput.value = "";
    closeComboList();
    closeNewContainerForm();
    await selectContainer(null);
  }

  /** Called by app.js right after show(), when boot() detects a
   * share_target redirect (#shared-photos) with pending media ids. Queues
   * them; consumePendingSharedMedia() picks them up the moment a
   * container is selected — never immediately here, since a share always
   * arrives with none chosen yet. */
  function attachSharedMedia(mediaIds) {
    pendingSharedMediaIds = [...pendingSharedMediaIds, ...mediaIds];
    consumePendingSharedMedia();
  }

  return { show, attachSharedMedia };
}
