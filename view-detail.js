// Container detail/edit: name, location, notes, item editor (add/edit/
// delete/move), confirm-drafts. Two-speed persistence (BLUEPRINT.md §9):
// the location select is write-through, text fields are save-gated on
// blur, item quantity is write-through, item text fields are save-gated.

import { queryItems, getItem, putItem, putItems, putMedia, cloneMedia, deleteMedia, makeRecord, makeId, getMedia, normalizeCode, nextCode } from "./db.js";
import { toast, attachSwipeActions, populateLocationSelect, escapeHtml, statusBadgeClass, openLightbox, resizeImageToBlob } from "./ui.js";
import { t, tCount } from "./i18n.js";
import { icon } from "./icons.js";
import { buildPrintReportHtml, formatFieldsSummary } from "./report.js";

export function initDetailView({ onDeleted }) {
  const codeEl = document.getElementById("detail-code");
  const badgeEl = document.getElementById("detail-status-badge");
  const notFoundEl = document.getElementById("detail-not-found");
  const contentEl = document.getElementById("detail-content");
  const titleInput = document.getElementById("detail-title");
  const locationSelect = document.getElementById("detail-location");
  const notesInput = document.getElementById("detail-notes");
  const confirmBtn = document.getElementById("detail-confirm-btn");
  const itemsLabel = document.getElementById("detail-items-label");
  const itemsEmpty = document.getElementById("detail-items-empty");
  const itemsList = document.getElementById("detail-items-list");
  const addItemBtn = document.getElementById("detail-add-item-btn");
  const itemForm = document.getElementById("detail-item-form");
  const newItemTitle = document.getElementById("new-item-title");
  const newItemQty = document.getElementById("new-item-quantity");
  const newItemCategory = document.getElementById("new-item-category");
  const newItemLink = document.getElementById("new-item-link");
  const newItemFieldsList = document.getElementById("new-item-fields-list");
  const newItemFieldAddBtn = document.getElementById("new-item-field-add-btn");
  const newItemSave = document.getElementById("new-item-save");
  const newItemCancel = document.getElementById("new-item-cancel");
  const deleteBtn = document.getElementById("detail-delete-btn");
  const printBtn = document.getElementById("detail-print-btn");
  const categoryOptionsEl = document.getElementById("category-options");
  const photoGrid = document.getElementById("detail-photo-grid");
  const photoInput = document.getElementById("detail-photo-input");
  const photoAddBtn = document.getElementById("detail-photo-add-btn");
  const photoAiToggle = document.getElementById("detail-photo-ai-toggle");
  const codeErrorEl = document.getElementById("detail-code-error");
  const copyBtn = document.getElementById("detail-copy-btn");
  const copyForm = document.getElementById("detail-copy-form");
  const copyTargetSelect = document.getElementById("detail-copy-target-select");
  const copyNewFields = document.getElementById("detail-copy-new-fields");
  const copyNewPrefix = document.getElementById("detail-copy-new-prefix");
  const copyNewCode = document.getElementById("detail-copy-new-code");
  const copyNewName = document.getElementById("detail-copy-new-name");
  const copyNewLocation = document.getElementById("detail-copy-new-location");
  const copyConfirmBtn = document.getElementById("detail-copy-confirm-btn");
  const copyCancelBtn = document.getElementById("detail-copy-cancel-btn");
  const copyErrorEl = document.getElementById("detail-copy-error");
  const NEW_CONTAINER_OPTION = "__new__";

  let container = null;
  let locations = [];
  let containers = [];
  let items = [];
  const photoUrls = new Set();

  function refreshCategoryOptionsDatalist() {
    const cats = [
      ...new Set([
        ...items.map((i) => i.category).filter(Boolean),
        "resistors",
        "capacitors",
        "displays",
        "microcontrollers",
        "sensors",
        "cables",
        "power",
        "rf",
        "tools",
        "storage",
        "misc",
      ]),
    ].sort();
    categoryOptionsEl.innerHTML = cats.map((c) => `<option value="${escapeHtml(c)}"></option>`).join("");
  }

  async function reload(containerId) {
    container = await getItem(containerId);
    if (!container || container.deletedAt) {
      notFoundEl.hidden = false;
      contentEl.hidden = true;
      return false;
    }
    notFoundEl.hidden = true;
    contentEl.hidden = false;

    const [{ results: locs }, { results: allContainers }, { results: itemResults }] = await Promise.all([
      queryItems({ type: "location" }),
      queryItems({ type: "container" }),
      queryItems({ type: "item", linkedId: containerId, sortBy: "createdAt", sortDir: "asc" }),
    ]);
    locations = locs;
    containers = allContainers;
    items = itemResults;
    return true;
  }

  function renderHeader() {
    codeEl.value = container.code;
    badgeEl.textContent = container.status;
    badgeEl.className = statusBadgeClass(container.status);
  }

  function renderFields() {
    titleInput.value = container.title;
    notesInput.value = container.comment;
    populateLocationSelect(locationSelect, locations, (container.linkedIds || [])[0], { noneLabel: t("detail.noLocation") });
  }

  /** Thumbnail grid of the container's photos — tapping the image opens it
   * full-size via openLightbox(); the × removes it. Deletion is Drive-safe
   * by construction, not by any explicit API call here: removing the
   * attachment locally is enough — the next sync's computeMediaActions
   * (merge.js) already treats "no live record references this mediaId
   * anymore" as the signal to delete the file on Drive too, the same way
   * every other delete in this app is a local tombstone the next sync
   * reconciles, never a synchronous network call at click-time. */
  async function renderPhotos() {
    for (const url of photoUrls) URL.revokeObjectURL(url);
    photoUrls.clear();
    const attachments = container.attachments || [];
    photoGrid.hidden = attachments.length === 0;
    photoGrid.innerHTML = attachments
      .map((a) => `<div class="capture-photo-tile" data-media-id="${escapeHtml(a.mediaId)}"><img alt="" /><button type="button" class="capture-photo-remove" aria-label="${escapeHtml(t("action.delete"))}">${icon("close", { size: 14 })}</button></div>`)
      .join("");
    for (const a of attachments) {
      const rec = await getMedia(a.mediaId);
      if (!rec || !rec.blob) continue;
      const url = URL.createObjectURL(rec.blob);
      photoUrls.add(url);
      const tile = photoGrid.querySelector(`[data-media-id="${CSS.escape(a.mediaId)}"]`);
      if (!tile) continue;
      tile.querySelector("img").src = url;
      tile.querySelector("img").addEventListener("click", () => openLightbox(url));
      tile.querySelector(".capture-photo-remove").addEventListener("click", () => removePhoto(a.mediaId));
    }
  }

  async function removePhoto(mediaId) {
    const removed = (container.attachments || []).find((a) => a.mediaId === mediaId);
    if (!removed) return;
    await patchContainer({ attachments: (container.attachments || []).filter((a) => a.mediaId !== mediaId) });
    await renderPhotos();
    toast(t("capture.photoRemoved"), "info", {
      actionLabel: t("toast.undo"),
      onExpire: () => deleteMedia(mediaId),
      onAction: async () => {
        await patchContainer({ attachments: [...(container.attachments || []), removed] });
        await renderPhotos();
      },
    });
  }

  function renderConfirmButton() {
    const draftCount = items.filter((i) => i.state === "draft").length;
    if (draftCount > 0) {
      confirmBtn.hidden = false;
      confirmBtn.textContent = tCount("detail.confirmDrafts", draftCount);
    } else if (container.status !== "confirmed") {
      confirmBtn.hidden = false;
      confirmBtn.textContent = t("detail.markConfirmed");
    } else {
      confirmBtn.hidden = true;
    }
  }

  // Structured key/value specs (BLUEPRINT.md §5) — resistor value, voltage
  // rating, datasheet URL, whatever a category needs. The type only decides
  // what's *suggested*; the mechanism is the same for every item.
  function fieldRowHtml(field) {
    return `
      <div class="row item-field-row" data-field-id="${field.id}">
        <input type="text" class="item-field-key" value="${escapeHtml(field.key)}" placeholder="${escapeHtml(t("item.fieldKey"))}" maxlength="40" />
        <input type="text" class="grow item-field-value" value="${escapeHtml(field.value)}" placeholder="${escapeHtml(t("item.fieldValue"))}" maxlength="200" />
        <button type="button" class="btn-icon item-field-remove-btn" data-i18n-aria="action.delete">${icon("close", { size: 16 })}</button>
      </div>`;
  }

  function itemRowHtml(item) {
    const link = (item.links || [])[0];
    const fieldCount = (item.fields || []).length;
    const fieldsSummary = formatFieldsSummary(item.fields);
    return `
      <div class="swipe-row" data-item-id="${item.id}">
        <div class="swipe-actions right">${icon("trash", { size: 18 })}</div>
        <div class="swipe-content item-row${item.state === "draft" ? " draft" : ""}">
          <div class="item-row-main">
            <div class="qty-stepper">
              <button type="button" data-qty-dec aria-label="-">−</button>
              <input type="text" inputmode="numeric" class="item-qty-input" value="${item.quantity}" />
              <button type="button" data-qty-inc aria-label="+">＋</button>
            </div>
            <input type="text" class="grow item-title-input" value="${escapeHtml(item.title)}" maxlength="100" />
            <button type="button" class="btn-icon item-delete-btn" data-i18n-aria="action.delete">${icon("close", { size: 18 })}</button>
          </div>
          <div class="item-row-sub">
            <input type="text" class="cat-input item-category-input" list="category-options" value="${escapeHtml(item.category)}" placeholder="${escapeHtml(t("item.category"))}" />
            <input type="text" class="link-input item-link-input" value="${escapeHtml(link ? link.url : "")}" placeholder="${escapeHtml(t("item.link"))}" autocapitalize="none" />
            <button type="button" class="btn-icon item-fields-toggle-btn${fieldCount ? " has-fields" : ""}" title="${escapeHtml(t("item.specs"))}">${icon("info", { size: 18 })}</button>
            <button type="button" class="btn-icon item-move-btn" title="${escapeHtml(t("item.moveTo"))}">${icon("move", { size: 18 })}</button>
          </div>
          <button type="button" class="item-fields-summary"${fieldsSummary ? "" : " hidden"}>${escapeHtml(fieldsSummary)}</button>
          <div class="move-row" hidden style="margin-top: 8px">
            <select class="item-move-select"></select>
          </div>
          <div class="item-fields-panel" hidden style="margin-top: 8px">
            <div class="item-fields-list">${(item.fields || []).map(fieldRowHtml).join("")}</div>
            <button type="button" class="btn btn-sm item-field-add-btn">${escapeHtml(t("item.addSpec"))}</button>
          </div>
        </div>
      </div>`;
  }

  function deleteItem(item) {
    const row = itemsList.querySelector(`[data-item-id="${item.id}"]`);
    row?.remove();
    itemsEmpty.hidden = itemsList.children.length > 0;

    toast(t("toast.itemDeleted"), "info", {
      actionLabel: t("toast.undo"),
      onAction: async () => {
        await renderItems(); // nothing was written — just re-render from source data
      },
      onExpire: async () => {
        await putItem({ ...item, deletedAt: new Date().toISOString() });
      },
    });
  }

  // Merges `fields` into item `id` and writes it. The merge into the shared
  // `items` array happens SYNCHRONOUSLY, before the write is awaited — two
  // blur events firing back-to-back (e.g. tabbing through title then
  // category) would otherwise both read the pre-edit record, and whichever
  // write lands last would silently discard the other field's change.
  function patchItem(id, fields) {
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return Promise.resolve();
    const merged = { ...items[idx], ...fields };
    items[idx] = merged;
    return putItem(merged).then((updated) => {
      items = items.map((i) => (i.id === id ? updated : i));
    });
  }

  function wireItemRow(row, item) {
    // Stepper reads its basis from the input's own current value, not the
    // closure's `item` snapshot — two quick +clicks before the first write
    // resolves must land on 5 then 6, not 5 then 5 again.
    const qtyInput = row.querySelector(".item-qty-input");
    row.querySelector("[data-qty-dec]").addEventListener("click", () => {
      const next = Math.max(1, (Number.parseInt(qtyInput.value, 10) || 1) - 1);
      qtyInput.value = next;
      patchItem(item.id, { quantity: next });
    });
    row.querySelector("[data-qty-inc]").addEventListener("click", () => {
      const next = (Number.parseInt(qtyInput.value, 10) || 1) + 1;
      qtyInput.value = next;
      patchItem(item.id, { quantity: next });
    });
    qtyInput.addEventListener("blur", () => {
      const next = Math.max(1, Number.parseInt(qtyInput.value, 10) || 1);
      qtyInput.value = next;
      const current = items.find((i) => i.id === item.id);
      if (next !== current?.quantity) patchItem(item.id, { quantity: next });
    });

    // After a write resolves, the input is re-synced to the normalized
    // stored value (trimmed title, lowercased category, tracking params
    // stripped from the link) — otherwise the field keeps showing exactly
    // what was typed until the view is reopened, which reads as the save
    // not having "really" taken effect.
    const titleInputEl = row.querySelector(".item-title-input");
    titleInputEl.addEventListener("blur", () => {
      const next = titleInputEl.value.trim();
      const current = items.find((i) => i.id === item.id);
      if (next && next !== current?.title) {
        patchItem(item.id, { title: next }).then(() => {
          titleInputEl.value = items.find((i) => i.id === item.id)?.title ?? next;
        });
      } else {
        titleInputEl.value = current?.title ?? item.title;
      }
    });

    const catInput = row.querySelector(".item-category-input");
    catInput.addEventListener("blur", () => {
      const next = catInput.value.trim();
      const current = items.find((i) => i.id === item.id);
      if (next !== current?.category) {
        patchItem(item.id, { category: next }).then(() => {
          catInput.value = items.find((i) => i.id === item.id)?.category ?? next;
        });
      }
    });

    const linkInput = row.querySelector(".item-link-input");
    linkInput.addEventListener("blur", () => {
      const next = linkInput.value.trim();
      const current = items.find((i) => i.id === item.id);
      const currentUrl = (current?.links || [])[0]?.url || "";
      if (next !== currentUrl) {
        patchItem(item.id, { links: next ? [{ label: "", url: next }] : [] }).then(() => {
          linkInput.value = (items.find((i) => i.id === item.id)?.links || [])[0]?.url || "";
        });
      }
    });

    row.querySelector(".item-delete-btn").addEventListener("click", () => deleteItem(item));

    const moveBtn = row.querySelector(".item-move-btn");
    const moveRow = row.querySelector(".move-row");
    const moveSelect = row.querySelector(".item-move-select");
    moveBtn.addEventListener("click", () => {
      const opening = moveRow.hidden;
      moveRow.hidden = !opening;
      if (opening) {
        moveSelect.innerHTML =
          `<option value="" disabled selected>${escapeHtml(t("item.moveTo"))}</option>` +
          containers
            .filter((c) => c.id !== container.id)
            .map((c) => `<option value="${c.id}">${escapeHtml(c.code)}${c.title ? ` — ${escapeHtml(c.title)}` : ""}</option>`)
            .join("");
      }
    });
    moveSelect.addEventListener("change", async () => {
      if (!moveSelect.value) return;
      await patchItem(item.id, { linkedIds: [moveSelect.value] });
      row.closest(".swipe-row").remove();
      items = items.filter((i) => i.id !== item.id);
      itemsEmpty.hidden = itemsList.children.length > 0;
    });

    // ---------- structured fields (specs) ----------

    const fieldsToggleBtn = row.querySelector(".item-fields-toggle-btn");
    const fieldsSummaryBtn = row.querySelector(".item-fields-summary");
    const fieldsPanel = row.querySelector(".item-fields-panel");
    const fieldsListEl = row.querySelector(".item-fields-list");

    // The DOM is the source of truth for "what's in the panel right now",
    // not the `items` array — normalizeFields() drops any field whose key
    // is still empty (correctly: a spec with no name isn't a spec yet), so
    // a freshly-added blank row never survives a round trip through
    // patchItem. Reading it back from `items` afterward would find it
    // already gone. Read the live inputs instead, on every write.
    function readFieldsFromPanel() {
      return [...fieldsListEl.querySelectorAll(".item-field-row")]
        .map((r) => ({ id: r.getAttribute("data-field-id"), key: r.querySelector(".item-field-key").value.trim(), value: r.querySelector(".item-field-value").value.trim() }))
        .filter((f) => f.key);
    }

    function commitFields() {
      const fields = readFieldsFromPanel();
      fieldsToggleBtn.classList.toggle("has-fields", fields.length > 0);
      // The closed-row summary must stay in sync with the panel that's
      // actually open, not wait for the next full renderItems() — same
      // "closed header still answers what's in here" reasoning as the
      // has-fields class above.
      const summary = formatFieldsSummary(fields);
      fieldsSummaryBtn.textContent = summary;
      fieldsSummaryBtn.hidden = !summary;
      return patchItem(item.id, { fields });
    }

    function wireFieldRow(fieldRowEl) {
      fieldRowEl.querySelector(".item-field-key").addEventListener("blur", commitFields);
      fieldRowEl.querySelector(".item-field-value").addEventListener("blur", commitFields);
      fieldRowEl.querySelector(".item-field-remove-btn").addEventListener("click", () => {
        fieldRowEl.remove();
        commitFields();
      });
    }
    fieldsListEl.querySelectorAll(".item-field-row").forEach(wireFieldRow);

    function openFieldsPanel() {
      fieldsPanel.hidden = false;
    }
    fieldsToggleBtn.addEventListener("click", () => {
      fieldsPanel.hidden = !fieldsPanel.hidden;
    });
    fieldsSummaryBtn.addEventListener("click", openFieldsPanel);
    row.querySelector(".item-field-add-btn").addEventListener("click", () => {
      const blank = { id: makeId(), key: "", value: "" };
      fieldsListEl.insertAdjacentHTML("beforeend", fieldRowHtml(blank));
      const newRow = fieldsListEl.lastElementChild;
      wireFieldRow(newRow);
      newRow.querySelector(".item-field-key").focus();
    });

    attachSwipeActions(row.closest(".swipe-row"), { onSwipeLeft: () => deleteItem(item) });
  }

  async function renderItems() {
    itemsLabel.textContent = tCount("detail.itemsCount", items.length);
    itemsEmpty.hidden = items.length > 0;
    itemsList.innerHTML = items.map(itemRowHtml).join("");
    items.forEach((item) => {
      const row = itemsList.querySelector(`[data-item-id="${item.id}"]`);
      if (row) wireItemRow(row, item);
    });
    refreshCategoryOptionsDatalist();
    renderConfirmButton();
  }

  // ---------- container field persistence (two-speed) ----------

  // Same synchronous-merge pattern as patchItem: blurring title then
  // immediately changing location must not let the slower write clobber
  // the faster one.
  function patchContainer(fields) {
    container = { ...container, ...fields };
    return putItem(container).then((updated) => {
      container = updated;
    });
  }

  // Rename: same two-speed blur-save as title/notes, but codes must stay
  // unique across containers — normalizeCode() runs the same transform
  // db.js applies on save, so the pre-write duplicate check compares
  // apples to apples instead of against the raw, un-normalized input.
  codeEl.addEventListener("blur", async () => {
    codeErrorEl.hidden = true;
    const next = normalizeCode(codeEl.value);
    if (!next || next === container.code) {
      codeEl.value = container.code;
      return;
    }
    if (containers.some((c) => c.id !== container.id && c.code === next)) {
      codeErrorEl.textContent = t("search.codeExists", { code: next });
      codeErrorEl.hidden = false;
      codeEl.value = container.code;
      return;
    }
    await patchContainer({ code: next });
    codeEl.value = container.code;
  });

  titleInput.addEventListener("blur", () => {
    const next = titleInput.value.trim();
    if (next !== container.title) patchContainer({ title: next });
  });
  notesInput.addEventListener("blur", () => {
    const next = notesInput.value.trim();
    if (next !== container.comment) patchContainer({ comment: next });
  });
  locationSelect.addEventListener("change", () => {
    patchContainer({ linkedIds: locationSelect.value ? [locationSelect.value] : [] });
  });

  confirmBtn.addEventListener("click", async () => {
    const drafts = items.filter((i) => i.state === "draft");
    if (drafts.length) {
      const updated = await putItems(drafts.map((i) => ({ ...i, state: "confirmed" })));
      const byId = new Map(updated.map((i) => [i.id, i]));
      items = items.map((i) => byId.get(i.id) || i);
    }
    await patchContainer({ status: "confirmed" });
    renderHeader();
    renderConfirmButton();
    await renderItems();
  });

  // ---------- add photos ----------
  //
  // Unlike view-capture.js's grid (built for a container mid-capture),
  // this one starts read-only — but an already-confirmed container still
  // legitimately gains new reference photos later (a replacement part, a
  // better angle). Mirrors capture's resize/store/append pattern exactly.
  // The AI toggle is the one addition: leaving it checked behaves exactly
  // like capture (new photos are fair game for the Review queue);
  // unchecking it also marks the container confirmed, which is the signal
  // view-review.js's visibleQueueContainers() already uses to keep a
  // container out of the default queue — no new schema field needed.

  photoAddBtn.addEventListener("click", () => photoInput.click());

  photoInput.addEventListener("change", async () => {
    const files = Array.from(photoInput.files || []);
    photoInput.value = "";
    if (!container || files.length === 0) return;
    photoAddBtn.disabled = true;
    try {
      const newAttachments = [];
      for (const file of files) {
        const { blob, width, height } = await resizeImageToBlob(file);
        const mediaId = makeId();
        await putMedia({ id: mediaId, blob, mimeType: "image/jpeg" });
        newAttachments.push({ mediaId, filename: file.name || "", mimeType: "image/jpeg", size: blob.size, width, height });
      }
      const patch = { attachments: [...(container.attachments || []), ...newAttachments] };
      if (!photoAiToggle.checked) patch.status = "confirmed";
      await patchContainer(patch);
      renderHeader();
      renderConfirmButton();
      await renderPhotos();
    } finally {
      photoAddBtn.disabled = false;
    }
  });

  // ---------- add item ----------

  // New-item fields have no item id to write through to yet, so unlike the
  // per-row editor above, the DOM *is* the state — no shadow array to keep
  // in sync. Add just appends a blank row; Save reads whatever's currently
  // in the panel.
  newItemFieldAddBtn.addEventListener("click", () => {
    newItemFieldsList.insertAdjacentHTML("beforeend", fieldRowHtml({ id: makeId(), key: "", value: "" }));
    const newRow = newItemFieldsList.lastElementChild;
    newRow.querySelector(".item-field-remove-btn").addEventListener("click", () => newRow.remove());
    newRow.querySelector(".item-field-key").focus();
  });

  function readNewItemFields() {
    return [...newItemFieldsList.querySelectorAll(".item-field-row")]
      .map((row) => ({
        id: row.getAttribute("data-field-id"),
        key: row.querySelector(".item-field-key").value.trim(),
        value: row.querySelector(".item-field-value").value.trim(),
      }))
      .filter((f) => f.key);
  }

  addItemBtn.addEventListener("click", () => {
    newItemTitle.value = "";
    newItemQty.value = "1";
    newItemCategory.value = "";
    newItemLink.value = "";
    newItemFieldsList.innerHTML = "";
    itemForm.hidden = false;
    addItemBtn.hidden = true;
    newItemTitle.focus();
  });
  newItemCancel.addEventListener("click", () => {
    itemForm.hidden = true;
    addItemBtn.hidden = false;
  });
  newItemSave.addEventListener("click", async () => {
    const title = newItemTitle.value.trim();
    if (!title) return;
    const link = newItemLink.value.trim();
    const record = makeRecord({
      type: "item",
      title,
      quantity: Number.parseInt(newItemQty.value, 10) || 1,
      category: newItemCategory.value.trim(),
      links: link ? [{ label: "", url: link }] : [],
      fields: readNewItemFields(),
      source: "manual",
      state: "confirmed",
      linkedIds: [container.id],
    });
    await putItem(record);
    items.push(record);
    itemForm.hidden = true;
    addItemBtn.hidden = false;
    await renderItems();
  });

  printBtn.addEventListener("click", () => {
    const html = buildPrintReportHtml({ containers: [container], items, locations, includeNotes: true, t });
    document.getElementById("print-root").innerHTML = html;
    window.print();
  });

  // ---------- copy items to another container ----------
  //
  // Duplicates this container's items (title/qty/category/tags/links/state/
  // source all carried over) into a target container — an existing one, or
  // a brand-new one created inline via the same prefix/code/name/location
  // mini-form used elsewhere. The source's notes and photos come along too:
  // notes are appended after whatever the target already has (never
  // overwritten — an existing container's own notes are never lost), and
  // photos are cloned via cloneMedia rather than shared, so the two
  // containers own independent copies from here on.

  function openCopyForm() {
    copyErrorEl.hidden = true;
    copyTargetSelect.innerHTML =
      `<option value="${NEW_CONTAINER_OPTION}">${escapeHtml(t("detail.copyNewOption"))}</option>` +
      containers
        .filter((c) => c.id !== container.id)
        .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: "base" }))
        .map((c) => `<option value="${c.id}">${escapeHtml(c.code)}${c.title ? ` — ${escapeHtml(c.title)}` : ""}</option>`)
        .join("");
    copyTargetSelect.value = NEW_CONTAINER_OPTION;
    copyNewFields.hidden = false;
    copyNewPrefix.value = "";
    copyNewCode.value = nextCode(containers.map((c) => c.code), "BOX");
    copyNewName.value = "";
    populateLocationSelect(copyNewLocation, locations, (container.linkedIds || [])[0], { noneLabel: t("detail.noLocation") });
    copyForm.hidden = false;
    copyBtn.hidden = true;
  }

  function closeCopyForm() {
    copyForm.hidden = true;
    copyBtn.hidden = false;
  }

  copyBtn.addEventListener("click", openCopyForm);
  copyCancelBtn.addEventListener("click", closeCopyForm);

  copyTargetSelect.addEventListener("change", () => {
    copyNewFields.hidden = copyTargetSelect.value !== NEW_CONTAINER_OPTION;
  });
  copyNewPrefix.addEventListener("blur", () => {
    copyNewCode.value = nextCode(containers.map((c) => c.code), copyNewPrefix.value.trim() || "BOX");
  });

  copyConfirmBtn.addEventListener("click", async () => {
    copyErrorEl.hidden = true;
    let target;
    const isNewContainer = copyTargetSelect.value === NEW_CONTAINER_OPTION;

    if (isNewContainer) {
      const code = normalizeCode(copyNewCode.value);
      if (!code) {
        copyErrorEl.textContent = t("search.codeRequired");
        copyErrorEl.hidden = false;
        return;
      }
      if (containers.some((c) => c.code === code)) {
        copyErrorEl.textContent = t("search.codeExists", { code });
        copyErrorEl.hidden = false;
        return;
      }
      const record = makeRecord({
        type: "container",
        code,
        title: copyNewName.value.trim(),
        status: "captured",
        linkedIds: copyNewLocation.value ? [copyNewLocation.value] : [],
      });
      target = await putItem(record);
    } else {
      target = containers.find((c) => c.id === copyTargetSelect.value);
      if (!target) return;
    }

    const patch = {};
    if (container.comment) {
      patch.comment = target.comment ? `${target.comment}\n\n${container.comment}` : container.comment;
    }
    if ((container.attachments || []).length) {
      const clonedAttachments = [];
      for (const a of container.attachments) {
        const newMediaId = await cloneMedia(a.mediaId);
        if (newMediaId) clonedAttachments.push({ ...a, mediaId: newMediaId });
      }
      patch.attachments = [...(target.attachments || []), ...clonedAttachments];
    }
    if (Object.keys(patch).length) target = await putItem({ ...target, ...patch });

    containers = isNewContainer ? [...containers, target] : containers.map((c) => (c.id === target.id ? target : c));

    const copies = items.map((i) =>
      makeRecord({
        type: "item",
        title: i.title,
        quantity: i.quantity,
        category: i.category,
        tags: i.tags,
        links: i.links,
        fields: i.fields,
        state: i.state,
        source: i.source,
        linkedIds: [target.id],
      }),
    );
    if (copies.length) await putItems(copies);

    closeCopyForm();
    const key = copies.length === 1 ? "detail.copySuccess.one" : "detail.copySuccess";
    toast(t(key, { count: copies.length, code: target.code }), "info");
  });

  // ---------- delete container (cascades to its items) ----------

  deleteBtn.addEventListener("click", () => {
    const toDelete = container;
    const itemsToDelete = items.slice();
    onDeleted();

    toast(t("toast.containerDeleted"), "info", {
      actionLabel: t("toast.undo"),
      onAction: () => {}, // nothing was written yet
      onExpire: async () => {
        const now = new Date().toISOString();
        await putItem({ ...toDelete, deletedAt: now });
        if (itemsToDelete.length) await putItems(itemsToDelete.map((i) => ({ ...i, deletedAt: now })));
      },
    });
  });

  async function show({ containerId }) {
    if (!containerId) return;
    const ok = await reload(containerId);
    if (!ok) return;
    codeErrorEl.hidden = true;
    closeCopyForm();
    photoAiToggle.checked = true;
    renderHeader();
    renderFields();
    await renderPhotos();
    await renderItems();
  }

  return { show };
}
