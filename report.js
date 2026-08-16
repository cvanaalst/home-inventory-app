// PURE export, insights, and print builders. Takes its translator as a
// parameter rather than importing i18n.js, so it can be tested with a stub
// dictionary (BLUEPRINT.md §4). No DOM, no storage — view-report.js and
// view-detail.js own the download/print mechanics.

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

function locationPathOf(location) {
  if (!location) return "";
  return [location.room, location.storage, location.section, location.title].filter(Boolean).join(" › ");
}

/** "Tolerance: 5% · Power: 0.25W" — the one place this join happens, so the
 * on-screen summary (view-detail.js) and the print table read identically.
 * Entries with no key are already impossible (normalizeFields drops them),
 * but an empty value is legitimate — a spec can be a bare label. */
export function formatFieldsSummary(fields) {
  return (fields || []).map((f) => (f.value ? `${f.key}: ${f.value}` : f.key)).join(" · ");
}

/** One DIFFABLE_FIELDS value (db.js), rendered for a revision-history diff
 * line. `itemsById` resolves a linkedIds entry to a title so "moved to X"
 * reads like a place, not a UUID — an id that no longer resolves (its
 * target was itself later purged) falls back to the raw id rather than
 * silently hiding the change. */
export function formatHistoryValue(field, value, { t, itemsById = new Map() } = {}) {
  if (value === undefined || value === null || value === "") return t("history.empty");
  if (field === "pinned") return value ? t("history.yes") : t("history.no");
  if (field === "linkedIds") {
    if (!Array.isArray(value) || value.length === 0) return t("history.empty");
    return value.map((id) => itemsById.get(id)?.title || id).join(", ");
  }
  if (field === "tags") {
    return Array.isArray(value) && value.length ? value.join(", ") : t("history.empty");
  }
  if (field === "fields") {
    return formatFieldsSummary(value) || t("history.empty");
  }
  if (field === "links") {
    if (!Array.isArray(value) || value.length === 0) return t("history.empty");
    return value.map((l) => l.label || l.url).filter(Boolean).join(", ") || t("history.empty");
  }
  if (field === "attachments") {
    if (!Array.isArray(value) || value.length === 0) return t("history.empty");
    return value.length === 1 ? t("history.photoCount.one") : t("history.photoCount", { n: value.length });
  }
  return String(value);
}

// ────────────────────────────────────────────────────────────────────────
// insights
// ────────────────────────────────────────────────────────────────────────

/** Totals + the per-category breakdown that stands in for this domain's
 * "per-type" bars (§8.8) — `type` itself is just location/container/item,
 * not a useful thing to chart; category is the item's real sub-classification. */
export function computeStats(items) {
  const live = items.filter((r) => !r.deletedAt);
  const locations = live.filter((r) => r.type === "location");
  const containers = live.filter((r) => r.type === "container");
  const itemRecords = live.filter((r) => r.type === "item");

  const byStatus = { captured: 0, drafted: 0, confirmed: 0 };
  for (const c of containers) byStatus[c.status] = (byStatus[c.status] || 0) + 1;

  const byCategory = new Map();
  let totalQuantity = 0;
  let draftCount = 0;
  for (const it of itemRecords) {
    totalQuantity += it.quantity || 0;
    if (it.state === "draft") draftCount++;
    const cat = it.category || "";
    byCategory.set(cat, (byCategory.get(cat) || 0) + 1);
  }

  const pinned = live.filter((r) => r.pinned).length;

  return {
    locations: locations.length,
    containers: { total: containers.length, byStatus },
    items: {
      total: itemRecords.length,
      totalQuantity,
      draftCount,
      byCategory: [...byCategory.entries()]
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count),
    },
    pinned,
  };
}

/** Buckets records into `weeks` consecutive 7-day windows ending "today"
 * (default now), oldest first. Deliberately UTC-day-boundary arithmetic —
 * date-string parsing pitfalls are the single most bug-prone class of pure
 * function in this codebase (BLUEPRINT.md §13). */
export function bucketItemsByWeek(items, weeks = 12, opts = {}) {
  const { dateField = "createdAt", today } = opts;
  const ref = today ? new Date(today) : new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const endMs = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()) + dayMs;

  const buckets = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const bucketEnd = endMs - w * 7 * dayMs;
    buckets.push({ start: bucketEnd - 7 * dayMs, end: bucketEnd, count: 0 });
  }
  const rangeStart = buckets[0].start;

  for (const item of items) {
    if (item.deletedAt) continue;
    const t = Date.parse(item[dateField]);
    if (!Number.isFinite(t) || t < rangeStart || t >= endMs) continue;
    const bucket = buckets.find((b) => t >= b.start && t < b.end);
    if (bucket) bucket.count++;
  }

  return buckets.map((b) => ({ weekStart: new Date(b.start).toISOString(), count: b.count }));
}

/** Distinct tags, newest-use first. Empty until a future phase adds tag
 * editing — the query engine and search haystack already support tags. */
export function sortTagsByRecency(items) {
  const map = new Map();
  for (const item of items) {
    if (item.deletedAt) continue;
    for (const tag of item.tags || []) {
      const entry = map.get(tag) || { tag, count: 0, lastUsed: item.updatedAt };
      entry.count++;
      if (item.updatedAt > entry.lastUsed) entry.lastUsed = item.updatedAt;
      map.set(tag, entry);
    }
  }
  return [...map.values()].sort((a, b) => b.lastUsed.localeCompare(a.lastUsed));
}

// ────────────────────────────────────────────────────────────────────────
// export
// ────────────────────────────────────────────────────────────────────────

/** Full-fidelity export: every record, including tombstones — this is the
 * same shape Phase 4's backup will use, so it must round-trip everything. */
export function buildJsonExport(items) {
  return JSON.stringify(items, null, 2);
}

function csvField(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Flattened, item-centric CSV for spreadsheets — live (non-deleted) items
 * only, since this is a snapshot of current stock, not a backup. Column
 * headers are fixed English keys, not translated, so the file stays usable
 * regardless of app language (BLUEPRINT.md §11 — diagnostic/interchange
 * strings stay language-neutral). */
export function buildCsvExport(items, containers, locations) {
  const containersById = new Map(containers.map((c) => [c.id, c]));
  const locationsById = new Map(locations.map((l) => [l.id, l]));

  const header = [
    "container",
    "container_name",
    "location",
    "description",
    "quantity",
    "category",
    "link",
    "state",
    "updated_at",
  ];
  const rows = [header.join(",")];

  for (const item of items) {
    if (item.deletedAt || item.type !== "item") continue;
    const container = containersById.get((item.linkedIds || [])[0]);
    const location = container ? locationsById.get((container.linkedIds || [])[0]) : null;
    rows.push(
      [
        csvField(container?.code || ""),
        csvField(container?.title || ""),
        csvField(locationPathOf(location)),
        csvField(item.title),
        csvField(item.quantity),
        csvField(item.category),
        csvField((item.links || [])[0]?.url || ""),
        csvField(item.state),
        csvField(item.updatedAt),
      ].join(","),
    );
  }
  return rows.join("\n");
}

// ────────────────────────────────────────────────────────────────────────
// print
// ────────────────────────────────────────────────────────────────────────

/** Overview report grouped by location path, alphabetical. `containers`
 * should already be scoped to whatever the caller wants printed — the
 * single-container print button passes an array of one. `photoUrls`
 * (containerId -> displayable img src) is precomputed by the caller —
 * this stays a synchronous, DOM-free function, so it can't itself fetch a
 * media blob and turn it into an object URL. */
export function buildPrintReportHtml({ containers, items, locations, includeNotes, t, photoUrls = new Map() }) {
  const locationsById = new Map(locations.map((l) => [l.id, l]));
  const itemsByContainer = new Map();
  for (const item of items) {
    if (item.deletedAt || item.type !== "item") continue;
    for (const id of item.linkedIds || []) {
      if (!itemsByContainer.has(id)) itemsByContainer.set(id, []);
      itemsByContainer.get(id).push(item);
    }
  }

  const sorted = [...containers]
    .filter((c) => !c.deletedAt)
    .sort((a, b) => {
      const pathA = locationPathOf(locationsById.get((a.linkedIds || [])[0]));
      const pathB = locationPathOf(locationsById.get((b.linkedIds || [])[0]));
      return pathA.localeCompare(pathB, undefined, { numeric: true, sensitivity: "base" }) || a.code.localeCompare(b.code);
    });

  let currentPath = Symbol("none");
  const sections = [];
  let totalItems = 0;

  for (const c of sorted) {
    const path = locationPathOf(locationsById.get((c.linkedIds || [])[0])) || t("report.print.noLocation");
    if (path !== currentPath) {
      sections.push(`<h2 class="print-location">${escapeHtml(path)}</h2>`);
      currentPath = path;
    }
    const containerItems = (itemsByContainer.get(c.id) || []).sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" }));
    totalItems += containerItems.length;

    const rows = containerItems.length
      ? containerItems
          .map((it) => {
            const specs = formatFieldsSummary(it.fields);
            const specsLine = specs ? `<div class="print-item-fields">${escapeHtml(specs)}</div>` : "";
            return `<tr><td class="print-qty">${it.quantity}</td><td>${escapeHtml(it.title)}${specsLine}</td><td class="print-cat">${escapeHtml(it.category)}</td></tr>`;
          })
          .join("")
      : `<tr><td colspan="3" class="print-empty">${escapeHtml(t("report.print.noItems"))}</td></tr>`;

    const notes = includeNotes && c.comment ? `<div class="print-notes">${escapeHtml(c.comment)}</div>` : "";
    const photoUrl = photoUrls.get(c.id);
    const thumb = photoUrl ? `<img src="${escapeHtml(photoUrl)}" class="print-container-thumb" alt="" />` : "";

    sections.push(`
      <div class="print-container">
        <div class="print-container-head">
          ${thumb}
          <span class="print-code">${escapeHtml(c.code)}</span>
          <span class="print-name">${escapeHtml(c.title)}</span>
          <span class="print-count">${containerItems.length}</span>
        </div>
        ${notes}
        <table><thead><tr><th class="print-qty">#</th><th>${escapeHtml(t("item.description"))}</th><th class="print-cat">${escapeHtml(t("item.category"))}</th></tr></thead>
        <tbody>${rows}</tbody></table>
      </div>`);
  }

  return `
    <h1>${escapeHtml(t("report.print.title"))}</h1>
    <div class="print-meta">${sorted.length} ${escapeHtml(t("report.print.containersLabel"))} · ${totalItems} ${escapeHtml(t("report.print.itemsLabel"))}</div>
    ${sections.join("\n") || `<p>${escapeHtml(t("report.print.empty"))}</p>`}
  `;
}

/** Popular pre-cut label sheet formats, alongside the original "generic"
 * (plain paper, cut-your-own-line) layout. Each real format's exact
 * label size/pitch/margins lives in style.css as a `.label-sheet.fmt-<id>`
 * rule — this registry only carries what the UI/print-mechanics layer
 * needs: which page size the sheet is cut for (view-labels.js sets the
 * @page rule accordingly) and the per-sheet capacity, shown in the picker
 * so a choice like "21/sheet" means something before you've printed it.
 * Dimensions cross-checked against gLabels' own Avery template definitions
 * (github.com/samlown/glabels, github.com/j-evins/glabels-qt) — the same
 * numbers real label-printing software ships with — not eyeballed. */
export const LABEL_FORMATS = [
  { id: "generic", page: null, perSheet: null },
  { id: "l7160", page: "a4", perSheet: 21 },
  { id: "l7163", page: "a4", perSheet: 14 },
  { id: "l7651", page: "a4", perSheet: 65 },
  { id: "avery5160", page: "letter", perSheet: 30 },
  { id: "avery5167", page: "letter", perSheet: 80 },
];

/** One small cut-out card per container — code, name, location path.
 * Deliberately no QR: a printed code that links back into the app opens in
 * Safari, not the installed PWA, on iOS (BLUEPRINT.md §13.3) — a link is
 * the wrong mechanism here, not just an omitted nice-to-have. `containers`
 * should already be scoped to whatever the caller wants printed.
 *
 * `format` picks a LABEL_FORMATS id; "generic" (the default) keeps the
 * original auto-fill grid on plain paper. Anything else adds a
 * `fmt-<id>` class that style.css sizes to that sheet's real label
 * dimensions/pitch/margins — the dashed cut-line border is dropped for
 * those, since the label boundary is a physical sticker edge there, not
 * something to mark with ink. */
export function buildLabelSheetHtml({ containers, locations, t, format = "generic" }) {
  const locationsById = new Map(locations.map((l) => [l.id, l]));
  const sorted = [...containers].filter((c) => !c.deletedAt).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: "base" }));

  const cards = sorted
    .map((c) => {
      const path = locationPathOf(locationsById.get((c.linkedIds || [])[0]));
      return `
      <div class="label-card">
        <div class="label-code">${escapeHtml(c.code)}</div>
        ${c.title ? `<div class="label-name">${escapeHtml(c.title)}</div>` : ""}
        ${path ? `<div class="label-path">${escapeHtml(path)}</div>` : ""}
      </div>`;
    })
    .join("");

  const formatClass = format && format !== "generic" ? ` fmt-${format}` : "";
  return `<div class="label-sheet${formatClass}">${cards || `<p>${escapeHtml(t("report.print.empty"))}</p>`}</div>`;
}
