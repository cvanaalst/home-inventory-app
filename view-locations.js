// Manage the room/storage/section/name location hierarchy. Add, edit, copy,
// range-create, soft-delete (undo-on-toast — same reversible pattern as
// every other record type; a container pointing at a deleted location just
// renders "no location" rather than being blocked from deleting).

import { queryItems, getItem, putItem, putItems, makeRecord, expandNameRange } from "./db.js";
import { toast, attachSwipeActions, escapeHtml } from "./ui.js";
import { t, tCount } from "./i18n.js";
import { icon } from "./icons.js";

export function initLocationsView() {
  const addBtn = document.getElementById("location-add-btn");
  const form = document.getElementById("location-form");
  const roomInput = document.getElementById("location-room");
  const storageInput = document.getElementById("location-storage");
  const sectionInput = document.getElementById("location-section");
  const nameInput = document.getElementById("location-name");
  const saveBtn = document.getElementById("location-save");
  const cancelBtn = document.getElementById("location-cancel");
  const errorEl = document.getElementById("location-error");
  const groupsEl = document.getElementById("location-groups");
  const emptyEl = document.getElementById("locations-empty");

  const editActionsRow = document.getElementById("location-edit-actions");
  const copyBtn = document.getElementById("location-copy-btn");
  const deleteBtn = document.getElementById("location-delete-btn");

  const rangeToggleRow = document.getElementById("location-range-toggle-row");
  const rangeToggle = document.getElementById("location-range-toggle");
  const rangeFields = document.getElementById("location-range-fields");
  const rangeFrom = document.getElementById("location-range-from");
  const rangeTo = document.getElementById("location-range-to");
  const rangeHint = document.getElementById("location-range-hint");

  const roomOptionsEl = document.getElementById("location-room-options");
  const storageOptionsEl = document.getElementById("location-storage-options");
  const sectionOptionsEl = document.getElementById("location-section-options");
  const nameOptionsEl = document.getElementById("location-name-options");

  let editingId = null;
  const pendingDeletes = new Set(); // location ids optimistically hidden, write deferred to toast expiry

  function openForm(prefill = {}, editId = null) {
    editingId = editId;
    roomInput.value = prefill.room || "";
    storageInput.value = prefill.storage || "";
    sectionInput.value = prefill.section || "";
    nameInput.value = prefill.title || "";
    errorEl.hidden = true;
    form.hidden = false;
    addBtn.hidden = true;

    // Range creation only makes sense for a brand-new batch of locations,
    // never while editing one that already exists.
    const isEditing = !!editId;
    editActionsRow.hidden = !isEditing;
    rangeToggleRow.hidden = isEditing;
    rangeToggle.checked = false;
    rangeFields.hidden = true;
    rangeHint.hidden = true;

    nameInput.focus();
  }

  function closeForm() {
    form.hidden = true;
    addBtn.hidden = false;
    editingId = null;
  }

  addBtn.addEventListener("click", () => openForm());
  cancelBtn.addEventListener("click", closeForm);

  rangeToggle.addEventListener("change", () => {
    rangeFields.hidden = !rangeToggle.checked;
    rangeHint.hidden = !rangeToggle.checked;
  });

  // Reopens the form in CREATE mode, carrying over this location's
  // room/storage/section but leaving the name blank — the fast path for
  // "another one in the same spot, different name/number".
  copyBtn.addEventListener("click", () => {
    openForm({ room: roomInput.value.trim(), storage: storageInput.value.trim(), section: sectionInput.value.trim() });
  });

  deleteBtn.addEventListener("click", async () => {
    if (!editingId) return;
    const loc = await getItem(editingId);
    closeForm();
    if (loc) deleteLocation(loc);
  });

  saveBtn.addEventListener("click", async () => {
    const title = nameInput.value.trim();
    if (!title) {
      errorEl.textContent = t("locations.nameRequired");
      errorEl.hidden = false;
      return;
    }
    const room = roomInput.value.trim();
    const storage = storageInput.value.trim();
    const section = sectionInput.value.trim();

    if (!editingId && rangeToggle.checked) {
      const names = expandNameRange(title, rangeFrom.value.trim(), rangeTo.value.trim());
      if (!names.length) {
        errorEl.textContent = t("locations.range.invalid");
        errorEl.hidden = false;
        return;
      }
      const records = names.map((name) => makeRecord({ type: "location", title: name, room, storage, section }));
      await putItems(records);
      closeForm();
      await refresh();
      return;
    }

    const fields = { title, room, storage, section };
    if (editingId) {
      const existing = await getItem(editingId);
      await putItem({ ...existing, ...fields });
    } else {
      await putItem(makeRecord({ type: "location", ...fields }));
    }
    closeForm();
    await refresh();
  });

  function deleteLocation(loc) {
    pendingDeletes.add(loc.id);
    render(currentGroups); // re-render without this row, optimistically

    toast(t("toast.locationDeleted"), "info", {
      actionLabel: t("toast.undo"),
      onAction: () => {
        pendingDeletes.delete(loc.id);
        render(currentGroups);
      },
      onExpire: async () => {
        await putItem({ ...loc, deletedAt: new Date().toISOString() });
        pendingDeletes.delete(loc.id);
      },
    });
  }

  let currentGroups = [];
  let containerCounts = new Map();

  function render(groups) {
    currentGroups = groups;
    groupsEl.innerHTML = "";
    const visibleGroups = groups
      .map(([room, locs]) => [room, locs.filter((l) => !pendingDeletes.has(l.id))])
      .filter(([, locs]) => locs.length > 0);

    emptyEl.hidden = visibleGroups.length > 0;

    for (const [room, locs] of visibleGroups) {
      const section = document.createElement("div");
      const label = document.createElement("div");
      label.className = "section-label";
      label.textContent = `🚪 ${room || t("locations.noRoom")}`;
      section.appendChild(label);

      const list = document.createElement("div");
      list.className = "list";

      for (const loc of locs) {
        const count = containerCounts.get(loc.id) || 0;
        const sub = [loc.storage, loc.section].filter(Boolean).join(" › ");

        const row = document.createElement("div");
        row.className = "swipe-row";
        row.innerHTML = `
          <div class="swipe-actions right">${icon("trash", { size: 18 })}</div>
          <button type="button" class="swipe-content row-card">
            <span class="row-main">
              <span class="row-title">${sub ? `${escapeHtml(sub)} › ` : ""}${escapeHtml(loc.title)}</span>
              <span class="row-sub">${tCount("locations.containerCount", count)}</span>
            </span>
          </button>`;

        row.querySelector(".swipe-content").addEventListener("click", () => openForm(loc, loc.id));
        attachSwipeActions(row, { onSwipeLeft: () => deleteLocation(loc) });
        list.appendChild(row);
      }
      section.appendChild(list);
      groupsEl.appendChild(section);
    }
  }

  /** Distinct existing values per field, so the "add location" form can
   * suggest them via <datalist> — typing "Bureau Chris" once and picking
   * it from then on avoids both retyping and near-duplicate typos. */
  function populateDatalists(locations) {
    const distinct = (values) =>
      [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
    const fill = (el, values) => {
      el.innerHTML = values.map((v) => `<option value="${escapeHtml(v)}"></option>`).join("");
    };
    fill(roomOptionsEl, distinct(locations.map((l) => l.room)));
    fill(storageOptionsEl, distinct(locations.map((l) => l.storage)));
    fill(sectionOptionsEl, distinct(locations.map((l) => l.section)));
    fill(nameOptionsEl, distinct(locations.map((l) => l.title)));
  }

  async function refresh() {
    const [{ results: locations }, { results: containers }] = await Promise.all([
      queryItems({ type: "location" }),
      queryItems({ type: "container" }),
    ]);

    populateDatalists(locations);

    containerCounts = new Map();
    for (const c of containers) {
      for (const id of c.linkedIds || []) {
        containerCounts.set(id, (containerCounts.get(id) || 0) + 1);
      }
    }

    locations.sort(
      (a, b) =>
        (a.room || "").localeCompare(b.room || "", undefined, { numeric: true, sensitivity: "base" }) ||
        (a.storage || "").localeCompare(b.storage || "", undefined, { numeric: true, sensitivity: "base" }) ||
        (a.section || "").localeCompare(b.section || "", undefined, { numeric: true, sensitivity: "base" }) ||
        (a.title || "").localeCompare(b.title || "", undefined, { numeric: true, sensitivity: "base" }),
    );

    const groups = [];
    const index = new Map();
    for (const loc of locations) {
      const key = loc.room || "";
      if (!index.has(key)) {
        index.set(key, []);
        groups.push([key, index.get(key)]);
      }
      index.get(key).push(loc);
    }

    render(groups);
  }

  return { show: refresh };
}
