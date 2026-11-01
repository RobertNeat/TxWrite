# Current session plan

- empty

# Postponed for future sessions

- TeX Live / pandoc toolchain installation inside Docker image (base image build, package pinning) — runtime stage in Dockerfile has an apt-get placeholder step ready for this, positioned before the app COPY so it won't bust app-layer caching
- Actual compile pipeline (latexmk, pandoc invocation), log parser
- Resource resolver / font resolution implementation
- Real file storage, SQLite schema (raw SQL via node:sqlite for now), migrations
- Prefetch watcher logic
- Template gallery content
- Revisit ORM/query-builder choice once a maintained node:sqlite driver exists for drizzle-orm (or similar) — see docs/project_assumptons/technology.md section 4
- PDF preview component wiring (pdfjs-dist installed, not yet used)
- See docs/contracts/api.md for the two open backend/frontend contract items (unconsumed health endpoint, SSE event type union not shared between apps)
