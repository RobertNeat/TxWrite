# Current session plan

Branch `feature/ui-overhaul`. UI overhaul milestones M1–M7 are complete (see
git history for details). See `docs/contracts/milestones.md` for the
remaining milestone sequence.

No work actively in progress — ZIP import endpoint (`POST
/api/projects/import?ownerProfileId=&name=`, creates a new project from an
uploaded ZIP) is implemented and verified live, pending commit.
`ProjectFilesService.importArchive()` validates entry count, total
uncompressed size, and every entry's path confinement (zip-slip) before
writing anything, so a rejected import leaves no partial project; entries
are written as plain files/dirs only (no real symlinks from a "symlink"
entry). Wired to the profile picker's "Importuj ZIP" button
(`#impBtn`/hidden `#zipIn` file input) per the mockup, naming the project
after the ZIP filename with a `-2`/`-3` suffix on collision.

Known limitation, not yet addressed: an imported project's `mainFile`
always defaults to `main.tex` regardless of what the ZIP actually
contains (e.g. importing this session's own export.zip round-trip, whose
sources lived under `rozdziały/`, opens the editor on a nonexistent
`main.tex`) — no main-file detection on import yet, matches the "Zip
templates in the wild... need good defaults" item in
project_assumptions.md, not tied to this milestone's zip-slip/size-limit
scope.

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
