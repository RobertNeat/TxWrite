# Technology

This document lists the proposed technology for each part and the reasoning. Sizes are rough estimates and need to be measured once an image exists.

## 1. Packaging and runtime

**Docker + Docker Compose.**
- One image, started with `docker compose up`.
- Two named volumes: `data` (projects, templates, database) and `cache` (TeX user tree, fonts, downloads, temp work).
- Multi-stage build: build frontend and backend in builder stages, copy only the results into the runtime image.
- Base: a slim Debian or Ubuntu image. Debian slim is a good default since the TeX Live upstream installer and most tools work without friction.

## 2. Backend

### Options considered

| Option | Pros | Cons |
|---|---|---|
| **NestJS (TypeScript)** | Structured modules, dependency injection, good fit for the module list in `architecture.md`, same language as the frontend | Some framework overhead |
| Fastify or Express only | Smallest and simplest | You design the structure yourself |
| FastAPI (Python) | Quick to write, good subprocess handling | Second language if the frontend is TypeScript |
| Go | Single small binary, great at subprocess and concurrency | More boilerplate for CRUD, separate language from the frontend |
| Spring Boot | Mature | Heavy for a portable local tool (JVM size and startup) |

### Recommendation
**NestJS with the Fastify adapter.**
- A single language (TypeScript) across frontend and backend.
- The module structure maps directly to Profiles, Projects, Templates, Compile, Resource Resolver, Prefetch.
- Fastify adapter keeps request overhead low.
- Heavy work happens in child processes (`latexmk`, `pandoc`, `tlmgr`), so the backend language is not a performance bottleneck.

If a lighter footprint is preferred, plain Fastify with the same module split works with little loss.

## 3. Frontend

### Options considered
- **Angular**: structured, fits well next to NestJS (similar patterns), good tooling.
- React or Svelte (with Vite): lighter, faster to prototype.
- Vue: middle ground.

The frontend is built into static assets, so runtime weight is not a deciding factor. Choose based on familiarity.

### Recommendation
**Angular** for a coherent TypeScript stack with the backend, or **Svelte/React with Vite** if faster iteration matters more. The API contract in `architecture.md` keeps the frontend swappable.

**Decision (2026-11-01):** Angular, scaffolded via `ng new` (standalone components, Vite-based dev server/builder). Backend is served from the same origin behind the `/api` prefix (see `architecture.md` section 3 update) with Angular handling the SPA shell and routing.

### Frontend libraries
- **Editor:** CodeMirror 6 (light, extensible, good LaTeX and Markdown support). Monaco is heavier.
- **PDF preview:** PDF.js.
- **Live status:** native `EventSource` for SSE.
- **File upload and tree:** standard browser APIs plus a small tree component.

## 4. Data storage

- **SQLite** for profiles, project metadata, template index and job state. Zero setup, one file in the `data` volume.
- **Driver decision (2026-11-01):** `node:sqlite` (`node:sqlite`'s `DatabaseSync`), not `better-sqlite3`. `better-sqlite3` requires a native node-gyp build; on the Windows dev machine used for this project there are no Visual Studio Build Tools, so the install fails. `node:sqlite` ships with Node 24+ and needs no compilation. Trade-off: no ORM yet — `drizzle-orm` 0.45.x has no `node:sqlite` driver (only `better-sqlite3`, `bun-sqlite`, etc.), so queries are raw SQL for now. Revisit the ORM/query-builder choice once a maintained `node:sqlite` adapter exists, or once build tooling for native modules is set up.
- **Filesystem** for project files and templates (one folder per project), so files are inspectable and easy to back up.
- No Redis or external database, to keep the container self-contained.

## 5. Jobs and realtime

- **Job queue:** in-process queue with a concurrency limit (for example `p-queue`). Package and font installs run serially, compiles run with a small concurrency cap, **and compiles for the same project are serialized with a per-project lock** — the compile working directory is persistent per project (see `architecture.md` §5.1), so a concurrent auto-compile and manual compile against the same `.aux`/`.bbl` files would otherwise corrupt the next pass. No external broker.
- **Realtime updates:** Server-Sent Events. Simpler than WebSockets for one-way status updates.

## 6. Compile toolchain

| Piece | Choice | Notes |
|---|---|---|
| TeX distribution | **TeX Live from the upstream installer**, `scheme-basic` + xetex/luatex collections, pinned release, from a **frozen snapshot/mirror** | Required so `tlmgr` can lazily install packages. `scheme-minimal` has no LaTeX at all, so the real floor is `scheme-basic`. A live/rolling repo breaks mid-year when upstream ships a new `texlive.infra`, not only at the yearly rollover — pin to a frozen snapshot from day one |
| Package management | `tlmgr` in user mode, user tree on the `cache` volume | No root needed, survives container replacement. User mode cannot install binaries/scripts (`biber`, `xindy`, `latexminted`'s `bin/` symlink) or update the kernel/formats — those must be baked into the image and excluded from lazy updates |
| Build driver | `latexmk` | Handles multi-pass, bibliography and index automatically. Must run with `-norc` plus an app-controlled rc — a project's own `latexmkrc` is Perl `latexmk` executes automatically and is a code-execution vector from untrusted zip imports |
| Engines | `xelatex`, `lualatex`, `pdflatex` | xelatex or lualatex for fonts and Unicode |
| Bibliography | `biber` (and `bibtex`) | Needed by many templates. `biber` and `biblatex` must come from the same frozen snapshot and be upgraded together, never independently — a drifted `biblatex` from a live repo produces `Found biblatex control file version X, expected Y` |
| Markdown | **pandoc**, pinned release | Static binary keeps it simple. In the *compile* pipeline, pandoc should only ever produce an intermediate `.tex`, never invoke the LaTeX engine itself — otherwise the `.log`-based retry loop and biber integration are bypassed. The *export* feature (UI overhaul) is a separate use: pandoc also runs standalone there to convert a project's source directly to Markdown/HTML/Word for download, with no LaTeX compile involved — that output is a final artifact, not an intermediate |
| Code highlighting | Python 3 + Pygments | Needed for `minted`. minted v3 (`latexminted`) runs under *restricted* shell-escape by design, so it does not require full shell-escape — restricted can be the default |
| Hyphenation / language | `hyphen-polish`, `babel-polish`, `polski` preinstalled | Hyphenation patterns are compiled into formats (`fmtutil`/`language.dat`); a missing pattern only produces a babel warning, not an error, so the reactive retry loop never catches it. Must ship in the base image, never lazy, for every supported language |
| Fonts | `fontconfig` plus a curated set | For example TeX Gyre, Libertinus, Noto, DejaVu, Liberation, Carlito, Inter. XeTeX uses fontconfig; LuaTeX's `luaotfload` does not — it needs its own cache (`TEXMFVAR`) kept on `/cache` |
| Vector graphics | `rsvg-convert` | The backend pre-converts every project SVG to PDF before each compile (independent of pandoc, which only ever produces an intermediate `.tex` — see §6 Markdown row), since `\includesvg` depends on Inkscape via shell-escape, which restricted mode does not allow. See `architecture.md` §8 |
| Markdown templates | Eisvogel plus a few others, bundled | Exposed as built-in templates in the UI |
| Optional | Graphviz | Small, used by some templates and diagrams |

**Optional fast path:** Tectonic as a first attempt with TeX Live as the fallback. This is an optimization, not required for the MVP.

## 7. Libraries for specific features

- **Zip import and export:** a streaming zip library (for example `yauzl` for reading and `archiver` for writing), with explicit zip-slip checks.
- **Subprocess control:** Node `child_process` with timeouts, plus `prlimit` or `ulimit` style limits for memory and CPU.
- **Log parsing:** a small custom parser for TeX logs. It extracts missing file, missing font and error line patterns for the retry loop.
- **Font fetching:** HTTP client with an allowlist, plus `fc-cache` to register fonts.
- **Template manifest:** YAML parser for `template.yaml`.

## 8. Testing

- **Unit tests:** Vitest or Jest for the log parser, package and font resolver, template detection, zip safety.
- **Integration tests:** compile fixtures (simple `.tex`, `.md`, a template with a custom `.cls`, a document with a missing package) inside the real image.
- **End-to-end:** Playwright against the running container: create a project, upload an image, compile, preview the PDF.

## 9. Image size strategy

- Install TeX Live with `scheme-basic` (the smallest scheme that includes LaTeX itself — `scheme-minimal` does not, see §6), skip documentation and source trees, add only a short list of common packages.
- Keep pandoc as a single binary.
- Keep the curated font set modest and rely on lazy fetching for the rest.
- Measure the final size per layer and set a budget. Rough expectation: base OS + TeX `scheme-basic` + pandoc + Python + Node lands in the low single-digit GB range or below; treat this as an estimate to verify.
- **Measured (2026-11-02, feature/texlive-toolchain branch, via `docker history --no-trunc`):** total image ~2.09 GB. Largest layers, correctly attributed to the actual command (the earlier 2026-11-01 measurement mis-attributed one of these): `COPY /opt/texlive /opt/texlive` (the TeX Live install produced in the toolchain stage — install-tl + all `tlmgr install` packages + `fmtutil-sys --all` baked-in formats) ~679 MB; `COPY /usr/local/bin/pandoc` (pandoc 3.5's static binary — genuinely ~150 MB, since it statically links GHC/Haskell plus the full citation/filter/Lua stack; expected upstream, not a packaging bug) ~150 MB; the runtime `apt-get install` layer (ca-certificates, perl, fontconfig, python3-pygments, librsvg2-bin, wget) ~202 MB; Node backend `pnpm install --prod` ~199 MB + the pnpm/corepack setup step ~42 MB. Within budget; no further size work needed yet.

## 10. Suggested build order

1. Image with TeX Live (`scheme-basic`, from a frozen snapshot — see `architecture.md` §6.6), `latexmk`, pandoc, and a CLI-level compile proof.
2. Backend skeleton: profiles, projects, file operations, compile endpoint.
3. Reactive lazy install loop for packages (log parser plus `tlmgr` user mode).
4. Frontend: file tree, editor, PDF preview, compile log.
5. Markdown pipeline with built-in pandoc templates.
6. Zip import and export, template import.
7. Font handling (project fonts first, then lazy fetching).
8. Proactive prefetch watcher.
9. Wrapper templates and a template gallery.
