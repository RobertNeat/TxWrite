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

## Milestone 3: reactive retry loop + package resolution
- [ ] File→package index built at image build time from the pinned snapshot's texlive.tlpdb (check tlpdb name/runfiles line format first) — not `tlmgr search` per miss (architecture.md section 6.2)
- [ ] Retry loop capped by "no new install in last iteration" / time budget, not fixed count (section 5.3)
- [ ] Resource Resolver module: missing-package detection from log, install via tlmgr through the Job Queue
- [ ] install.queued / install.started / install.finished / install.failed SSE events
- [ ] After a tlmgr install with unchanged sources, check whether latexmk reports "up-to-date" instead of rerunning — if so, retry passes need `-g` to force a fresh pass
- [ ] End-to-end test: polyglossia-needing document compiled through the API with zero packages pre-installed

## Milestone 3: reactive retry loop + package resolution
- [ ] File→package index built at image build time from the pinned snapshot's texlive.tlpdb (check tlpdb name/runfiles line format first) — not `tlmgr search` per miss (architecture.md section 6.2)
- [ ] Retry loop capped by "no new install in last iteration" / time budget, not fixed count (section 5.3)
- [ ] Resource Resolver module: missing-package detection from log, install via tlmgr through the Job Queue
- [ ] install.queued / install.started / install.finished / install.failed SSE events
- [ ] End-to-end test: polyglossia-needing document compiled through the API with zero packages pre-installed

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
