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
keeping the two manually in sync until compile/install events are actually emitted and
consumed.
