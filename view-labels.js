// Printable label sheets: human-readable (code, name, location path) —
// no QR, per the iOS separate-storage problem (BLUEPRINT.md §13.3). Every
// container is pre-selected on open (the common case is "print everything
// that doesn't have a label yet"), with individual and select-all toggles
// to narrow it down.

import { queryItems, locationPath } from "./db.js";
import { escapeHtml } from "./ui.js";
import { t } from "./i18n.js";
import { buildLabelSheetHtml } from "./report.js";

export function initLabelsView() {
  const emptyEl = document.getElementById("labels-empty");
  const selectAllRow = document.getElementById("labels-select-all-row");
  const selectAllCheckbox = document.getElementById("labels-select-all");
  const listEl = document.getElementById("labels-list");
  const printBtn = document.getElementById("labels-print-btn");

  let containers = [];
  let locations = [];
  const selected = new Set();

  function rowHtml(c) {
    const loc = locations.find((l) => (c.linkedIds || []).includes(l.id));
    const path = loc ? locationPath(loc) : "";
    return `
      <label class="row-card" data-container-id="${c.id}">
        <input type="checkbox" class="labels-check" ${selected.has(c.id) ? "checked" : ""} />
        <span class="row-main">
          <span class="row-title">${escapeHtml(c.code)}${c.title ? ` — ${escapeHtml(c.title)}` : ""}</span>
          <span class="row-sub">${escapeHtml(path)}</span>
        </span>
      </label>`;
  }

  function refreshSelectAll() {
    selectAllCheckbox.checked = containers.length > 0 && selected.size === containers.length;
    selectAllCheckbox.indeterminate = selected.size > 0 && selected.size < containers.length;
  }

  function render() {
    emptyEl.hidden = containers.length > 0;
    selectAllRow.hidden = containers.length === 0;
    listEl.innerHTML = containers.map(rowHtml).join("");
    for (const c of containers) {
      const row = listEl.querySelector(`[data-container-id="${c.id}"]`);
      row?.querySelector(".labels-check").addEventListener("change", (e) => {
        if (e.target.checked) selected.add(c.id);
        else selected.delete(c.id);
        refreshSelectAll();
        printBtn.disabled = selected.size === 0;
      });
    }
    refreshSelectAll();
    printBtn.disabled = selected.size === 0;
  }

  selectAllCheckbox.addEventListener("change", () => {
    selected.clear();
    if (selectAllCheckbox.checked) containers.forEach((c) => selected.add(c.id));
    render();
  });

  printBtn.addEventListener("click", () => {
    const chosen = containers.filter((c) => selected.has(c.id));
    if (!chosen.length) return;
    const html = buildLabelSheetHtml({ containers: chosen, locations, t });
    document.getElementById("print-root").innerHTML = html;
    window.print();
  });

  async function show() {
    const [{ results: loadedContainers }, { results: loadedLocations }] = await Promise.all([
      queryItems({ type: "container", sortBy: "code", sortDir: "asc" }),
      queryItems({ type: "location" }),
    ]);
    containers = loadedContainers;
    locations = loadedLocations;
    selected.clear();
    containers.forEach((c) => selected.add(c.id));
    render();
  }

  return { show };
}
