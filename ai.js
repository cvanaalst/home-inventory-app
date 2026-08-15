// Network-only: calls the Anthropic API directly from the browser to draft
// container contents from photos. Imports aiplan.js for the pure
// prompt/parse/estimate logic; owns nothing but the fetch call and the
// API-key setting, the same split sync.js uses for the Drive OAuth client ID.

import { getMeta, setMeta } from "./db.js";
import { MODEL, buildPrompt, draftOutputSchema, parseDraft } from "./aiplan.js";

const API_KEY_META = "anthropicApiKey";
const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOKENS = 1536;

async function getApiKey() {
  return (await getMeta(API_KEY_META, "")) || "";
}

async function setApiKey(key) {
  await setMeta(API_KEY_META, String(key || "").trim());
}

async function hasApiKey() {
  return (await getApiKey()) !== "";
}

/** FileReader-based blob→base64 (no data: prefix). Browser fetch has no
 * built-in binary-to-base64 helper that works uniformly on Blobs. */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Sends one container's photos to Claude and returns a sanitized draft-item
 * list. photos: [{blob, mimeType}]. Never throws — every failure path
 * (no key configured, offline, API error, malformed response) resolves to
 * an { outcome } result so a batch run can continue past one bad container. */
async function identifyContainerPhotos(photos) {
  const list = Array.isArray(photos) ? photos.filter((p) => p && p.blob) : [];
  if (list.length === 0) return { outcome: "error", message: "No photos to identify." };

  const apiKey = await getApiKey();
  if (!apiKey) return { outcome: "skipped", reason: "no-api-key" };

  const { system, instructions } = buildPrompt(list.length);
  let imageBlocks;
  try {
    imageBlocks = await Promise.all(
      list.map(async (p) => ({
        type: "image",
        source: { type: "base64", media_type: p.mimeType || "image/jpeg", data: await blobToBase64(p.blob) },
      })),
    );
  } catch (err) {
    return { outcome: "error", message: err && err.message ? err.message : "Could not read photo data." };
  }

  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    output_config: { format: { type: "json_schema", schema: draftOutputSchema() } },
    messages: [{ role: "user", content: [...imageBlocks, { type: "text", text: instructions }] }],
  };

  let response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { outcome: "error", message: err && err.message ? err.message : "Network request failed." };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return { outcome: "error", message: `Unreadable response (HTTP ${response.status}).` };
  }

  if (!response.ok) {
    const message = (payload && payload.error && payload.error.message) || `Request failed (HTTP ${response.status}).`;
    return { outcome: "error", message };
  }
  if (payload.stop_reason === "refusal") {
    return { outcome: "error", message: "Claude declined to identify these photos." };
  }

  const textBlock = Array.isArray(payload.content) ? payload.content.find((b) => b.type === "text") : null;
  if (!textBlock) return { outcome: "error", message: "No response content." };

  return { outcome: "success", items: parseDraft(textBlock.text) };
}

export { getApiKey, setApiKey, hasApiKey, identifyContainerPhotos };
