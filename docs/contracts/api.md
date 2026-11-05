# Open contracts between backend and frontend

## GET /api/health

Implemented on the backend (`apps/backend/src/modules/health`), returns
`{ status: 'ok', uptimeSeconds: number }`. Nothing in the frontend calls it yet.
Remove this entry once a frontend consumer (e.g. a status indicator) is added, or once
it's confirmed the endpoint is meant to stay ops-only (health checks, `docker compose`
healthcheck) and not be called from the UI.

## ~~SSE event type mismatch~~ — resolved

Fixed in feature/frontend-wiring: the frontend's `AppEvent`/`AppEventType` now live
in `apps/frontend/src/app/core/api/api.types.ts`, manually mirroring the backend's
`apps/backend/src/modules/events/event-bus.service.ts` union. Still no
`packages/shared` workspace package — both sides must be updated together when the
union changes. `font.*` events remain unimplemented (font resolution is postponed —
see plan.md).

## Profiles and Projects CRUD + file endpoints

Implemented on the backend (`apps/backend/src/modules/profiles`,
`apps/backend/src/modules/projects`), feature/projects-and-compile branch:

- `GET/POST /api/profiles` — consumed (feature/frontend-wiring: profile picker)
- `GET/POST/PUT/DELETE /api/projects`, `/api/projects/:id` — consumed
  (profile picker's workspace list/create/rename/delete, UI overhaul branch).
- `GET/PUT/DELETE /api/projects/:id/files/*` — consumed: `GET`/`PUT` by the
  editor's load/save, `DELETE` by the file tree's delete action.
- `GET /api/projects/:id/files` — recursive listing,
  `{ path: string, size: number, isDirectory: boolean }[]`, paths are `/`-joined
  relative to the project root regardless of host OS. Symlinks that resolve
  outside the project root are silently skipped (not listed, not descended into).
  Consumed by the file tree.
- `POST /api/projects/:id/files/move` — body `{ from: string, to: string }`,
  used for both rename and move. Both paths are confinement-checked. Consumed
  by the file tree's rename action (`window.prompt`-based, no modal yet).
- `POST /api/projects/:id/dirs` — body `{ path: string }`, creates an empty
  directory (including intermediate parents). 409 if anything already exists
  at that path. Confinement-checked. Consumed by the file tree's "Nowy
  katalog" action.

File creation has no dedicated endpoint:
the frontend creates a new file by `PUT`-ing empty content to a new path, which
the backend already supports (`writeFile` creates parent dirs + the file).

## Compile endpoints

Implemented on the backend (`apps/backend/src/modules/compile`),
feature/projects-and-compile branch:

- `POST /api/projects/:id/compile?file=` — compile `.tex` and `.md` (via pandoc,
  through a dedicated Lua filter that rewrites `.svg` image references to `.pdf`
  since SVGs are pre-converted — `docker/pandoc-filters/svg-to-pdf.lua`), with a
  reactive retry loop (architecture.md section 5.3/6.2): on a missing-package
  error, resolves the file to a TeX Live package via a build-time index and
  installs it through `tlmgr`, then retries, capped by a time budget
  (`COMPILE_RETRY_BUDGET_MS`) and by never attempting the same missing file
  twice in one compile. Returns the parsed log result (`success`, `diagnostics`,
  `missingFiles`, raw `log`, `pdfPath`, `timedOut`) plus an `installs` array
  (`{ packageName, installed, message? }` per package the retry loop
  attempted) synchronously in the response body, in addition to the
  `compile.*`/`install.*` SSE events (compile events always emitted, even if a
  pre-step like pandoc throws). The optional `?file=` query param compiles that
  project-relative path instead of the project's configured `mainFile` (user
  request, UI overhaul M6 follow-up: compiling shouldn't require the open file
  to be named `main.tex`) — validated the same way `mainFile` is
  (`isValidMainFile`) plus an existence check against the project directory
  (400 if either fails). `GET /output.pdf` and `GET /synctex` take the same
  `?file=` param, so the PDF/synctex endpoints stay in sync with whichever
  target was actually compiled.
- `GET /api/projects/:id/output.pdf?file=` — streams the most recent compiled
  PDF for the given target (or `mainFile` if `file` is absent), with
  `Cache-Control: no-store` (feature/frontend-wiring) so a recompile is never
  masked by a stale cached response.
- `GET /api/projects/:id/synctex?page&x&y&file=` — maps a PDF click back to a
  project-relative source file + line via `synctex edit` (UI overhaul M6).

`POST /compile` consumed by `PdfPreviewComponent`'s `.pv-bar` compile button,
which also drives `CompilePanelComponent` (now presentational — takes
`[result]` as an input) rendering `installs`/`diagnostics` from the synchronous
response and a live log from the `compile.*`/`install.*` SSE events.
`GET /output.pdf` consumed by `PdfPreviewComponent` (renders all pages via
pdf.js), refreshed when a compile response's `pdfPath` is non-null. All three
endpoints' `?file=` is driven by `ProjectWorkspaceComponent`'s `compileTarget`
computed signal: the currently open file when it's `.tex`/`.md`, otherwise
`undefined` (backend defaults to `mainFile`).

Nothing left unconsumed in this section.
