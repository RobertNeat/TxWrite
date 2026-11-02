# Current session plan

No work currently planned on `feature/frontend-wiring`. All 5 milestones
(profile/project shell, file tree + editor, compile + log + diagnostics, PDF
preview) are complete and committed. See git log for details.

## Bug fixes after user testing (this session)
- Editor accepted input with no file open (new file wasn't auto-selected after
  creation, so pasted content went nowhere and was silently lost) — fixed:
  FileTreeComponent.create() now auto-opens the new file, and the editor is
  read-only until a file is actually loaded (no more silent "paste into the
  void").
- Save-on-switch race: editing file A then switching to file B within the
  800ms debounce window could write A's content to B — fixed: the pending save
  now captures its target path at edit time, and loadCurrentFile flushes any
  pending save before swapping the editor's state.
- Misleading compile error after a prior failed compile on unchanged sources:
  latexmk's own "Nothing to do" cache replies with a non-zero exit code and a
  stale "gave an error in previous invocation" meta-message instead of a fresh,
  readable diagnostic — fixed in CompileRunnerService.runOnce: that case now
  forces one fresh pass (reusing the existing -g/forceRebuild mechanism) so the
  user always sees a current error, not a cached one.
- Verified via docker compose build + the running container: a CV document
  with lato/tikz/geometry/hyperref compiles successfully (was never actually
  broken — the reported "crash" was the silently-lost-paste bug above); the
  stale-failure case (empty/broken main.tex, recompiled unchanged) now reports
  a real diagnostic (e.g. "File 'photo.jpg' not found") instead of latexmk's
  cached meta-message.

# Postponed for future sessions

- **UI/UX overhaul** (user-flagged, 2026-11-02): current UI is functional but
  deliberately bare — a CSS grid shell with no visual design, spacing,
  contrast, or responsiveness. User approved doing this as its own dedicated
  branch after functional work settles, not mixed with logic changes. Includes
  at minimum: visual design pass, layout/spacing, and reconsidering
  interaction patterns that are impractical (e.g. window.prompt()-based
  rename).
- File upload endpoint (would also let users import an existing .tex instead
  of hand-typing/pasting into the editor — directly related to the paste bug
  above, since there'd be a less error-prone path for bringing in an existing
  document).
- Container startup readiness/healthcheck (entrypoint's luaotfload warmup blocks HTTP briefly on a fresh /cache volume)
- Font resolution (chain beyond "already installed")
- UID/mount-namespace isolation for compile child processes (architecture.md section 8)
- Prefetch watcher logic
- Template gallery content, zip import/export
- Revisit ORM/query-builder choice once a maintained node:sqlite driver exists for drizzle-orm (or similar)
- Auto-compile on edit
- See docs/contracts/api.md for open backend/frontend contract items
