# Current session plan

Branch: feature/frontend-wiring — wire the existing backend API into a usable UI:
profile picker, project list/create, file tree, editor with language modes, compile
button with live install/compile status, PDF preview. First branch where the product
is actually usable end to end, not just via curl.

Previous branches (feature/texlive-toolchain, feature/projects-and-compile) are done
and merged to main — see git log for details, no longer tracked here.

In scope: profile picker + create, project list + create (engine/mainFile), file
tree (list/create/rename-via-move/delete), editor load/save with .tex vs .md
language modes, compile button + structured log + clickable diagnostics, PDF
preview (pdf.js) refreshed after compile, status bar driven by SSE
(compile.*/install.*), lightweight runtime-switchable PL/EN i18n (signal + JSON
dictionary, no new dependency).
Out of scope (stays postponed): file upload, zip import/export, templates, font
settings, auto-compile on edit.

## Milestone 1: backend prerequisites for the file tree — done, committed
Implemented and verified end-to-end through the real API: GET /api/projects/:id/files
(recursive listing, symlink-escape-safe), POST /api/projects/:id/files/move
(rename/move, confinement-checked on both from and to), Cache-Control: no-store on
GET /api/projects/:id/output.pdf (confirmed via curl -I). 8 new unit tests, full
verify suite green. docs/contracts/api.md updated.

## Milestone 2: project shell — done, verified live, pending commit
Frontend API service (fetch wrapper mirroring backend DTOs/AppEventType, manual
sync, no packages/shared yet — revisit if drift becomes a problem), profile picker
(list + create), project list + create (name, engine, mainFile), routing
(`/` -> `/profiles/:profileId/projects` -> `/projects/:projectId`), i18n service
(signal-based, PL default / EN switchable, JSON dictionaries, no new dependency).
Verified end-to-end in a real browser (profile create -> project create -> open ->
editor route, Polish UI, SSE connected, no console errors). `pnpm run verify` green.
Every element in the new templates has an explicit id attribute (see memory:
feedback_html_element_ids). Still needs a commit.

## Milestone 3: file tree + editor — done, verified live, pending commit
File tree component (GET /files listing, create via PUT with empty content,
rename via POST /files/move, delete via DELETE /files/*). Editor: language mode
by extension (.md -> @codemirror/lang-markdown, .tex/.sty/.cls/.bib -> stex via
@codemirror/legacy-modes + @codemirror/language's StreamLanguage, added as an
explicit frontend dependency since it's used directly now). Load on selection,
debounced save (800ms) via PUT files/*. Deleting or renaming away the file
currently open in the editor clears it (fileOpened emits null, editor clears its
CodeMirror doc) rather than leaving stale content. Moved the file-tree/editor/
PDF-preview layout out of the app shell into a new ProjectWorkspaceComponent
(the workspace route), since the shell previously rendered that layout globally
even on the profile-picker and project-list routes. Verified live in browser:
create/open/edit/save/reload-persists for both .tex and .md, syntax highlighting
confirmed for both modes, delete-while-open clears the editor and does not
resurrect the file via a stray debounced save. `pnpm run verify` green.

## Milestone 4: compile + log + status bar — done, verified live, pending commit
CompilePanelComponent: compile button (disabled while in flight, calls POST
/compile), live running log from EventStreamService (extended to keep a capped
history of events, not just the latest, filtered by projectId), structured
diagnostics list. Diagnostics are clickable to jump to file:line in the editor
(EditorComponent gained a `jumpTarget` input) except for Markdown projects
(mainFile ends in .md), where diagnostics reference the generated intermediate
.tex per architecture.md section 5.2 — shown as a note instead of a broken
jump link, since that file isn't in the project's file tree. Status bar now uses
the existing status.connected/status.disconnected i18n keys instead of hardcoded
English (was already wired to the real SSE connection state, just untranslated).
Verified live: successful compile shows "Kompilacja udana" + log; a broken
\undefinedcommandxyz line shows "Kompilacja nieudana", a clickable
./main.tex:4 diagnostic, and clicking it moves the editor cursor to line 4.
`pnpm run verify` green, no console errors.

## Milestone 5: PDF preview
- [ ] pdf.js integration: worker asset wired via angular.json, GlobalWorkerOptions.workerSrc set (verify pdfjs-dist 6.x's actual worker filename/ESM entry before assuming)
- [ ] Preview pane loads GET /output.pdf, refreshes after each successful compile.finished event (cache-busted via the no-store header from Milestone 1)
- [ ] Verify via docker compose build + the built SPA served from the container (not just `ng serve`), since the worker asset path can differ between dev and the built bundle

# Dev loop for this branch
`docker compose up` (TeX toolchain, compile, only works inside the container) in one
terminal + `pnpm dev:frontend` in a separate terminal (proxy.conf.json already points
`/api` at 127.0.0.1:3000). Stop both when done (rule 3). Do not run a combined
parallel dev script (see memory: feedback_dev_servers).

# Postponed for future sessions

- Container startup readiness/healthcheck (entrypoint's luaotfload warmup blocks HTTP briefly on a fresh /cache volume)
- Font resolution (chain beyond "already installed")
- UID/mount-namespace isolation for compile child processes (architecture.md section 8)
- Prefetch watcher logic
- Template gallery content, zip import/export, file upload endpoint
- Revisit ORM/query-builder choice once a maintained node:sqlite driver exists for drizzle-orm (or similar)
- Auto-compile on edit
- See docs/contracts/api.md for open backend/frontend contract items
