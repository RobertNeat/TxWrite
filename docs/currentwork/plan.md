# Current session plan

Branch `feature/ui-overhaul`. Implementing the UI redesign from the two mockup
projects (see `docs/contracts/milestones.md` for the full remaining sequence).

## Done: M6 follow-up fixes — compile target file + regressions from the M6 commit

User-requested fix: compiling no longer requires the open file to be
named `main.tex` — it now compiles whichever file is open in the editor
when it's `.tex`/`.md`, falling back to the project's configured
`mainFile` otherwise (e.g. a binary file or no file open).

- Backend: `CompileService.compile`/`outputPdfPath` and
  `SynctexService.edit` all take an optional `targetFile`/`?file=`
  param, validated with the existing `isValidMainFile` plus an
  existence check against the project directory (`BadRequestException`
  on either failure). `CompileRunnerService` gained a shared
  `outputPdfPath(projectId, targetFile)` helper, deduplicating what
  used to be two near-identical copies in `compile.service.ts` and
  `synctex.service.ts`. New specs in `compile.service.spec.ts` cover
  the override, a missing target file, and an invalid one (path
  traversal) — using a real `mkdtempSync` temp dir rather than mocking
  `node:fs`, since `vi.spyOn` can't redefine an ESM named export.
- Frontend: `ProjectWorkspaceComponent` computes `compileTarget()` (the
  active tab's path if `.tex`/`.md`, else `undefined` so the backend's
  own `mainFile` default applies) and `isMarkdownProject()` from that
  target instead of the project's `mainFile`, so compiling a `.md` file
  inside a `.tex` project correctly enables the generated-file note and
  disables diagnostic-jump/double-click-to-source for that compile
  (and vice versa). Both are passed into `PdfPreviewComponent`, which
  threads `compileTarget()` through `api.compile`/`outputPdfUrl`/`synctexEdit`.
- Found and fixed two regressions in the M6 commit (5e23275) while
  doing this, since they're in the same compile call path:
  - **Kompiluj silently did nothing when the log panel was closed.**
    `app-compile-panel` (which used to own `compile()`/`compiling`/
    `lastResult`) only existed inside the log panel's `@if (logOpen())`
    block, so once "open the log panel only on failure" shipped,
    clicking Kompiluj with the panel closed called
    `this.compilePanel?.compile()` against an undefined ViewChild — a
    silent no-op. Fixed by moving `api.compile()` and the
    `compiling`/`lastResult` state into `PdfPreviewComponent` itself
    (always alive), and making `CompilePanelComponent` purely
    presentational (`[result]` input, no more `compile()`/`compiled`/
    `compilingChanged`). Also fixes two related bugs this structure
    caused: closing the panel used to destroy `lastResult` (reopening
    showed "Brak diagnostyki" even after a real compile), and closing
    it mid-compile destroyed the component before `compiled`/
    `compilingChanged` could fire, leaving the spinner stuck forever.
  - **Ctrl+Enter inserted a blank line in the editor instead of (or in
    addition to) compiling.** `basicSetup`'s default CodeMirror keymap
    binds Mod-Enter to `insertBlankLine`; a bubble-phase
    `document:keydown` listener fires after CodeMirror's own keydown
    handling, too late to prevent it. Fixed by listening in the capture
    phase (`document.addEventListener('keydown', fn, true)`) with both
    `preventDefault()` and `stopPropagation()`, added/removed in
    `ngAfterViewInit`/`ngOnDestroy` (replacing the `@HostListener`,
    which is always bubble-phase).
  - Compile now also flushes a pending debounced editor save first
    (`EditorComponent.flushSave()`, new public method) — compile reads
    the file from disk, and the editor's autosave debounce is 800ms, so
    compiling immediately after typing could previously compile stale
    content.
  - Found live while verifying the `?file=` override:
    `PdfPreviewComponent.loadPdf()` built its cache-busting URL as
    `` `${api.outputPdfUrl(id, target)}?t=${Date.now()}` ``, which
    produced a malformed `output.pdf?file=other.tex?t=169...` (two
    `?`s) whenever a non-default target was compiled — the backend 400s
    on that, so the PDF silently failed to load even though the compile
    itself succeeded. `outputPdfUrl` now takes the cache-bust value as
    a third param and builds the whole query with `URLSearchParams`, so
    `?file=`/`?t=` are joined correctly regardless of which are present.
- User-requested fix, same session: opening a working directory no
  longer blindly opens `project.mainFile` by name even when that file
  doesn't exist in the project (e.g. a shared/edited-elsewhere working
  directory, or `mainFile` renamed/deleted outside the app) — it used
  to leave the editor silently blank with the stale filename still
  shown in the tab. `ProjectWorkspaceComponent.loadProject()` now
  fetches the file list alongside the project and resolves the initial
  file via `resolveInitialFile()`: prefer `mainFile` if it exists at
  the working directory root, else the first root-level `.tex` file,
  else the first root-level `.md` file, else nothing open. Verified
  live: a project with no `main.tex` but a root `thesis.tex` now opens
  `thesis.tex` automatically instead of showing a blank editor.
- `docs/contracts/api.md`'s compile-endpoints section updated for the
  `?file=` param and the `CompilePanelComponent` ownership change (rule
  6).

## Done: UI overhaul M6 — PDF preview toolbar

Ported app.js's `.pv-bar`/pager/zoom/log-panel-toggle, plus a real
SyncTeX double-click-to-source endpoint. User confirmed installing the
`synctex` tlmgr package since it was missing from the Docker image
(`tlmgr install synctex` in the toolchain stage, `-synctex=1` added to
the latexmk invocation).

- Backend: new `SynctexService` + `GET /projects/:id/synctex?page&x&y`
  — runs `synctex edit -o page:x:y:<pdf>` via `execFile` (no shell
  interpolation), parses the `Input:`/`Line:` fields from its stdout,
  resolves the path against the project dir and rejects anything
  outside it (`relative(...).startsWith('..')` check) before returning
  `{path, line}`. Markdown projects map to the generated intermediate
  `.tex` in the cache work dir, not the `.md` source, so the frontend
  gates double-click on `isMarkdownProject` client-side (same flag the
  existing diagnostic-jump already uses) rather than trying to make
  this endpoint md-aware.
- Frontend: `PdfPreviewComponent` absorbed the `.pv-bar` toolbar
  (compile button with spin/stale-dot states, Ctrl+Enter shortcut, Logi
  toggle, pager with click/keyboard/scroll-tracked page, zoom
  in/out/fit clamped 0.4–2.5) and multi-page canvas rendering
  (`devicePixelRatio`-scaled, cancel-on-rerender via a render token).
  `CompilePanelComponent` was narrowed to just the `logp` body
  (diagnostics + event log, unchanged logic) and now lives nested
  inside the log panel instead of being its own pane; it gained a
  `compilingChanged` output and lost its own "Kompiluj" button, which
  moved to `PdfPreviewComponent`'s bar per the mockup's control
  ordering. `EditorComponent` gained a `docEdited` output (fires only
  on a real `docChanged`, unlike `contentChanged` which also fires on
  file load) so `ProjectWorkspaceComponent` can mark the preview stale
  only on tex/sty/cls/bib edits, matching app.js's `markStale()`.
  Export split-button is out of scope (no backend for non-PDF formats
  yet — stays in `milestones.md`).
- Fixed during self-test: the fit-to-width `ResizeObserver` caused a
  continuous "ResizeObserver loop completed with undelivered
  notifications" console error (recurring every ~1s, not just once) —
  `fitWidth()` always re-rendered every page's canvas even when the
  computed zoom was unchanged, and that re-render could itself change
  the scroll container's scrollbar/content size, re-triggering the
  observer. Fixed by skipping the re-render when the new clamped zoom
  equals the current one, and by deferring the observer's callback to
  `requestAnimationFrame` (the standard fix for this warning). Verified
  clean: no ResizeObserver errors on load or during a manual `rz2` drag
  after the fix, versus a continuous once-per-second error before it.
- Self-tested live (fresh 3-page `.tex` project + a `.md` project,
  since the repo's pre-existing "Test Paper" fixture project has
  broken `\input`s unrelated to this milestone): pager prev/next/scroll
  tracking, zoom +/-/fit (clamped, page preserved across re-render),
  log panel toggle + close, diagnostic jump-to-source, stale dot on tex
  edit, Ctrl+Enter compile shortcut, double-click-to-source correctly
  jumping to the clicked line on the `.tex` project and correctly
  inert (no jump) on the `.md` project. Test projects deleted after
  verification.
- Fixed after user review:
  - `app-pdf-preview` wasn't filling the aside's full width — the
    parent's `::ng-deep app-pdf-preview` rule in
    `project-workspace.component.css` was missing `min-width: 0` (and
    `flex-direction: column`), the same flex-sizing gotcha hit earlier
    with `app-editor`: without it the flex child's default
    `min-width: auto` let intrinsic content width win instead of
    matching the pane. Verified live: `app-pdf-preview`'s own width now
    matches `.pv`'s to within a 1px border.
  - Compiling no longer force-opens the log panel on a successful
    compile — `PdfPreviewComponent.compile()` used to call
    `logOpen.set(true)` unconditionally before compiling; it now only
    opens the panel in `onCompiled()` when `result.success` is false,
    leaving a successful compile's panel state untouched (open stays
    open, closed stays closed). Matches the mockup's own spec, which
    never mentions auto-opening on compile at all — `Logi` is purely a
    manual toggle there.

## Done: line-number gutter markers (not from either mockup — user request)

Click a line number in the gutter to toggle a temporary "I want to edit
this line" visual marker, with a full-row hover highlight while
composing. Session-scoped only (in-memory, cleared on refresh) and
deliberately not a `.cm-content` selection/decoration, to stay cheap.

- New `apps/frontend/src/app/features/editor/line-marks.ts`: a
  `StateField<RangeSet<GutterMarker>>` + `gutterLineClass` for the
  marked lines (maps through `tr.changes` so a mark follows its line
  across edits — insert a line above it and it moves down) and a
  second field for the hover highlight. Click/hover handled by a plain
  `mousedown`/`mousemove`/`mouseleave` listener on `view.scrollDOM`
  (not a CodeMirror event handler extension, since scrollDOM survives
  `setState` across file switches) — `preventDefault()` on the
  gutter mousedown keeps `.cm-content`'s selection untouched. A click
  on a non-empty `.cm-foldGutter` cell folds instead of toggling a
  mark.
- Storage is behind a tiny `LineMarkStore` interface
  (`loadMarks(key)`/`saveMarks(key, lines)`), implemented in-memory by
  `InMemoryLineMarkStore` for now. `EditorComponent` saves the
  outgoing file's marks (keyed `projectId:path`) before switching
  files and reseeds the new file's marks after `setState` — so marks
  survive a tab switch but not a page refresh, as requested. A future
  milestone can swap in a backend-persisted `LineMarkStore` without
  touching the CodeMirror wiring in `EditorComponent`.
- Fixed during verification: moving the mouse from the gutter straight
  onto `.cm-content` (rather than off the whole editor) never fired
  `scrollDOM`'s `mouseleave`, so the last-hovered line stayed
  highlighted. `onMouseMove` now explicitly clears the hover the
  moment `event.target` is no longer inside `.cm-gutters`.

## Done: UI overhaul M5 — formatting toolbar

Ported app.js's `.tools`/`act()`/`insertTpl()`/`insertRaw()` family
verbatim into `ToolbarComponent` (new `features/toolbar/` dir:
`toolbar.component.*`, `toolbar.model.ts` for the pure edit functions,
`toolbar.data.ts` for HEADS/SYMS/SYMCAT). Order and grouping (with
`.tsep` separators) matches the mockup: undo/redo — heading style menu
— bold/italic — math menu, Ω symbols toggle — link/ref/cite/figure/
table — list menu.

- `EditorComponent` gained a narrow public API instead of exposing
  `EditorView`: `applyEdit(compute)` (dispatches a pure (doc, from, to)
  → `EditResult` transform as a full-document replace), `undo()`/
  `redo()` (via `@codemirror/commands`, works because `basicSetup`
  already wires `history()` + `historyKeymap`), `isEditable()`,
  `currentMode()`. A new `headingLevelChanged` output fires on both
  `docChanged` and `selectionSet` so the toolbar's heading-style label
  tracks the cursor live, per app.js's `updHead()`/`lineLevel()`.
  `ProjectWorkspaceComponent` wires `ToolbarComponent`'s `editorApi`
  input to a thin adapter object backed by a `#editor` `@ViewChild`.
- Insertion logic in `toolbar.model.ts` is pure (doc, selection) →
  `EditResult` functions mirroring `pad()`, `insertRaw()`,
  `insertTpl()`, `applyHeading()`, `insertTable()`, `insertFigure()`,
  `insertLink()`, `lineBounds()`, `lineLevel()`. Templates (`TPL`)
  ported per-mode (tex/md) with the `‸` cursor marker exactly as
  written — including the `.md` extensions the mockup's own author
  flagged as scope creep (ref/cite/display-math/table syntax for
  `.md`, since the brief only specified LaTeX commands).
- Toolbar fully disabled (`.tb[disabled]`) for non-text files
  (`!isTextFile`), matching the outline's binary-file handling.
- Heading menu: 5 items (Normalny tekst/Sekcja/Podsekcja/Podpodsekcja/
  Paragraf), each styled in its target font/size (`.hd-*`, `--serif`),
  command hint next to each, `aria-checked` on the cursor's level.
  Verified live: inserting "Sekcja" wraps the cursor's line in
  `\section{...}`; undo restores exactly.
- Math menu: "Wzór w tekście" (`$…$`) / "Blokowy" (`\begin{equation}`
  tex, `$$…$$` md) — verified live, menu content matches the mockup.
- Link/ref/cite: `\href{}{sel}`/`\ref{}`/`\cite{}` (tex) or
  `[sel](url)`/`[@etykieta]` (md).
- Table grid: 10×10 hover/keyboard-navigable grid (`.gc` cells),
  "R × C" label, click inserts the exact template string from app.js
  (4-space indent preserved verbatim) or the md pipe-table variant.
  Verified live: hovered 3×4, inserted, exact template matched
  (`\begin{table}` … `\label{tab:placeholder}` … `\end{table}`); undo
  restored cleanly.
- Figure menu: per explicit user decision, only the two backend-backed
  options ship — "Prześlij z komputera" (writes into `obrazy/` via the
  existing file-write endpoint, then inserts the figure template) and
  "Z plików projektu" (submenu listing project images png/jpg/pdf/svg
  via the existing file-list endpoint — verified live, correctly found
  `images/figure.svg`). "Z innego projektu" and "Z adresu URL" are
  dropped entirely (mockup-only dummies, no real backend) — not
  stubbed, not disabled, per rule 8's "absent, not disabled" principle.
- List menu: itemize/enumerate (tex) or `- `/`1. ` (md).
- Symbols panel: toggle button (`aria-pressed`), opens below the
  editor inside `.ed` via CSS `order` (toolbar's `:host { display:
  contents }` flattens `.tools`/`.symp` into `.ed`'s flex children;
  `order: -1`/`1` keeps them pinned above/below `app-editor` regardless
  of DOM position), `flex: none; max-height: 55%`, category tabs +
  live cross-category search, click inserts the raw command and keeps
  the panel open and focus in the editor for inserting several symbols
  in a row. Verified live: hovered Ω showed `\Omega` hint, click
  inserted `\Omega ` and kept the panel open; re-verified the M4
  editor-scroll fix (`bodyScrollHeight === windowInnerHeight`) still
  holds with the panel open (editor host correctly shrank from 843px
  to 622px instead of the page growing).
- Added missing sprite icons to `index.html` (`i-undo`, `i-redo`,
  `i-sigma`, `i-link`, `i-hash`, `i-quote`, `i-image`, `i-table`,
  `i-list`, `i-chev-l`), copied verbatim from the mockup.
- `placePopover()` gained an `align` parameter (`'left' | 'right'`,
  defaulting to preserve each existing caller's prior behavior) since
  the toolbar's menus are left-aligned to their button like app.js's
  `wirePop(..., 'left')`, while the pre-existing `wsPop`/kebab popovers
  were right-aligned.
- Backend 404 fix (`main.ts`'s `preHandler` hook) and trailing-newline
  cleanup for two files edited during manual M4 testing were folded
  into the M4 commit, not this one.

## Done: UI overhaul M4 — document outline panel wired to the open file

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
