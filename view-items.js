// Flat item list: search/filter/sort over the shared query engine. A
// second list-like view with its own module (BLUEPRINT.md §4) — the query
// engine is shared, the row rendering and singleton DOM state are not.

import { queryItems, locationPath } from "./db.js";
import { escapeHtml } from "./ui.js";
import { t, tCount } from "./i18n.js";

const DEBOUNCE_MS = 250;

export function initItemsView({ onOpenContainer }) {
  const searchInput = document.getElementById("items-search");
  const categorySelect = document.getElementById("items-category-filter");
  const stateSelect = document.getElementById("items-state-filter");
  const sortSelect = document.getElementById("items-sort");
  const countEl = document.getElementById("items-count");
  const listEl = document.getElementById("items-list");
  const emptyEl = document.getElementById("items-empty");

  let debounceTimer = null;
  let containersById = new Map();
  let locationsById = new Map();

  function refreshCategoryOptions(items) {
    const current = categorySelect.value;
    const categories = [...new Set(items.map((i) => i.category).filter(Boolean))].sort();
    categorySelect.innerHTML = `<option value="">${t("items.categoryAll")}</option>`;
    for (const cat of categories) {
      const opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = cat;
      categorySelect.appendChild(opt);
    }
    categorySelect.value = categories.includes(current) ? current : "";
  }

  function rowHtml(item) {
    const container = containersById.get((item.linkedIds || [])[0]);
    const loc = container ? locationsById.get((container.linkedIds || [])[0]) : null;
    const subParts = [container ? container.code : "", loc ? locationPath(loc) : "", item.category, item.state === "draft" ? t("item.draft") : ""].filter(Boolean);
    return `
      <button type="button" class="row-card" data-container-id="${container ? container.id : ""}">
        <span class="row-main">
          <span class="row-title">${item.quantity > 1 ? `${item.quantity}× ` : ""}${escapeHtml(item.title)}</span>
          <span class="row-sub">${escapeHtml(subParts.join(" · "))}</span>
        </span>
      </button>`;
  }

  async function refresh() {
    const [{ results: allItems }, { results: containers }, { results: locations }] = await Promise.all([
      queryItems({ type: "item" }),
      queryItems({ type: "container" }),
      queryItems({ type: "location" }),
    ]);
    containersById = new Map(containers.map((c) => [c.id, c]));
    locationsById = new Map(locations.map((l) => [l.id, l]));
    refreshCategoryOptions(allItems);

    const [sortBy, sortDir] = sortSelect.value.split("-");
    const { results, total } = await queryItems({
      type: "item",
      search: searchInput.value.trim(),
      category: categorySelect.value || undefined,
      itemState: stateSelect.value || undefined,
      sortBy,
      sortDir,
    });

    countEl.textContent = tCount("items.count", total);
    emptyEl.hidden = results.length > 0;
    listEl.innerHTML = results.map(rowHtml).join("");
    listEl.querySelectorAll("[data-container-id]").forEach((el) => {
      const id = el.getAttribute("data-container-id");
      if (id) el.addEventListener("click", () => onOpenContainer(id));
      else el.disabled = true;
    });
  }

  searchInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(refresh, DEBOUNCE_MS);
  });
  categorySelect.addEventListener("change", refresh);
  stateSelect.addEventListener("change", refresh);
  sortSelect.addEventListener("change", refresh);

  return { show: refresh };
}
