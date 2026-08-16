// Insights: stats tiles, per-category bars, 12-week activity chart, tag
// cloud, JSON/CSV export, printable overview. All computation is delegated
// to the pure functions in report.js — this file only owns DOM + downloads.

import { getAllItems, getMedia } from "./db.js";
import {
  computeStats,
  bucketItemsByWeek,
  sortTagsByRecency,
  buildJsonExport,
  buildCsvExport,
  buildPrintReportHtml,
} from "./report.js";
import { t } from "./i18n.js";
import { escapeHtml } from "./ui.js";

function downloadBlob(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

export function initReportView() {
  const els = {
    locations: document.getElementById("report-stat-locations"),
    containers: document.getElementById("report-stat-containers"),
    items: document.getElementById("report-stat-items"),
    pinned: document.getElementById("report-stat-pinned"),
    drafts: document.getElementById("report-stat-drafts"),
    categories: document.getElementById("report-categories"),
    categoriesEmpty: document.getElementById("report-categories-empty"),
    chart: document.getElementById("report-chart"),
    tags: document.getElementById("report-tags"),
    tagsEmpty: document.getElementById("report-tags-empty"),
    exportJsonBtn: document.getElementById("report-export-json-btn"),
    exportCsvBtn: document.getElementById("report-export-csv-btn"),
    printBtn: document.getElementById("report-print-btn"),
  };

  let allItems = [];

  function renderStats(stats) {
    els.locations.textContent = stats.locations;
    els.containers.textContent = stats.containers.total;
    els.items.textContent = stats.items.total;
    els.pinned.textContent = stats.pinned;
    els.drafts.textContent = stats.items.draftCount;
  }

  function renderCategories(byCategory) {
    const max = Math.max(1, ...byCategory.map((c) => c.count));
    els.categoriesEmpty.hidden = byCategory.length > 0;
    els.categories.innerHTML = byCategory
      .map(({ category, count }) => {
        const pct = Math.round((count / max) * 100);
        const label = category || t("report.categories.uncategorized");
        return `
        <div class="category-bar-row">
          <span class="category-bar-label">${escapeHtml(label)}</span>
          <span class="category-bar-track"><span class="category-bar-fill" style="width:${pct}%"></span></span>
          <span class="category-bar-count">${count}</span>
        </div>`;
      })
      .join("");
  }

  function renderChart(buckets) {
    const max = Math.max(1, ...buckets.map((b) => b.count));
    const w = 300;
    const h = 90;
    const barW = w / buckets.length;
    const bars = buckets
      .map((b, i) => {
        const barH = b.count ? Math.max(2, (b.count / max) * (h - 18)) : 0;
        const x = i * barW + 2;
        const y = h - barH - 14;
        const valueLabel = b.count ? `<text x="${x + (barW - 4) / 2}" y="${y - 3}" class="chart-value" text-anchor="middle">${b.count}</text>` : "";
        return `<rect x="${x}" y="${y}" width="${Math.max(0, barW - 4)}" height="${barH}" rx="2" class="chart-bar"></rect>${valueLabel}`;
      })
      .join("");
    els.chart.innerHTML = `<svg viewBox="0 0 ${w} ${h}" class="chart-svg" role="img" aria-label="${escapeHtml(t("report.activity.title"))}">${bars}</svg>`;
  }

  function renderTags(tags) {
    els.tagsEmpty.hidden = tags.length > 0;
    els.tags.innerHTML = tags
      .map(({ tag, count }) => `<span class="tag-pill">${escapeHtml(tag)} <span class="tag-count">${count}</span></span>`)
      .join("");
  }

  els.exportJsonBtn.addEventListener("click", () => {
    downloadBlob(`inventory-export-${dateStamp()}.json`, buildJsonExport(allItems), "application/json");
  });

  els.exportCsvBtn.addEventListener("click", () => {
    const containers = allItems.filter((r) => r.type === "container");
    const locations = allItems.filter((r) => r.type === "location");
    downloadBlob(`inventory-export-${dateStamp()}.csv`, buildCsvExport(allItems, containers, locations), "text/csv");
  });

  els.printBtn.addEventListener("click", async () => {
    const containers = allItems.filter((r) => r.type === "container");
    const locations = allItems.filter((r) => r.type === "location");
    // Object URLs deliberately outlive this handler unrevoked — a one-shot
    // print action over a handful of thumbnails, not a hot loop, so the
    // usual revoke-on-rerender discipline (view-search.js, view-detail.js)
    // isn't worth the complexity of timing it around window.print()'s
    // non-deterministic-across-browsers return.
    const photoUrls = new Map();
    for (const c of containers) {
      const first = (c.attachments || [])[0];
      if (!first) continue;
      const rec = await getMedia(first.mediaId);
      if (rec?.blob) photoUrls.set(c.id, URL.createObjectURL(rec.blob));
    }
    const html = buildPrintReportHtml({ containers, items: allItems, locations, includeNotes: false, t, photoUrls });
    document.getElementById("print-root").innerHTML = html;
    window.print();
  });

  async function show() {
    allItems = await getAllItems();
    const stats = computeStats(allItems);
    renderStats(stats);
    renderCategories(stats.items.byCategory);
    renderChart(bucketItemsByWeek(allItems, 12));
    renderTags(sortTagsByRecency(allItems));
  }

  return { show };
}
