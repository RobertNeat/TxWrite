# Current session plan

- empty

# Postponed for future sessions

- TeX Live / pandoc toolchain installation inside Docker image (base image build, package pinning: `scheme-basic` from a frozen dated snapshot — see docs/project_assumptons/architecture.md section 6.6 for the concrete snapshot-source decision). Runtime stage in Dockerfile has an apt-get placeholder step ready for this, positioned before the app COPY so it won't bust app-layer caching. `docker-compose.yml`'s `TEX_REPO_URL` is currently a forward-looking placeholder pointed at a dated historic path — confirm/update the exact date against whatever TeX Live release actually gets pinned
- UID/mount-namespace isolation for compile child processes (currently: container has no `USER` directive, runs as root; near-term boundary is `openin_any` restriction + Unix file permissions only — see docs/project_assumptons/architecture.md section 8)
- Actual compile pipeline (latexmk, pandoc invocation), log parser
- Resource resolver / font resolution implementation
- Real file storage, SQLite schema (raw SQL via node:sqlite for now), migrations
- Prefetch watcher logic
- Template gallery content
- Revisit ORM/query-builder choice once a maintained node:sqlite driver exists for drizzle-orm (or similar) — see docs/project_assumptons/technology.md section 4
- PDF preview component wiring (pdfjs-dist installed, not yet used)
- See docs/contracts/api.md for the two open backend/frontend contract items (unconsumed health endpoint, SSE event type union not shared between apps)
