// PURE: prompt construction, response parsing, token/cost estimation, and
// batch planning for AI photo identification. No imports, no network, no DOM
// — the part that is easy to get wrong is the part that must be easy to test.

const MODEL = "claude-haiku-4-5";

// Anthropic's published image-token approximation is tokens ≈ (w × h) / 750,
// after the model downsizes anything larger than ~1.15 megapixels (long edge
// capped around 1568px) to that ceiling first. This mirrors that resize step
// so the estimate matches what the API actually bills for a full-resolution
// phone photo, not the raw pixel count. Display-only — never used for billing.
const MAX_IMAGE_PIXELS = 1_150_000;
const TOKENS_PER_PIXEL = 1 / 750;

// Fixed overhead for the system + task instructions + JSON output schema
// that rides on every request regardless of photo count.
const PROMPT_OVERHEAD_TOKENS = 250;
// Rough per-item output cost (title/quantity/category/tags as JSON) plus a
// fixed wrapper allowance, used only to size the cost preview shown before
// a batch run — not a promise about what the model will actually return.
const OUTPUT_TOKENS_PER_ITEM = 60;
const OUTPUT_OVERHEAD_TOKENS = 40;
// A 250-char description costs roughly this many output tokens (English
// prose runs ~4 chars/token); folded into the cost preview alongside items.
const DESCRIPTION_TOKENS_ESTIMATE = 70;
const DEFAULT_ITEM_ESTIMATE = 6;

// Per-million-token list prices for claude-haiku-4-5 (input, output), in USD.
const PRICE_PER_MTOK = { input: 1.0, output: 5.0 };

const ITEM_CAP = 40;
const TITLE_MAX = 100;
const CATEGORY_MAX = 30;
const TAGS_MAX = 10;
const TAG_MAX = 30;
const DESCRIPTION_MAX = 250;

/** Downsizes (width, height) to the model's effective resolution ceiling,
 * preserving aspect ratio. Pixel counts at or under the ceiling pass through
 * unchanged. */
function effectiveDimensions(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return { width: 0, height: 0 };
  const pixels = w * h;
  if (pixels <= MAX_IMAGE_PIXELS) return { width: w, height: h };
  const scale = Math.sqrt(MAX_IMAGE_PIXELS / pixels);
  return { width: w * scale, height: h * scale };
}

/** Estimated input tokens for one image at its given pixel dimensions. */
function estimateImageTokens(width, height) {
  const { width: w, height: h } = effectiveDimensions(width, height);
  return Math.ceil(w * h * TOKENS_PER_PIXEL);
}

/** System + user instructions for one container's identification pass.
 * photoCount is folded into the wording so the model knows whether it's
 * looking at one view of the container or several. */
function buildPrompt(photoCount) {
  const n = Number.isFinite(photoCount) && photoCount > 0 ? Math.floor(photoCount) : 1;
  const system =
    "You catalog the contents of storage containers (boxes, bins, shelves) from photos for a home inventory app. " +
    "List each distinct physical item you can identify. Group identical items together with a quantity rather than " +
    "listing duplicates separately. Skip anything you cannot identify with reasonable confidence — it is better to " +
    "omit an item than to guess. Do not include the container itself, packaging, or the surface it sits on as items. " +
    "Also write a short description of the container's contents as a whole, at most 250 characters — one or two " +
    "plain sentences a person could read as a quick note, not a restatement of the item list.";
  const instructions =
    n > 1
      ? `These ${n} photos show the same container from different angles or at different times. Combine what you see across all of them into one item list — do not report the same physical item twice just because it appears in more than one photo.`
      : "This photo shows one container. List the items visible in it.";
  return { system, instructions };
}

/** JSON schema for structured output — one call site (ai.js) needs this
 * verbatim, but it's static data with no network involved, so it lives here
 * alongside the rest of the request-shaping logic. */
function draftOutputSchema() {
  return {
    type: "object",
    properties: {
      description: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            quantity: { type: "integer" },
            category: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["title"],
          additionalProperties: false,
        },
      },
    },
    required: ["items", "description"],
    additionalProperties: false,
  };
}

function sanitizeTitle(raw) {
  return typeof raw === "string" ? raw.trim().slice(0, TITLE_MAX) : "";
}

function sanitizeQuantity(raw) {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function sanitizeCategory(raw) {
  return typeof raw === "string" ? raw.trim().toLowerCase().slice(0, CATEGORY_MAX) : "";
}

function sanitizeTags(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const tag of raw) {
    if (typeof tag !== "string") continue;
    const trimmed = tag.trim().slice(0, TAG_MAX);
    if (trimmed) out.push(trimmed);
    if (out.length >= TAGS_MAX) break;
  }
  return out;
}

function sanitizeDescription(raw) {
  return typeof raw === "string" ? raw.trim().slice(0, DESCRIPTION_MAX) : "";
}

/** Parses the model's structured-output JSON text into a sanitized
 * { items, description }. Defensive even though output_config.format
 * constrains the shape — a malformed or truncated response must degrade to
 * an empty result, never throw partway through a batch run. */
function parseDraft(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { items: [], description: "" };
  }
  const rawItems = parsed && Array.isArray(parsed.items) ? parsed.items : [];
  const items = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") continue;
    const title = sanitizeTitle(raw.title);
    if (!title) continue;
    items.push({
      title,
      quantity: sanitizeQuantity(raw.quantity),
      category: sanitizeCategory(raw.category),
      tags: sanitizeTags(raw.tags),
    });
    if (items.length >= ITEM_CAP) break;
  }
  const description = sanitizeDescription(parsed && parsed.description);
  return { items, description };
}

/** Cost/token estimate for identifying one container from its photos.
 * photos: [{width, height}]. Estimate-only, shown in the UI before a batch
 * run — not derived from or compared against the API's actual usage. */
function estimateContainerCost(photos) {
  const list = Array.isArray(photos) ? photos : [];
  const imageTokens = list.reduce((sum, p) => sum + estimateImageTokens(p && p.width, p && p.height), 0);
  const inputTokens = imageTokens + PROMPT_OVERHEAD_TOKENS;
  const outputTokens = OUTPUT_TOKENS_PER_ITEM * DEFAULT_ITEM_ESTIMATE + OUTPUT_OVERHEAD_TOKENS + DESCRIPTION_TOKENS_ESTIMATE;
  const usd = (inputTokens * PRICE_PER_MTOK.input + outputTokens * PRICE_PER_MTOK.output) / 1_000_000;
  return { inputTokens, outputTokens, usd };
}

/** Per-container plus grand-total estimate for a selected batch.
 * containers: [{id, photos: [{width, height}]}]. */
function planBatch(containers) {
  const list = Array.isArray(containers) ? containers : [];
  const perContainer = list.map((c) => ({ id: c && c.id, ...estimateContainerCost(c && c.photos) }));
  const total = perContainer.reduce(
    (acc, c) => ({
      inputTokens: acc.inputTokens + c.inputTokens,
      outputTokens: acc.outputTokens + c.outputTokens,
      usd: acc.usd + c.usd,
      containerCount: acc.containerCount + 1,
    }),
    { inputTokens: 0, outputTokens: 0, usd: 0, containerCount: 0 },
  );
  return { perContainer, total };
}

export { MODEL, buildPrompt, draftOutputSchema, parseDraft, estimateImageTokens, estimateContainerCost, planBatch };
