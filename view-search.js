// Home view: text search across items/containers/locations; when the
// search box is empty, browse containers filtered by location, plus manual
// ("no photo") container creation.

import { queryItems, queryItemSet, getAllItems, getMeta, setMeta, putItem, makeRecord, nextCode, locationPath, getMedia } from "./db.js";
import { populateLocationSelect, escapeHtml, statusBadgeClass, skeletonGate } from "./ui.js";
import { t, tCount } from "./i18n.js";

const DEBOUNCE_MS = 250;

export function initSearchView({ onOpenContainer }) {
  const input = document.getElementById("search-input");
  const photoToggle = document.getElementById("search-photo-toggle");
  const resultsEl = document.getElementById("search-results");
  const browseEl = document.getElementById("search-browse");
  const locationFilter = document.getElementById("search-location-filter");
  const newBtn = document.getElementById("new-container-btn");
  const newForm = document.getElementById("new-container-form");
  const prefixInput = document.getElementById("new-container-prefix");
  const codeInput = document.getElementById("new-container-code");
  const nameInput = document.getElementById("new-container-name");
  const locationSelect = document.getElementById("new-container-location");
  const createBtn = document.getElementById("new-container-create");
  const cancelBtn = document.getElementById("new-container-cancel");
  const errorEl = document.getElementById("new-container-error");
  const browseLabel = document.getElementById("search-browse-label");
  const browseList = document.getElementById("search-container-list");
  const browseEmpty = document.getElementById("search-browse-empty");
  const browseSkeleton = skeletonGate(document.getElementById("search-skeleton"));

  let locations = [];
  let debounceTimer = null;
  // Object URLs for row thumbnails, revoked and rebuilt on every render so a
  // long browsing session doesn't accumulate one blob URL per container ever
  // shown — see hydrateThumbnails().
  const thumbUrls = new Set();
  // Session-only, not persisted (BLUEPRINT.md doesn't call for it, and a
  // toggle that silently changed a returning visit's default view would be
  // more surprising than helpful) — resets to the normal list every time
  // the tab is reopened.
  let photoMode = false;

  function containerRowHtml(c, loc, itemCount) {
    const path = loc ? locationPath(loc) : "";
    const firstPhoto = (c.attachments || [])[0];
    // CSS hides .row-thumb entirely in compact density — the element still
    // exists so hydrateThumbnails() has something to fill in, it's just
    // never visible there, matching how .row-sub is dropped in compact.
    const thumb = firstPhoto ? `<span class="row-thumb" data-media-id="${escapeHtml(firstPhoto.mediaId)}"><img alt="" /></span>` : "";
    // "captured" is every container's starting status and stays that way
    // until someone explicitly confirms it — showing it on every single
    // row carries zero information (you already know a row is "captured"
    // if it isn't showing anything else) and is exactly the badge every
    // row in a long list was carrying. "confirmed" (settled, trustworthy)
    // and "drafted" (has AI drafts pending) are each a real exception
    // worth a glance, so those still show.
    const badge = c.status === "captured" ? "" : `<span class="${statusBadgeClass(c.status)}">${escapeHtml(c.status)}</span>`;
    return `
      <button type="button" class="row-card" data-container-id="${c.id}">
        ${thumb}
        <span class="row-main">
          <span class="row-title">${escapeHtml(c.code)}${c.title ? ` — ${escapeHtml(c.title)}` : ""}</span>
          <span class="row-sub">${tCount("items.count", itemCount)}${path ? ` · ${escapeHtml(path)}` : ""}</span>
        </span>
        ${badge}
      </button>`;
  }

  function wireContainerRows(root) {
    root.querySelectorAll("[data-container-id]").forEach((el) => {
      el.addEventListener("click", () => onOpenContainer(el.getAttribute("data-container-id")));
    });
  }

  // A tile carries both data-container-id (wireContainerRows) and
  // data-media-id (hydrateThumbnails) on the same element — the whole tile
  // is the click target, exactly like a normal row, and hydration doesn't
  // care which attribute matched.
  function photoTileHtml(c) {
    const firstPhoto = c.attachments[0];
    return `<button type="button" class="capture-photo-tile" data-container-id="${c.id}" data-media-id="${escapeHtml(firstPhoto.mediaId)}"><img alt="" /></button>`;
  }

  /** Renders `containers` into `targetEl` as either the normal row list or,
   * in photo mode, a thumbnail-only grid of just the ones with a photo —
   * the one branch point renderBrowse() and renderSearchResults() both
   * call through, so the two entry points can't drift out of sync. */
  function renderContainers(containers, targetEl, { itemCounts, locById } = {}) {
    if (photoMode) {
      const withPhotos = containers.filter((c) => (c.attachments || []).length > 0);
      targetEl.innerHTML = withPhotos.length
        ? `<div class="photo-search-grid">${withPhotos.map(photoTileHtml).join("")}</div>`
        : `<p class="empty-state">${escapeHtml(t("search.noPhotos"))}</p>`;
    } else {
      targetEl.innerHTML = containers
        .map((c) => containerRowHtml(c, locById?.get((c.linkedIds || [])[0]), itemCounts?.get(c.id) ?? c.__itemCount ?? 0))
        .join("");
    }
    wireContainerRows(targetEl);
    hydrateThumbnails(targetEl);
  }

  /** Fills every .row-thumb img left empty by containerRowHtml. Async and
   * unawaited by callers on purpose — rows are fully usable (clickable,
   * readable) before their thumbnails arrive; images just pop in. */
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

  // ---------- browse mode ----------

  /** Groups `containers` by location (a plain flat list of up to a few
   * hundred rows had no way to jump to "the shelf I'm standing in front
   * of" without scrolling past everything before it) — one sticky
   * .location-group-header per location, sorted by path, "no location"
   * last since it isn't a real place to file rows under. Only used for
   * the unfiltered "all locations" browse view: once already filtered to
   * one location every row would land in the same single group, which is
   * just the flat list with a redundant heading on top. */
  function groupedContainerListHtml(containers, locById, itemCounts) {
    const groups = new Map();
    for (const c of containers) {
      const locId = (c.linkedIds || [])[0] || "";
      if (!groups.has(locId)) groups.set(locId, []);
      groups.get(locId).push(c);
    }
    const sortedKeys = [...groups.keys()].sort((a, b) => {
      if (!a) return 1;
      if (!b) return -1;
      return locationPath(locById.get(a)).localeCompare(locationPath(locById.get(b)), undefined, { numeric: true, sensitivity: "base" });
    });
    return sortedKeys
      .map((locId) => {
        const heading = locId ? escapeHtml(locationPath(locById.get(locId))) : escapeHtml(t("detail.noLocation"));
        const rows = groups.get(locId).map((c) => containerRowHtml(c, locById.get(locId), itemCounts.get(c.id) || 0)).join("");
        return `<div class="location-group"><div class="location-group-header">${heading}</div>${rows}</div>`;
      })
      .join("");
  }

  async function renderBrowse() {
    const seq = browseSkeleton.begin();
    try {
      // One IDB read + hydrate, not two — see runSearch() below for why
      // this matters (called on every keystroke, unlike renderBrowse).
      const allRecords = await getAllItems();
      const { results: containers } = queryItemSet(allRecords, { type: "container", sortBy: "code", sortDir: "asc" });
      const { results: items } = queryItemSet(allRecords, { type: "item" });
      const locById = new Map(locations.map((l) => [l.id, l]));
      const itemCounts = new Map();
      for (const it of items) {
        for (const id of it.linkedIds || []) itemCounts.set(id, (itemCounts.get(id) || 0) + 1);
      }

      const filterId = locationFilter.value;
      const filtered = filterId ? containers.filter((c) => (c.linkedIds || []).includes(filterId)) : containers;

      browseLabel.textContent = filterId ? t("search.browseAt", { location: locationPath(locById.get(filterId)) }) : t("search.browseAll");
      if (photoMode) {
        browseEmpty.hidden = true; // renderContainers renders its own "no photos" empty state inline
      } else {
        browseEmpty.hidden = filtered.length > 0;
        // Filter-aware: "no containers at all" reads very differently from
        // "none at this particular location" — the latter would otherwise
        // wrongly imply the whole inventory is empty when it isn't.
        browseEmpty.textContent = filterId
          ? t("search.noContainersAt", { location: locationPath(locById.get(filterId)) })
          : t("search.noContainers");
      }
      if (!photoMode && !filterId && filtered.length) {
        browseList.innerHTML = groupedContainerListHtml(filtered, locById, itemCounts);
        wireContainerRows(browseList);
        hydrateThumbnails(browseList);
      } else {
        renderContainers(filtered, browseList, { itemCounts, locById });
      }
    } finally {
      browseSkeleton.end(seq);
    }
  }

  function refreshLocationFilter() {
    const current = locationFilter.value;
    locationFilter.innerHTML = "";
    const all = document.createElement("option");
    all.value = "";
    all.textContent = t("search.locationFilterAll");
    locationFilter.appendChild(all);
    for (const loc of [...locations].sort((a, b) => locationPath(a).localeCompare(locationPath(b), undefined, { numeric: true, sensitivity: "base" }))) {
      const opt = document.createElement("option");
      opt.value = loc.id;
      opt.textContent = locationPath(loc);
      locationFilter.appendChild(opt);
    }
    locationFilter.value = current;
  }

  locationFilter.addEventListener("change", renderBrowse);

  // ---------- new container ----------

  async function openNewContainerForm() {
    errorEl.hidden = true;
    const { results: containers } = await queryItems({ type: "container" });
    const prefix = prefixInput.value.trim() || "BOX";
    codeInput.value = nextCode(containers.map((c) => c.code), prefix);
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

  prefixInput.addEventListener("blur", async () => {
    const { results: containers } = await queryItems({ type: "container" });
    codeInput.value = nextCode(containers.map((c) => c.code), prefixInput.value.trim() || "BOX");
  });

  createBtn.addEventListener("click", async () => {
    const code = codeInput.value.trim();
    if (!code) {
      errorEl.textContent = t("search.codeRequired");
      errorEl.hidden = false;
      return;
    }
    const { results: containers } = await queryItems({ type: "container" });
    const record = makeRecord({
      type: "container",
      code,
      title: nameInput.value.trim(),
      status: "captured",
      linkedIds: locationSelect.value ? [locationSelect.value] : [],
    });
    if (containers.some((c) => c.code === record.code)) {
      errorEl.textContent = t("search.codeExists", { code: record.code });
      errorEl.hidden = false;
      return;
    }
    if (locationSelect.value) await setMeta("lastLocationId", locationSelect.value);
    await putItem(record);
    closeNewContainerForm();
    onOpenContainer(record.id);
  });

  // ---------- search mode ----------

  function renderSearchResults(items, containers, locs) {
    // Photo mode collapses the whole items/containers/locations breakdown
    // into one thumbnail grid of just the matched containers that have a
    // photo — items and locations aren't photo-representable, and mixing
    // "text results" with "photo results" in the same screen would defeat
    // the point of a quick visual scan.
    if (photoMode) {
      renderContainers(containers, resultsEl);
      return;
    }
    const locById = new Map(locations.map((l) => [l.id, l]));
    const containerById = new Map(containers.concat().map((c) => [c.id, c]));
    // include every container referenced by a matched item, for its code/name
    const sections = [];

    if (items.length) {
      sections.push(`<div class="section-label">${t("search.resultsItems")}</div><div class="list">${items
        .map((it) => {
          const container = containerById.get((it.linkedIds || [])[0]);
          const loc = container ? locById.get((container.linkedIds || [])[0]) : null;
          const sub = [container ? container.code : "", loc ? locationPath(loc) : ""].filter(Boolean).join(" · ");
          return `<button type="button" class="row-card" data-container-id="${container ? container.id : ""}">
            <span class="row-main">
              <span class="row-title">${it.quantity > 1 ? `${it.quantity}× ` : ""}${escapeHtml(it.title)}</span>
              <span class="row-sub">${escapeHtml(sub)}</span>
            </span>
          </button>`;
        })
        .join("")}</div>`);
    }
    if (containers.length) {
      sections.push(`<div class="section-label">${t("search.resultsContainers")}</div><div class="list">${containers
        .map((c) => containerRowHtml(c, locById.get((c.linkedIds || [])[0]), c.__itemCount || 0))
        .join("")}</div>`);
    }
    if (locs.length) {
      sections.push(`<div class="section-label">${t("search.resultsLocations")}</div><div class="list">${locs
        .map((l) => `<div class="row-card" style="cursor:default"><span class="row-main"><span class="row-title">📍 ${escapeHtml(locationPath(l))}</span></span></div>`)
        .join("")}</div>`);
    }
    resultsEl.innerHTML = sections.length ? sections.join("") : `<p class="empty-state">${t("search.noResults")}</p>`;
    wireContainerRows(resultsEl);
    hydrateThumbnails(resultsEl);
  }

  async function runSearch(q) {
    // One IDB read + hydrate for the whole search, not four — this runs on
    // every debounced keystroke, so it was the actual hot path the 4-scans
    // cost hit hardest. queryItemSet is the same pure engine queryItems
    // wraps; running it 3-4x against one in-memory snapshot instead of
    // each re-reading and re-hydrating the store measured at ~199ms ->
    // ~50ms per keystroke on 3340 records.
    const allRecords = await getAllItems();
    const itemsRes = queryItemSet(allRecords, { type: "item", search: q });
    const containersRes = queryItemSet(allRecords, { type: "container", search: q });
    const locsRes = queryItemSet(allRecords, { type: "location", search: q });
    // attach item counts to matched containers for display
    if (containersRes.results.length) {
      const { results: allItems } = queryItemSet(allRecords, { type: "item" });
      const counts = new Map();
      for (const it of allItems) for (const id of it.linkedIds || []) counts.set(id, (counts.get(id) || 0) + 1);
      containersRes.results.forEach((c) => (c.__itemCount = counts.get(c.id) || 0));
    }
    renderSearchResults(itemsRes.results, containersRes.results, locsRes.results);
  }

  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (!q) {
      resultsEl.hidden = true;
      browseEl.hidden = false;
      return;
    }
    debounceTimer = setTimeout(async () => {
      resultsEl.hidden = false;
      browseEl.hidden = true;
      await runSearch(q);
    }, DEBOUNCE_MS);
  });

  photoToggle.addEventListener("click", async () => {
    photoMode = !photoMode;
    photoToggle.classList.toggle("active", photoMode);
    photoToggle.setAttribute("aria-pressed", String(photoMode));
    const q = input.value.trim();
    if (q) await runSearch(q);
    else await renderBrowse();
  });

  async function show() {
    const { results } = await queryItems({ type: "location" });
    locations = results;
    refreshLocationFilter();
    if (input.value.trim()) {
      resultsEl.hidden = false;
      browseEl.hidden = true;
      await runSearch(input.value.trim());
    } else {
      resultsEl.hidden = true;
      browseEl.hidden = false;
      await renderBrowse();
    }
  }

  // Exposed for app.js's "New container" manifest shortcut (#new-container)
  // — that's a boot-time-only entry point external to the normal tab
  // router (BLUEPRINT.md's TAB_TARGETS hash routing has no room for "show
  // this tab AND also open a form"), so it calls this directly after
  // show() rather than going through any params show() itself accepts.
  return { show, openNewForm: openNewContainerForm };
}
