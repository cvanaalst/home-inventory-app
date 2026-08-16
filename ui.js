// Toast, dialogs, focus trap, formatters, and shared widgets. Widgets that
// wrap a DOM element are created once by the view that owns them and reset
// per open — see BLUEPRINT.md §9 "The widget pattern".

import { locationPath } from "./db.js";

// ────────────────────────────────────────────────────────────────────────
// toast — undo-on-toast for reversible destructive actions (§8, §19.8).
// The actual write is deferred to the toast's expiry, so an undone action
// never happens at all.
// ────────────────────────────────────────────────────────────────────────

/** toast(message, kind, { actionLabel, onAction, onExpire, duration }).
 * `duration: 0` means the toast never expires on its own — for a prompt
 * like "a new version is ready", not an undo window, where auto-dismissing
 * would mean the offer to reload was simply never seen. An explicit 0 must
 * survive `opts.duration || 5000`, which would otherwise treat 0 as falsy
 * and silently default it back to 5 seconds. */
export function toast(message, kind = "info", opts = {}) {
  const { actionLabel, onAction, onExpire } = opts;
  const duration = opts.duration === 0 ? 0 : opts.duration || 5000;
  const root = document.getElementById("toast-root");
  if (!root) return;

  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");

  const msg = document.createElement("span");
  msg.className = "toast-message";
  msg.textContent = message;
  el.appendChild(msg);

  let settled = false;
  let timer = null;

  function dismiss() {
    el.remove();
  }

  function settle(fn) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    dismiss();
    fn?.();
  }

  if (actionLabel) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toast-action";
    btn.textContent = actionLabel;
    btn.addEventListener("click", () => settle(onAction));
    el.appendChild(btn);
  }

  root.appendChild(el);
  if (duration > 0) timer = setTimeout(() => settle(onExpire), duration);

  return { dismiss: () => settle(onAction) };
}

// ────────────────────────────────────────────────────────────────────────
// dialogs — confirmDialog/alertDialog return promises. Focus trap,
// Escape-to-close, visible focus ring (global :focus-visible covers the ring).
// ────────────────────────────────────────────────────────────────────────

function openDialog(messageHtmlOrText, buttons) {
  return new Promise((resolve) => {
    const root = document.getElementById("dialog-root");
    if (!root) return resolve(false);

    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    const box = document.createElement("div");
    box.className = "dialog-box";
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-modal", "true");

    const msg = document.createElement("div");
    msg.className = "dialog-message";
    msg.textContent = messageHtmlOrText;
    box.appendChild(msg);

    const actions = document.createElement("div");
    actions.className = "dialog-actions";

    const focusable = [];
    buttons.forEach(({ label, value, primary }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = primary ? "btn btn-primary" : "btn";
      btn.textContent = label;
      btn.addEventListener("click", () => close(value));
      actions.appendChild(btn);
      focusable.push(btn);
    });
    box.appendChild(actions);
    backdrop.appendChild(box);
    root.appendChild(backdrop);

    const previouslyFocused = document.activeElement;
    focusable[focusable.length - 1]?.focus();

    function onKeydown(e) {
      if (e.key === "Escape") {
        close(false);
      } else if (e.key === "Tab" && focusable.length) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeydown);

    function close(value) {
      document.removeEventListener("keydown", onKeydown);
      backdrop.remove();
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
      resolve(value);
    }

    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close(false);
    });
  });
}

export function confirmDialog(message, okLabel = "OK") {
  return openDialog(message, [
    { label: "Cancel", value: false },
    { label: okLabel, value: true, primary: true },
  ]);
}

export function alertDialog(message, okLabel = "OK") {
  return openDialog(message, [{ label: okLabel, value: undefined, primary: true }]).then(() => {});
}

/** openLightbox(url) — full-screen image viewer. Same backdrop-click /
 * Escape / focus-restore mechanics as openDialog, but with no buttons to
 * choose between, so it resolves nothing — callers just fire-and-forget. */
export function openLightbox(url) {
  const root = document.getElementById("dialog-root");
  if (!root) return;

  const backdrop = document.createElement("div");
  backdrop.className = "lightbox-backdrop";
  const img = document.createElement("img");
  img.className = "lightbox-img";
  img.src = url;
  img.alt = "";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "lightbox-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "×";
  backdrop.append(img, closeBtn);
  root.appendChild(backdrop);

  const previouslyFocused = document.activeElement;
  closeBtn.focus();

  function onKeydown(e) {
    if (e.key === "Escape") close();
  }
  document.addEventListener("keydown", onKeydown);

  function close() {
    document.removeEventListener("keydown", onKeydown);
    backdrop.remove();
    if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
  }

  closeBtn.addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
}

// ────────────────────────────────────────────────────────────────────────
// swipe gestures — swipe-left to delete, swipe-right to pin (§9 Gestures).
// Pointer Events unify touch and mouse, so this is also drivable in tests.
// ────────────────────────────────────────────────────────────────────────

const SWIPE_REVEAL = 88;

/** attachSwipeActions(rowEl, { onSwipeLeft, onSwipeRight, threshold }).
 * rowEl must contain a direct child with class "swipe-content". A real drag
 * (beyond a few px) suppresses the click that would otherwise follow
 * pointerup, so a swipe never also triggers the row's own tap handler.
 *
 * Pointer capture is deferred until that same few-px threshold is crossed,
 * not taken on pointerdown. Capturing eagerly would retarget the click
 * event a plain tap produces to `content` itself — a browser-standard but
 * easy-to-miss consequence of setPointerCapture — silently swallowing
 * clicks on every button/input nested in the row (confirmed against real
 * click delivery, not a synthetic .click() call, in both Chrome and
 * Safari: qty steppers, delete, move, and the fields-summary pill were all
 * unclickable). A plain tap never captures at all, so it hits the actual
 * element normally. */
export function attachSwipeActions(rowEl, { onSwipeLeft, onSwipeRight, threshold = 56 } = {}) {
  const content = rowEl.querySelector(".swipe-content");
  if (!content) return;

  let startX = 0;
  let dx = 0;
  let dragging = false;
  let dragged = false;
  let pointerId = null;

  function setX(x, animate) {
    content.style.transition = animate ? "transform 160ms ease-out" : "none";
    content.style.transform = `translateX(${x}px)`;
  }

  content.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    dragging = true;
    dragged = false;
    startX = e.clientX;
    dx = 0;
    pointerId = e.pointerId;
  });

  content.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    dx = e.clientX - startX;
    if (!dragged && Math.abs(dx) > 8) {
      dragged = true;
      content.setPointerCapture(pointerId);
    }
    if (dragged) {
      const clamped = Math.max(-SWIPE_REVEAL, Math.min(SWIPE_REVEAL, dx));
      setX(clamped, false);
    }
  });

  function end() {
    if (!dragging) return;
    dragging = false;
    if (dx <= -threshold && onSwipeLeft) onSwipeLeft();
    else if (dx >= threshold && onSwipeRight) onSwipeRight();
    setX(0, true);
    dx = 0;
  }

  content.addEventListener("pointerup", end);
  content.addEventListener("pointercancel", end);
  content.addEventListener(
    "click",
    (e) => {
      if (dragged) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );
}

// ────────────────────────────────────────────────────────────────────────
// skeleton loader — delayed placeholder rows for a view's first render
// (§6 polish). Delayed on purpose: an IndexedDB read finishes in a few
// milliseconds, so showing this immediately would flash it on every
// render and read as jank rather than progress — it appears only if the
// wait is long enough to have actually been noticed.
// ────────────────────────────────────────────────────────────────────────

const SKELETON_DELAY_MS = 180;

/** `skeletonGate(hostEl)` returns `{ begin(), end(seq) }` for a view to
 * wrap each async render with:
 *
 *   const seq = skeleton.begin();
 *   try { ...load + paint... } finally { skeleton.end(seq); }
 *
 * Only the FIRST render ever shows the skeleton (a returning visit to an
 * already-warm view shouldn't flash one), and only the newest in-flight
 * render may show or hide it — renders overlap (typing in a search box
 * stacks new ones on top of old), and without the sequence number a timer
 * left behind by an abandoned render would pop the skeleton back up over
 * a list that has already been painted, with nothing left to take it
 * down again. */
export function skeletonGate(hostEl, rowCount = 5) {
  let hasRenderedOnce = false;
  let renderSeq = 0;
  // The seq check alone only catches a NEWER render superseding an older
  // one — it does nothing when the SAME render's end() lands before its own
  // delayed timer fires (the common case: an IndexedDB read finishes well
  // under SKELETON_DELAY_MS). Without cancelling it, that timer still fires
  // later and shows the skeleton over content that's already painted, with
  // no later end() call left to hide it again.
  let pendingTimer = null;

  function show() {
    if (!hostEl.childElementCount) {
      hostEl.innerHTML = Array.from({ length: rowCount })
        .map(
          () =>
            '<div class="row-card skeleton-row"><span class="row-main">' +
            '<span class="skeleton-line skeleton-line--title"></span>' +
            '<span class="skeleton-line skeleton-line--meta"></span></span></div>',
        )
        .join("");
    }
    hostEl.hidden = false;
  }

  return {
    begin() {
      const seq = ++renderSeq;
      if (!hasRenderedOnce) {
        pendingTimer = setTimeout(() => {
          if (seq === renderSeq) show();
        }, SKELETON_DELAY_MS);
      }
      return seq;
    },
    end(seq) {
      hasRenderedOnce = true;
      if (seq === renderSeq) {
        clearTimeout(pendingTimer);
        hostEl.hidden = true;
      }
    },
  };
}

// ────────────────────────────────────────────────────────────────────────
// shared widgets / formatters
// ────────────────────────────────────────────────────────────────────────

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escapes a value for safe interpolation into an HTML template string. */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** Maps a container status to its badge CSS class. */
export function statusBadgeClass(status) {
  if (status === "confirmed") return "badge badge-ok";
  if (status === "drafted") return "badge badge-warn";
  return "badge";
}

const RESIZE_MAX_DIM = 1600;
const RESIZE_QUALITY = 0.85;

/** Downscales an image File/Blob to at most maxDim on its long edge and
 * re-encodes as JPEG, returning { blob, width, height }. One size only —
 * the same blob is both what's shown in the capture grid (via CSS) and what
 * gets sent to Claude, since nothing in the app needs a separate thumbnail
 * yet and the default cap already roughly matches the model's own resize
 * ceiling (aiplan.js's cost estimate assumes it). An image already at or
 * under the cap is re-encoded but not upscaled. */
export async function resizeImageToBlob(file, maxDim = RESIZE_MAX_DIM, quality = RESIZE_QUALITY) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  return { blob, width, height };
}

/** Fills a <select> with "— no location —" + every location's full path,
 * sorted. Used identically by the new-container form, the container-detail
 * location field, and the search view's browse filter. */
export function populateLocationSelect(selectEl, locations, selectedId, { noneLabel = "— " } = {}) {
  const sorted = [...locations].sort((a, b) => locationPath(a).localeCompare(locationPath(b), undefined, { numeric: true, sensitivity: "base" }));
  selectEl.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = noneLabel;
  selectEl.appendChild(none);
  for (const loc of sorted) {
    const opt = document.createElement("option");
    opt.value = loc.id;
    opt.textContent = locationPath(loc);
    selectEl.appendChild(opt);
  }
  selectEl.value = selectedId || "";
}
