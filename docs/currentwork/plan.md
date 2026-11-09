# Postponed for future sessions

- Font resolution section 7 step 2 (project `fonts/` folder: per-compile
  `FONTCONFIG_FILE`/`OSFONTDIR` setup) — steps 1, 3, and 5 are done
  (`FontResolverService`); this step is a compile-runner environment change,
  not a resolver change, and was not part of this session's scope
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
