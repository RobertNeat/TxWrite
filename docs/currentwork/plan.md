# Current session

(empty — nothing in progress)

# Next cycles

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
