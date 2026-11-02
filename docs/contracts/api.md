# Open contracts between backend and frontend

## GET /api/health

Implemented on the backend (`apps/backend/src/modules/health`), returns
`{ status: 'ok', uptimeSeconds: number }`. Nothing in the frontend calls it yet.
Remove this entry once a frontend consumer (e.g. a status indicator) is added, or once
it's confirmed the endpoint is meant to stay ops-only (health checks, `docker compose`
healthcheck) and not be called from the UI.

## SSE event type mismatch

- Backend (`apps/backend/src/modules/events/event-bus.service.ts`) types `AppEvent.type`
  as a closed union: `AppEventType` (`'compile.started' | 'compile.finished' | ...`).
- Frontend (`apps/frontend/src/app/core/events/event-stream.service.ts`) types the same
  field as plain `string`.

No shared-types package exists yet, so the two sides can drift silently. Resolve by
either introducing a `packages/shared` workspace package with the event type union (and
importing it from both apps), or by duplicating the exact union on the frontend and
keeping the two manually in sync. **Now load-bearing, not just theoretical:** the
Compile module (feature/projects-and-compile) emits real `compile.started` /
`compile.finished` events over `/api/events`; `install.*` events will follow once
Milestone 3's resource resolver lands.

## Profiles and Projects CRUD + file endpoints

Implemented on the backend (`apps/backend/src/modules/profiles`,
`apps/backend/src/modules/projects`), feature/projects-and-compile branch:

- `GET/POST /api/profiles`
- `GET/POST /api/projects`, `GET/PUT/DELETE /api/projects/:id`
- `GET/PUT/DELETE /api/projects/:id/files/*` (binary bodies via
  `application/octet-stream`)

Nothing in the frontend calls any of these yet — the file tree, project list, and
profile picker UI are all still placeholders. Remove each endpoint's entry here once
a frontend consumer exists for it, or fold this into a single "frontend data layer"
contract item if several land together.

## Compile endpoints

Implemented on the backend (`apps/backend/src/modules/compile`),
feature/projects-and-compile branch:

- `POST /api/projects/:id/compile` — single-pass compile, `.tex` and `.md` (via
  pandoc, through a dedicated Lua filter that rewrites `.svg` image references to
  `.pdf` since SVGs are pre-converted — `docker/pandoc-filters/svg-to-pdf.lua`). No
  retry loop or package resolution yet (Milestone 3). Returns the parsed log result
  (`success`, `diagnostics`, `missingFiles`, raw `log`, `pdfPath`, `timedOut`)
  synchronously in the response body, in addition to the `compile.started`/
  `compile.finished` SSE events (always emitted, even if a pre-step like pandoc
  throws).
- `GET /api/projects/:id/output.pdf` — streams the most recent compiled PDF.

Not implemented yet: the reactive retry loop and any frontend consumer (compile
button, PDF preview, structured log display).
