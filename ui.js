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

// ────────────────────────────────────────────────────────────────────────
// swipe gestures — swipe-left to delete, swipe-right to pin (§9 Gestures).
// Pointer Events unify touch and mouse, so this is also drivable in tests.
// ────────────────────────────────────────────────────────────────────────

const SWIPE_REVEAL = 88;

/** attachSwipeActions(rowEl, { onSwipeLeft, onSwipeRight, threshold }).
 * rowEl must contain a direct child with class "swipe-content". A real drag
 * (beyond a few px) suppresses the click that would otherwise follow
 * pointerup, so a swipe never also triggers the row's own tap handler. */
export function attachSwipeActions(rowEl, { onSwipeLeft, onSwipeRight, threshold = 56 } = {}) {
  const content = rowEl.querySelector(".swipe-content");
  if (!content) return;

  let startX = 0;
  let dx = 0;
  let dragging = false;
  let dragged = false;

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
    content.setPointerCapture(e.pointerId);
    setX(0, false);
  });

  content.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    dx = e.clientX - startX;
    if (Math.abs(dx) > 8) dragged = true;
    const clamped = Math.max(-SWIPE_REVEAL, Math.min(SWIPE_REVEAL, dx));
    setX(clamped, false);
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
