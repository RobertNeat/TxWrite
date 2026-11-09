# Current session

(empty — nothing in progress)

# Next cycles

- **Install/font status-bar line.** See `docs/contracts/api.md` for the
  open contract this closes (`install.*`/`font.*` events + `installs`/
  `fontResolutions` have no frontend consumer today). Extend
  `StatusBarComponent` with a single-line transient status area, separate
  from the compile log panel (`.logp`) — `install.*`/`font.*` SSE events
  must never appear there.
  - Each event renders one short line (e.g. "Installing tikz-cd…",
    "Resolved font EB Garamond"), shown for a fixed number of seconds, then
    cleared.
  - Events arriving while one is already showing must queue, not overwrite
    or overlap — a visible queue of pending messages, drained one at a
    time, so the user can read each one instead of being flooded.
  - Decide the per-message display duration and queue cap (how many
    pending messages before older ones are dropped) before implementing.

- **LuaTeX project `fonts/` folder support, with shared caching.** Give
  LuaTeX feature parity with XeTeX's per-compile `FONTCONFIG_FILE`
  (architecture.md §7 step 2), without the cross-project leak a shared
  `luaotfload` database would otherwise cause.
  - First investigate whether `luaotfload` honors a per-process `OSFONTDIR`
    override scoped to one compile, without forcing a full
    `luaotfload-tool -u` refresh of the shared database each time — verify
    this empirically in the real container before writing resolver code
    (same standard as this session's font work: real logs/behavior, not
    documentation paraphrase).
  - Once a font is resolved for *any* project (TeX-Live package install,
    or a project-local upload), it should become visible to every other
    project on the same install without re-fetching — i.e. the resolution
    is cached at the install/download level, not re-done per project. A
    font must be used once by some project to appear as available platform-
    wide afterward. This applies to the TeX-Live-package path already (lazy
    installs already land in the shared `TEXMFHOME` tree); confirm the same
    sharing model extends cleanly to whatever `OSFONTDIR` scoping is chosen
    for the per-project-upload case.
  - If no clean per-compile scoping exists for `luaotfload`, stop and report
    back before falling back to a leaky shared-registration approach.

- **Google Fonts fallback source (architecture.md §7 step 4).**
  - Source: the `google/fonts` GitHub repository's raw content API (no API
    key required).
  - Priority order: TeX-Live-package resolution (existing `FontResolverService`
    step 3) always tried first; Google Fonts is only a fallback when no TeX
    Live package provides the font. This keeps unauthenticated GitHub
    traffic to the minority of lookups that actually need it.
  - Account for GitHub's unauthenticated rate limits on raw-content
    fetches (no auth token planned) — needs a sensible failure mode when
    rate-limited, not a hard failure that looks like "font not found."

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
