# Postponed for future sessions

- Font resolution section 7 step 2, LuaTeX half only: a project's `fonts/`
  folder is not made visible to `luaotfload`, since its font-name database
  is shared/global per container (not per-project) — registering a
  project's fonts there the way step 3 does for an installed package would
  leak that project's fonts into every other project's LuaTeX compiles.
  Needs a real design decision (e.g. a scoped `OSFONTDIR` per compile)
  before attempting it. The XeTeX half (`FONTCONFIG_FILE`) is done.
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
