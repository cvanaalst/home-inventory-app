// Long-form help text as Markdown, per language. Rendered by markdown.js.
// Describes what the app can actually do right now — not a roadmap. Update
// this whenever a phase changes user-visible behaviour (BLUEPRINT.md §8.14).
//
// Each paragraph/bullet is one source line, since markdown.js is line-based.

const nl = `
## Wat deze app is
Voorraad is een app om bij te houden wat er in je containers (dozen, bakken, laden) zit en waar die containers staan. Alles werkt volledig offline, in je browser — een internetverbinding is alleen nodig voor AI-herkenning en synchroniseren.

## Locaties, containers, items
Een **locatie** is een plek in huis: ruimte, opslagplek, sectie en optioneel een naam — bijvoorbeeld "Bureau Chris › Hoog Rek Links › Plank 3". Een **container** is een doos of bak met een code (zoals BOX-0001) die aan zo'n locatie hangt. Een **item** is één soort spullen in die container, met een aantal, een categorie, en optioneel een link en losse specs (extra veld/waarde-paren).

## Een container vastleggen
Het tabblad Vastleggen opent altijd met "Kies container" — kies een bestaande container of maak direct een nieuwe aan (zonder dat je meteen een foto nodig hebt). Voeg foto's toe met "Foto's toevoegen": je kunt zowel een nieuwe foto maken als een bestaande uit je fotobibliotheek kiezen. Staat "Ook AI laten herkennen" aan, dan komt de container in de wachtrij van het tabblad Controleren.

## Automatisch herkennen (AI)
Het tabblad Controleren toont containers die op AI-herkenning wachten. Selecteer er één of meerdere en klik "Herkennen" — de geschatte kosten worden getoond voordat je bevestigt. De AI stelt conceptitems voor (naam, aantal, categorie); die verschijnen onderin als concepten totdat je ze bevestigt. Je kunt dit ook los per container doen: in het containerscherm staat dezelfde "Herkennen"-knop zodra er foto's aan die container hangen. AI-herkenning vereist een Anthropic API-sleutel (zie Instellingen).

## Een container beheren
Open een container om de code te hernoemen, naam/locatie/notities aan te passen, foto's toe te voegen of te verwijderen, en items toe te voegen of te bewerken (met een stappen-teller voor het aantal). Vanuit dit scherm kun je ook:
- de containerinhoud afdrukken
- alle items kopiëren naar een andere, bestaande of nieuwe container
- de container verwijderen

## Zoeken en filteren
Het tabblad Zoeken doorzoekt items, containers en locaties tegelijk. Zonder zoekterm blader je door alle containers, gegroepeerd per locatie; filter op ruimte, ruimte + opslagplek, of ruimte + opslagplek + sectie, en/of op categorie. De camera-knop schakelt naar een fotoweergave met een tegel per foto — een container met meerdere foto's toont ze allemaal, niet alleen de eerste. Het tabblad Items laat alle items zien met filters op categorie en status, een sorteervolgorde naar keuze, en een stappen-teller om het aantal direct aan te passen.

## Locaties en containers in bulk aanmaken
Onder Meer › Locaties beheer je de hiërarchie van ruimte, opslagplek, sectie en naam; "Maak een reeks" maakt in één keer een doorlopende reeks aan (bijvoorbeeld "Plank {n}" van 1 tot 10). Onder Meer › Containers in bulk aanmaken maak je op dezelfde manier in één keer een reeks containercodes aan (bijvoorbeeld BOX-0006 t/m BOX-0020), automatisch doorgenummerd vanaf de eerstvolgende vrije — zonder naam of locatie, die stel je later per container in.


## Labels afdrukken
Onder Meer › Labels selecteer je containers en kies je een velformaat (een aantal Avery-formaten of gewoon blanco papier). Heb je al een deel van een vel gebruikt? Vul in hoeveel labels je wilt overslaan — de nieuwe labels beginnen na die posities, zodat je geen half vel hoeft weg te gooien.

## Inzichten
Onder Meer › Inzichten zie je totalen (locaties, containers, items, vastgepind, conceptitems), een verdeling per categorie, en nieuwe items per week. Je kunt je volledige gegevens exporteren als JSON (volledige back-up) of CSV (spreadsheet), en een afdrukbaar overzicht printen — dit gebeurt allemaal volledig lokaal.

## Verwijderen en de prullenbak
Verwijderen toont eerst een melding onderaan met "Ongedaan maken" — pas als die melding verdwijnt, wordt iets echt verwijderd. Een container verwijderen verwijdert ook de items erin. Onder Meer › Onlangs verwijderd vind je alles wat daarna nog is verwijderd: herstel het, of verwijder het voorgoed.

## Synchroniseren met Google Drive
Onder Meer › Instellingen › Synchroniseren koppel je je Google Drive-account. "Nu synchroniseren" voegt de gegevens van je apparaten automatisch samen; "Nu back-uppen" maakt een moment-opname die je later kunt terugzetten (samenvoegen met je huidige gegevens, of alles vervangen). Onder Meer › Synclogboek zie je de geschiedenis van elke sync-, back-up- en herstelactie, inclusief eventuele fouten.

## Weergave, thema en taal
Onder Meer › Instellingen kies je een thema (Donker, Licht, Middernacht, Papier of Automatisch), een taal (Nederlands of English), en een dichtheid: Comfortabel toont per rij ook locatie en categorie, Compact toont alleen de naam.

## Je gegevens
Alles blijft standaard op dit apparaat, in de lokale opslag van deze browser. Onder Instellingen › Opslag kun je duurzame opslag aanvragen, zodat de browser je gegevens niet automatisch opruimt bij plaatsgebrek. Onder Instellingen › Wijzigingsgeschiedenis zie je per record de laatste 20 wijzigingen. Je Anthropic API-sleutel (voor AI-herkenning) wordt alleen lokaal bewaard en rechtstreeks vanuit je browser naar Anthropic gestuurd — nooit via een eigen server. Onder Instellingen › Gevarenzone kun je alle locaties, containers en items in één keer wissen; instellingen zoals thema en sync blijven staan.

## Installeren en snelkoppelingen
Voeg de app toe aan je startscherm voor een eigen app-icoon en volledig-scherm gebruik — Instellingen toont een installatieknop zodra dat kan. Vanaf het startscherm-icoon (lang indrukken) open je direct "Nieuwe container", Vastleggen of Zoeken. Je kunt ook foto's rechtstreeks vanuit je Foto's-app naar deze app delen — ze staan dan klaar in Vastleggen zodra je een container kiest. Zolang er containers of conceptitems op bevestiging wachten, toont het app-icoon een teller.
`.trim();

const en = `
## What this app is
Inventory is an app for tracking what's inside your containers (boxes, bins, drawers) and where those containers live. Everything works fully offline, in your browser — an internet connection is only needed for AI identification and syncing.

## Locations, containers, items
A **location** is a place in your home: room, storage, section, and an optional name — for example "Bureau Chris › Hoog Rek Links › Plank 3". A **container** is a box or bin with a code (like BOX-0001) that belongs to a location. An **item** is one kind of thing in that container, with a quantity, a category, and optionally a link and freeform specs (extra field/value pairs).

## Capturing a container
The Capture tab always opens on "Choose container" — pick an existing one or create a new one right away, no photo required first. Add photos with "Add photos": you can either take a new one or pick an existing one from your photo library. If "Also run AI recognition" is on, the container gets added to the Review tab's queue.

## Automatic recognition (AI)
The Review tab lists containers waiting on AI identification. Select one or more and click "Identify" — the estimated cost is shown before you confirm. The AI proposes draft items (name, quantity, category); those sit below as drafts until you confirm them. You can also run this per-container: the container screen has the same "Identify" button once it has photos attached. AI identification needs an Anthropic API key (see Settings).

## Managing a container
Open a container to rename its code, edit its name/location/notes, add or remove photos, and add or edit items (with a stepper for quantity). From that screen you can also:
- print the container's contents
- copy all its items to another, existing or new, container
- delete the container

## Search and filters
The Search tab searches items, containers, and locations at once. With no search term, you browse all containers, grouped by location; filter by room, room + storage, or room + storage + section, and/or by category. The camera button switches to a photo view with one tile per photo — a container with several photos shows all of them, not just the first. The Items tab lists every item with category and state filters, a choice of sort order, and a stepper to adjust quantity directly.

## Bulk-creating locations and containers
Under More › Locations you manage the room/storage/section/name hierarchy; "Create a range" creates a run of them at once (e.g. "Shelf {n}" from 1 to 10). Under More › Bulk-create containers you do the same for container codes (e.g. BOX-0006 through BOX-0020), auto-numbered from the next free one — with no name or location yet, which you set later per container.

## Printing labels
Under More › Labels you select containers and pick a sheet format (a handful of Avery formats, or plain blank paper). Already used part of a sheet? Enter how many labels to skip — the new ones start right after those positions, so you don't have to throw away a half-used sheet.

## Insights
Under More › Insights you see totals (locations, containers, items, pinned, drafted items), a breakdown by category, and new items per week. You can export your full data as JSON (a complete backup) or CSV (for a spreadsheet), and print an overview — all of this happens entirely on your device.

## Deleting things and the trash
Deleting shows a toast at the bottom with an "Undo" button — only after it disappears is anything really deleted. Deleting a container also deletes the items inside it. Under More › Recently deleted you'll find anything deleted after that: restore it, or delete it forever.

## Syncing with Google Drive
Under More › Settings › Sync you connect your Google Drive account. "Sync now" automatically merges your devices' data; "Backup now" takes a snapshot you can restore later (merged with your current data, or replacing it entirely). Under More › Sync log you can see the history of every sync, backup, and restore, including any errors.

## Appearance, theme, and language
Under More › Settings you can choose a theme (Dark, Light, Midnight, Paper, or Auto), a language (Nederlands or English), and a density: Comfortable shows location and category on each row, Compact shows only the name.

## Your data
Everything stays on this device by default, in this browser's local storage. Under Settings › Storage you can request persistent storage, so the browser won't automatically clear your data when space runs low. Under Settings › Revision history you can see each record's last 20 changes. Your Anthropic API key (for AI identification) is stored locally only and sent straight from your browser to Anthropic — never through a server of ours. Under Settings › Danger zone you can wipe all locations, containers, and items at once; settings like theme and sync stay put.

## Installing and shortcuts
Add the app to your home screen for its own app icon and full-screen use — Settings shows an install button once that's possible. From the home-screen icon (long-press) you can jump straight to "New container", Capture, or Search. You can also share photos straight from your Photos app into this app — they'll be waiting in Capture once you pick a container. As long as containers or draft items are waiting to be confirmed, the app icon shows a count.
`.trim();

export function helpContent(lang) {
  return lang === "en" ? en : nl;
}
