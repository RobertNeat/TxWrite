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

## Milestone 2: single-run compile
- [ ] Fixture project in /data with: an `\input{...}`, a project image, and a pre-converted SVG — confirms whether architecture.md section 5.1's `-outdir`/`-auxdir`-against-/data design actually keeps the project directory clean (prior verification only tested a single top-level SVG, not `\input` or minted's `_minted/` leaking into /data)
- [ ] If the file-listing-unchanged assertion fails: switch to running with CWD = work dir + `TEXINPUTS` pointing at the project dir, and update architecture.md section 5.1 accordingly (ask before committing to this change, rule 5)
- [ ] POST /api/projects/:id/compile (single pass, no retry yet): spawn latexmk detached, kill process group on timeout, `-norc -interaction=nonstopmode -file-line-error -shell-restricted`, `max_print_line=10000`
- [ ] Per-project compile queue (concurrency 1, p-queue) + global concurrency cap
- [ ] Log parser (built from real captured logs, not assumed formats) + GET /api/projects/:id/output.pdf
- [ ] compile.started / compile.finished SSE events wired to the real EventBusService
- [ ] End-to-end container test: create project via API, PUT files, POST compile, GET output.pdf

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
