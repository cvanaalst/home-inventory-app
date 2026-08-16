// Router, boot, cross-view orchestration. A view module never imports
// another view module — cross-view actions are passed in as callbacks from
// here. In Phase 0 the view-*.js modules are empty stubs; this file owns
// all chrome (tab bar, pushed-view navigation, theme, language).

import { state } from "./state.js";
import { setLang, applyTranslations, t } from "./i18n.js";
import { renderIcons } from "./icons.js";
import { VERSION } from "./version.js";
import { getMeta, setMeta, requestPersistentStorage, getAllItems } from "./db.js";
import { initSearchView } from "./view-search.js";
import { initItemsView } from "./view-items.js";
import { initLocationsView } from "./view-locations.js";
import { initLabelsView } from "./view-labels.js";
import { initCaptureView } from "./view-capture.js";
import { initReviewView } from "./view-review.js";
import { initDetailView } from "./view-detail.js";
import { initReportView } from "./view-report.js";
import { initHelpView } from "./view-help.js";
import { initSettingsView } from "./view-settings.js";
import { initTrashView } from "./view-trash.js";
import { initSyncLogView } from "./view-synclog.js";
import { checkRedirectReturn } from "./sync.js";
import { toast } from "./ui.js";

const TAB_TARGETS = ["view-search", "view-items", "view-capture", "view-review", "view-more"];
const PUSH_TARGETS = [
  "view-detail",
  "view-locations",
  "view-labels",
  "view-report",
  "view-settings",
  "view-trash",
  "view-synclog",
  "view-help",
  "view-about",
];
const ALL_VIEWS = [...TAB_TARGETS, ...PUSH_TARGETS];
const DEFAULT_TAB = "view-search";

let currentTab = DEFAULT_TAB;

// ---------- persisted prefs (db.js meta store) ----------
//
// IndexedDB is inherently async, so boot() applies a synchronous best-guess
// theme first (avoids a flash of the wrong theme) and corrects it once the
// stored preference has loaded.

async function loadPrefs() {
  const lang = await getMeta("lang", "nl");
  const theme = await getMeta("theme", "auto");
  const density = await getMeta("density", "comfortable");
  if (lang === "nl" || lang === "en") state.lang = lang;
  if (["auto", "dark", "light", "midnight", "paper"].includes(theme)) state.theme = theme;
  if (["comfortable", "compact"].includes(density)) state.density = density;
}

// ---------- theme ----------

function resolvedTheme() {
  if (state.theme !== "auto") return state.theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme() {
  const resolved = resolvedTheme();
  document.documentElement.setAttribute("data-theme", resolved);
  const meta = document.querySelector('meta[name="theme-color"]');
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  if (meta && bg) meta.setAttribute("content", bg);
  document.querySelectorAll("[data-theme-choice]").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-theme-choice") === state.theme);
  });
}

function setTheme(theme) {
  state.theme = theme;
  applyTheme();
  setMeta("theme", theme);
  announce(t(`settings.theme.${theme}`));
}

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (state.theme === "auto") applyTheme();
});

// ---------- density ----------

function applyDensity() {
  document.getElementById("app").setAttribute("data-density", state.density);
  document.querySelectorAll("[data-density-choice]").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-density-choice") === state.density);
  });
}

function setDensity(density) {
  state.density = density;
  applyDensity();
  setMeta("density", density);
  announce(t(`settings.density.${density}`));
}

// ---------- language ----------

function applyLang() {
  setLang(state.lang);
  document.documentElement.lang = state.lang;
  applyTranslations();
  renderIcons();
  document.querySelectorAll("[data-lang-choice]").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-lang-choice") === state.lang);
  });
  applyTheme(); // re-picks up localized theme-name labels' active state
  renderAbout();
}

function setLanguage(lang) {
  state.lang = lang;
  applyLang();
  setMeta("lang", lang);
  announce(t("settings.language." + lang));
}

// ---------- about ----------

function renderAbout() {
  const el = document.getElementById("about-version-line");
  if (!el) return;
  el.textContent = t("about.line", VERSION);
}

// ---------- aria-live announcements ----------

function announce(message) {
  const region = document.getElementById("live-region");
  if (!region) return;
  region.textContent = "";
  // Force a DOM mutation even if the text repeats.
  requestAnimationFrame(() => {
    region.textContent = message;
  });
}

// ---------- unhandled write failures ----------
//
// Every write in this app is optimistic (§9): the UI paints the new value
// before the write's promise resolves, and no view awaits it inside a
// try/catch (patchItem/patchContainer and their equivalents just chain
// .then, or await plainly). That's the right call for a snappy local-first
// UI on the happy path, but it means a REJECTED write — quota exceeded, a
// blocked/corrupted IndexedDB connection — currently has no path to the
// user at all: it dies as a console-only unhandled rejection while the
// screen still shows the edit as if it landed. This is the one place that
// can catch it project-wide instead of adding try/catch to every call site.
window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled rejection:", event.reason);
  toast(t("toast.writeFailed"), "error");
});

// ---------- app badge (§8.16 polish) ----------
//
// This app has no due-reminder concept, so the badge instead counts what's
// actually left in an unfinished state: containers not yet marked
// confirmed (every new container starts as "captured" — see view-search.js)
// plus any draft items. Called from every router entry point below rather
// than from one central "data changed" funnel — this app doesn't have one —
// so it stays roughly fresh without every view needing to know about it.
async function updateAppBadge() {
  if (!navigator.setAppBadge) return;
  try {
    const items = await getAllItems();
    const pending = items.filter(
      (r) =>
        !r.deletedAt &&
        ((r.type === "container" && r.status !== "confirmed") || (r.type === "item" && r.state === "draft")),
    ).length;
    if (pending > 0) await navigator.setAppBadge(pending);
    else await navigator.clearAppBadge();
  } catch {
    // Unsupported, or the app isn't installed — not worth reporting.
  }
}

// ---------- router ----------
//
// Each view module exports init...View({ ...callbacks }) which wires its
// DOM once and returns { show(params) }. The registry below is populated at
// boot; the router calls controller.show(params) every time that view
// becomes active, per the widget pattern (BLUEPRINT.md §9).

const viewControllers = {};

function showView(id) {
  ALL_VIEWS.forEach((viewId) => {
    const el = document.getElementById(viewId);
    if (el) el.hidden = viewId !== id;
  });
}

function setActiveTab(id) {
  currentTab = id;
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-nav-tab") === id);
  });
}

/** Runs `mutate` (which may be async) as a View Transition when the browser
 * supports it and the user hasn't asked for reduced motion, else runs it
 * plain. Re-checks the media query on every call rather than caching it, so
 * a mid-session OS setting change is picked up on the very next navigation. */
function runTransition(mutate) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (document.startViewTransition && !reduced) {
    const transition = document.startViewTransition(mutate);
    // Starting a transition while one is still running ABORTS the old one,
    // and every one of its promises then rejects. Unhandled, that surfaces
    // as "InvalidStateError: Transition was aborted" on any quick double
    // navigation. The abort itself is harmless — the swap still ran — so
    // the rejections are swallowed deliberately rather than reported.
    const ignore = () => {};
    transition.finished.catch(ignore);
    transition.ready.catch(ignore);
    transition.updateCallbackDone.catch(ignore);
  } else {
    mutate();
  }
}

function navigateTab(id, { replace = false } = {}) {
  if (!TAB_TARGETS.includes(id)) return;
  const entry = { tab: id };
  if (replace) history.replaceState(entry, "", `#${id}`);
  else history.pushState(entry, "", `#${id}`);
  runTransition(async () => {
    showView(id);
    setActiveTab(id);
    document.getElementById("view-container").scrollTop = 0;
    await viewControllers[id]?.show({});
  });
  updateAppBadge();
}

function pushView(id, params = {}) {
  if (!PUSH_TARGETS.includes(id)) return;
  history.pushState({ view: id, fromTab: currentTab, params }, "", `#${id}`);
  runTransition(async () => {
    showView(id);
    document.getElementById("view-container").scrollTop = 0;
    await viewControllers[id]?.show(params);
  });
  updateAppBadge();
}

function onPopState(event) {
  const s = event.state;
  runTransition(async () => {
    if (s?.view) {
      showView(s.view);
      await viewControllers[s.view]?.show(s.params || {});
    } else if (s?.tab) {
      showView(s.tab);
      setActiveTab(s.tab);
      await viewControllers[s.tab]?.show({});
    } else {
      // No state (e.g. first load without a hash) — land on the default tab.
      showView(DEFAULT_TAB);
      setActiveTab(DEFAULT_TAB);
      await viewControllers[DEFAULT_TAB]?.show({});
    }
  });
  updateAppBadge();
}

function wireNav() {
  document.querySelectorAll("[data-nav-tab]").forEach((btn) => {
    btn.addEventListener("click", () => navigateTab(btn.getAttribute("data-nav-tab")));
  });
  document.querySelectorAll("[data-nav-push]").forEach((btn) => {
    btn.addEventListener("click", () => pushView(btn.getAttribute("data-nav-push")));
  });
  document.querySelectorAll("[data-nav-back]").forEach((btn) => {
    btn.addEventListener("click", () => history.back());
  });
  window.addEventListener("popstate", onPopState);
}

function initViews() {
  const openContainer = (id) => pushView("view-detail", { containerId: id });
  viewControllers["view-search"] = initSearchView({ onOpenContainer: openContainer });
  viewControllers["view-items"] = initItemsView({ onOpenContainer: openContainer });
  viewControllers["view-locations"] = initLocationsView();
  viewControllers["view-labels"] = initLabelsView();
  viewControllers["view-capture"] = initCaptureView({ onOpenContainer: openContainer });
  viewControllers["view-review"] = initReviewView({ onOpenContainer: openContainer, onOpenSettings: () => pushView("view-settings") });
  viewControllers["view-detail"] = initDetailView({ onDeleted: () => history.back() });
  viewControllers["view-report"] = initReportView();
  viewControllers["view-help"] = initHelpView();
  viewControllers["view-settings"] = initSettingsView();
  viewControllers["view-trash"] = initTrashView();
  viewControllers["view-synclog"] = initSyncLogView();
}

function wireSettings() {
  document.querySelectorAll("[data-theme-choice]").forEach((btn) => {
    btn.addEventListener("click", () => setTheme(btn.getAttribute("data-theme-choice")));
  });
  document.querySelectorAll("[data-lang-choice]").forEach((btn) => {
    btn.addEventListener("click", () => setLanguage(btn.getAttribute("data-lang-choice")));
  });
  document.querySelectorAll("[data-density-choice]").forEach((btn) => {
    btn.addEventListener("click", () => setDensity(btn.getAttribute("data-density-choice")));
  });
}

// ---------- service worker ----------

/** Registers the service worker and offers a reload when a new build is
 * ready (§13.13, §15.2). Without this, a returning visitor keeps running
 * the old app until they happen to hard-reload — and they never will,
 * because the old app looks like it's working fine. sw.js deliberately
 * never calls skipWaiting() on install; the new worker waits until the
 * user agrees to the swap here, so it never hands an already-loaded page
 * assets from a different build mid-session. */
function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;

  let reloading = false;
  // The swap finishes by reloading exactly once. Guarding this matters: a
  // controllerchange during an already-running reload would loop the page.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });

  window.addEventListener("load", async () => {
    let registration;
    try {
      registration = await navigator.serviceWorker.register("./sw.js");
    } catch (err) {
      console.error("Service worker registration failed:", err);
      return;
    }

    // A build may already have been sitting in waiting since a previous visit.
    if (registration.waiting && navigator.serviceWorker.controller) {
      offerUpdate(registration.waiting);
    }

    registration.addEventListener("updatefound", () => {
      const incoming = registration.installing;
      if (!incoming) return;
      incoming.addEventListener("statechange", () => {
        // No controller means this is the FIRST install, not an update —
        // there is nothing yet for the user to reload into.
        if (incoming.state === "installed" && navigator.serviceWorker.controller) {
          offerUpdate(incoming);
        }
      });
    });

    // A long-lived tab would otherwise never ask again on its own. Re-check
    // whenever it comes back to the foreground, throttled so tab-flicking
    // doesn't hammer the server.
    let lastCheck = Date.now();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastCheck < 60000) return;
      lastCheck = Date.now();
      registration.update().catch(() => {
        /* offline, or the server is unreachable — try again next time */
      });
    });
  });
}

/** The reload prompt. Stays put until answered — a 5-second toast would be missed. */
function offerUpdate(worker) {
  toast(t("update.available"), "info", {
    actionLabel: t("update.reload"),
    duration: 0,
    onAction: () => {
      // The worker is waiting on purpose; tell it to take over. That fires
      // controllerchange above, which reloads into the new build as a whole.
      worker.postMessage({ type: "SKIP_WAITING" });
    },
  });
}

// ---------- special entry points (manifest shortcuts, share_target) ----------
//
// Neither of these is a plain tab hash — both need to land on a specific
// tab AND trigger something the normal TAB_TARGETS hash routing has no
// room for ("show this tab, then also open a form" / "...then also
// attach these photos"). Handled once, at boot, only: nothing inside the
// app ever navigates to either hash itself — they only ever arrive from
// outside (the OS long-press shortcut menu, the share sheet).

async function routeSpecialEntry() {
  if (location.hash === "#new-container") {
    showView("view-search");
    setActiveTab("view-search");
    history.replaceState({ tab: "view-search" }, "", "#view-search");
    await viewControllers["view-search"]?.show({});
    viewControllers["view-search"]?.openNewForm?.();
    return true;
  }
  if (location.hash === "#shared-photos") {
    // sw.js's share_target handler already stored the shared blobs and
    // redirected here — this just hands their ids to Capture. Consumed
    // immediately (set back to []) so a later reload of this same URL
    // (e.g. the user refreshes) can't re-attach the same photos twice.
    const mediaIds = await getMeta("pendingShareMediaIds", []);
    await setMeta("pendingShareMediaIds", []);
    showView("view-capture");
    setActiveTab("view-capture");
    history.replaceState({ tab: "view-capture" }, "", "#view-capture");
    await viewControllers["view-capture"]?.show({});
    if (mediaIds.length) viewControllers["view-capture"]?.attachSharedMedia?.(mediaIds);
    return true;
  }
  return false;
}

// ---------- boot ----------

async function boot() {
  // Best-guess theme + language immediately, from defaults — no flash of an
  // unstyled or untranslated shell while IndexedDB opens.
  applyLang();
  applyTheme();
  applyDensity();
  wireNav();
  wireSettings();
  initViews();

  registerServiceWorker();
  requestPersistentStorage(); // fire-and-forget, per BLUEPRINT.md §8.13

  // An OAuth redirect returns with its token in the URL fragment — the
  // same place the router below reads its initial tab from. This MUST run
  // (and be awaited) before that router code touches location.hash: its
  // own history.replaceState would otherwise silently overwrite the
  // fragment and destroy the token before checkRedirectReturn ever saw it
  // — a real bug this project hit in testing (§7).
  try {
    await checkRedirectReturn();
  } catch (err) {
    console.error("OAuth redirect could not be processed:", err);
  }

  if (!(await routeSpecialEntry())) {
    const initial = TAB_TARGETS.includes(location.hash.slice(1))
      ? location.hash.slice(1)
      : DEFAULT_TAB;
    showView(initial);
    setActiveTab(initial);
    history.replaceState({ tab: initial }, "", `#${initial}`);
    viewControllers[initial]?.show({});
  }
  updateAppBadge();

  // Correct language/theme/density once the stored preference has loaded.
  await loadPrefs();
  applyLang();
  applyTheme();
  applyDensity();
}

boot();
