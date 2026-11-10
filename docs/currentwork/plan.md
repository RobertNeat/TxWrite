# Current session

(empty — nothing in progress)

# Next cycles

- **`apps/frontend` has no `.gitattributes`.** `apps/backend`'s
  `* text=auto eol=lf` keeps its `format:check` passing on a CRLF checkout
  (`core.autocrlf=true` locally); `apps/frontend` lacks that file, so on
  this Windows checkout every frontend source file reads back CRLF and
  `prettier --check` (which defaults to `endOfLine: "lf"`) reports all of
  them as unformatted — confirmed as a checkout artifact, not real drift
  (`prettier --check --end-of-line auto` passes clean). CI runners checking
  out on Linux are unaffected either way. Add the same `.gitattributes`
  line to `apps/frontend` to fix local `pnpm run verify`/`check` on Windows.
- **Minimum release age (`minimumReleaseAge: 10080` in `pnpm-workspace.yaml`,
  added 2026-11-10) blocks installing any dependency version published in
  the last 7 days.** This is a deliberate supply-chain hardening setting
  (semgrep `package_managers.pnpm.pnpm-missing-minimum-release-age`), but it
  changes the day-to-day workflow: a fresh `pnpm up` right after a dependency
  ships a new version will fail until the 7 days pass. Worth calling out the
  first time it blocks someone.
- **Real browser-level (e2e) frontend tests.** No automated
  browser-level test exists yet, only unit-level Vitest specs against
  mocked `fetch`/`EventSource`. A real Playwright/Cypress-style reload
  test against a running backend would close the remaining gap. Tell the
  user before adding Playwright as a new dev dependency (CLAUDE.md rule 2).

# Postponed (last additional feature)

- OIDC login (Google, Keycloak) on top of local JWT auth
- Template gallery content — scope unknown (`TemplatesModule` and the
  picker's current implementation state were never audited); revisit once
  OIDC is underway or explicitly prioritized, starting with an audit of
  what already exists before committing to a scope
