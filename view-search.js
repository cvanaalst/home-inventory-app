// Home view: text search across items/containers/locations; when the
// search box is empty, browse containers filtered by location.

import { queryItems, queryItemSet, getAllItems, locationPath, getMedia } from "./db.js";
import { escapeHtml, statusBadgeClass, skeletonGate } from "./ui.js";
import { t, tCount } from "./i18n.js";
import { icon } from "./icons.js";

const DEBOUNCE_MS = 250;

export function initSearchView({ onOpenContainer }) {
  const input = document.getElementById("search-input");
  const photoToggle = document.getElementById("search-photo-toggle");
  const photoSizeToggle = document.getElementById("search-photo-size-toggle");
  const resultsEl = document.getElementById("search-results");
  const browseEl = document.getElementById("search-browse");
  const roomFilter = document.getElementById("search-room-filter");
  const storageFilter = document.getElementById("search-storage-filter");
  const sectionFilter = document.getElementById("search-section-filter");
  const categoryFilter = document.getElementById("search-category-filter");
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
  // "compact" = existing thumbnail grid; "full" = one photo at a time,
  // full width, with prev/next + swipe — only meaningful while photoMode
  // is on, and reset with it (see photoToggle's click handler).
  let photoSizeMode = "compact";
  // The gallery's own flat photo list + position, kept across prev/next so
  // paging doesn't need to re-run the query — rebuilt fresh each render.
  let galleryPhotos = [];
  let galleryIndex = 0;
  let galleryUrl = null;

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

  // Reads the currently rendered rows' ids once per render, in DOM order —
  // i.e. exactly the order the user sees, whatever filter/sort/grouping
  // produced it — so Container Detail can offer prev/next through this
  // same set without re-deriving it itself. Deduped: photo-grid mode has
  // one tile per photo, so a container with several photos would
  // otherwise appear several times in a row.
  function wireContainerRows(root) {
    const seen = new Set();
    const ids = [...root.querySelectorAll("[data-container-id]")]
      .map((el) => el.getAttribute("data-container-id"))
      .filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
    root.querySelectorAll("[data-container-id]").forEach((el) => {
      el.addEventListener("click", () => onOpenContainer(el.getAttribute("data-container-id"), ids));
    });
  }

  // A tile carries both data-container-id (wireContainerRows) and
  // data-media-id (hydrateThumbnails) on the same element — the whole tile
  // is the click target, exactly like a normal row, and hydration doesn't
  // care which attribute matched. One tile per PHOTO, not per container —
  // a container with 5 photos is 5 tiles, all opening the same container;
  // .flatMap keeps a container's own photos adjacent since `containers`
  // is already sorted.
  function photoTilesHtml(containers) {
    return containers
      .flatMap((c) => (c.attachments || []).map((a) => `<button type="button" class="capture-photo-tile" data-container-id="${c.id}" data-media-id="${escapeHtml(a.mediaId)}"><img alt="" /></button>`))
      .join("");
  }

  function galleryHtml() {
    return `
      <div class="photo-gallery">
        <button type="button" class="photo-gallery-nav photo-gallery-prev" aria-label="${escapeHtml(t("search.photoPrev"))}">${icon("chevronLeft", { size: 22 })}</button>
        <div class="photo-gallery-viewport">
          <button type="button" class="photo-gallery-photo"><img alt="" /></button>
          <p class="photo-gallery-counter"></p>
        </div>
        <button type="button" class="photo-gallery-nav photo-gallery-next" aria-label="${escapeHtml(t("search.photoNext"))}">${icon("chevronRight", { size: 22 })}</button>
      </div>`;
  }

  /** Paints whichever photo galleryIndex currently points at — swaps the
   * blob URL and updates the counter/button state in place, no re-render
   * of the surrounding markup, so prev/next stays snappy. */
  async function renderGalleryPhoto(targetEl) {
    const photo = galleryPhotos[galleryIndex];
    if (!photo) return;
    const prevBtn = targetEl.querySelector(".photo-gallery-prev");
    const nextBtn = targetEl.querySelector(".photo-gallery-next");
    const photoBtn = targetEl.querySelector(".photo-gallery-photo");
    const counterEl = targetEl.querySelector(".photo-gallery-counter");
    if (!photoBtn) return;
    prevBtn.disabled = galleryIndex === 0;
    nextBtn.disabled = galleryIndex === galleryPhotos.length - 1;
    counterEl.textContent = `${galleryIndex + 1} / ${galleryPhotos.length}`;
    photoBtn.setAttribute("data-container-id", photo.containerId);
    if (galleryUrl) URL.revokeObjectURL(galleryUrl);
    galleryUrl = null;
    const rec = await getMedia(photo.mediaId);
    if (rec && rec.blob) {
      galleryUrl = URL.createObjectURL(rec.blob);
      photoBtn.querySelector("img").src = galleryUrl;
    }
  }

  function wireGallery(targetEl) {
    const prevBtn = targetEl.querySelector(".photo-gallery-prev");
    const nextBtn = targetEl.querySelector(".photo-gallery-next");
    const viewport = targetEl.querySelector(".photo-gallery-viewport");
    const photoBtn = targetEl.querySelector(".photo-gallery-photo");

    function go(delta) {
      const next = galleryIndex + delta;
      if (next < 0 || next >= galleryPhotos.length) return;
      galleryIndex = next;
      renderGalleryPhoto(targetEl);
    }

    prevBtn.addEventListener("click", () => go(-1));
    nextBtn.addEventListener("click", () => go(1));
    photoBtn.addEventListener("click", () => onOpenContainer(galleryPhotos[galleryIndex].containerId));

    // Plain pointerdown/up delta, no capture — a tap that never moves
    // still reaches the photo button's own click handler untouched.
    let startX = null;
    viewport.addEventListener("pointerdown", (e) => {
      startX = e.clientX;
    });
    viewport.addEventListener("pointerup", (e) => {
      if (startX === null) return;
      const dx = e.clientX - startX;
      startX = null;
      if (Math.abs(dx) < 40) return;
      go(dx < 0 ? 1 : -1);
    });
  }

  /** Renders `containers` into `targetEl` as either the normal row list or,
   * in photo mode, a thumbnail grid or one-at-a-time gallery of just the
   * ones with a photo — the one branch point renderBrowse() and
   * renderSearchResults() both call through, so the two entry points
   * can't drift out of sync. */
  async function renderContainers(containers, targetEl, { itemCounts, locById } = {}) {
    if (photoMode) {
      const withPhotos = containers.filter((c) => (c.attachments || []).length > 0);
      if (!withPhotos.length) {
        targetEl.innerHTML = `<p class="empty-state">${escapeHtml(t("search.noPhotos"))}</p>`;
        return;
      }
      if (photoSizeMode === "full") {
        galleryPhotos = withPhotos.flatMap((c) => (c.attachments || []).map((a) => ({ containerId: c.id, mediaId: a.mediaId })));
        galleryIndex = 0;
        targetEl.innerHTML = galleryHtml();
        wireGallery(targetEl);
        await renderGalleryPhoto(targetEl);
      } else {
        targetEl.innerHTML = `<div class="photo-search-grid">${photoTilesHtml(withPhotos)}</div>`;
        wireContainerRows(targetEl);
        hydrateThumbnails(targetEl);
      }
    } else {
      targetEl.innerHTML = containers
        .map((c) => containerRowHtml(c, locById?.get((c.linkedIds || [])[0]), itemCounts?.get(c.id) ?? c.__itemCount ?? 0))
        .join("");
      wireContainerRows(targetEl);
      hydrateThumbnails(targetEl);
    }
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
      // A container has no category of its own — "category" only lives on
      // items — so filtering containers by category means "contains at
      // least one item of this category", built from the same item scan
      // that already computes itemCounts.
      const categoriesByContainer = new Map();
      for (const it of items) {
        for (const id of it.linkedIds || []) {
          itemCounts.set(id, (itemCounts.get(id) || 0) + 1);
          if (it.category) {
            if (!categoriesByContainer.has(id)) categoriesByContainer.set(id, new Set());
            categoriesByContainer.get(id).add(it.category);
          }
        }
      }
      refreshCategoryFilter(items);

      const roomVal = roomFilter.value;
      const storageVal = storageFilter.value;
      const sectionVal = sectionFilter.value;
      const categoryVal = categoryFilter.value;
      const locationActive = !!(roomVal || storageVal || sectionVal);

      let filtered = containers;
      if (locationActive) {
        filtered = filtered.filter((c) => {
          const loc = locById.get((c.linkedIds || [])[0]);
          if (!loc) return false;
          if (roomVal && loc.room !== roomVal) return false;
          if (storageVal && loc.storage !== storageVal) return false;
          if (sectionVal && loc.section !== sectionVal) return false;
          return true;
        });
      }
      if (categoryVal) {
        filtered = filtered.filter((c) => categoriesByContainer.get(c.id)?.has(categoryVal));
      }

      const labelParts = [];
      if (locationActive) labelParts.push([roomVal, storageVal, sectionVal].filter(Boolean).join(" › "));
      if (categoryVal) labelParts.push(categoryVal);
      const filterLabel = labelParts.join(" · ");

      browseLabel.textContent = filterLabel ? t("search.browseAt", { location: filterLabel }) : t("search.browseAll");
      if (photoMode) {
        browseEmpty.hidden = true; // renderContainers renders its own "no photos" empty state inline
      } else {
        browseEmpty.hidden = filtered.length > 0;
        // Filter-aware: "no containers at all" reads very differently from
        // "none matching this filter" — the latter would otherwise wrongly
        // imply the whole inventory is empty when it isn't.
        browseEmpty.textContent = filterLabel ? t("search.noContainersAt", { location: filterLabel }) : t("search.noContainers");
      }
      // Grouping by location only helps when browsing the whole, unfiltered
      // list — once a filter has already narrowed things down, a flat list
      // is short enough that a redundant group heading just adds noise.
      if (!photoMode && !locationActive && !categoryVal && filtered.length) {
        browseList.innerHTML = groupedContainerListHtml(filtered, locById, itemCounts);
        wireContainerRows(browseList);
        hydrateThumbnails(browseList);
      } else {
        await renderContainers(filtered, browseList, { itemCounts, locById });
      }
    } finally {
      browseSkeleton.end(seq);
    }
  }

  function distinctSorted(values) {
    return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  }

  function fillOptions(select, allLabel, values, current) {
    select.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>` + values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
    select.value = values.includes(current) ? current : "";
  }

  // Strictly cascading — room, then storage scoped to that room, then
  // section scoped to that room+storage — matching the request's "ROOM or
  // ROOM+STORAGE or ROOM+STORAGE+SECTION" shape rather than letting
  // storage/section be picked independently of the level above them.
  function refreshRoomFilter() {
    fillOptions(roomFilter, t("search.locationFilterAllRooms"), distinctSorted(locations.map((l) => l.room)), roomFilter.value);
  }

  function refreshStorageFilter() {
    const room = roomFilter.value;
    if (!room) {
      fillOptions(storageFilter, t("search.locationFilterAllStorage"), [], "");
      storageFilter.disabled = true;
      return;
    }
    const storages = distinctSorted(locations.filter((l) => l.room === room).map((l) => l.storage));
    fillOptions(storageFilter, t("search.locationFilterAllStorage"), storages, storageFilter.value);
    storageFilter.disabled = storages.length === 0;
  }

  function refreshSectionFilter() {
    const room = roomFilter.value;
    const storage = storageFilter.value;
    if (!room || !storage) {
      fillOptions(sectionFilter, t("search.locationFilterAllSections"), [], "");
      sectionFilter.disabled = true;
      return;
    }
    const sections = distinctSorted(locations.filter((l) => l.room === room && l.storage === storage).map((l) => l.section));
    fillOptions(sectionFilter, t("search.locationFilterAllSections"), sections, sectionFilter.value);
    sectionFilter.disabled = sections.length === 0;
  }

  function refreshCategoryFilter(items) {
    fillOptions(categoryFilter, t("search.categoryFilterAll"), distinctSorted(items.map((i) => i.category)), categoryFilter.value);
  }

  roomFilter.addEventListener("change", () => {
    refreshStorageFilter();
    refreshSectionFilter();
    renderBrowse();
  });
  storageFilter.addEventListener("change", () => {
    refreshSectionFilter();
    renderBrowse();
  });
  sectionFilter.addEventListener("change", renderBrowse);
  categoryFilter.addEventListener("change", renderBrowse);

  // ---------- search mode ----------

  async function renderSearchResults(items, containers, locs) {
    // Photo mode collapses the whole items/containers/locations breakdown
    // into one thumbnail grid of just the matched containers that have a
    // photo — items and locations aren't photo-representable, and mixing
    // "text results" with "photo results" in the same screen would defeat
    // the point of a quick visual scan.
    if (photoMode) {
      await renderContainers(containers, resultsEl);
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
    await renderSearchResults(itemsRes.results, containersRes.results, locsRes.results);
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
    // The size toggle only makes sense once photo mode is on, and always
    // starts back at "compact" so leaving and re-entering photo mode never
    // surprises with a full-size gallery no one asked for this time.
    photoSizeMode = "compact";
    photoSizeToggle.hidden = !photoMode;
    photoSizeToggle.classList.remove("active");
    photoSizeToggle.setAttribute("aria-pressed", "false");
    const q = input.value.trim();
    if (q) await runSearch(q);
    else await renderBrowse();
  });

  photoSizeToggle.addEventListener("click", async () => {
    photoSizeMode = photoSizeMode === "full" ? "compact" : "full";
    photoSizeToggle.classList.toggle("active", photoSizeMode === "full");
    photoSizeToggle.setAttribute("aria-pressed", String(photoSizeMode === "full"));
    const q = input.value.trim();
    if (q) await runSearch(q);
    else await renderBrowse();
  });

  async function show() {
    const { results } = await queryItems({ type: "location" });
    locations = results;
    refreshRoomFilter();
    refreshStorageFilter();
    refreshSectionFilter();
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

  return { show };
}
