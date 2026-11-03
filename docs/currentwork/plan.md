# Current session plan

Branch `feature/ui-overhaul`. Implementing the UI redesign from the two mockup
projects (see `docs/contracts/milestones.md` for the full remaining sequence).

## Active: UI overhaul M4 — document outline panel wired to the open file

- `OutlineComponent` (`#outline-header`/`#outline-list`) ported from app.js's
  `renderOutline()`: parses the active file's headings on every load/edit,
  shows only the current document's sections (no cross-file `\input{...}`
  entries), re-renders on tab switch. `.md` files use `#`-level headings,
  `.tex` files use `\part|chapter|section|subsection|subsubsection|paragraph`
  plus two special cases (`\begin{abstract}` → "Streszczenie",
  `\printbibliography` → "Literatura"), `.bib` files always show "Brak
  sekcji w tym pliku.", binary/non-text files show "Plik binarny nie ma
  sekcji." (reusing `isTextFile` from the file-tree model).
- `EditorComponent` gained a `contentChanged` output (`{path, content} |
  null`), emitted after every `setState` (initial load) and on every
  `docChanged` update, plus `null` on `clear()`. `ProjectWorkspaceComponent`
  gates the outline's `path`/`content` inputs on `payload.path ===
  activePath()` to avoid a one-tick flash of the previous file's outline
  during the async tab-switch load.
- Clicking an outline entry now selects the whole line in the editor (not
  just a cursor placement) — `applyJumpTarget` dispatches `{anchor:
  line.from, head: line.to}`, matching app.js's `gotoLine`'s
  `setSelectionRange`. This also improves the existing compile-log
  "plik:wiersz" jump and SyncTeX double-click, which share the same
  `jumpTarget` mechanism.
- Left-panel layout split: `FileTreeComponent`'s host is now `flex: 1 1 56%`
  and `OutlineComponent` is `flex: 1 1 44%`, both scrolling independently
  inside `.side` (matching the mockup's `.tree`/`.ol` height shares).
- Fixed after user review (not file-tree-only — pulled forward while
  working in the same files):
  - SPA deep-link fallback: a direct load/refresh of e.g. `/projects/:id`
    returned a raw `{"message":"Not Found","statusCode":404}` from the
    Fastify static-file layer instead of serving `index.html` for Angular's
    router to take over. `ServeStaticModule.forRoot()` needed
    `serveStaticOptions: { fallthrough: true }` — Fastify's loader already
    registers a `*` catch-all `GET` route (unlike Express, whose default
    render path needed an explicit override), but without `fallthrough`
    that route always 404s instead of serving the index file.
  - File-tree drag-and-drop: dragging a row over the tree (highlighting a
    drop target) and then releasing outside a valid target left the
    `.row.drop`/`.tree.drop` highlight stuck for the rest of the session
    (only a full page refresh cleared it). Added a `document:dragend`
    `@HostListener` as a safety net (covers the case where the dragged
    row's own `dragend` listener is detached by a mid-drag tree
    re-render) and a `dragleave` handler on the root tree container to
    clear `dropTargetPath` when the pointer actually leaves the tree
    without dropping.
  - Editor pane had no internal scroll: a long file grew `#editor-host`
    (and the whole page) instead of scrolling within the middle panel —
    unlike the PDF preview pane (`.pv { overflow: auto }`), which already
    scrolled correctly. Root cause was the custom element `app-editor`
    defaulting to `display: inline` from outside, so the `.ed ::ng-deep
    app-editor { flex: 1; min-height: 0 }` rule had no effect (an inline
    box isn't a flex item in the sizing sense that matters here) and
    CodeMirror's `.cm-scroller` (which does have `overflow: auto` by
    default) was never actually height-constrained. Fixed by giving
    `app-editor` (and `app-file-tree`/`app-outline`, same pattern)
    `display: flex` from the parent, plus explicit `min-height: 0` /
    `overflow: hidden` on `EditorComponent`'s own `:host`. That in turn
    needed `flex-direction: column` + `min-width: 0` on `app-editor`
    (the default `row` direction stopped `#editor-host` from stretching
    to the panel's full width — caught and fixed in the same pass).
  - SPA-fallback side effect: the same `fallthrough: true` fix that made
    `/projects/:id` survive a refresh also made an unmatched `/api/*`
    path (typo, removed endpoint) silently return `index.html` with a
    200 instead of 404 — Fastify's `ServeStaticModule` catch-all route
    has no built-in awareness of the `exclude` option. Fixed with a
    `preHandler` hook in `main.ts` that 404s any request whose URL
    starts with `/api/` and whose matched route is the `*` catch-all
    (checked in `preHandler`, not `onRequest`, since `routeOptions` is
    only populated once Fastify has resolved the route).
- Not in this milestone: formatting toolbar, symbols panel, PDF preview
  toolbar (M5–M7).

## Done earlier this session: UI overhaul M3 — editor screen file tree, tabs, resizable panels

- Resizable panels between file-tree/editor/preview, ported app.js's
  `mkResizer`: pointer-drag and arrow-key resizing, clamped
  (240–520px side panel, editor ≥380px, preview ≥420px).
- Open-file tabs (`#tabs`) above the editor: multiple files can be open at
  once, each tab shows its extension tag, closing a tab (not the last one)
  falls back to the previous tab. Only the active tab's path is passed to
  `EditorComponent` (unchanged — it already reloads on `filePath` input
  changes).
- `FileTreeComponent` rewritten to match `edytor-ui`'s tree exactly: the
  working directory root itself is invisible (top-level entries have 0
  indent), inline create/rename via a text input in the row (no
  `window.prompt`), hover-reveal rename/delete icons, extension tag badges,
  "główny" pill on the project's main file (no delete action on it), full
  drag-and-drop move within the tree (blocks dropping onto self/own
  descendant), drop-on-empty-area moves to the working directory root.
- New-directory creation has no empty-dir backend endpoint yet, so a hidden
  `.gitkeep` placeholder file is created and filtered out of the rendered
  tree — directories still look genuinely empty in the UI.
- Backend fix: `deleteFile` now passes `recursive: true` to `rmSync` —
  deleting a non-empty directory previously threw `EISDIR` (not caught by
  any existing test; found while wiring the tree's folder-delete action).
- Fixed after user review:
  - Selected-row extension tag (`.tg`) now forces a white background on a
    selected tree row — it was blending into the row's `--tint2` highlight
    since both are a similar light blue.
  - Closing a tab with middle-click (not just the "x" button) now works
    anywhere on the tab, via `auxclick` filtered to button 0/1.
  - Dropping files from the OS onto the tree now actually uploads them
    (`handleDragOver`/`handleDrop` previously only handled the in-tree
    drag-move case and never called `preventDefault()` for `dataTransfer.types`
    containing `Files`, so the browser's default "open file" action won.
    `ApiService.writeFile` now also accepts a `Blob` body).
  - Switching working directories via `#wsBtn` didn't actually reload: (1)
    `ProjectWorkspaceComponent.ngOnInit` read `route.snapshot.paramMap` once
    — Angular reuses the component instance across a `:projectId`-only
    navigation, so it never re-ran; now subscribes to `route.paramMap`. (2)
    `EditorComponent.ngOnChanges` ignored `projectId` changes, so a new
    project whose main file has the same name (e.g. both `main.tex`) kept
    showing the old project's content — it now resets `loadedPath` on a
    (non-first) `projectId` change.
- Not in this milestone: upload-from-disk / `#bUp` and ZIP export / `#bDir`'s
  "Z plików projektu" variant (no backend endpoints — see
  `docs/contracts/milestones.md`), document outline, formatting toolbar,
  symbols panel, PDF preview toolbar (M4–M6).

## Done earlier this session: UI overhaul M1+M2 — login/profile screen, workspace topbar

- Re-skinned the app to match the mockups' visual language (navy/white panel
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
  scramble()/animateTexts()). Logging out reverses this. Scramble only fires
  on login/logout, not on switching the selected profile (explicit user call
  — not in the reference design).
- Workspace (editor) screen topbar: chip is the user's profile (avatar +
  name) with an "x" that logs out (navigates to `/`). Working-directory
  selection moved to the left panel as a searchable dropdown
  (`#wsBtn`/`#wsPop`/`#wsQ`/`#wsList`), listing the other projects owned by
  the same profile.
- Popovers are positioned dynamically against their trigger button (ported
  app.js's `place()`), with rounded corners clipped correctly (`overflow:
  hidden` on `.pop`, a bug from the first pass where scrollable content
  overran the border-radius).
- Decisions (see project memory `ui_overhaul_scope`): no real authentication
  (non-goal per `project_assumptions.md`); fonts self-hosted via
  `@fontsource/*`; anything in the mockups not backed by a real endpoint is
  omitted from the UI entirely — see `docs/contracts/milestones.md` for the
  backend-gap items split out as their own future milestones.
- Project rename (kebab "Edytuj nazwę") wired to the existing
  `PUT /api/projects/:id`, closing that previously-unconsumed contract gap.

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
