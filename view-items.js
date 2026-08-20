// Flat item list: search/filter/sort over the shared query engine. A
// second list-like view with its own module (BLUEPRINT.md §4) — the query
// engine is shared, the row rendering and singleton DOM state are not.

import { getAllItems, queryItemSet, putItem, locationPath, getMedia } from "./db.js";
import { escapeHtml, skeletonGate } from "./ui.js";
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
  const skeleton = skeletonGate(document.getElementById("items-skeleton"));

  let debounceTimer = null;
  let containersById = new Map();
  let locationsById = new Map();
  // The currently-rendered rows, kept in sync as writes resolve — a
  // stepper click reads/writes through THIS, not the item snapshot
  // captured when the row was built, so two quick +clicks before the
  // first write resolves land on 5 then 6, not 5 then 5 again (same
  // pattern as view-detail.js's patchItem).
  let currentResults = [];
  // Object URLs for row thumbnails, revoked and rebuilt on every render —
  // same pattern as view-search.js's hydrateThumbnails().
  const thumbUrls = new Set();

  function patchQuantity(id, quantity) {
    const idx = currentResults.findIndex((i) => i.id === id);
    if (idx === -1) return Promise.resolve();
    const merged = { ...currentResults[idx], quantity };
    currentResults[idx] = merged;
    return putItem(merged).then((updated) => {
      currentResults = currentResults.map((i) => (i.id === id ? updated : i));
    });
  }

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
    // Items have no photos of their own — this is the parent container's
    // first photo, shown as context, same as containerRowHtml() in
    // view-search.js. Hidden in compact density along with .row-sub.
    const firstPhoto = (container?.attachments || [])[0];
    const thumb = firstPhoto ? `<span class="row-thumb" data-media-id="${escapeHtml(firstPhoto.mediaId)}"><img alt="" /></span>` : "";
    // The row's own quantity used to only be a "N× " prefix on the title —
    // read-only, and adjusting it meant drilling into the container first.
    // That's the single most common action on an item ("I just used 3 of
    // these"); the stepper below is a sibling of the nav button, not
    // nested inside it, so tapping it never triggers navigation.
    return `
      <div class="row-card items-row" data-item-id="${item.id}">
        ${thumb}
        <button type="button" class="row-main-btn" data-container-id="${container ? container.id : ""}">
          <span class="row-main">
            <span class="row-title">${escapeHtml(item.title)}</span>
            <span class="row-sub">${escapeHtml(subParts.join(" · "))}</span>
          </span>
        </button>
        <div class="qty-stepper">
          <button type="button" data-qty-dec aria-label="-">−</button>
          <input type="text" inputmode="numeric" class="item-qty-input" value="${item.quantity}" />
          <button type="button" data-qty-inc aria-label="+">＋</button>
        </div>
      </div>`;
  }

  function wireQtyStepper(rowEl) {
    const itemId = rowEl.getAttribute("data-item-id");
    const qtyInput = rowEl.querySelector(".item-qty-input");
    rowEl.querySelector("[data-qty-dec]").addEventListener("click", () => {
      const next = Math.max(1, (Number.parseInt(qtyInput.value, 10) || 1) - 1);
      qtyInput.value = next;
      patchQuantity(itemId, next);
    });
    rowEl.querySelector("[data-qty-inc]").addEventListener("click", () => {
      const next = (Number.parseInt(qtyInput.value, 10) || 1) + 1;
      qtyInput.value = next;
      patchQuantity(itemId, next);
    });
    qtyInput.addEventListener("blur", () => {
      const next = Math.max(1, Number.parseInt(qtyInput.value, 10) || 1);
      qtyInput.value = next;
      const current = currentResults.find((i) => i.id === itemId);
      if (next !== current?.quantity) patchQuantity(itemId, next);
    });
  }

  /** Fills every .row-thumb img left empty by rowHtml(). Same pattern as
   * view-search.js's hydrateThumbnails(). */
  async function hydrateThumbnails(root) {
    for (const url of thumbUrls) URL.revokeObjectURL(url);
    thumbUrls.clear();
    const tiles = root.querySelectorAll("[data-media-id]");
    for (const tile of tiles) {
      const rec = await getMedia(tile.getAttribute("data-media-id"));
      if (!rec || !rec.blob) continue;
      const url = URL.createObjectURL(rec.blob);
      thumbUrls.add(url);
      const img = tile.querySelector("img");
      if (img) img.src = url;
    }
  }

  async function refresh() {
    const seq = skeleton.begin();
    try {
      // One IDB read + hydrate for the whole refresh, not one per query —
      // queryItemSet (the same pure filter/sort/paginate engine queryItems
      // wraps) runs three more times below against this single in-memory
      // snapshot instead of each re-reading and re-hydrating the entire
      // store. Measured on 3340 records: ~78ms -> ~20ms per refresh.
      const allRecords = await getAllItems();
      const { results: allItems } = queryItemSet(allRecords, { type: "item" });
      const { results: containers } = queryItemSet(allRecords, { type: "container" });
      const { results: locations } = queryItemSet(allRecords, { type: "location" });
      containersById = new Map(containers.map((c) => [c.id, c]));
      locationsById = new Map(locations.map((l) => [l.id, l]));
      refreshCategoryOptions(allItems);

      const [sortBy, sortDir] = sortSelect.value.split("-");
      const { results, total } = queryItemSet(allRecords, {
        type: "item",
        search: searchInput.value.trim(),
        category: categorySelect.value || undefined,
        itemState: stateSelect.value || undefined,
        sortBy,
        sortDir,
      });

      currentResults = results;
      countEl.textContent = tCount("items.count", total);
      emptyEl.hidden = results.length > 0;
      listEl.innerHTML = results.map(rowHtml).join("");
      listEl.querySelectorAll("[data-container-id]").forEach((el) => {
        const id = el.getAttribute("data-container-id");
        if (id) el.addEventListener("click", () => onOpenContainer(id));
        else el.disabled = true;
      });
      listEl.querySelectorAll(".items-row").forEach(wireQtyStepper);
      hydrateThumbnails(listEl);
    } finally {
      skeleton.end(seq);
    }
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
