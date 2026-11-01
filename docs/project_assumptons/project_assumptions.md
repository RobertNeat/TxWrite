# Project Assumptions

Working title: *(TBD)*. A self-hosted, browser-based LaTeX and Markdown renderer that runs in a single Docker container.

## 1. Vision

A "download and don't worry about it" alternative to Overleaf. The user starts one container, opens a browser, and writes LaTeX or Markdown. Missing packages and fonts are fetched in the background and cached, so the user never has to think about TeX distributions.

### Goals
- Render `.tex` and `.md` files to PDF from a web UI.
- Keep the shipped image lightweight. Heavy content is pulled lazily on first use.
- No hard limit on which TeX packages or fonts can be used.
- Support project files beyond source text: images, bibliographies, fonts, custom `.cls`/`.sty` files.
- Support templates as a starting point for new projects.
- Run locally, with no cloud dependency after the cache is warm.

### Non-goals (initial version)
- Real-time multi-user collaboration.
- Real authentication, permissions or hosted multi-tenant use.
- Version history, comments or track changes.
- Full Overleaf feature parity.

## 2. Why this project (competitive gap)

| Option | Tradeoff this project targets |
|---|---|
| Overleaf Community Edition | Full TeX Live (several GB), heavy to run, no Markdown rendering |
| Plain `pandoc/latex` or `texlive` images | CLI only, limited package set or very large image |
| Tectonic | Small and lazy, but pinned to a fixed package snapshot and no external tools |
| SwiftLaTeX (WebAssembly) | No server needed, but less complete and less maintained |

The gap: a **small image + lazy package/font resolution + Markdown and LaTeX under one UI**, self-hosted.

## 3. Core concepts

### 3.1 Users (initial: simple profiles)
- A user is a simple profile entry (display name, id). No password, no session security.
- Profiles are accessible by anyone with access to the app. This is a convenience grouping, not a security boundary.
- Each project belongs to one profile.
- Real authentication is a possible later phase and must not be assumed by the data model.

### 3.2 Projects
- A project is a folder of files plus metadata (name, owner profile, engine, main file, template origin).
- File types: `.tex`, `.md`, `.bib`, `.cls`, `.sty`, images (png, jpg, pdf, svg), font files (`.ttf`, `.otf`), arbitrary assets.
- Users can create, upload, rename and delete files.
- Whole projects can be imported and exported as zip.
- Images and assets uploaded by the user are embedded in the compiled PDF through normal relative paths.

### 3.3 Templates
A template is a project zip with an optional manifest.

```yaml
name: IEEE Conference
engine: xelatex          # optional engine hint
main: main.tex
supports: [latex, markdown]
```

Kinds of template:
1. **LaTeX template**: copied into a new project as a starting point.
2. **Pandoc template**: a `.latex` file with `$body$`-style placeholders, used when rendering Markdown (`--template`).
3. **Wrapper template**: a LaTeX template with a designated content slot (for example `\input{content.tex}`). Markdown is converted to a LaTeX fragment and inserted there. A bundled compatibility style defines the macros pandoc output expects.
4. **Class reuse**: Markdown uses a template's `.cls` through `documentclass:` in YAML metadata (zero-effort path).

Assumption: LaTeX and pandoc templates are **not fully interchangeable** (a pandoc template is not valid LaTeX on its own). Interchangeability is achieved through the wrapper convention and class reuse. The UI shows per-template badges (LaTeX / Markdown) driven by detection plus manifest.

### 3.4 Markdown rendering
- Markdown goes through pandoc to LaTeX to PDF, using the same engine, package cache and font cache as `.tex` files.
- Raw LaTeX inside Markdown is allowed.
- Project images work with the same relative paths as in LaTeX.

### 3.5 Compile
- Triggered manually or automatically after edits.
- Runs with time and resource limits.
- Produces a PDF plus a structured log shown in the UI.

## 4. Constraints and design principles

1. **Lightweight base image.** The shipped image contains only a `scheme-basic` TeX installation (the smallest scheme that includes LaTeX itself — see `technology.md` §6), pandoc, a small curated set of preinstalled packages and a curated set of fonts. Target size to be measured; the intent is well under a full TeX Live.
2. **Lazy pull, then cached.** A package or font not yet present is downloaded the first time it is needed and stored in a persistent cache volume. Later compiles use the cache and work offline for anything already cached.
3. **Invisible to the user.** The user sees at most a slower first compile and a status message. No manual installation steps.
4. **No artificial limit, but with exceptions that must ship preinstalled, not lazily.** Any package available from the TeX package repository can in principle be resolved lazily, except: binaries/scripts (`biber`, `xindy`, `latexminted`'s `bin/` symlink — `tlmgr` user mode cannot install these at all), the LaTeX kernel (`latex-base`/`l3kernel`, baked into the compiled formats at image-build time), and hyphenation patterns for any language the project must support (also baked into formats — see §5). Fonts follow a best-effort chain with a guaranteed manual fallback (upload the font file to the project).
5. **Ephemeral container, persistent data.** The container can be destroyed and recreated at any time. Projects, templates, profiles and caches live in volumes.
6. **Shell-escape restricted by default, not full.** Compiles run with *restricted* shell-escape by default (covers `bibtex`, `biber`, `makeindex`, and minted v3's `latexminted`, which was redesigned to work under restricted mode). Full shell-escape is an explicit per-project opt-in, because combined with zip/template imports from the internet it allows arbitrary code execution with whatever access the compile process has. Process/filesystem isolation is a separate control, not provided by shell-escape mode, since TeX's `openin_any` defaults to unrestricted regardless (see `architecture.md` §8); today that boundary is ordinary Unix file permissions within the container, with UID/mount-namespace isolation tracked as later hardening, not yet implemented.
7. **Safe imports.** Zip imports must prevent path traversal (zip-slip) and enforce size limits. A project-provided `latexmkrc` must never be executed (it is Perl, run automatically by `latexmk` from the working directory) — only statically parsed if used at all for engine detection.

## 5. Font and language assumptions

- A good default font set is shipped so most documents work immediately.
- Fonts not shipped are resolved in order: already installed, project `fonts/` folder, TeX Live font packages, Google Fonts (via an allowlisted source), then a clear error asking the user to upload the font file.
- **Resolution differs by engine**, not just by "project path": XeTeX needs a per-compile fontconfig config pointing at `fonts/` (or, engine-independent, `fontspec`'s `Path=fonts/`); LuaTeX's `luaotfload` has its own font database (not fontconfig) and its cache must live on `/cache` under `TEXMFVAR` or it rebuilds — and can time out — on every container recreate.
- Commercial fonts: **to verify per font before stating as fact.** Some (for example Times New Roman, Arial, Courier New) may be legally obtainable under vendor EULAs such as the MS core fonts package; others (for example Calibri, Cambria) are not. Treat "cannot be fetched legally" as a per-font lookup, not a blanket rule for all commercial fonts, and map unavailable ones to metric-compatible substitutes with a visible warning.
- **Hyphenation patterns must be preinstalled for every language the project supports, never lazy.** They are compiled into formats via `fmtutil`/`language.dat`. A missing pattern produces only a babel *warning*, not a compile error, so the reactive retry loop (architecture.md §5.3) will not notice and will not trigger an install — the document just hyphenates badly with no visible failure. Polish (`hyphen-polish`, `babel-polish`, `polski`) must be in the base image from day one since it's the primary target language for this project.

## 6. Known risks

- **tlmgr release matching, and not only at yearly rollover.** Lazy installation with `tlmgr` requires an upstream TeX Live install whose release matches the package repository. Even mid-year, pointing a pinned install at a live/rolling repo breaks once upstream ships a newer `texlive.infra` (`tlmgr` then refuses installs until `update --self`) and mixes package dates in the cache. The repository must point at a frozen snapshot/mirror from day one, namespaced by release, not just after the yearly rollover (see `architecture.md` §6.6).
- **biber/biblatex version drift.** `biber` is a binary baked into the image; a lazily-installed `biblatex` from a live repo will drift to a newer version over time, producing `Found biblatex control file version X, expected Y` on documents that used to compile. Both must come from the same frozen snapshot and never be updated independently.
- **Packages that need external tools** (for example `minted` needs Pygments, `biber` for bibliographies) require those tools in the base image.
- **Package dependency resolution is not automatic at the package level.** `texlive.tlpdb` entries mostly declare no `depend` relationships between individual packages (only collections/schemes do), so a template needing many packages can surface them one compile-retry at a time. The retry loop must be capped by "no new install happened" or a time budget, not a fixed iteration count (see `architecture.md` §5.3).
- **First-compile latency** for large dependency sets such as TikZ-heavy or font-heavy templates.
- **Network dependence on first use** of an uncached package. The UI must explain this clearly when offline.
- **Zip templates in the wild** vary widely (custom engines, odd main files), so main-file and engine detection need good defaults and manual override.
- **SVG needs a conversion step.** `\includesvg` depends on Inkscape via shell-escape, which is not in the restricted allowlist. The backend pre-converts every project SVG to PDF with `rsvg-convert` before the LaTeX compile runs, independent of pandoc (see `architecture.md` §8).

## 7. Initial scope (MVP)

- Simple profiles.
- Project CRUD and file upload (including images), zip import and export.
- Editor, PDF preview and compile log in the browser.
- `.tex` compile through `latexmk` with engine selection.
- `.md` compile through pandoc with a few built-in pandoc templates.
- Lazy package installation (reactive, on compile failure).
- Curated font set plus project-local fonts.

### Later
- Proactive prefetching while the user edits.
- Lazy font fetching from Google Fonts.
- Wrapper templates and a template gallery.
- Real authentication.

## 8. Open questions

- Which pinned TeX Live release, and which exact frozen-snapshot date (see `architecture.md` §6.6)?
- Compile working directories are persistent per project, not per-request temp (see `architecture.md` §5.1) — should isolation beyond that (restricted UID, mount namespace) be in scope for the MVP, or a later hardening pass (see `architecture.md` §8 note on current feasibility)?
- Is auto-compile on edit in scope for the MVP, or manual compile first?
- Should the template gallery be a built-in list or a configurable list of zip URLs?
