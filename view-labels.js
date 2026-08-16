// Printable label sheets: human-readable (code, name, location path) —
// no QR, per the iOS separate-storage problem (BLUEPRINT.md §13.3). Every
// container is pre-selected on open (the common case is "print everything
// that doesn't have a label yet"), with individual and select-all toggles
// to narrow it down.

import { queryItems, locationPath, getMeta, setMeta } from "./db.js";
import { escapeHtml } from "./ui.js";
import { t } from "./i18n.js";
import { buildLabelSheetHtml, LABEL_FORMATS } from "./report.js";

const LABEL_FORMAT_META_KEY = "labelFormat";

// The @page size isn't something report.js's HTML output can carry (it's a
// stylesheet-level rule, not an element), and it has to match whichever
// physical sheet the chosen format is cut for — a real Avery layout sized
// in mm/inches printed onto the wrong page size prints wrong, not just
// oddly. Injected fresh on every print rather than left in style.css
// because it's the one piece of "print mechanics" that's genuinely
// per-choice, not per-format-forever.
function setPrintPageSize(page) {
  let styleEl = document.getElementById("print-page-size");
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "print-page-size";
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = page ? `@page { size: ${page}; margin: 0; }` : "";
}

export function initLabelsView() {
  const emptyEl = document.getElementById("labels-empty");
  const selectAllRow = document.getElementById("labels-select-all-row");
  const selectAllCheckbox = document.getElementById("labels-select-all");
  const listEl = document.getElementById("labels-list");
  const formatSelect = document.getElementById("labels-format-select");
  const skipInput = document.getElementById("labels-skip-input");
  const printBtn = document.getElementById("labels-print-btn");

  let containers = [];
  let locations = [];
  const selected = new Set();

  formatSelect.innerHTML = LABEL_FORMATS.map((f) => `<option value="${f.id}">${escapeHtml(t(`labels.format.${f.id}`))}</option>`).join("");
  formatSelect.addEventListener("change", () => setMeta(LABEL_FORMAT_META_KEY, formatSelect.value));

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
    const format = formatSelect.value;
    const formatEntry = LABEL_FORMATS.find((f) => f.id === format);
    setPrintPageSize(formatEntry?.page ? formatEntry.page : null);
    const skipCount = Math.max(0, Math.floor(Number(skipInput.value)) || 0);
    const html = buildLabelSheetHtml({ containers: chosen, locations, t, format, skipCount });
    document.getElementById("print-root").innerHTML = html;
    window.print();
  });

  async function show() {
    const [{ results: loadedContainers }, { results: loadedLocations }, savedFormat] = await Promise.all([
      queryItems({ type: "container", sortBy: "code", sortDir: "asc" }),
      queryItems({ type: "location" }),
      getMeta(LABEL_FORMAT_META_KEY, "generic"),
    ]);
    containers = loadedContainers;
    locations = loadedLocations;
    formatSelect.value = LABEL_FORMATS.some((f) => f.id === savedFormat) ? savedFormat : "generic";
    // Not persisted like the format choice — how many labels are already
    // gone from THIS particular sheet changes every time, so it's always
    // re-entered fresh rather than carried over from a previous visit.
    skipInput.value = "0";
    selected.clear();
    containers.forEach((c) => selected.add(c.id));
    render();
  }

  return { show };
}
