# Current session plan

Branch `feature/ui-overhaul`.

# Postponed for future sessions

- Font resolution (chain beyond "already installed")
- UID/mount-namespace isolation for compile child processes (architecture.md section 8)
- Prefetch watcher logic
- Template gallery content
- Revisit ORM/query-builder choice once a maintained node:sqlite driver exists for drizzle-orm (or similar)
- No automated browser-level (e2e) frontend test exists yet, only unit-level
  Vitest specs against mocked fetch/EventSource — a real Playwright/Cypress-
  style reload test against a running backend would close the remaining gap
- See docs/contracts/milestones.md for the full UI-overhaul + backend-gap milestone list
- See docs/contracts/api.md for open backend/frontend contract items
