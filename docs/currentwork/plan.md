# Current session plan

Branch `feature/ui-overhaul`. UI overhaul milestones M1–M7 are complete (see
git history for details). See `docs/contracts/milestones.md` for the
remaining milestone sequence.

No work actively in progress — ZIP export endpoint (`GET
/api/projects/:id/export.zip`, whole-project download) is implemented and
verified live, pending commit. `ProjectFilesService.createArchive()`
streams a ZIP built from `listFiles()` (not archiver's own directory()
walk, so the existing symlink-confinement check also protects export),
including empty directories. Wired to two UI surfaces per the mockups: the
editor's file-tree toolbar (`#bZip` equivalent) and the profile picker's
per-project kebab menu ("Eksportuj jako ZIP"), both plain `<a download>`
links. Both reuse the `.ib`/`.mi` button classes shared with regular
`<button>`s, so those classes got `color: inherit; text-decoration: none;
cursor: pointer` added — otherwise the browser's default link styling
(blue, underlined) showed through on the anchor variant.

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
