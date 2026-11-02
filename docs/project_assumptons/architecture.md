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
|     TeX Live (scheme-basic, frozen snapshot) + latexmk |
|     + engines                                          |
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
- `GET /api/events` (SSE stream of install and compile events) — implemented, but no event producers (compile/install pipeline) exist yet, so it currently emits nothing
- `GET /api/health` (toolchain/app health check) — implemented, returns app status only; does not yet report toolchain versions or cache size (see §10)

## 4. Storage layout

```
/data
  app.db                      SQLite: profiles, project metadata, templates index, job state
  projects/<project-id>/      the project files (sources, images, fonts/, bib)
  templates/<template-id>/    built-in and user-imported templates
/cache
  tl-<snapshot-key>/          namespaced by the pinned TeX Live snapshot date (§6.6);
                               a rebuild against a new snapshot gets a fresh tree here
                               instead of mixing package dates with the old one
    texmf-user/                 TeX user tree: lazily installed packages (= TEXMFHOME)
    texmf-var/                   luaotfload font-name DB / cache (= TEXMFCACHE); NOT the
                                  engine's own baked-in formats, which stay in the image
                                  at /opt/texlive/texmf-var and must never be redirected
  fonts/                      lazily fetched fonts (registered with fontconfig)
  downloads/                  HTTP download cache
  work/<project-id>/          persistent per-project compile working directory (§5.1, §8)
```

Both `/data` and `/cache` are named volumes. Deleting `/cache` is always safe: it only costs re-download time.

## 5. Compile pipeline

### 5.1 LaTeX
1. Each project has one **persistent** working directory under `/cache/work/<project-id>` (not a fresh temp directory per compile). `latexmk` relies on previous-pass artifacts (`.aux`, `.bbl`, `.fls`, the `luaotfload`/font caches under `TEXMFVAR`) to avoid redoing work and to converge in the normal number of passes; discarding the directory after every compile would force a from-scratch rebuild — including the first-run font-cache warm-up described in §7 — on every single compile, not just the first. Acquire the project's compile lock (§8) before touching this directory. Sources stay in `/data/projects/<project-id>` (the file tree, zip export, etc. all operate on that copy); run `latexmk` with `-outdir=/cache/work/<project-id>` and `-auxdir=/cache/work/<project-id>` pointed at the persistent work directory, rather than copying sources into `/cache/work` before every compile — that way edited source files are always picked up without a sync step, while build artifacts (`.aux`/`.bbl`/`.fls`/the PDF) persist across compiles in `/cache`.
   - **Process CWD must be the project directory, not `/cache/work`.** `\input{chapters/intro}`-style relative includes are resolved by the engine against its current working directory, which is independent of `-outdir`/`-auxdir`. Spawn `latexmk` with `cwd: /data/projects/<project-id>` (verified: compiling from `/cache/work` with only `-outdir`/`-auxdir` set produced `! LaTeX Error: File 'chapters/intro.tex' not found`, even though the file exists in the project directory).
   - **`TEXINPUTS` must also include the work directory**, so SVG-derived PDFs (§8) and other work-dir-only generated inputs resolve via `\includegraphics`/`\input` even though CWD is now the project directory, not the work directory: `TEXINPUTS=.:/cache/work/<project-id>//:` (the trailing `//` makes kpathsea search it recursively). Verified end to end with a project combining `\input`, a plain `\includegraphics` of a project image, and a pre-converted SVG: all three resolved correctly with `cwd=<project-dir>` + this `TEXINPUTS`, and the project directory's file listing was unchanged after the compile (minted's `_minted/` and all other generated artifacts landed only in the work directory).
2. Determine engine: magic comment (`% !TEX program = xelatex`), then `latexmkrc`, then project setting. **`latexmkrc` must never be executed by latexmk.** `latexmkrc` is Perl that `latexmk` runs automatically from the working directory — a project imported from an untrusted zip can ship one and get arbitrary code execution regardless of shell-escape mode. Run `latexmk -norc` with the app's own rc, and only statically scan a project-provided `latexmkrc` (e.g. regex for `$pdflatex`/`$lualatex` assignments) if the engine hint is taken from it at all.
3. Run `latexmk` with the chosen engine, shell-escape restricted by default (see §8), with timeout and resource limits.
4. `latexmk` handles repeated passes, bibliography (`biber`/`bibtex`) and index steps.
5. Parse the log, return PDF plus structured diagnostics.

### 5.2 Markdown
1. Choose the Markdown template mode:
   - **Pandoc template**: `pandoc --template <file>` with xelatex or lualatex.
   - **Class reuse**: pandoc default template with `documentclass` from YAML.
   - **Wrapper template** (later): pandoc outputs a LaTeX fragment and metadata file, then the template's main file is compiled with `latexmk`.
2. **Pandoc must not invoke the LaTeX engine itself.** Always run pandoc to produce an intermediate `.tex` file, then compile that `.tex` through the same `latexmk` pipeline as 5.1. Letting pandoc call the engine directly loses the `.log`, the retry loop, and biber integration. Note for the UI: compile errors will point at lines in the generated `.tex`, not at the original Markdown — the error mapping needs to account for this (at minimum, show both and say so).
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
The loop is capped by **no new package installed in the last iteration, or a total time budget** — not a fixed iteration count. A single template can need 20+ packages resolved one miss at a time (see §6.2 on transitive dependencies not being fully handled by `tlmgr`), so a fixed cap like 5 will abort legitimate compiles partway through. Each iteration emits status events.

## 6. Lazy library management

### 6.1 Principle
The base image has a `scheme-basic` TeX installation (see §6.6, technology.md §6). Everything else is installed into a **user tree on the cache volume**, so it survives container replacement and does not require root.

### 6.2 Package resolution
- **Resolve by file, not by name.** The `\usepackage{foo}` name frequently does not match the TeX Live package name (`tikz`→package `pgf`, `graphicx`→`graphics`, `\usetikzlibrary{cd}`→package `tikz-cd`). Always resolve against the file the package provides (`foo.sty`, `foo.cls`), never the macro-level name.
- **Do not call `tlmgr search --global --file` per miss.** That fetches the remote tlpdb on every lookup. Build and maintain a local file→package index derived from the cached `texlive.tlpdb`, refreshed only when the pinned snapshot changes.
- **Dependencies are not fully handled by `tlmgr` at the package level.** In `texlive.tlpdb`, individual packages almost never declare `depend` on other packages — only collections and schemes do (verify against the `tcolorbox` entry, which pulls in several packages with no explicit `depend` chain). In practice each missing transitive dependency costs its own compile-retry iteration; the retry loop's cap (§5.3: no new install in the last iteration, or a time budget — not a fixed count) must assume this, not assume one miss resolves one dependency tree.
- **Binaries and scripts cannot be installed in `tlmgr` user mode.** This includes `latexminted` (installed as a symlink in `bin/`), `biber`, and `xindy`. These must ship in the base image regardless of lazy package resolution — lazy install only ever adds `.sty`/`.cls`/data files, never executables.
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
- **Implemented:** the cache is namespaced by snapshot date, not invalidated. `TL_SNAPSHOT_KEY` is baked into the image (Dockerfile ARG/ENV, matching the `TEX_REPO_URL` the image was built against) and `docker/entrypoint.sh` uses it to put the TeX user tree and luaotfload cache under `/cache/tl-<key>/` (§4). Upgrading the pinned release changes the key, so a rebuild gets a fresh tree automatically instead of reusing one built against the old snapshot; old `/cache/tl-<old-key>/` trees are simply orphaned, not migrated. The entrypoint also refuses to start if the runtime `TEX_REPO_URL` (docker-compose.yml) doesn't match the image's baked-in `TL_IMAGE_REPO_URL`, so the two can't silently drift apart.
- **The repository must point at a frozen snapshot from day one, not only after rollover.** Pointing a pinned install at a live/rolling repo breaks mid-year too: once upstream ships a newer `texlive.infra`, `tlmgr` refuses further installs until `update --self`, and the cache ends up mixing package dates from before and after that point. Use a frozen snapshot/mirror for the pinned release from the start, namespaced by release.
- **Concrete source (decision, verified reachable 2026-11-01):** `https://texlive.info/tlnet-archive/<YYYY>/<MM>/<DD>/tlnet/` publishes a dated TeX Live snapshot for every day; confirmed two different dates (`2026/09/01` and `2026/10/01`) return genuinely different, non-identical `texlive.tlpdb` files, so each dated path is frozen by construction (never republished afterwards) — unlike `tlnet` (always-rolling) or `tlnet-final` (only exists for a *past* release after the *next* one has shipped, so it is unavailable for the current release for most of the year). Pin the exact date used for the base image build (`TEX_REPO_URL` in `docker-compose.yml`/`.env.example`, currently `2026/10/01`) and record that date alongside the pinned `texlive-scheme-basic` release in the image build notes, so a rebuild from the same Dockerfile reproduces the same package set. Pass the same URL to the `install-tl` installer as `-repository <url>` (not just as a runtime `tlmgr` setting), so the installer and the lazily-resolved packages can never come from different snapshots.
- **biber and biblatex must match exactly, down to the control-file version.** `biber` is a binary baked into the image; `biblatex` installed lazily from a live repo will drift newer over time. Symptom months after release: `Found biblatex control file version X, expected Y` on documents that worked before — indistinguishable from a user error unless this is known. Fix: preinstall `biblatex` together with `biber` from the same frozen snapshot, never update either lazily.
- **The LaTeX kernel must never be updated lazily.** Compiled formats (`*.fmt`) are built at image-build time against a specific `latex-base`/`l3kernel`. A lazy `tlmgr install` that pulls a newer kernel — directly, or as a transitive dependency of some unrelated package — breaks every format. Symptom: `Mismatched LaTeX support files detected`. The pinned snapshot must cover the kernel too, with lazy installs excluded from ever touching it.

### 6.7 Failure handling
- No network and package not cached: show "Package X is not installed and needs a download. Connect to the network and compile again."
- Unknown package: surface the TeX error as is.
- Install failure: report the `tlmgr` error and stop retrying that package for the current compile.
- Retry loop exhaustion: when the cap defined in §5.3 is hit (no new package installed in the last iteration, or the time budget elapsed) while the compile is still failing, stop and surface the last compile log to the user rather than retrying further.

## 7. Font resolution

Fonts use the same detect, resolve, install, retry shape.

**Detection** (from log): `The font "X" cannot be found`, luaotfload "cannot be found", xelatex "not loadable".

**Resolution chain:**
1. Already installed (`fc-match`).
2. Project `fonts/` folder. **This is engine-dependent, not just "made available through the project path":**
   - XeTeX reads fontconfig, so the compile needs a per-compile `FONTCONFIG_FILE` pointing at the project's `fonts/` directory (or an engine-independent path: `fontspec`'s `Path=fonts/` option set by the backend, which works regardless of engine).
   - LuaTeX's `luaotfload` does not use fontconfig at all — it has its own font name database (`luaotfload-tool -u`) and reads `OSFONTDIR`. **Its cache actually lives under `TEXMFCACHE`, not directly under `TEXMFVAR`** — `TEXMFCACHE` defaults to the search list `"$TEXMFSYSVAR;$TEXMFVAR"`, and `TEXMFSYSVAR` (baked into the image) comes first and wins, so setting only `TEXMFVAR` to a `/cache` path does *not* redirect the cache (verified: `luaotfload-tool -u` with only `TEXMFVAR` overridden still wrote into the image's `/opt/texlive/texmf-var`, not `/cache`). Set `TEXMFCACHE` directly instead. **Do not** "fix" this by overriding `TEXMFSYSVAR` itself — that also breaks the *engine's* lookup of the `.fmt` files baked into `/opt/texlive/texmf-var` at image-build time (verified: with `TEXMFSYSVAR` redirected to `/cache`, `xelatex` silently fell back to `mktexfmt` and rebuilt its format from scratch on every single compile, which is exactly the lazy-kernel-update failure mode this document warns against — see §6.6). Without a correctly redirected `TEXMFCACHE`, the cache also rebuilds from scratch after every container recreate (and can exceed the compile timeout on first run — build/warm this cache at container start via the entrypoint, not lazily on first user compile; see `docker/entrypoint.sh`).
3. TeX Live font package (`tlmgr search --file`).
4. Google Fonts through an allowlisted source (the `google/fonts` repository or a Fontsource mirror).
5. Failure message: "Font X not found. Upload the font file to this project's fonts folder."

**Installation:** fetched fonts go to `/cache/fonts`. For XeTeX, register through a fontconfig configuration file followed by `fc-cache`. For LuaTeX, additionally run `luaotfload-tool -u` to refresh its own font name database (fontconfig registration alone is not visible to `luaotfload`). Then the compile retries.

**TeX Live's own bundled fonts are not automatically visible to fontconfig.** `/opt/texlive/texmf-dist/fonts` is outside fontconfig's default search directories (`/usr/share/fonts`, `/usr/local/share/fonts`, etc.), so without an explicit fontconfig `<dir>` entry, XeTeX/fontspec cannot resolve even bundled fonts like Latin Modern or TeX Gyre by name — they fail with the same "font not found" error as a genuinely missing font (verified: `\setmainfont{Latin Modern Roman}` failed with every glyph falling back to `nullfont` until `/opt/texlive/texmf-dist/fonts/{opentype,truetype}` was added to `/etc/fonts/conf.d/`). This is baked into the image at build time (`docker/texlive-fonts.conf`), not something the lazy font resolution chain handles — it must exist before any compile, including the very first one.

**Commercial fonts:** mapped to metric-compatible substitutes (Liberation, Carlito, Tinos) with a UI warning. Never fetched from unofficial sources. *(To verify before relying on this: some commercial fonts, e.g. Times New Roman/Arial/Courier New, may be obtainable legally under vendor EULAs such as the MS core fonts package; others, e.g. Calibri/Cambria, are not. Don't assume the whole commercial-font class is equally unavailable without checking the specific font.)*

**Proactive font prefetch** follows the same candidate and delay mechanism as packages (6.4).

## 8. Security and limits

- Compiles run inside the container, in the project's persistent working directory (§5.1), guarded by a per-project compile lock so concurrent auto/manual triggers cannot interleave on the same `.aux`/`.bbl` files.
- Limits: wall-clock timeout, memory cap, CPU cap, output size cap, and a cap on concurrent compiles.
- Zip import: reject absolute paths and `..` segments, enforce total size and file count limits.
- Download sources are allowlisted (TeX repository mirror, font sources). Network fetching can be disabled by an admin setting.
- No authentication in the initial version. The app should bind to localhost by default and warn when exposed more widely.
- **Shell-escape is restricted by default, not full.** Full shell-escape plus zip/template imports from the internet means arbitrary code runs with whatever the compile process can see. Restricted shell-escape (texmf.cnf `shell_escape_commands`) already covers `bibtex`, `biber`, `makeindex`, and (as of minted v3's `latexminted`) `minted` — minted was redesigned specifically to work under restricted mode without needing full shell-escape. Full shell-escape should be an explicit per-project opt-in, not the default. **Verified** (feature/texlive-toolchain branch): a `minted` Python code block compiled successfully under restricted shell-escape, with `latexminted` correctly invoked via `\write18` and real Pygments output embedded. One gotcha confirmed empirically: minted v3 needs **two compile passes** before the highlighted code shows in the PDF — a single `pdflatex` pass produces the literal `<MINTED>` placeholder in the output even though `latexminted` ran with no error and `_minted/*.highlight.minted` already has the correct highlighted content; a second pass in the *same* directory (no cache cleanup needed) picks it up and the PDF renders correctly. This is the same shape as references/TOC needing a rerun, not a sign of anything broken, and `latexmk`'s automatic multi-pass handling (used everywhere in this pipeline, §5.1) resolves it transparently — a single raw `pdflatex` invocation (as used in ad hoc debugging) will not.
- **`openin_any` defaults to unrestricted in TeX Live (`a` — "any").** This is independent of shell-escape mode: even with shell-escape fully off, `\input{/data/app.db}` can read anything the compile process has filesystem access to, including other projects' files and the SQLite DB. Set a restrictive `openin_any` as defense in depth, but the real boundary has to be filesystem access, not the shell-escape setting.
  - **Current state (as implemented):** the runtime container has no `USER` directive, so the Node process — and the `latexmk`/`pandoc`/`tlmgr` child processes it will spawn once the compile pipeline exists — runs as root with no extra namespace or capability restriction from `docker-compose.yml`. `openin_any` restriction plus ordinary Unix file permissions (compile processes only ever `cd` into their own project's work directory) is the actual near-term boundary.
  - **Later hardening (not yet implemented):** run the app as a non-root `USER`, and/or run each compile's child process under a restricted UID or mount namespace that only has access to its own project directory. Track this as a postponed item (see `docs/currentwork/plan.md`) rather than assuming it is already in place.
- **SVG requires a pre-conversion step, not `\includesvg`.** `\includesvg` calls Inkscape through shell-escape and is not on the restricted allowlist. The backend converts every project SVG (regardless of whether it's referenced from `.tex` or from Markdown) to PDF with `rsvg-convert` before the LaTeX compile runs, writing the converted PDF into the project's compile work directory (`/cache/work/<project-id>/`, mirroring the SVG's relative path, e.g. `images/figure.svg` → `<workdir>/images/figure.pdf`) — never back into `/data/projects/<project-id>` — so it never shows up in the file tree or a zip export as a generated artifact. It's made visible to `\includegraphics{images/figure}` through the `TEXINPUTS` setting from §5.1 (not `-outdir`/`-auxdir` alone — those only affect where *output* and auxiliary files are written, not kpathsea's input search path, and process CWD is the project directory per §5.1, not the work directory). This is a backend pre-processing step that runs independently of pandoc — it is not pandoc's own (unused, per 5.2) image-conversion path, and it runs whether the source document is `.tex` or Markdown-via-`.tex`-intermediate (5.2), since in both cases the final input to the LaTeX engine is `.tex`/`\includegraphics`, never an SVG. **Verified** (feature/projects-and-compile branch): a project combining `\input`, a project image via plain `\includegraphics`, and a pre-converted SVG — all three resolved with `cwd=<project-dir>` and `TEXINPUTS` including the work directory; see §5.1 for the full setup.
- **The per-project working directory (§5.1) needs a per-project lock.** If auto-compile and a manual compile trigger run concurrently against the same working directory, `.aux`/`.bbl` files can be read or written mid-update and corrupt the next pass. The job queue must serialize compiles per project, not just cap global concurrency.

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
