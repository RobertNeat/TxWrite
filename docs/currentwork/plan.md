# Current session plan

Branch `feature/ui-overhaul`. This is the deferred "major" session: implement
the prefetch watcher end-to-end (architecture.md section 6.4), the backend
half of font resolution (section 7), and clean up stale doc text. OIDC stays
out of scope (no domain yet).

1. Prefetch watcher: `PrefetchWatcherService` + `POST /api/projects/:id/scan`,
   extracting `\usepackage`/`\RequirePackage`/`\documentclass`/
   `\usetikzlibrary`/font-command references, candidate delay/promotion via
   `PREFETCH_DELAY_MS`, routed through the existing `JobQueueService` so it
   never races the compile-retry install path. Frontend wiring: editor calls
   `/scan` debounced on content change.
2. Font resolution chain (section 7): steps 1-3 (fc-match / project fonts/
   folder / TeX Live font package via the index) on the backend reactive
   retry path, with `font.*` events already defined on the bus.
3. Stale doc cleanup in architecture.md (section 3 events/health text,
   section 8 "once the compile pipeline exists").

# Postponed for future sessions

- Google Fonts allowlisted fetch source (section 7 step 4) — needs a
  concrete allowlist decision from the user first
- UID/mount-namespace isolation for compile child processes (architecture.md section 8)
- Template gallery content
- Revisit ORM/query-builder choice once a maintained node:sqlite driver exists for drizzle-orm (or similar)
- No automated browser-level (e2e) frontend test exists yet, only unit-level
  Vitest specs against mocked fetch/EventSource — a real Playwright/Cypress-
  style reload test against a running backend would close the remaining gap
- See docs/contracts/milestones.md for the full UI-overhaul + backend-gap milestone list
- See docs/contracts/api.md for open backend/frontend contract items
