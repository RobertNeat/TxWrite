# Current session plan

Branch: feature/projects-and-compile — zero-to-working compile: SQLite schema +
Projects CRUD/file storage, then a real `POST /api/projects/:id/compile` for `.tex`
(with `.md` via pandoc as a thin pre-step), log parsing, reactive package retry loop,
and `compile.*`/`install.*` SSE events. Three milestones, one commit each.

In scope: minimal profiles, projects + file CRUD, `.tex`/`.md` compile, log parser,
retry loop with package resolution, SSE events for compile/install.
Out of scope (stays postponed): zip import/export, upload, templates, prefetch
watcher, font resolution, frontend wiring, toolchain info in /api/health.

## Milestone 1: storage, migrations, Projects CRUD — done, committed
Implemented: SQLite schema via `PRAGMA user_version` migrations (no migration
library), Profiles + Projects tables, UUID project IDs validated before touching
any filesystem path, full Projects CRUD + file CRUD (`GET/PUT/DELETE
/api/projects/:id/files/*`) with path confinement, Fastify octet-stream parser +
bodyLimit. 26 unit tests, full verify suite green. Logged the two new unconsumed
endpoint groups in docs/contracts/api.md.

## Milestone 2: single-run compile — done, committed
Implemented and verified end-to-end through the real API on fresh container volumes:
- `.tex` and `.md` (via pandoc) single-pass compile, `POST /api/projects/:id/compile` + `GET /api/projects/:id/output.pdf`
- cwd=project dir + `TEXINPUTS` including the work dir (§5.1 updated — `-outdir`/`-auxdir` alone isn't enough for `\input` to resolve)
- SVG pre-conversion (native `.tex` and Markdown via a Lua filter rewriting `.svg`→`.pdf`, `docker/pandoc-filters/svg-to-pdf.lua`)
- Per-project compile queue (concurrency 1) + global cap, engine mapping (pdflatex/xelatex/lualatex) validated at project create/update
- `mainFile`/`engine` validated against an allowlist before ever reaching a spawned command line (rejects traversal, option-injection like `-pdflatex=...`)
- Log parser from real captured logs; stdout/stderr drained (not piped-and-ignored, which deadlocked large documents) with a bounded diagnostic tail
- Exit-code-driven success + log-mtime check, so a failed run never reports a stale previous compile's log as this run's result
- `compile.started`/`compile.finished` SSE events, always emitted including on pre-step (pandoc) failure
- 52 unit tests (including compile-validation, stale-artifact and pipe-related regressions), full verify + e2e suite green

## Milestone 3: reactive retry loop + package resolution — done, committed
Implemented and verified end-to-end through the real API on fresh container volumes
(zero packages pre-installed, confirmed via `kpsewhich`):
- File→package index built at image build time (`docker/build-package-index.pl`) from the pinned snapshot's cached, GPG-verified remote tlpdb — runfiles only (docfiles/srcfiles excluded to avoid resolving generic names like example.tex), already-locally-installed packages excluded (so the kernel/biblatex/hyphenation can never be re-touched by a lazy install, section 6.6), one preferred package per file
- Resource Resolver module: tlmgr user-mode install, serialized + deduplicated through the Job Queue (two concurrent compiles needing the same package share one install and one result)
- Retry loop in CompileService: capped by time budget and by never re-attempting the same missing file twice in one compile (section 6.7); `-g` forces a fresh latexmk pass after an install so an unchanged-sources "up-to-date" result doesn't mask the newly-installed package
- Fixed: latexmk's own legitimate "Nothing to do" (unchanged sources, exit 0) was being misreported as a failure by the log-mtime check from Milestone 2 — now only an actual non-zero exit before a log is produced counts as a failure
- install.queued / install.started / install.finished / install.failed SSE events; `CompileResult` now includes an `installs` array
- NETWORK_FETCH=false honored with the exact section 6.7 message, short-circuiting before any install attempt
- Log parser: added the tikz-library-missing pattern (`architecture.md` section 6.2's own `tikzlibrarycd.code.tex` example) — wraps across lines without `max_print_line` set wide enough, checked for in both places
- Runtime image was missing gnupg, so lazy installs were unverified despite the toolchain-branch commit claiming "both build stages" — fixed, confirmed `(verified)` in tlmgr output
- 72 unit tests (dedup/outcome propagation, per-compile attempt tracking, NETWORK_FETCH short-circuit, tikz-library log fixture), full verify + e2e suite green
- Verified: polyglossia (xelatex, lazy-installed) and tikz-cd (pdflatex, lazy-installed) documents compiled from zero via the real API; SSE event order correct; installed packages persist across container restart with zero re-install events; user tree stays limited to the actually-needed package (verified via `tlpkg/tlpobj` listing)

# Postponed for future sessions

- Container startup readiness/healthcheck (entrypoint's luaotfload warmup blocks HTTP briefly on a fresh /cache volume)
- Font resolution (chain beyond "already installed")
- UID/mount-namespace isolation for compile child processes (architecture.md section 8)
- Prefetch watcher logic
- Template gallery content, zip import/export, file upload endpoint
- Revisit ORM/query-builder choice once a maintained node:sqlite driver exists for drizzle-orm (or similar)
- PDF preview component wiring (pdfjs-dist installed, not yet used)
- Frontend wiring for any of the above — this branch is backend-only
- See docs/contracts/api.md for open backend/frontend contract items
