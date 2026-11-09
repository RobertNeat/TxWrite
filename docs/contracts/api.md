# Open contracts between backend and frontend

## `install.*`/`font.*` SSE events, `CompileResult.installs`/`.fontResolutions` — backend emits, frontend doesn't render

Both `install.*` (packages) and `font.*` (fonts) events are emitted by the
backend (`ResourceResolverService`/`FontResolverService`) and typed on the
frontend (`AppEventType`, `CompileResult.installs`/`.fontResolutions` in
`api.types.ts`), but nothing in the frontend subscribes to them or renders
them — `StatusBarComponent` only shows connect/disconnect, and
`CompilePanelComponent` only renders `diagnostics`, not
`installs`/`fontResolutions`. A user sees no UI feedback while a package or
font installs in the background (prefetch) or during a compile retry — only
the eventual compile success/failure. Scoped for next cycle in
`docs/currentwork/plan.md` (status-bar line, queued, separate from the
compile log panel).
