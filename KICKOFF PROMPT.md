## Kickoff prompt — paste this into a new session

```
Read BLUEPRINT.md in the project root. It is the design contract for this build;   
follow its conventions rather than inventing new ones, and re-read it whenever a   
convention question comes up.   
   
Project: see Section 14 (App Brief) in that file.   
   
This is a local-first browser app: plain HTML/CSS/JavaScript ES modules, no server,   
no framework, no build step, no dependencies. If I am replacing an existing   
server-based app, read that old code as a SPECIFICATION of required behaviour —   
do not port it line by line, and do not keep its language or its architecture.  

First do a thorough analysis of the project, ask anything which is not clear or ambiguous, do not start coding before my approval !   
      
Build it in phases; stop after each phase for my review:      
      
  Phase 0 — Skeleton      
    index.html with all view sections, style.css with the four themes and tokens,      
    manifest, service worker with an explicit precache list, version.js at build 1,      
    empty module files per the Section 4 layout.      
      
  Phase 1 — Storage + record contract      
    db.js with the three stores, the Section 5 envelope, queryItems with      
    search/filter/sort/pagination, and the pure helpers. tests.html covering them.      
      
  Phase 2 — Core app views      
    List, detail/edit, create. Search, filters, sort, density toggle,      
    undo-on-delete, gestures.      
      
  Phase 3 — Platform layer (Settings)      
    Themes, language (full NL/EN), storage info, export JSON/CSV, print + overview      
    report, insights, help, about/version.      
      
  Phase 4 — Sync      
    merge.js (pure, fully unit-tested FIRST), then sync.js: Drive OAuth with the      
    redirect fallback, two-way sync, media reconciliation, backup, restore      
    (merge/replace), activity log with auto-sync skip reasons, trash with      
    restore + delete-forever.      
      
  Phase 5 — Migration (only if replacing an existing app; see §2.3)      
    A throwaway script (Python is fine for this — it never ships with the app) that      
    reads a COPY of the legacy database read-only and emits import.json in the      
    record-contract shape, plus any attachments. It must print a reconciliation      
    report: rows read, records written, per type, skipped and why. Import it      
    through the app's existing restore path, then verify counts and spot-check      
    records and attachments by hand before I trust it.      
      
  Phase 6 — Polish      
    PWA install hint, app badge, view transitions, skeleton loaders, empty states.      
      
Rules for every phase:      
- Zero dependencies, no build step, plain ES modules.      
- Every user-visible string goes through i18n in both languages.      
- Every pure function gets a test in tests.html.      
- Bump version.js build on every change; bump the SW CACHE\\\\\\\_VERSION and add any new      
  module to its precache list.      
- Verify in a real browser before claiming a phase is done: run tests.html, exercise      
  the flow, check the console is clean. Report what you actually observed.      
- Do not commit or push unless I say "deploy vN".
```

