// More ▸ Bulk-create containers: a run of "<PREFIX>-NNN" containers created
// in one go, none of them attached to a location yet (that's set later, per
// container, same as any manually-created container) — for prepping a batch
// of empty boxes before they're actually filled and placed.

import { queryItems, putItems, makeRecord, nextCode, codeRange } from "./db.js";
import { toast } from "./ui.js";
import { t, tCount } from "./i18n.js";

const DEFAULT_BATCH_SIZE = 10;

export function initBulkContainersView() {
  const prefixInput = document.getElementById("bulk-containers-prefix");
  const fromInput = document.getElementById("bulk-containers-from");
  const toInput = document.getElementById("bulk-containers-to");
  const createBtn = document.getElementById("bulk-containers-create");
  const errorEl = document.getElementById("bulk-containers-error");

  /** Reads the next free number for the current prefix straight off
   * nextCode's own "<PREFIX>-NNN" output, so this never drifts out of sync
   * with the single-container creation flow's own numbering. */
  async function refreshDefaults() {
    const { results: containers } = await queryItems({ type: "container" });
    const next = nextCode(containers.map((c) => c.code), prefixInput.value.trim() || "BOX");
    const nextNum = Number.parseInt(next.split("-").pop(), 10) || 1;
    fromInput.value = String(nextNum);
    toInput.value = String(nextNum + DEFAULT_BATCH_SIZE - 1);
  }

  prefixInput.addEventListener("blur", refreshDefaults);

  createBtn.addEventListener("click", async () => {
    errorEl.hidden = true;
    const prefix = prefixInput.value.trim() || "BOX";
    const codes = codeRange(prefix, fromInput.value.trim(), toInput.value.trim());
    if (!codes.length) {
      errorEl.textContent = t("bulkContainers.invalid");
      errorEl.hidden = false;
      return;
    }

    // codeRange never checks for collisions — codes aren't unique-
    // constrained at the storage layer, so this has to happen here,
    // exactly like every other container-code write path in the app.
    const { results: containers } = await queryItems({ type: "container" });
    const existing = new Set(containers.map((c) => c.code));
    const collisions = codes.filter((code) => existing.has(code));
    if (collisions.length) {
      errorEl.textContent = t("bulkContainers.codesExist", { codes: collisions.join(", ") });
      errorEl.hidden = false;
      return;
    }

    const records = codes.map((code) => makeRecord({ type: "container", code, status: "captured" }));
    await putItems(records);

    const from = codes[0];
    const to = codes[codes.length - 1];
    toast(codes.length === 1 ? t("bulkContainers.done.one", { from }) : t("bulkContainers.done", { count: codes.length, from, to }), "info");

    await refreshDefaults();
  });

  async function show() {
    errorEl.hidden = true;
    await refreshDefaults();
  }

  return { show };
}
