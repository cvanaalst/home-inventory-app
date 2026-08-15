// Router, boot, cross-view orchestration. A view module never imports
// another view module — cross-view actions are passed in as callbacks from
// here. In Phase 0 the view-*.js modules are empty stubs; this file owns
// all chrome (tab bar, pushed-view navigation, theme, language).

import { state } from "./state.js";
import { setLang, applyTranslations, t } from "./i18n.js";
import { renderIcons } from "./icons.js";
import { VERSION } from "./version.js";
import { getMeta, setMeta, requestPersistentStorage } from "./db.js";
import { initSearchView } from "./view-search.js";
import { initItemsView } from "./view-items.js";
import { initLocationsView } from "./view-locations.js";
import { initDetailView } from "./view-detail.js";
import { initReportView } from "./view-report.js";
import { initHelpView } from "./view-help.js";
import { initSettingsView } from "./view-settings.js";
import { initTrashView } from "./view-trash.js";
import { initSyncLogView } from "./view-synclog.js";
import { checkRedirectReturn } from "./sync.js";

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

function navigateTab(id, { replace = false } = {}) {
  if (!TAB_TARGETS.includes(id)) return;
  showView(id);
  setActiveTab(id);
  const entry = { tab: id };
  if (replace) history.replaceState(entry, "", `#${id}`);
  else history.pushState(entry, "", `#${id}`);
  document.getElementById("view-container").scrollTop = 0;
  viewControllers[id]?.show({});
}

function pushView(id, params = {}) {
  if (!PUSH_TARGETS.includes(id)) return;
  showView(id);
  history.pushState({ view: id, fromTab: currentTab, params }, "", `#${id}`);
  document.getElementById("view-container").scrollTop = 0;
  viewControllers[id]?.show(params);
}

function onPopState(event) {
  const s = event.state;
  if (s?.view) {
    showView(s.view);
    viewControllers[s.view]?.show(s.params || {});
  } else if (s?.tab) {
    showView(s.tab);
    setActiveTab(s.tab);
    viewControllers[s.tab]?.show({});
  } else {
    // No state (e.g. first load without a hash) — land on the default tab.
    showView(DEFAULT_TAB);
    setActiveTab(DEFAULT_TAB);
    viewControllers[DEFAULT_TAB]?.show({});
  }
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

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.error("Service worker registration failed:", err);
    });
  });
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

  const initial = TAB_TARGETS.includes(location.hash.slice(1))
    ? location.hash.slice(1)
    : DEFAULT_TAB;
  showView(initial);
  setActiveTab(initial);
  history.replaceState({ tab: initial }, "", `#${initial}`);
  viewControllers[initial]?.show({});

  // Correct language/theme/density once the stored preference has loaded.
  await loadPrefs();
  applyLang();
  applyTheme();
  applyDensity();
}

boot();
