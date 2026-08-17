# Home Inventory

A local-first PWA for tracking what's inside your storage containers (boxes, bins, drawers) and where those containers live — down to the room, shelf, and section.

**Live app:** https://cvanaalst.github.io/home-inventory-app/

## What it does

- **Locations → containers → items.** A location is a place (room / storage / section / name); a container is a coded box or bin at that location; an item is one kind of thing inside it, with quantity, category, and optional specs.
- **Capture by photo.** Take or pick photos for a container, then optionally let AI (Claude Haiku, via your own Anthropic API key) identify what's in them as draft items you confirm before they're saved.
- **Search & filter.** Full-text search across items/containers/locations, or browse by room/storage/section and category, including a photo-only view.
- **Labels & printing.** Print container labels to common sheet formats (with blank-label skipping for partially used sheets), or a full printable inventory overview.
- **Insights.** Totals, category breakdown, weekly activity, and JSON/CSV export.
- **Trash, revision history, undo.** Every delete is reversible via a toast, then via a proper trash screen; every record keeps its last 20 changes.
- **Google Drive sync.** Optional two-way sync and timestamped backups, `drive.file` scope only (the app can only see its own folder).
- **Installable.** Add to home screen/dock, works fully offline, supports sharing photos into it from your OS share sheet (Android/desktop).

## Stack

Zero dependencies, no build step. Plain ES modules, IndexedDB for storage, a service worker for offline + precaching. Dutch and English, switchable in-app.

## Running locally

Any static file server works — the service worker needs a real origin, so `file://` won't do:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`. Run `tests.html` in the same way to see the unit test suite (pure-function coverage for the storage/query/merge/report engine).

## Project notes

[`BLUEPRINT.md`](BLUEPRINT.md) is the design contract this app was built from — architecture decisions, release discipline, and the reasoning behind them.
