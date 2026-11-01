# Current session plan

- empty

# Postponed for future sessions

- Actual compile pipeline wiring into the backend (Compile module, log parser, retry loop) — feature/texlive-toolchain only proved the toolchain works via CLI/docker run, not through the API yet
- Resource resolver / font resolution implementation
- UID/mount-namespace isolation for compile child processes (currently: container has no `USER` directive, runs as root; near-term boundary is `openin_any` restriction + Unix file permissions only — see docs/project_assumptons/architecture.md section 8)
- Real file storage, SQLite schema (raw SQL via node:sqlite for now), migrations
- Prefetch watcher logic
- Template gallery content
- Revisit ORM/query-builder choice once a maintained node:sqlite driver exists for drizzle-orm (or similar) — see docs/project_assumptons/technology.md section 4
- PDF preview component wiring (pdfjs-dist installed, not yet used)
- See docs/contracts/api.md for the two open backend/frontend contract items (unconsumed health endpoint, SSE event type union not shared between apps)
