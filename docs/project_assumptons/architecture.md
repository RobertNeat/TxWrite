# Architecture

## 1. Overview

One container exposes a web UI and an API. Persistent state lives in volumes. The container itself can be thrown away.

```
Browser
  |  HTTP + SSE
  v
+--------------------------------------------------------+
| Container                                              |
|                                                        |
|  Frontend (static assets)                              |
|     editor | file tree | PDF preview | log | status    |
|                                                        |
|  Backend API                                           |
|     Profiles | Projects | Templates | Compile          |
|     Resource Resolver (packages, fonts)                |
|     Prefetch Watcher | Job Queue | Event stream        |
|                                                        |
|  Toolchain                                             |
|     TeX Live (minimal) + latexmk + engines             |
|     pandoc + built-in templates                        |
|     fontconfig + curated fonts                         |
|     biber, Python + Pygments                           |
+-------------+--------------------+---------------------+
              |                    |
        /data (volume)       /cache (volume)
        projects, templates  TeX user tree, fonts,
        SQLite DB            download cache
```

## 2. Frontend

- **File tree**: create, rename, delete, upload files and images, import and export zip.
- **Editor**: syntax highlighting for LaTeX and Markdown.
- **PDF preview**: renders the latest compiled PDF.
- **Compile panel**: compile button, optional auto-compile, structured log with clickable errors.
- **Status bar**: live events such as "Installing package `tikz-cd`", "Fetching font `Inter`" or "Compiling".
- **Settings per project**: engine, main file, template type, Markdown template choice.
- **Profile picker**: select a profile with no password; this is only a grouping.
- **Template picker**: list templates with LaTeX and Markdown badges; create a project from a template; import a template zip.

The frontend is built into static assets and served by the backend, so it adds no runtime footprint beyond a few MB.

## 3. Backend modules

| Module | Responsibility |
|---|---|
| Profiles | Create and list simple profiles (no auth) |
| Projects | Project metadata, file operations, zip import and export |
| Templates | Template storage, manifest parsing, type detection |
| Compile | Pipeline selection, execution, log parsing, result PDF |
| Resource Resolver | Maps missing packages and fonts to installable resources and installs them |
| Prefetch Watcher | Scans edited content for package and font references and queues background installs |
| Job Queue | Serializes installs, tracks job state |
| Events | Pushes compile and install status to the browser (SSE) |

### API sketch
All backend routes are served under the `/api` prefix (decision, 2026-11-01), since the backend also serves the built frontend SPA from the same origin and plain paths like `/projects` would otherwise collide with Angular routes. The frontend dev server proxies `/api` to the backend (`apps/frontend/proxy.conf.json`).

- `GET/POST /api/profiles`
- `GET/POST /api/projects`, `GET/PUT/DELETE /api/projects/:id`
- `GET/PUT/DELETE /api/projects/:id/files/*`, `POST /api/projects/:id/upload`
- `POST /api/projects/:id/import`, `GET /api/projects/:id/export`
- `GET/POST /api/templates`, `POST /api/projects/from-template`
- `POST /api/projects/:id/compile`, `GET /api/projects/:id/output.pdf`
- `POST /api/projects/:id/scan` (editor content for prefetch)
- `GET /api/events` (SSE stream of install and compile events) — implemented as a stub in this session, emits no events yet
- `GET /api/health` (toolchain/app health check) — implemented in this session

## 4. Storage layout

```
/data
  app.db                      SQLite: profiles, project metadata, templates index, job state
  projects/<project-id>/      the project files (sources, images, fonts/, bib)
  templates/<template-id>/    built-in and user-imported templates
/cache
  texmf-user/                 TeX user tree: lazily installed packages
  fonts/                      lazily fetched fonts (registered with fontconfig)
  downloads/                  HTTP download cache
  work/                       temporary compile directories
```

Both `/data` and `/cache` are named volumes. Deleting `/cache` is always safe: it only costs re-download time.

## 5. Compile pipeline

### 5.1 LaTeX
1. Copy or lock the project into a temp working directory under `/cache/work`.
2. Determine engine: magic comment (`% !TEX program = xelatex`), then `latexmkrc`, then project setting.
3. Run `latexmk` with the chosen engine, shell-escape enabled, with timeout and resource limits.
4. `latexmk` handles repeated passes, bibliography (`biber`/`bibtex`) and index steps.
5. Parse the log, return PDF plus structured diagnostics.

### 5.2 Markdown
1. Choose the Markdown template mode:
   - **Pandoc template**: `pandoc --template <file>` with xelatex or lualatex.
   - **Class reuse**: pandoc default template with `documentclass` from YAML.
   - **Wrapper template** (later): pandoc outputs a LaTeX fragment and metadata file, then the template's main file is compiled with `latexmk`.
2. Pandoc invokes the LaTeX engine, so the same package and font resolution applies.
3. Return PDF plus diagnostics.

### 5.3 Retry loop (reactive resolution)
```
compile
  success -> done
  failure -> parse log for resolvable errors
     missing package or file  -> resolve package, install, retry
     missing font             -> resolve font, install, retry
     other                    -> return error to user
```
The loop has a maximum number of iterations per compile (for example 5) to avoid endless retries. Each iteration emits status events.

## 6. Lazy library management

### 6.1 Principle
The base image has a minimal TeX installation. Everything else is installed into a **user tree on the cache volume**, so it survives container replacement and does not require root.

### 6.2 Package resolution
- **By name** (from `\usepackage{foo}`, `\RequirePackage`, `\documentclass{foo}`, `\usetikzlibrary{...}`): try installing the package directly.
- **By file** (from "File `foo.sty' not found"): ask `tlmgr search --global --file foo.sty` to find which package provides it, then install that package.
- Dependencies are handled by `tlmgr`.
- Installs are serialized through the job queue. A compile that needs a package waits for its pending install.

### 6.3 Reactive mode (always on)
Triggered by compile failure, as described in 5.3. This is the guaranteed path: whatever the user writes, a compile will pull what it needs.

### 6.4 Proactive mode (prefetch while editing)
Goal: when the user pastes TeX that uses a new package, the package is already installed by the time they press compile.

1. The editor sends content (debounced) to `/scan`.
2. The Prefetch Watcher extracts package references (`\usepackage`, `\RequirePackage`, `\documentclass`, `\usetikzlibrary`, `\setmainfont` and similar font commands).
3. Each reference that is not installed becomes a **candidate** with a timestamp.
4. A candidate is promoted to a background install only if it is **still present after X seconds** (configurable, default a few seconds). This avoids downloading packages for half-typed names.
5. Installs run in the background queue. Status events tell the UI.
6. If the reference is removed from the source before promotion, the candidate is dropped.
7. If the user compiles while an install is running, the compile waits for that job.

Prefetch is an optimization. Reactive mode remains the source of truth.

### 6.5 Download proxying and caching
- `tlmgr` is configured with a repository URL. That URL can point to the official mirror or to a **local caching proxy** (a small HTTP caching layer in the backend or a sidecar), which stores downloads under `/cache/downloads`.
- Benefits: repeated installs after a cache reset are fast, an offline mirror is possible, and an allowlist and logging point exists.
- The repository URL is a setting, so users can point it at a corporate or local mirror.

### 6.6 Release pinning
- TeX Live is installed from the upstream installer (not the distribution package manager), pinned to a specific release, so `tlmgr` can operate.
- When upstream moves to a newer release, the pinned release's packages live in the historic repository. The configured repository must therefore point to the matching historic location after rollover.
- Upgrading the pinned release means rebuilding the image; the cache must be invalidated (or namespaced by release) to avoid mixing versions.

### 6.7 Failure handling
- No network and package not cached: show "Package X is not installed and needs a download. Connect to the network and compile again."
- Unknown package: surface the TeX error as is.
- Install failure: report the `tlmgr` error and stop retrying that package for the current compile.

## 7. Font resolution

Fonts use the same detect, resolve, install, retry shape.

**Detection** (from log): `The font "X" cannot be found`, luaotfload "cannot be found", xelatex "not loadable".

**Resolution chain:**
1. Already installed (`fc-match`).
2. Project `fonts/` folder (made available to fontspec through the project path).
3. TeX Live font package (`tlmgr search --file`).
4. Google Fonts through an allowlisted source (the `google/fonts` repository or a Fontsource mirror).
5. Failure message: "Font X not found. Upload the font file to this project's fonts folder."

**Installation:** fetched fonts go to `/cache/fonts`, registered through a fontconfig configuration file, followed by `fc-cache`, then the compile retries.

**Commercial fonts:** mapped to metric-compatible substitutes (Liberation, Carlito, Tinos) with a UI warning. Never fetched from unofficial sources.

**Proactive font prefetch** follows the same candidate and delay mechanism as packages (6.4).

## 8. Security and limits

- Compiles run inside the container, in a temporary working directory per compile.
- Limits: wall-clock timeout, memory cap, CPU cap, output size cap, and a cap on concurrent compiles.
- Zip import: reject absolute paths and `..` segments, enforce total size and file count limits.
- Download sources are allowlisted (TeX repository mirror, font sources). Network fetching can be disabled by an admin setting.
- No authentication in the initial version. The app should bind to localhost by default and warn when exposed more widely.

## 9. Docker and deployment

- A single image containing frontend assets, backend, and toolchain.
- `docker compose up` starts it with two named volumes: `data` and `cache`.
- Default port exposed on localhost.
- Environment settings: TeX repository URL, prefetch delay, compile timeout, limits, network fetching on or off.
- Image layering keeps the toolchain layers stable so rebuilds are fast and downloads are cached by Docker.

## 10. Events and observability

- SSE stream carries: `compile.started`, `compile.finished`, `install.queued`, `install.started`, `install.finished`, `install.failed`, `font.*`.
- Install and compile logs are stored per project for debugging.
- A simple health endpoint reports toolchain versions and cache size.
