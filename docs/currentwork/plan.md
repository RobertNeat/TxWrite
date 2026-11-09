# Current session

(empty — nothing in progress)

# Next cycles

- **Non-root container user.** Run the Node process (and everything it
  spawns — `latexmk`/`pandoc`/`tlmgr`/`fc-cache`/`luaotfload-tool`) as a
  non-root `USER`, closing the residual-risk note in architecture.md §8.
  - Entrypoint stays root only long enough to `chown` the `/data`/`/cache`
    volumes and write the `/etc/fonts/conf.d` fontconfig file, then drops
    privileges (`gosu`/`su-exec` — check what's available in the base
    image) before `exec`ing the Node process.
  - `tlmgr init-usertree`, `fc-cache`, and `luaotfload-tool -u` must run as
    the app user from that point on, or their caches end up root-owned and
    unwritable by the app on a later lazy install.
  - Verify against the existing named volumes (which may already have
    root-owned content from prior sessions) — a fresh volume and an
    existing one both need to end up usable.
  - This does **not** add per-project process isolation (one compile can
    still see another project's files) — that's a separate, larger piece
    not scoped here.

- **Revisit ORM/query-builder choice** once a maintained `node:sqlite`
  driver exists for `drizzle-orm` (or similar) — blocked on an external
  dependency; check periodically, not blocked on anything in this repo.

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
