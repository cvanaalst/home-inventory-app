// NL/EN dictionaries + t() + applyTranslations(). No framework, no build step.
// Every user-visible string in the app must have an entry here in both
// languages — including strings that happen to be identical in both (proper
// nouns, native language names) so nothing renders as a bare key.

const dict = {
  nl: {
    "app.name": "Inventory",

    "tab.search": "Zoeken",
    "tab.items": "Items",
    "tab.capture": "Vastleggen",
    "tab.review": "Controleren",
    "tab.more": "Meer",

    "nav.back": "Terug",

    "view.search.title": "Zoeken",
    "view.items.title": "Items",
    "view.capture.title": "Vastleggen",
    "view.review.title": "Controleren",
    "view.more.title": "Meer",
    "view.detail.title": "Container",
    "view.locations.title": "Locaties",
    "view.labels.title": "Labels",
    "view.report.title": "Inzichten",
    "view.settings.title": "Instellingen",
    "view.trash.title": "Onlangs verwijderd",
    "view.synclog.title": "Synclogboek",
    "view.help.title": "Help",
    "view.about.title": "Over",

    "empty.generic": "Hier is nog niets.",
    "empty.comingSoon": "Komt in een latere fase.",

    "more.locations.sub": "Ruimtes en opslagplekken beheren",
    "more.labels.sub": "Labels afdrukken voor containers",
    "more.report.sub": "Totalen, per locatie",
    "more.trash.sub": "Verwijderde items herstellen",
    "more.synclog.sub": "Synchronisatiegeschiedenis",
    "more.settings.sub": "Thema, taal, opslag",
    "more.help.sub": "Uitleg over de app",
    "more.about.sub": "Versie-informatie",

    "settings.appearance": "Weergave",
    "settings.theme": "Thema",
    "settings.theme.auto": "Automatisch",
    "settings.theme.dark": "Donker",
    "settings.theme.light": "Licht",
    "settings.theme.midnight": "Middernacht",
    "settings.theme.paper": "Papier",
    "settings.language": "Taal",
    "settings.language.nl": "Nederlands",
    "settings.language.en": "English",
    "settings.density": "Dichtheid",
    "settings.density.comfortable": "Comfortabel",
    "settings.density.compact": "Compact",

    "about.line": "{designer} · {date} · build {build}",

    "action.create": "Aanmaken",
    "action.cancel": "Annuleren",
    "action.save": "Opslaan",
    "action.add": "Toevoegen",
    "action.delete": "Verwijderen",
    "action.confirm": "Bevestigen",
    "action.move": "Verplaatsen",

    "search.placeholder": "Zoek items, containers, locaties…",
    "search.newContainer": "＋ Nieuwe container (zonder foto)",
    "search.locationFilterAll": "Alle locaties",
    "search.browseAll": "Alle containers",
    "search.browseAt": "Containers bij {location}",
    "search.resultsItems": "Items",
    "search.resultsContainers": "Containers",
    "search.resultsLocations": "Locaties",
    "search.noResults": "Geen resultaten",
    "search.noContainers": "Nog geen containers.",
    "search.codePrefix": "Codeprefix",
    "search.codeRequired": "Code is verplicht",
    "search.codeExists": "{code} bestaat al",

    "detail.code": "Code",
    "detail.name": "Naam",
    "detail.location": "Locatie",
    "detail.noLocation": "— geen locatie —",
    "detail.notes": "Notities",
    "detail.addItem": "＋ Item toevoegen",
    "detail.deleteContainer": "Container verwijderen",
    "detail.markConfirmed": "✓ Markeer als bevestigd",
    "detail.confirmDrafts.one": "✓ Bevestig 1 conceptitem",
    "detail.confirmDrafts": "✓ Bevestig {n} conceptitems",
    "detail.itemsCount.one": "Items (1)",
    "detail.itemsCount": "Items ({n})",
    "detail.itemsEmpty": "Nog geen items — voeg er hieronder een toe.",
    "detail.notFound": "Container niet gevonden.",

    "item.description": "Omschrijving",
    "item.category": "Categorie",
    "item.link": "Link / datasheet",
    "item.moveTo": "Verplaats naar container…",
    "item.draft": "concept",

    "items.filterPlaceholder": "🔎 Items filteren…",
    "items.state.all": "Status: alle",
    "items.state.confirmed": "bevestigd",
    "items.state.draft": "concept",
    "items.categoryAll": "Categorie: alle",
    "items.count.one": "1 item",
    "items.count": "{n} items",
    "items.empty": "Geen items komen overeen met de filters.",

    "sort.updatedDesc": "Sorteer: laatst gewijzigd",
    "sort.titleAsc": "Sorteer: naam A–Z",
    "sort.quantityDesc": "Sorteer: aantal (hoog–laag)",

    "locations.add": "＋ Locatie toevoegen",
    "locations.room": "Ruimte",
    "locations.storage": "Opslag (optioneel)",
    "locations.section": "Sectie (optioneel)",
    "locations.name": "Naam",
    "locations.empty": "Nog geen locaties.",
    "locations.noRoom": "(geen ruimte)",
    "locations.containerCount.one": "1 container",
    "locations.containerCount": "{n} containers",
    "locations.nameRequired": "Naam is verplicht",

    "toast.itemDeleted": "Item verwijderd",
    "toast.containerDeleted": "Container verwijderd",
    "toast.locationDeleted": "Locatie verwijderd",
    "toast.undo": "Ongedaan maken",

    "report.stats.locations": "Locaties",
    "report.stats.containers": "Containers",
    "report.stats.items": "Items",
    "report.stats.pinned": "Vastgepind",
    "report.stats.drafts": "Conceptitems",
    "report.categories.title": "Per categorie",
    "report.categories.empty": "Nog geen categorieën.",
    "report.categories.uncategorized": "(geen categorie)",
    "report.activity.title": "Nieuwe items, per week",
    "report.tags.title": "Labels",
    "report.tags.empty": "Nog geen labels.",
    "report.export.title": "Exporteren",
    "report.export.json": "Exporteer JSON (volledige back-up)",
    "report.export.csv": "Exporteer CSV (spreadsheet)",
    "report.print.title": "Voorraadoverzicht",
    "report.print.button": "Overzicht afdrukken",
    "report.print.noLocation": "Geen locatie",
    "report.print.noItems": "Geen items",
    "report.print.containersLabel": "containers",
    "report.print.itemsLabel": "items",
    "report.print.empty": "Nog geen containers om af te drukken.",
    "detail.printContainer": "Deze container afdrukken",

    "settings.storage.title": "Opslag",
    "settings.storage.usage": "{used} van {quota} gebruikt",
    "settings.storage.unsupported": "Opslaggebruik is niet beschikbaar in deze browser.",
    "settings.storage.persisted": "Opslag is duurzaam — de browser ruimt gegevens niet automatisch op.",
    "settings.storage.notPersisted": "Opslag is nog niet duurzaam gemaakt.",
    "settings.storage.persistBtn": "Duurzame opslag aanvragen",
    "settings.storage.persistGranted": "Duurzame opslag toegekend.",
    "settings.storage.persistDenied": "Duurzame opslag geweigerd door de browser.",
  },
  en: {
    "app.name": "Inventory",

    "tab.search": "Search",
    "tab.items": "Items",
    "tab.capture": "Capture",
    "tab.review": "Review",
    "tab.more": "More",

    "nav.back": "Back",

    "view.search.title": "Search",
    "view.items.title": "Items",
    "view.capture.title": "Capture",
    "view.review.title": "Review",
    "view.more.title": "More",
    "view.detail.title": "Container",
    "view.locations.title": "Locations",
    "view.labels.title": "Labels",
    "view.report.title": "Insights",
    "view.settings.title": "Settings",
    "view.trash.title": "Recently deleted",
    "view.synclog.title": "Sync log",
    "view.help.title": "Help",
    "view.about.title": "About",

    "empty.generic": "Nothing here yet.",
    "empty.comingSoon": "Coming in a later phase.",

    "more.locations.sub": "Manage rooms & storage places",
    "more.labels.sub": "Print labels for containers",
    "more.report.sub": "Totals, by location",
    "more.trash.sub": "Restore deleted items",
    "more.synclog.sub": "Sync history",
    "more.settings.sub": "Theme, language, storage",
    "more.help.sub": "How the app works",
    "more.about.sub": "Version information",

    "settings.appearance": "Appearance",
    "settings.theme": "Theme",
    "settings.theme.auto": "Auto",
    "settings.theme.dark": "Dark",
    "settings.theme.light": "Light",
    "settings.theme.midnight": "Midnight",
    "settings.theme.paper": "Paper",
    "settings.language": "Language",
    "settings.language.nl": "Nederlands",
    "settings.language.en": "English",
    "settings.density": "Density",
    "settings.density.comfortable": "Comfortable",
    "settings.density.compact": "Compact",

    "about.line": "{designer} · {date} · build {build}",

    "action.create": "Create",
    "action.cancel": "Cancel",
    "action.save": "Save",
    "action.add": "Add",
    "action.delete": "Delete",
    "action.confirm": "Confirm",
    "action.move": "Move",

    "search.placeholder": "Search items, containers, locations…",
    "search.newContainer": "＋ New container (no photo)",
    "search.locationFilterAll": "All locations",
    "search.browseAll": "All containers",
    "search.browseAt": "Containers at {location}",
    "search.resultsItems": "Items",
    "search.resultsContainers": "Containers",
    "search.resultsLocations": "Locations",
    "search.noResults": "No matches",
    "search.noContainers": "No containers yet.",
    "search.codePrefix": "Code prefix",
    "search.codeRequired": "Code is required",
    "search.codeExists": "{code} already exists",

    "detail.code": "Code",
    "detail.name": "Name",
    "detail.location": "Location",
    "detail.noLocation": "— no location —",
    "detail.notes": "Notes",
    "detail.addItem": "＋ Add item",
    "detail.deleteContainer": "Delete container",
    "detail.markConfirmed": "✓ Mark as confirmed",
    "detail.confirmDrafts.one": "✓ Confirm 1 drafted item",
    "detail.confirmDrafts": "✓ Confirm {n} drafted items",
    "detail.itemsCount.one": "Items (1)",
    "detail.itemsCount": "Items ({n})",
    "detail.itemsEmpty": "No items yet — add one below.",
    "detail.notFound": "Container not found.",

    "item.description": "Description",
    "item.category": "Category",
    "item.link": "Link / datasheet",
    "item.moveTo": "Move to container…",
    "item.draft": "draft",

    "items.filterPlaceholder": "🔎 Filter items…",
    "items.state.all": "State: all",
    "items.state.confirmed": "confirmed",
    "items.state.draft": "draft",
    "items.categoryAll": "Category: all",
    "items.count.one": "1 item",
    "items.count": "{n} items",
    "items.empty": "No items match the filters.",

    "sort.updatedDesc": "Sort: last updated",
    "sort.titleAsc": "Sort: name A–Z",
    "sort.quantityDesc": "Sort: quantity (high–low)",

    "locations.add": "＋ Add location",
    "locations.room": "Room",
    "locations.storage": "Storage (optional)",
    "locations.section": "Section (optional)",
    "locations.name": "Name",
    "locations.empty": "No locations yet.",
    "locations.noRoom": "(no room)",
    "locations.containerCount.one": "1 container",
    "locations.containerCount": "{n} containers",
    "locations.nameRequired": "Name is required",

    "toast.itemDeleted": "Item deleted",
    "toast.containerDeleted": "Container deleted",
    "toast.locationDeleted": "Location deleted",
    "toast.undo": "Undo",

    "report.stats.locations": "Locations",
    "report.stats.containers": "Containers",
    "report.stats.items": "Items",
    "report.stats.pinned": "Pinned",
    "report.stats.drafts": "Drafted items",
    "report.categories.title": "By category",
    "report.categories.empty": "No categories yet.",
    "report.categories.uncategorized": "(no category)",
    "report.activity.title": "New items, per week",
    "report.tags.title": "Tags",
    "report.tags.empty": "No tags yet.",
    "report.export.title": "Export",
    "report.export.json": "Export JSON (full backup)",
    "report.export.csv": "Export CSV (spreadsheet)",
    "report.print.title": "Inventory overview",
    "report.print.button": "Print overview",
    "report.print.noLocation": "No location",
    "report.print.noItems": "No items",
    "report.print.containersLabel": "containers",
    "report.print.itemsLabel": "items",
    "report.print.empty": "No containers to print yet.",
    "detail.printContainer": "Print this container",

    "settings.storage.title": "Storage",
    "settings.storage.usage": "{used} of {quota} used",
    "settings.storage.unsupported": "Storage usage isn't available in this browser.",
    "settings.storage.persisted": "Storage is persistent — the browser won't automatically clear data.",
    "settings.storage.notPersisted": "Storage hasn't been made persistent yet.",
    "settings.storage.persistBtn": "Request persistent storage",
    "settings.storage.persistGranted": "Persistent storage granted.",
    "settings.storage.persistDenied": "Persistent storage denied by the browser.",
  },
};

let currentLang = "nl";

export function setLang(lang) {
  if (lang !== "nl" && lang !== "en") return;
  currentLang = lang;
}

export function getLang() {
  return currentLang;
}

/** t(key, vars) — interpolates {var} placeholders. Falls back to the key
 * itself (visibly broken, on purpose) if the key is missing so a missing
 * translation is never silently swallowed. */
export function t(key, vars) {
  const entry = dict[currentLang]?.[key] ?? dict.nl[key] ?? key;
  if (!vars) return entry;
  return entry.replace(/\{(\w+)\}/g, (_, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : `{${name}}`,
  );
}

/** tCount(key, n) — picks `key.one` for n === 1, `key` otherwise. */
export function tCount(key, n) {
  return n === 1 ? t(`${key}.one`, { n }) : t(key, { n });
}

/** Walks the DOM applying data-i18n / data-i18n-placeholder / data-i18n-aria. */
export function applyTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
  });
  root.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
  });
}

/** Test helper: every key present in one language must exist in the other. */
export function dictionaryKeys() {
  return { nl: Object.keys(dict.nl), en: Object.keys(dict.en) };
}
