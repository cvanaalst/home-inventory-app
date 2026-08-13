// Container detail/edit: name, location, notes, item editor (add/edit/
// delete/move), confirm-drafts. Two-speed persistence (BLUEPRINT.md §9):
// the location select is write-through, text fields are save-gated on
// blur, item quantity is write-through, item text fields are save-gated.

import { queryItems, getItem, putItem, putItems, makeRecord } from "./db.js";
import { toast, attachSwipeActions, populateLocationSelect, escapeHtml, statusBadgeClass } from "./ui.js";
import { t, tCount } from "./i18n.js";
import { icon } from "./icons.js";

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
  const newItemSave = document.getElementById("new-item-save");
  const newItemCancel = document.getElementById("new-item-cancel");
  const deleteBtn = document.getElementById("detail-delete-btn");
  const categoryOptionsEl = document.getElementById("category-options");

  let container = null;
  let locations = [];
  let containers = [];
  let items = [];

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
    codeEl.textContent = container.code;
    badgeEl.textContent = container.status;
    badgeEl.className = statusBadgeClass(container.status);
  }

  function renderFields() {
    titleInput.value = container.title;
    notesInput.value = container.comment;
    populateLocationSelect(locationSelect, locations, (container.linkedIds || [])[0], { noneLabel: t("detail.noLocation") });
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

  function itemRowHtml(item) {
    const link = (item.links || [])[0];
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
            <button type="button" class="btn-icon item-move-btn" title="${escapeHtml(t("item.moveTo"))}">${icon("move", { size: 18 })}</button>
          </div>
          <div class="move-row" hidden style="margin-top: 8px">
            <select class="item-move-select"></select>
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

  // ---------- add item ----------

  addItemBtn.addEventListener("click", () => {
    newItemTitle.value = "";
    newItemQty.value = "1";
    newItemCategory.value = "";
    newItemLink.value = "";
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
    renderHeader();
    renderFields();
    await renderItems();
  }

  return { show };
}
