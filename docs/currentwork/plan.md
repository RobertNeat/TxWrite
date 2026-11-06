# Current session plan

Branch `feature/ui-overhaul`. UI overhaul milestones M1–M7 are complete (see
git history for details). `docs/contracts/milestones.md` is now empty —
every tracked backend-gap milestone from the UI overhaul has been
implemented; next milestones need to be freshly planned with the user.

No work actively in progress — export formats beyond PDF (`GET
/api/projects/:id/export?format=md|tex|html|docx&file=`, the mockup's
"Eksportuj" split button: PDF, Markdown, LaTeX, HTML, Word, Projekt/ZIP) is
implemented and verified live, pending commit. `ExportService` converts via
pandoc (already in the image) for cross-format conversions, or hands back
the raw file for same-format-as-source. The "LaTeX" format is not just the
raw main file — the mockup specifies "jeden plik z dołączonymi
rozdziałami" (one file with chapters inlined), so a `.tex` source is
flattened with `latexpand` (added to the Dockerfile via `tlmgr install`,
user-approved; confirmed present via `which latexpand` after a `--no-cache`
rebuild, since one earlier incremental build silently skipped that layer —
its log came back empty, likely a stale background-task id after a context
compaction, root cause not otherwise identified). Every pandoc call runs a
new `docker/pandoc-filters/safe-images.lua` filter: verified empirically
that pandoc's `--embed-resources`/docx image embedding will both attempt
outbound fetches for remote image URLs (SSRF) and inline arbitrary local
files by absolute path as base64 — the filter strips any Image src that's
a URL, absolute path, or contains `..`; verified fixed by exporting the
same payload before and after adding the filter. Wired to a new split
button in `PdfPreviewComponent`'s `.pv-bar` (`#split`/`#exp-car`/
`#exp-pop`), which also drives PDF (compiles if stale) and ZIP from the
same menu and remembers the last format in `localStorage`.

Bug found and fixed during live verification: `ExportService` initially
passed the export-menu's format keys (`md`, `tex`) directly as pandoc's
`-t`/`-f` writer names, but pandoc's own writer names are `markdown` and
`latex` — every `format=md`/`format=tex` pandoc conversion failed with 422
("Unknown output format"). Added a `PANDOC_WRITERS` map; re-verified all 7
backend checks (latexpand flattening, HTML MathML + image embed, docx
validity, md/tex pandoc conversions both directions, the safety filter,
and 422-not-500 on broken LaTeX) plus the frontend split button (menu
contents/order, checkmark, Esc/outside-click close, download capture via
an overridden `HTMLAnchorElement.prototype.click`, `localStorage`
persistence, button title update) pass.

Flagged to the user, not fixed (out of scope for this milestone): `getFile`
already serves `.svg` with `Content-Type: image/svg+xml`; an SVG containing
`<script>`, opened at its raw file URL (the binary-preview milestone's
"paste link in a new tab" feature), executes in the app's origin. The ZIP
import milestone made untrusted SVGs a realistic input (an imported
project's SVG wasn't authored by this app). Not touched here since it's
unrelated to export-format conversion; worth its own small fix
(`Content-Security-Policy: sandbox` on `.svg` responses only — check it
doesn't break any legitimate inline-SVG use first).

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
