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

1. **Lightweight base image.** The shipped image contains only a minimal TeX installation, pandoc, a small curated set of preinstalled packages and a curated set of fonts. Target size to be measured; the intent is well under a full TeX Live.
2. **Lazy pull, then cached.** A package or font not yet present is downloaded the first time it is needed and stored in a persistent cache volume. Later compiles use the cache and work offline for anything already cached.
3. **Invisible to the user.** The user sees at most a slower first compile and a status message. No manual installation steps.
4. **No artificial limit.** Any package available from the TeX package repository can be resolved. Fonts follow a best-effort chain with a guaranteed manual fallback (upload the font file to the project).
5. **Ephemeral container, persistent data.** The container can be destroyed and recreated at any time. Projects, templates, profiles and caches live in volumes.
6. **Container as the sandbox.** Compiles run with shell-escape enabled inside the container, with CPU, memory and time limits. The app is meant for local or trusted use.
7. **Safe imports.** Zip imports must prevent path traversal (zip-slip) and enforce size limits.

## 5. Font assumptions

- A good default font set is shipped so most documents work immediately.
- Fonts not shipped are resolved in order: already installed, project `fonts/` folder, TeX Live font packages, Google Fonts (via an allowlisted source), then a clear error asking the user to upload the font file.
- Commercial fonts (for example Helvetica Neue, Calibri, Times New Roman) cannot be fetched legally. They are mapped to metric-compatible substitutes with a visible warning.

## 6. Known risks

- **tlmgr release matching.** Lazy installation with `tlmgr` requires an upstream TeX Live install whose release matches the package repository. Releases roll yearly, so the pinned release needs a defined historic-repository strategy (see `architecture.md`).
- **Packages that need external tools** (for example `minted` needs Pygments, `biber` for bibliographies) require those tools in the base image.
- **First-compile latency** for large dependency sets such as TikZ-heavy or font-heavy templates.
- **Network dependence on first use** of an uncached package. The UI must explain this clearly when offline.
- **Zip templates in the wild** vary widely (custom engines, odd main files), so main-file and engine detection need good defaults and manual override.

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

- Which pinned TeX Live release, and how to handle the yearly rollover?
- Should compile isolation per request go beyond a temp working directory?
- Is auto-compile on edit in scope for the MVP, or manual compile first?
- Should the template gallery be a built-in list or a configurable list of zip URLs?
