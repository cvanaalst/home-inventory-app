// Manage the room/storage/section/name location hierarchy. Add, edit,
// soft-delete (undo-on-toast — same reversible pattern as every other
// record type; a container pointing at a deleted location just renders
// "no location" rather than being blocked from deleting).

import { queryItems, getItem, putItem, makeRecord } from "./db.js";
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
    nameInput.focus();
  }

  function closeForm() {
    form.hidden = true;
    addBtn.hidden = false;
    editingId = null;
  }

  addBtn.addEventListener("click", () => openForm());
  cancelBtn.addEventListener("click", closeForm);

  saveBtn.addEventListener("click", async () => {
    const title = nameInput.value.trim();
    if (!title) {
      errorEl.textContent = t("locations.nameRequired");
      errorEl.hidden = false;
      return;
    }
    const fields = {
      title,
      room: roomInput.value.trim(),
      storage: storageInput.value.trim(),
      section: sectionInput.value.trim(),
    };
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

  async function refresh() {
    const [{ results: locations }, { results: containers }] = await Promise.all([
      queryItems({ type: "location" }),
      queryItems({ type: "container" }),
    ]);

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
