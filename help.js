// Long-form help text as Markdown, per language. Rendered by markdown.js.
// Describes what the app can actually do right now — not a roadmap. Update
// this whenever a phase changes user-visible behaviour (BLUEPRINT.md §8.14).
//
// Each paragraph/bullet is one source line, since markdown.js is line-based.

const nl = `
## Wat deze app is
Voorraad is een app om bij te houden wat er in je containers (dozen, bakken, laden) zit en waar die containers staan. Alles werkt volledig offline, in je browser.

## Waar je gegevens staan
Alles wat je invoert blijft op dit apparaat, in de lokale opslag van deze browser (IndexedDB). Er is nog geen synchronisatie met andere apparaten — wat je op je telefoon invoert, zie je nu nog niet op je Mac, en andersom.

## Locaties, containers, items
Een **locatie** is een plek in huis (ruimte, opslagplek, sectie, naam) — bijvoorbeeld "Bureau Chris › Hoog Rek Links › Plank 3". Een **container** is een doos of bak met een code (zoals BOX-001) die aan een locatie hangt. Een **item** is één soort spullen in die container, met een aantal en een categorie.

## Zoeken en filteren
Het tabblad Zoeken doorzoekt items, containers en locaties tegelijk. Het tabblad Items laat alle items zien met filters op categorie en status, en een sorteervolgorde naar keuze.

## Dingen verwijderen
Verwijderen toont een melding onderaan met een knop "Ongedaan maken". Zolang die melding zichtbaar is (een paar seconden), gebeurt er nog niets — pas daarna wordt iets echt verwijderd. Een container verwijderen verwijdert ook de items erin. Let op: er is nu nog geen prullenbak-scherm om iets terug te halen nadat die melding is verdwenen.

## Weergave, thema en taal
Onder Meer › Instellingen kies je een thema (Donker, Licht, Middernacht, Papier of Automatisch), een taal (Nederlands of English), en een dichtheid: Comfortabel toont per rij ook locatie en categorie, Compact toont alleen de naam.

## Je gegevens exporteren
Onder Meer › Inzichten kun je je volledige gegevens exporteren als JSON (voor een volledige back-up) of als CSV (voor een spreadsheet). Deze export gebeurt volledig lokaal — er wordt niets naar internet gestuurd.
`.trim();

const en = `
## What this app is
Inventory is an app for tracking what's inside your containers (boxes, bins, drawers) and where those containers live. Everything works fully offline, in your browser.

## Where your data lives
Everything you enter stays on this device, in this browser's local storage (IndexedDB). There is no sync between devices yet — what you enter on your phone won't show up on your Mac, and vice versa.

## Locations, containers, items
A **location** is a place in your home (room, storage, section, name) — for example "Bureau Chris › Hoog Rek Links › Plank 3". A **container** is a box or bin with a code (like BOX-001) that belongs to a location. An **item** is one kind of thing in that container, with a quantity and a category.

## Search and filters
The Search tab searches items, containers, and locations at once. The Items tab lists every item with category and state filters, and a choice of sort order.

## Deleting things
Deleting shows a toast at the bottom with an "Undo" button. As long as that toast is visible (a few seconds), nothing has actually happened yet — only after it disappears is anything really deleted. Deleting a container also deletes the items inside it. Note: there is no trash screen yet to recover something after that toast has closed.

## Density, theme, and language
Under More › Settings you can choose a theme (Dark, Light, Midnight, Paper, or Auto), a language (Nederlands or English), and a density: Comfortable shows location and category on each row, Compact shows only the name.

## Exporting your data
Under More › Insights you can export your full data as JSON (a complete backup) or as CSV (for a spreadsheet). This export happens entirely on your device — nothing is sent over the internet.
`.trim();

export function helpContent(lang) {
  return lang === "en" ? en : nl;
}
