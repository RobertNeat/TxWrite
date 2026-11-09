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
- **Profile picker**: select a profile within the signed-in account with no separate password; profiles are only a grouping under real JWT auth (§8), not an authentication boundary themselves.
- **Template picker**: list templates with LaTeX and Markdown badges; create a project from a template; import a template zip.

The frontend is built into static assets and served by the backend, so it adds no runtime footprint beyond a few MB.

## 3. Backend modules

| Module            | Responsibility                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| Profiles          | Create and list profiles, grouped under the authenticated user (§8); no separate password per profile |
| Projects          | Project metadata, file operations, zip import and export                                              |
| Templates         | Template storage, manifest parsing, type detection                                                    |
| Compile           | Pipeline selection, execution, log parsing, result PDF                                                |
| Resource Resolver | Maps missing packages and fonts to installable resources and installs them                            |
| Prefetch Watcher  | Scans edited content for package and font references and queues background installs                   |
| Job Queue         | Serializes installs, tracks job state                                                                 |
| Events            | Pushes compile and install status to the browser (SSE)                                                |

### API sketch

All backend routes are served under the `/api` prefix (decision, 2026-11-01), since the backend also serves the built frontend SPA from the same origin and plain paths like `/projects` would otherwise collide with Angular routes. The frontend dev server proxies `/api` to the backend (`apps/frontend/proxy.conf.json`).

- `GET/POST /api/profiles`
- `GET/POST /api/projects`, `GET/PUT/DELETE /api/projects/:id`
- `GET/PUT/DELETE /api/projects/:id/files/*`, `POST /api/projects/:id/upload`
- `POST /api/projects/:id/import`, `GET /api/projects/:id/export`
- `GET/POST /api/templates`, `POST /api/projects/from-template`
- `POST /api/projects/:id/compile`, `GET /api/projects/:id/output.pdf`
- `POST /api/projects/:id/scan` — implemented (`PrefetchWatcherModule`, §6.4): body `{ file, content }`, extracts package/font references (`reference-extractor.ts`) and promotes a candidate to a background install via `ResourceResolverService` once it has been present, unchanged, across scans for at least `PREFETCH_DELAY_MS`. Consumed by the editor, debounced 800ms on content change, scoped to `.tex`/`.md` files.
- `GET /api/events` (SSE stream of install and compile events) — implemented; compile._/install._ events are emitted by `CompileService`/`ResourceResolverService` (§5.3/§6.2), consumed by the status bar and compile panel.
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
    lua-fonts/tl-<snapshot-key>/ isolated per-project luaotfload font-name DB/cache for
                                  LuaTeX compiles of a project with a fonts/ folder (§7
                                  step 2); only created for that case, never shared across
                                  projects or with the main tl-<snapshot-key>/texmf-var
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
  - **Implemented** (feature/projects-and-compile branch): a Perl script (`deploy/docker/build-package-index.pl`) runs once at image-build time, parsing `runfiles` only (not `docfiles`/`srcfiles` — those are full of generically-named example/test/README files that would otherwise make a typo'd `\input` try to install dozens of unrelated packages) from the pinned snapshot's full remote tlpdb. install-tl already downloads and GPG-verifies this file once per build (cached at `/opt/texlive/tlpkg/texlive.tlpdb.main.<hash>`), reused here instead of a second unverified download. Packages already present in the locally-installed tlpdb are excluded from the index — those are exactly the base image's `scheme-basic` content plus everything explicitly `tlmgr install`ed at build time (kernel, biblatex, hyphenation, binaries/scripts), which §6.6 says must never be touched by a lazy install. One file can map to several packages (e.g. `graphicx.sty` is in both `graphics` and `latex-graphics-dev`); the build script picks a single preferred candidate per file (the package whose name matches the file's own stem, e.g. `polyglossia.sty`→`polyglossia`, falling back to the alphabetically-first candidate), so the resolver and retry loop only ever deal with one package per missing file. Output is a gzipped JSON map (`basename → package`, ~1&nbsp;MB compressed from ~160k entries), loaded once at backend startup (`PackageIndexService`) and failing loudly — not silently — if the file is missing.
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
- **Implemented:** the cache is namespaced by snapshot date, not invalidated. `TL_SNAPSHOT_KEY` is baked into the image (Dockerfile ARG/ENV, matching the `TEX_REPO_URL` the image was built against) and `deploy/docker/entrypoint.sh` uses it to put the TeX user tree and luaotfload cache under `/cache/tl-<key>/` (§4). Upgrading the pinned release changes the key, so a rebuild gets a fresh tree automatically instead of reusing one built against the old snapshot; old `/cache/tl-<old-key>/` trees are simply orphaned, not migrated. The entrypoint also refuses to start if the runtime `TEX_REPO_URL` (`deploy/docker-compose.yml`) doesn't match the image's baked-in `TL_IMAGE_REPO_URL`, so the two can't silently drift apart.
- **The repository must point at a frozen snapshot from day one, not only after rollover.** Pointing a pinned install at a live/rolling repo breaks mid-year too: once upstream ships a newer `texlive.infra`, `tlmgr` refuses further installs until `update --self`, and the cache ends up mixing package dates from before and after that point. Use a frozen snapshot/mirror for the pinned release from the start, namespaced by release.
- **Concrete source (decision, verified reachable 2026-11-01):** `https://texlive.info/tlnet-archive/<YYYY>/<MM>/<DD>/tlnet/` publishes a dated TeX Live snapshot for every day; confirmed two different dates (`2026/09/01` and `2026/10/01`) return genuinely different, non-identical `texlive.tlpdb` files, so each dated path is frozen by construction (never republished afterwards) — unlike `tlnet` (always-rolling) or `tlnet-final` (only exists for a _past_ release after the _next_ one has shipped, so it is unavailable for the current release for most of the year). Pin the exact date used for the base image build (`TEX_REPO_URL` in `deploy/docker-compose.yml`/`.env.example`, currently `2026/10/01`) and record that date alongside the pinned `texlive-scheme-basic` release in the image build notes, so a rebuild from the same Dockerfile reproduces the same package set. Pass the same URL to the `install-tl` installer as `-repository <url>` (not just as a runtime `tlmgr` setting), so the installer and the lazily-resolved packages can never come from different snapshots.
- **biber and biblatex must match exactly, down to the control-file version.** `biber` is a binary baked into the image; `biblatex` installed lazily from a live repo will drift newer over time. Symptom months after release: `Found biblatex control file version X, expected Y` on documents that worked before — indistinguishable from a user error unless this is known. Fix: preinstall `biblatex` together with `biber` from the same frozen snapshot, never update either lazily.
- **The LaTeX kernel must never be updated lazily.** Compiled formats (`*.fmt`) are built at image-build time against a specific `latex-base`/`l3kernel`. A lazy `tlmgr install` that pulls a newer kernel — directly, or as a transitive dependency of some unrelated package — breaks every format. Symptom: `Mismatched LaTeX support files detected`. The pinned snapshot must cover the kernel too, with lazy installs excluded from ever touching it.

### 6.7 Failure handling

- No network and package not cached: show "Package X is not installed and needs a download. Connect to the network and compile again."
- Unknown package: surface the TeX error as is.
- Install failure: report the `tlmgr` error and stop retrying that package for the current compile.
- Retry loop exhaustion: when the cap defined in §5.3 is hit (no new package installed in the last iteration, or the time budget elapsed) while the compile is still failing, stop and surface the last compile log to the user rather than retrying further.

## 7. Font resolution

Fonts use the same detect, resolve, install, retry shape.

**Detection (from log) — implemented** (`log-parser.ts`'s `FONTSPEC_ERROR`/`FONTSPEC_FONT_NAME`): fontspec's `Package fontspec Error: ... The font "X" cannot be found` (identical from both xelatex and lualatex, since both route font selection through the `fontspec` package) — built from real captured logs, not the message's own paraphrase (see `__fixtures__/missing-font*.log`). The font name can itself be wrapped across two `(fontspec)` continuation lines for a long/multi-word name; the parser joins them before matching. Deliberately not parsed from the later low-level "Font ...=X at Npt not loadable"/"not loadable: metric data not found" line — its font name carries engine-specific internal syntax (`name:X:mode=...` for lualatex, `=X at 10.0pt` for xelatex) rather than the fontspec message's clean quoted name.

**Resolution chain:**

1. **Already installed (`fc-match`) — implemented** (`FontResolverService.isAlreadyInstalled`). `fc-match` never reports "not found" — it always returns some fallback family (verified: `fc-match "NoSuchFont"` exits 0 with `DejaVu Sans`) — so a hit only counts if the returned family string equals the requested one exactly.
2. Project `fonts/` folder. **This is engine-dependent, not just "made available through the project path":**
   - **XeTeX — implemented** (`CompileRunnerService.writeProjectFontconfig`). When a project has a `fonts/` directory, a per-compile fontconfig file is written into the work directory (`<include>` of the system `/etc/fonts/fonts.conf` plus a `<dir>` entry for the project's `fonts/`) and passed via `FONTCONFIG_FILE` to the `latexmk`/`xelatex` child process. Verified empirically: resolves a font installed only in a throwaway `fonts/` directory and not registered anywhere globally, without overriding `<cachedir>` — fontconfig reuses its existing system cache and only scans the one new project directory, so this does not cause a full system-font rescan on every compile.
   - **LuaTeX — implemented** (`CompileRunnerService.buildProjectLuaFontEnv`). `luaotfload` does not use fontconfig at all — it has its own font name database (`luaotfload-tool -u`) and reads `OSFONTDIR`, and that database is otherwise shared/global per container (namespaced by TeX Live snapshot, not by project). **Verified empirically** (real `latexmk -lualatex` compiles against a running container) that simply pointing `OSFONTDIR` at a project's `fonts/` directory while leaving `TEXMFVAR`/`TEXMFCACHE` shared leaks: luaotfload's reload-on-miss writes the project's font straight into the shared names database, and a second project's compile with `OSFONTDIR` unset then still resolved the first project's font from its own path. Avoiding the leak needs a per-compile-scoped equivalent of `FONTCONFIG_FILE`, built from four environment variables set together for a project with a `fonts/` directory:
     - `TEXMFVAR`/`TEXMFCACHE` both redirected to an isolated per-project directory (`/cache/work/<project-id>/lua-fonts/tl-<snapshot-key>/`, §4) — **they must move together**: pointing only `TEXMFCACHE` elsewhere while `TEXMFVAR` stays shared makes luaotfload hard-fail at Lua module load with "no writeable cache path, quitting", verified empirically.
     - `OSFONTDIR` set to the project's `fonts/` directory.
     - `TEXFONTMAPS` set back to the shared tree's `fonts/map/pdftex` directory (kpathsea `//:` recursive-search suffix) — verified empirically that without this, `pdftex.map` silently falls back to the image's own ephemeral `/opt/texlive/texmf-var` copy, losing visibility into every Type1 map entry `updmap-user` has registered for lazily-installed font packages in the shared tree.
     - A kpathsea search-list form (`;`- or `:`-joining a shared and isolated path in one `TEXMFCACHE`/`TEXMFVAR` value, to avoid the full rebuild below) does **not** work: the `;` form is taken as a literal character in the path (creating a directory literally named e.g. `cacheB;`), and the `:` form (the real POSIX separator) causes the same "no writeable cache path" failure as a single non-matching path — verified empirically for both.
     - This isolated database is rebuilt from scratch once per project (verified: ~17KB names-db + ~0.3MB OTL glyph cache per referenced font, ~3s on first compile) and reused on later compiles (verified: no "generating new one" on a second run). It still sees every font already installed into the shared `TEXMFHOME` tree and the system OS fonts (both verified), and a font installed into the shared tree *after* the isolated cache was already built is still found via the same reload-on-miss mechanism the shared database relies on (verified: no extra invalidation logic needed). Only a project's own `fonts/` upload is scoped to that project — this deliberately does not make an upload visible platform-wide the way a TeX-Live package install is (decision, 2026-11-09): the per-compile isolation that avoids the leak and the "available to every project after one use" model are mutually exclusive, and isolation was chosen, mirroring XeTeX's own per-compile scoping above rather than the shared/global registration step 3 uses for installed packages.
   - **Its cache actually lives under `TEXMFCACHE`, not directly under `TEXMFVAR`** — `TEXMFCACHE` defaults to the search list `"$TEXMFSYSVAR;$TEXMFVAR"`, and `TEXMFSYSVAR` (baked into the image) comes first and wins, so setting only `TEXMFVAR` to a `/cache` path does _not_ redirect the cache (verified: `luaotfload-tool -u` with only `TEXMFVAR` overridden still wrote into the image's `/opt/texlive/texmf-var`, not `/cache`). Set `TEXMFCACHE` directly instead. **Do not** "fix" this by overriding `TEXMFSYSVAR` itself — that also breaks the _engine's_ lookup of the `.fmt` files baked into `/opt/texlive/texmf-var` at image-build time (verified: with `TEXMFSYSVAR` redirected to `/cache`, `xelatex` silently fell back to `mktexfmt` and rebuilt its format from scratch on every single compile, which is exactly the lazy-kernel-update failure mode this document warns against — see §6.6). Without a correctly redirected `TEXMFCACHE`, the cache also rebuilds from scratch after every container recreate (and can exceed the compile timeout on first run — build/warm this cache at container start via the entrypoint, not lazily on first user compile; see `deploy/docker/entrypoint.sh`).
3. **TeX Live font package — implemented** (`FontResolverService` + `PackageIndexService.packageProvidingFont`), but resolved by a _secondary_ index, not `tlmgr search --file` per miss (same section 6.2 rule as packages). A font family name ("EB Garamond") doesn't match a font file's basename verbatim ("EBGaramond-Regular.otf"), unlike a `\usepackage` name, which already matches a `.sty` basename directly — so a second lookup table is built once at index-load time from the same build-time package index's `.otf`/`.ttf` entries, keyed by the filename stem with its trailing `-Style` suffix stripped and normalized (spaces/hyphens removed, lowercased). Verified against the real pinned-snapshot index for several common families (EB Garamond, Fira Sans, Lato, Crimson Pro); a miss is expected, not a bug, for a genuinely absent or upstream-renamed font (e.g. "Source Sans Pro", renamed to "Source Sans 3").
4. **Google Fonts fallback — implemented** (`FontResolverService.resolveFromGoogleFonts`), tried only once step 3 finds no TeX Live package, so unauthenticated GitHub traffic stays limited to the minority of lookups that need it. Source: `raw.githubusercontent.com/google/fonts/main/<license>/<dir>/...` — the CDN raw-content path, not `api.github.com` (verified empirically: a METADATA.pb probe returns no `x-ratelimit-*` headers at all, unlike the Contents API, which is capped at 60/hour unauthenticated). The repository organizes each family under exactly one of three license directories (`ofl`/`apache`/`ufl`), keyed by the family name lowercased with spaces/punctuation stripped (verified against several real families — e.g. "Press Start 2P" → `pressstart2p`); probed `ofl` → `apache` → `ufl` in that order since most families are OFL, each verified to actually resolve a real family under that directory. `METADATA.pb` (the repo's own protobuf text format) is parsed with a small targeted regex, not a protobuf library (no new dependency) — only the top-level `name:` and each `fonts { ... filename: ... }` block are needed.
   - **Static families only (decision, 2026-11-09).** Most actively-maintained families (Inter, Roboto, and similar) now ship *only* a variable font in this repository — no `static/` fallback directory exists for them (verified: `api.github.com/repos/google/fonts/contents/ofl/inter` lists only the two variable `.ttf` files, no static subdirectory). Verified empirically against a real compile that installing a variable font into the shared tree breaks both engines: xelatex's `xdvipdfmx` fatals outright trying to embed one ("Invalid TTC index (not TTC font)" — confirmed this is not a bracket-in-filename parsing issue by retesting with a bracket-free filename, same fatal error), and lualatex compiles successfully but silently has no bold (`fontspec` only sees whichever single static instance luaotfload picked — the default/regular weight — so `\textbf` falls back to regular with a `Font shape ... undefined` warning). A family whose METADATA.pb lists only filenames containing `[` (the variable-font naming convention) is therefore treated as unresolvable, with a distinct message telling the user to upload a static file instead, rather than attempting a fatal/degraded install. This means popular variable-only families are not covered by this fallback; closing that gap would need font instancing (e.g. fonttools' `varLib.instancer`) at fetch time, which was deliberately not added in this pass (a new Python dependency, CLAUDE.md rule 2) — tracked as a possible future extension, not a bug.
   - Fetched static files are written into `$TEXMFHOME/fonts/truetype/googlefonts/<dir>/` — the same tree TeX-Live-installed fonts land in (step 3 above) — so the existing fontconfig `<dir>` entry and shared luaotfload database pick them up with no new runtime config, then the same `refreshFontDatabases` step 3 uses (`fc-cache -f` + `luaotfload-tool -u`) runs again. Verified empirically end-to-end in the real container: a static family (Lato, `apache`-licensed Aclonica) downloads all its weight/style files, `fc-match` resolves it exactly afterward, and a real `latexmk -xelatex`/`-lualatex` compile with regular/bold/italic/bold-italic text produces a clean PDF with no font-substitution warnings on either engine.
   - **Filenames from METADATA.pb are untrusted network data** that reach both a download URL and a filesystem write path, so every filename is checked against a strict basename pattern (`.ttf`/`.otf` only, no path separators or traversal) before use, mirroring the same discipline `ResourceResolverService`/`FontResolverService` step 3 already apply to tlmgr package names. Downloads are written to a temp file and renamed into place, capped at a fixed size per file, and time out rather than hanging on a stalled connection.
   - **Failure handling, verified empirically:** a genuine "no such family" (404 across all three license directories) falls through to step 5's message, same as a TeX-Live-package miss. A transient failure (non-404 error status, network error, or timeout on any probe) is never treated as "not found" and is never cached — a 404 is cached in memory (keyed by the normalized directory name) only once confirmed across all three directories, so a half-typed name under prefetch doesn't repeat the same 3 lookups on every debounced scan, while a rate-limited/transient failure can still succeed on the very next attempt.
   - Also added in this cycle: the `fonts-liberation` system package (Dockerfile), since `Liberation Serif`/`Liberation Sans`/`Courier New` (metric-compatible aliases fontconfig already maps to TeX Gyre Termes/Heros/Cursor via `fc-match`) are not in TeX Live under their literal names (checked the built `package-index.json.gz`: zero `.otf`/`.ttf` entries for any of the three). `fonts-liberation` ships Liberation Serif/Sans/Mono as real installed system fonts — verified in the real container that `fc-match` now resolves `"Liberation Serif"`/`"Liberation Sans"` to an exact match, so step 1 (`isAlreadyInstalled`) resolves them directly with no TeX Live package or Google Fonts fetch needed. Does not cover `Courier New` itself (no open package ships under that literal name, and it isn't a Google Fonts family either) — `fc-match "Courier New"` still falls back to Liberation Mono; this gap remains, documented rather than silently left unresolved.
5. **Failure message — implemented**: "Font X not found. Upload the font file to this project's fonts folder." (step 2 now supports both XeLaTeX and LuaTeX, so the message no longer needs to call out one engine.)

**Installation — implemented.** Fetched font packages install via `tlmgr` the same way package installs do (`FontResolverService.runTlmgrInstall`). Afterward both font databases are refreshed in the same job-queue task: `fc-cache -f` for XeTeX, and `luaotfload-tool -u` for LuaTeX (fontconfig registration alone is not visible to `luaotfload`). **Verified empirically that the install alone, without this refresh, is not enough** — `tlmgr install ebgaramond` succeeded and the font files landed under `$TEXMFHOME/fonts/opentype/...`, but a recompile still failed with the same "font not found" error until `fc-cache` ran against a fontconfig entry covering that directory. Then the compile retries. This refresh only ever touches the *shared* `luaotfload` database — a LuaTeX project with its own isolated per-project cache (step 2 above) does not need a matching per-project refresh, since its own reload-on-miss already re-scans `TEXMFHOME` (and finds the newly-installed package) on its own next retry.

**The runtime fontconfig entry for `$TEXMFHOME` must use fontconfig's numeric-prefix filename convention.** `/etc/fonts/conf.d/<name>.conf` is only read by `fc-cache`/`fc-match` if `<name>` starts with a number matching the existing convention (`09-texlive.conf`, `10-hinting-slight.conf`, etc.) — **verified empirically**: a config file written as `texlive-user-fonts.conf` (no numeric prefix) was silently never picked up by `fc-cache -f`, even though its `<dir>` entries were otherwise correct and `fc-cache` run directly against that same directory worked fine. Renaming it to `09-texlive-user-fonts.conf` fixed it immediately. `deploy/docker/entrypoint.sh` writes this file at container start (as `09-texlive-user-fonts.conf`), since `$TEXMFHOME` is a `/cache` path only known at runtime (namespaced by snapshot key, per §6.6) — it can't be baked into the image like `deploy/docker/texlive-fonts.conf` is for `texmf-dist`.

**TeX Live's own bundled fonts are not automatically visible to fontconfig.** `/opt/texlive/texmf-dist/fonts` is outside fontconfig's default search directories (`/usr/share/fonts`, `/usr/local/share/fonts`, etc.), so without an explicit fontconfig `<dir>` entry, XeTeX/fontspec cannot resolve even bundled fonts like Latin Modern or TeX Gyre by name — they fail with the same "font not found" error as a genuinely missing font (verified: `\setmainfont{Latin Modern Roman}` failed with every glyph falling back to `nullfont` until `/opt/texlive/texmf-dist/fonts/{opentype,truetype}` was added to `/etc/fonts/conf.d/`). This is baked into the image at build time (`deploy/docker/texlive-fonts.conf`), not something the lazy font resolution chain handles — it must exist before any compile, including the very first one.

**Commercial fonts:** mapped to metric-compatible substitutes (Liberation, Carlito, Tinos) with a UI warning. Never fetched from unofficial sources. _(To verify before relying on this: some commercial fonts, e.g. Times New Roman/Arial/Courier New, may be obtainable legally under vendor EULAs such as the MS core fonts package; others, e.g. Calibri/Cambria, are not. Don't assume the whole commercial-font class is equally unavailable without checking the specific font.)_

**Proactive font prefetch** follows the same candidate and delay mechanism as packages (6.4).

## 8. Security and limits

- Compiles run inside the container, in the project's persistent working directory (§5.1), guarded by a per-project compile lock so concurrent auto/manual triggers cannot interleave on the same `.aux`/`.bbl` files.
- Limits: wall-clock timeout, memory cap, CPU cap, output size cap, and a cap on concurrent compiles.
- Zip import: reject absolute paths and `..` segments, enforce total size and file count limits.
- Download sources are allowlisted (TeX repository mirror, `raw.githubusercontent.com/google/fonts` for the Google Fonts fallback — section 7 step 4). Network fetching can be disabled by an admin setting (`NETWORK_FETCH=false` also disables the Google Fonts fallback, not just tlmgr installs).
- **Real authentication: JWT access/refresh tokens in httpOnly cookies.** Local (email+password) login uses `crypto.scrypt` for hashing; `user_identities` is provider-agnostic (`provider='local'` today) so Google/Keycloak OIDC can be added later without a schema change — see `docs/contracts/milestones.md`. Access tokens are short-lived (15 min default); refresh tokens rotate on use with reuse-detection (replaying an already-rotated refresh token revokes its whole token family). Cookies use `SameSite=Strict`; `COOKIE_SECURE` must be set to `false` for plain-HTTP LAN/Docker deployments (Secure cookies are silently dropped over HTTP) — the app should still bind to localhost by default and warn when exposed more widely. Every profile/project/file/compile/export/SSE endpoint is scoped to the authenticated user's own profiles via a global Nest guard (`@Public()` opts a route out, used only for register/login/refresh/health).
- **Email verification on registration.** `POST /auth/register` creates the account and emails a 6-digit code but issues no session cookies; the session only starts once `POST /auth/verify-email` accepts the correct code. `users.email_verified_at` (not `user_identities`) tracks this, so a future OIDC identity (Google already verifies emails itself) can simply set it at creation with no schema change. Codes are hashed (never stored raw), expire after 15 minutes, lock out after 5 wrong attempts, and `POST /auth/resend-verification` is rate-limited to one per 60 seconds per account; the resend endpoint always returns the same response whether or not the email is registered, to avoid leaking account existence. Login checks the password before verification state, so a wrong password always looks identical (401) regardless of whether the account is verified — only a correct password on an unverified account returns a distinguishable `403 { code: 'EMAIL_NOT_VERIFIED' }`. Email delivery uses `nodemailer` over SMTP (`SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`MAIL_FROM` in the shared root `.env`); with no `SMTP_HOST` configured, the code is logged instead of emailed, so local dev works without a mail server. The email body is styled (inline-styled HTML, no `<style>` blocks/CSS vars, for email-client compatibility) — see `apps/backend/src/modules/auth/mail/verification-email.template.ts`. **Not yet handled:** an unverified local account still occupies its email (`users.email` is UNIQUE), so a future Google OIDC login must decide how to handle that collision (e.g. replace the never-verified local account) rather than silently auto-linking to it.
- **Shell-escape is restricted by default, not full.** Full shell-escape plus zip/template imports from the internet means arbitrary code runs with whatever the compile process can see. Restricted shell-escape (texmf.cnf `shell_escape_commands`) already covers `bibtex`, `biber`, `makeindex`, and (as of minted v3's `latexminted`) `minted` — minted was redesigned specifically to work under restricted mode without needing full shell-escape. Full shell-escape should be an explicit per-project opt-in, not the default. **Verified** (feature/texlive-toolchain branch): a `minted` Python code block compiled successfully under restricted shell-escape, with `latexminted` correctly invoked via `\write18` and real Pygments output embedded. One gotcha confirmed empirically: minted v3 needs **two compile passes** before the highlighted code shows in the PDF — a single `pdflatex` pass produces the literal `<MINTED>` placeholder in the output even though `latexminted` ran with no error and `_minted/*.highlight.minted` already has the correct highlighted content; a second pass in the _same_ directory (no cache cleanup needed) picks it up and the PDF renders correctly. This is the same shape as references/TOC needing a rerun, not a sign of anything broken, and `latexmk`'s automatic multi-pass handling (used everywhere in this pipeline, §5.1) resolves it transparently — a single raw `pdflatex` invocation (as used in ad hoc debugging) will not.
- **`openin_any` defaults to unrestricted in TeX Live (`a` — "any").** This is independent of shell-escape mode: even with shell-escape fully off, `\input{/data/app.db}` can read anything the compile process has filesystem access to, including other projects' files and the SQLite DB. Set a restrictive `openin_any` as defense in depth, but the real boundary has to be filesystem access, not the shell-escape setting.
  - **Current state (as implemented):** the runtime image still has no `USER` directive — the container starts as root — but `deploy/docker/entrypoint.sh` now stays root only long enough to (1) `chown` `/data` and `/cache` (via `find ... ! -user ... -exec chown`, so a steady-state restart with already-owned volumes is cheap — not a blanket `chown -R` every time), (2) write the system-wide fontconfig file plus hand the freshly-root-written `/var/cache/fontconfig` to the app user, then it drops to the unprivileged `node` user (uid/gid 1000, already present in the `node:24-bookworm-slim` base image) via `gosu` for `tlmgr init-usertree`, the runtime `luaotfload-tool -u` warmup, and the final `exec` of the Node process itself. Every child process the Node process spawns at runtime (`latexmk`/`pandoc`/`tlmgr`/`fc-cache`/`luaotfload-tool` — compile pipeline §5, lazy font resolution §7) inherits that uid through normal process inheritance, since none of them re-exec as root. `gosu` (not `su-exec`) is installed via apt in the runtime stage — Debian bookworm ships it directly, no third-party apt source needed. This does **not** yet add per-project process isolation (one compile can still see another project's files under the shared `node` uid) — `openin_any` restriction plus ordinary Unix file permissions (compile processes only ever `cd` into their own project's work directory) remains the boundary for that. **Verified** (2026-11-09, this container): PID 1 and every spawned `latexmk`/`tlmgr`/`fc-cache`/`luaotfload-tool` process run as `node`; a fresh lazy TeX-Live-package font install (step 3), a fresh Google Fonts fallback install (step 4), and a project-local LuaTeX `fonts/` folder compile (§7) all produced `node`-owned files end to end, including against pre-existing root-owned `/data`/`/cache` volume content from before this change — the startup `chown` pass correctly re-owned it on first boot under the new entrypoint.
  - **Later hardening (not yet implemented):** run each compile's child process under a restricted UID or mount namespace that only has access to its own project directory, for real per-project process isolation (not just the shared-`node`-uid boundary above).
- **SVG requires a pre-conversion step, not `\includesvg`.** `\includesvg` calls Inkscape through shell-escape and is not on the restricted allowlist. The backend converts every project SVG (regardless of whether it's referenced from `.tex` or from Markdown) to PDF with `rsvg-convert` before the LaTeX compile runs, writing the converted PDF into the project's compile work directory (`/cache/work/<project-id>/`, mirroring the SVG's relative path, e.g. `images/figure.svg` → `<workdir>/images/figure.pdf`) — never back into `/data/projects/<project-id>` — so it never shows up in the file tree or a zip export as a generated artifact. It's made visible to `\includegraphics{images/figure}` through the `TEXINPUTS` setting from §5.1 (not `-outdir`/`-auxdir` alone — those only affect where _output_ and auxiliary files are written, not kpathsea's input search path, and process CWD is the project directory per §5.1, not the work directory). This is a backend pre-processing step that runs independently of pandoc — it is not pandoc's own (unused, per 5.2) image-conversion path, and it runs whether the source document is `.tex` or Markdown-via-`.tex`-intermediate (5.2), since in both cases the final input to the LaTeX engine is `.tex`/`\includegraphics`, never an SVG. **Verified** (feature/projects-and-compile branch): a project combining `\input`, a project image via plain `\includegraphics`, and a pre-converted SVG — all three resolved with `cwd=<project-dir>` and `TEXINPUTS` including the work directory; see §5.1 for the full setup.
- **The per-project working directory (§5.1) needs a per-project lock.** If auto-compile and a manual compile trigger run concurrently against the same working directory, `.aux`/`.bbl` files can be read or written mid-update and corrupt the next pass. The job queue must serialize compiles per project, not just cap global concurrency.

## 9. Docker and deployment

- A single image containing frontend assets, backend, and toolchain.
- `docker compose up` starts it with two named volumes: `data` and `cache`.
- Default port exposed on localhost.
- Environment settings: TeX repository URL, prefetch delay, compile timeout, limits, network fetching on or off.
- Image layering keeps the toolchain layers stable so rebuilds are fast and downloads are cached by Docker.
- The image declares a `HEALTHCHECK` (`GET /api/health` via `wget`) with a 180s
  `start-period`, since `entrypoint.sh`'s `luaotfload-tool -u` warmup blocks
  HTTP briefly on a fresh `/cache` volume — without the grace period, `docker
compose`/orchestrators would see the container as briefly unhealthy right
  after a healthy start.

## 10. Events and observability

- SSE stream carries: `compile.started`, `compile.finished`, `install.queued`, `install.started`, `install.finished`, `install.failed`, `font.resolving`, `font.resolved`, `font.failed` — all implemented and emitted. `install.*`/`font.*` are rendered as a transient, queued single line in `StatusBarComponent` (separate from the compile log panel); see `docs/contracts/api.md` for the remaining gap (`CompileResult.installs`/`.fontResolutions` per-compile summary, not yet rendered anywhere).
- Install and compile logs are stored per project for debugging.
- `GET /api/health` returns app status only — see §3; it does not report toolchain versions or cache size.
