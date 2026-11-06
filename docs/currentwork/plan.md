# Current session plan

Branch `feature/ui-overhaul`. UI overhaul milestones M1–M7 are complete (see
git history for details). See `docs/contracts/milestones.md` for the
remaining milestone sequence.

No work actively in progress — profile delete endpoint (`DELETE
/api/profiles/:id`, cascading to delete all of that profile's projects, DB
rows and working-directory files) is implemented and verified live, pending
commit. Along the way, fixed a pre-existing bug in `shared/scramble.ts`:
it replaced an element's text node via `el.textContent`, which orphaned
Angular's binding reference to that node — any update after the first
scramble (switching profiles, deleting one, logging out) left stale text
on screen. Now mutates the existing text node's `nodeValue` in place.

Known limitation, not yet addressed: two files with the same basename in
different directories (e.g. `a/main.tex` and `b/main.tex`), or `main.tex`
next to `main.md` in the same project, share one `<basename>.pdf`/aux-file
set in the cache work directory — compiling one then viewing/synctex-ing the
other would show stale output. Pre-existing in `compile-runner.service.ts`'s
work-dir layout, not tied to any specific milestone.

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
