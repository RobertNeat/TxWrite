# Open contracts between backend and frontend

## `CompileResult.installs`/`.fontResolutions` — backend emits, frontend doesn't render

`StatusBarComponent` now renders the live `install.*`/`font.*` SSE events
(transient queued line, see `docs/currentwork/plan.md` history). The
remaining gap: `CompileResult.installs`/`.fontResolutions` — the final,
per-compile summary returned alongside `diagnostics` — are still typed on
the frontend (`api.types.ts`) but not rendered anywhere. `CompilePanelComponent`
only renders `diagnostics`. A user who missed the transient status-bar line
(e.g. reloaded mid-compile) has no way to see after the fact which packages/
fonts were installed/resolved during that compile.
