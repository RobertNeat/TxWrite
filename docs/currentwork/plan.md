# Current session plan

Branch `feature/ui-overhaul`. Implementing the UI redesign from the two mockup
projects (see `docs/contracts/milestones.md` for the full remaining sequence).

## Active: UI overhaul M1 — shell, routing, design tokens, login/profile screen, workspace topbar

- Re-skin the app to match the mockups' visual language (navy/white panel
  design, IBM Plex Sans / JetBrains Mono / STIX Two Text via `@fontsource/*`).
- Merged `/` and the old `/profiles/:id/projects` route into a single screen
  (`ProfilePickerComponent`) matching `logowanie-ui` exactly: left panel is
  profile selector (`#profBtn`/`#profPop` dropdown, add/select only — no
  delete, backend has no `DELETE /api/profiles/:id` yet) + that profile's
  working directories (create, rename via kebab menu, delete via kebab +
  confirm dialog), blurred with placeholder text pre-login; right panel is a
  login form (no real auth — see below) that becomes an account card on
  "sign in", with a scramble/decode text animation revealing the real profile
  name and workspace list in the left panel (ported from app.js's
  scramble()/animateTexts()). Logging out reverses this (scramble back to
  placeholders, re-blur). Scramble only fires on login/logout, not on
  switching the selected profile (explicit user call — not in the reference
  design).
- Workspace (editor) screen topbar: chip is the user's profile (avatar +
  name) with an "x" that logs out (navigates to `/`), not a workspace-name
  button — matches `edytor-ui`'s `#chipX`. Working-directory selection moved
  to the left panel as a searchable dropdown (`#wsBtn`/`#wsPop`/`#wsQ`/`#wsList`),
  listing the other projects owned by the same profile.
- Popovers (profile list, kebab menu, workspace selector) are positioned
  dynamically against their trigger button (ported app.js's `place()`), not
  hardcoded — fixes an earlier bug where they rendered off-panel or
  full-viewport-width.
- Decisions made this session (see project memory `ui_overhaul_scope`):
  - No real authentication is added (non-goal per
    `docs/project_assumptons/project_assumptions.md`). The login form only
    selects/reveals an existing profile — no password check, no session.
  - Fonts are self-hosted via `@fontsource/*` packages (new dependency,
    user-approved), not Google Fonts CDN.
  - Anything in the mockups not backed by a real endpoint is omitted from the
    UI entirely (not stubbed/disabled) — see `docs/contracts/milestones.md`
    for the backend-gap items split out as their own future milestones
    (profile delete, ZIP import/export, file upload, empty-dir creation).
  - Project rename (kebab "Edytuj nazwę") now wired to the existing
    `PUT /api/projects/:id`, closing that previously-unconsumed contract gap.
- File tree internals (drag/drop, per-file kebab, nested folders), the
  formatting toolbar, symbols panel, and PDF preview toolbar are still the
  old bare UI — out of scope for this milestone, covered by later
  UI-overhaul milestones in `docs/contracts/milestones.md`.

# Postponed for future sessions

- Container startup readiness/healthcheck (entrypoint's luaotfload warmup blocks HTTP briefly on a fresh /cache volume)
- Font resolution (chain beyond "already installed")
- UID/mount-namespace isolation for compile child processes (architecture.md section 8)
- Prefetch watcher logic
- Template gallery content
- Revisit ORM/query-builder choice once a maintained node:sqlite driver exists for drizzle-orm (or similar)
- Auto-compile on edit
- See docs/contracts/milestones.md for the full UI-overhaul + backend-gap milestone list
- See docs/contracts/api.md for open backend/frontend contract items
