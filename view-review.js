// Review queue: containers with photos ready for (or already run through) AI
// batch identification, and AI-drafted items awaiting confirmation. Owns the
// whole AI pipeline end to end — the explicit "select which photos get
// processed" gate lives here as the batch checklist below, and approval
// itself is left to view-detail.js's existing confirm-drafts button, which
// this view links out to rather than duplicating.

import { queryItems, getItem, putItem, putItems, makeRecord, getMedia } from "./db.js";
import { toast, escapeHtml, skeletonGate } from "./ui.js";
import { t, tCount } from "./i18n.js";
import { icon } from "./icons.js";
import { hasApiKey, identifyContainerPhotos } from "./ai.js";
import { planBatch } from "./aiplan.js";

export function initReviewView({ onOpenContainer, onOpenSettings }) {
  const queueSkeleton = skeletonGate(document.getElementById("review-queue-skeleton"));
  const queueEmpty = document.getElementById("review-queue-empty");
  const queueFilteredEmpty = document.getElementById("review-queue-filtered-empty");
  const showIdentifiedToggle = document.getElementById("review-show-identified-toggle");
  const queueList = document.getElementById("review-queue-list");
  const noKeyHint = document.getElementById("review-no-api-key");
  const noKeyBtn = document.getElementById("review-no-api-key-btn");
  const batchBar = document.getElementById("review-batch-bar");
  const batchCountEl = document.getElementById("review-batch-count");
  const batchCostEl = document.getElementById("review-batch-cost");
  const batchRunBtn = document.getElementById("review-batch-run-btn");

  const draftsEmpty = document.getElementById("review-drafts-empty");
  const draftsList = document.getElementById("review-drafts-list");

  let containers = [];
  let items = [];
  let apiKeyConfigured = false;
  const selected = new Set();

  function attachmentPhotos(container) {
    return (container.attachments || []).map((a) => ({ width: a.width, height: a.height }));
  }

  function containersWithPhotos() {
    return containers.filter((c) => (c.attachments || []).length > 0);
  }

  function aiItemCountFor(containerId) {
    return items.filter((i) => i.source === "ai" && (i.linkedIds || []).includes(containerId)).length;
  }

  // Default view: only containers never run through AI before — re-running
  // an already-identified one takes an explicit opt-in via the toggle, so a
  // batch click can't accidentally re-spend on containers already done. A
  // confirmed container is excluded the same way: view-detail.js's "add
  // photos without AI" sets status to confirmed specifically so reference
  // photos added to an already-settled container don't silently re-enter
  // the queue — the toggle still reveals it for an explicit re-run.
  function visibleQueueContainers() {
    const withPhotos = containersWithPhotos();
    return showIdentifiedToggle.checked ? withPhotos : withPhotos.filter((c) => aiItemCountFor(c.id) === 0 && c.status !== "confirmed");
  }

  // ---------- queue (select containers, run AI) ----------

  function queueRowHtml(c) {
    const photoCount = (c.attachments || []).length;
    const aiCount = aiItemCountFor(c.id);
    const status = aiCount > 0 ? tCount("review.alreadyIdentified", aiCount) : t("review.notYetIdentified");
    return `
      <label class="row-card review-queue-row" data-container-id="${c.id}">
        <input type="checkbox" class="review-queue-check" ${selected.has(c.id) ? "checked" : ""} />
        <span class="row-main">
          <span class="row-title">${escapeHtml(c.code)}${c.title ? ` — ${escapeHtml(c.title)}` : ""}</span>
          <span class="row-sub">${tCount("capture.photoCount", photoCount)} · ${status}</span>
        </span>
      </label>`;
  }

  function refreshBatchBar() {
    const chosen = visibleQueueContainers().filter((c) => selected.has(c.id));
    batchBar.hidden = chosen.length === 0;
    if (chosen.length === 0) return;
    const plan = planBatch(chosen.map((c) => ({ id: c.id, photos: attachmentPhotos(c) })));
    batchCountEl.textContent = tCount("review.selectedCount", chosen.length);
    batchCostEl.textContent = t("review.estimatedCost", { usd: plan.total.usd < 0.01 ? "< $0.01" : `~$${plan.total.usd.toFixed(2)}` });
    batchRunBtn.disabled = !apiKeyConfigured;
  }

  async function renderQueue() {
    const seq = queueSkeleton.begin();
    try {
      const withPhotos = containersWithPhotos();
      const visible = visibleQueueContainers();
      queueEmpty.hidden = withPhotos.length > 0;
      // Distinguish "nothing has photos yet" from "everything does, but the
      // toggle is hiding it" — same idea as search.noContainersAt in
      // view-search.js, since the two states need different guidance.
      queueFilteredEmpty.hidden = withPhotos.length === 0 || visible.length > 0;
      queueList.innerHTML = visible.map(queueRowHtml).join("");
      for (const c of visible) {
        const row = queueList.querySelector(`[data-container-id="${c.id}"]`);
        row?.querySelector(".review-queue-check").addEventListener("change", (e) => {
          if (e.target.checked) selected.add(c.id);
          else selected.delete(c.id);
          refreshBatchBar();
        });
      }
      noKeyHint.hidden = apiKeyConfigured;
      refreshBatchBar();
    } finally {
      queueSkeleton.end(seq);
    }
  }

  noKeyBtn.addEventListener("click", () => onOpenSettings());

  // Switching the filter changes which containers are even selectable, so
  // any prior selection could reference a now-hidden row — drop it rather
  // than run a batch on containers the user can no longer see or uncheck.
  showIdentifiedToggle.addEventListener("change", () => {
    selected.clear();
    renderQueue();
  });

  async function runContainer(container) {
    const attachments = container.attachments || [];
    const photos = [];
    for (const a of attachments) {
      const rec = await getMedia(a.mediaId);
      if (rec && rec.blob) photos.push({ blob: rec.blob, mimeType: rec.mimeType || a.mimeType || "image/jpeg" });
    }
    const result = await identifyContainerPhotos(photos);
    if (result.outcome !== "success") return result;
    const drafts = result.items.map((d) =>
      makeRecord({
        type: "item",
        title: d.title,
        quantity: d.quantity,
        category: d.category,
        tags: d.tags,
        state: "draft",
        source: "ai",
        linkedIds: [container.id],
      }),
    );
    if (drafts.length) await putItems(drafts);
    // A re-run appends rather than replaces — the notes field is the user's,
    // and an earlier AI pass (or their own notes) shouldn't be overwritten.
    if (result.description) {
      const comment = container.comment ? `${container.comment}\n\n${result.description}` : result.description;
      const updated = await putItem({ ...container, comment });
      const idx = containers.findIndex((c) => c.id === container.id);
      if (idx !== -1) containers[idx] = updated;
    }
    return { outcome: "success", count: drafts.length };
  }

  batchRunBtn.addEventListener("click", async () => {
    const chosen = visibleQueueContainers().filter((c) => selected.has(c.id));
    if (chosen.length === 0) return;
    batchRunBtn.disabled = true;
    const original = batchRunBtn.textContent;
    let identified = 0;
    let failed = 0;
    for (const container of chosen) {
      batchRunBtn.textContent = t("review.identifying", { code: container.code });
      const result = await runContainer(container);
      if (result.outcome === "success") identified += result.count;
      else failed += 1;
    }
    batchRunBtn.textContent = original;
    selected.clear();
    await reload();
    if (failed === 0) toast(tCount("review.batchDone", identified), "info");
    else toast(t("review.batchPartial", { done: identified, failed }), "error");
  });

  // ---------- drafts (edit / add / delete) ----------

  function draftRowHtml(item) {
    return `
      <div class="swipe-row" data-item-id="${item.id}">
        <div class="swipe-actions right">${icon("trash", { size: 18 })}</div>
        <div class="swipe-content item-row draft">
          <div class="item-row-main">
            <div class="qty-stepper">
              <button type="button" data-qty-dec aria-label="-">−</button>
              <input type="text" inputmode="numeric" class="draft-qty-input" value="${item.quantity}" />
              <button type="button" data-qty-inc aria-label="+">＋</button>
            </div>
            <input type="text" class="grow draft-title-input" value="${escapeHtml(item.title)}" maxlength="100" />
            <button type="button" class="btn-icon draft-delete-btn" data-i18n-aria="action.delete">${icon("close", { size: 18 })}</button>
          </div>
          <div class="item-row-sub">
            <input type="text" class="cat-input draft-category-input" list="category-options" value="${escapeHtml(item.category)}" placeholder="${escapeHtml(t("item.category"))}" />
          </div>
        </div>
      </div>`;
  }

  function patchDraft(id, fields) {
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return Promise.resolve();
    const merged = { ...items[idx], ...fields };
    items[idx] = merged;
    return putItem(merged).then((updated) => {
      items = items.map((i) => (i.id === id ? updated : i));
    });
  }

  function deleteDraft(item, groupEl) {
    const row = groupEl.querySelector(`[data-item-id="${item.id}"]`);
    row?.remove();
    items = items.filter((i) => i.id !== item.id);
    toast(t("toast.itemDeleted"), "info", {
      actionLabel: t("toast.undo"),
      onAction: async () => {
        items.push(item);
        await renderDrafts();
      },
      onExpire: () => putItem({ ...item, deletedAt: new Date().toISOString() }),
    });
  }

  function wireDraftRow(row, item, groupEl) {
    const qtyInput = row.querySelector(".draft-qty-input");
    row.querySelector("[data-qty-dec]").addEventListener("click", () => {
      const next = Math.max(1, (Number.parseInt(qtyInput.value, 10) || 1) - 1);
      qtyInput.value = next;
      patchDraft(item.id, { quantity: next });
    });
    row.querySelector("[data-qty-inc]").addEventListener("click", () => {
      const next = (Number.parseInt(qtyInput.value, 10) || 1) + 1;
      qtyInput.value = next;
      patchDraft(item.id, { quantity: next });
    });
    qtyInput.addEventListener("blur", () => {
      const next = Math.max(1, Number.parseInt(qtyInput.value, 10) || 1);
      qtyInput.value = next;
      const current = items.find((i) => i.id === item.id);
      if (next !== current?.quantity) patchDraft(item.id, { quantity: next });
    });
    const titleInput = row.querySelector(".draft-title-input");
    titleInput.addEventListener("blur", () => {
      const next = titleInput.value.trim();
      const current = items.find((i) => i.id === item.id);
      if (next && next !== current?.title) {
        patchDraft(item.id, { title: next }).then(() => {
          titleInput.value = items.find((i) => i.id === item.id)?.title ?? next;
        });
      } else {
        titleInput.value = current?.title ?? item.title;
      }
    });
    const catInput = row.querySelector(".draft-category-input");
    catInput.addEventListener("blur", () => {
      const next = catInput.value.trim();
      const current = items.find((i) => i.id === item.id);
      if (next !== current?.category) {
        patchDraft(item.id, { category: next }).then(() => {
          catInput.value = items.find((i) => i.id === item.id)?.category ?? next;
        });
      }
    });
    row.querySelector(".draft-delete-btn").addEventListener("click", () => deleteDraft(item, groupEl));
  }

  function groupHtml(container, drafts) {
    return `
      <div class="card review-draft-group" data-container-id="${container.id}">
        <div class="review-draft-group-header">
          <span class="row-title">${escapeHtml(container.code)}${container.title ? ` — ${escapeHtml(container.title)}` : ""}</span>
          <button type="button" class="btn btn-sm review-open-container-btn">${escapeHtml(t("review.openContainer"))}</button>
        </div>
        <div class="review-draft-items">${drafts.map(draftRowHtml).join("")}</div>
        <div class="row review-add-draft-row">
          <input type="text" class="grow review-add-draft-input" placeholder="${escapeHtml(t("detail.addItem"))}" maxlength="100" />
          <button type="button" class="btn btn-sm review-add-draft-btn">${escapeHtml(t("action.add"))}</button>
        </div>
      </div>`;
  }

  async function renderDrafts() {
    const drafts = items.filter((i) => i.state === "draft");
    draftsEmpty.hidden = drafts.length > 0;
    const byContainer = new Map();
    for (const item of drafts) {
      const containerId = (item.linkedIds || [])[0];
      if (!containerId) continue;
      if (!byContainer.has(containerId)) byContainer.set(containerId, []);
      byContainer.get(containerId).push(item);
    }
    const groups = [...byContainer.entries()]
      .map(([containerId, groupItems]) => ({ container: containers.find((c) => c.id === containerId), items: groupItems }))
      .filter((g) => g.container);

    draftsList.innerHTML = groups.map((g) => groupHtml(g.container, g.items)).join("");

    for (const g of groups) {
      const groupEl = draftsList.querySelector(`[data-container-id="${g.container.id}"]`);
      if (!groupEl) continue;
      for (const item of g.items) {
        const row = groupEl.querySelector(`[data-item-id="${item.id}"]`);
        if (row) wireDraftRow(row, item, groupEl);
      }
      groupEl.querySelector(".review-open-container-btn").addEventListener("click", () => onOpenContainer(g.container.id));
      const addInput = groupEl.querySelector(".review-add-draft-input");
      const addBtn = groupEl.querySelector(".review-add-draft-btn");
      const addDraft = async () => {
        const title = addInput.value.trim();
        if (!title) return;
        const record = makeRecord({ type: "item", title, quantity: 1, state: "draft", source: "manual", linkedIds: [g.container.id] });
        const saved = await putItem(record);
        items.push(saved);
        addInput.value = "";
        await renderDrafts();
      };
      addBtn.addEventListener("click", addDraft);
      addInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") addDraft();
      });
    }
  }

  async function reload() {
    const [{ results: loadedContainers }, { results: loadedItems }, keyConfigured] = await Promise.all([
      queryItems({ type: "container" }),
      queryItems({ type: "item" }),
      hasApiKey(),
    ]);
    containers = loadedContainers;
    items = loadedItems;
    apiKeyConfigured = keyConfigured;
    for (const id of [...selected]) {
      if (!containers.some((c) => c.id === id)) selected.delete(id);
    }
    await renderQueue();
    await renderDrafts();
  }

  return { show: reload };
}
