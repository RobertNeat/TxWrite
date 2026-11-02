# syntax=docker/dockerfile:1

#### Stage: frontend build ####
FROM node:24-bookworm-slim AS frontend-build
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/frontend/package.json apps/frontend/package.json
RUN corepack enable \
    && pnpm config set fetch-timeout 600000 \
    && pnpm config set fetch-retries 10 \
    && pnpm config set fetch-retry-factor 2 \
    && pnpm config set fetch-retry-mintimeout 20000 \
    && pnpm config set fetch-retry-maxtimeout 120000 \
    && pnpm config set network-concurrency 4
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm fetch
COPY apps/frontend apps/frontend
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --offline --filter frontend...
RUN pnpm --filter frontend build

#### Stage: backend build ####
FROM node:24-bookworm-slim AS backend-build
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/backend/package.json apps/backend/package.json
RUN corepack enable \
    && pnpm config set fetch-timeout 600000 \
    && pnpm config set fetch-retries 10 \
    && pnpm config set fetch-retry-factor 2 \
    && pnpm config set fetch-retry-mintimeout 20000 \
    && pnpm config set fetch-retry-maxtimeout 120000 \
    && pnpm config set network-concurrency 4
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm fetch
COPY apps/backend apps/backend
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --offline --filter backend...
RUN pnpm --filter backend build

#### Stage: toolchain ####
# TeX Live (scheme-basic) + pandoc, installed from a frozen dated snapshot so the
# package set is reproducible across rebuilds (see
# docs/project_assumptons/architecture.md section 6.6). Kept as its own stage so the
# (slow, large) toolchain install layer is cached independently of app code changes.
FROM debian:bookworm-slim AS toolchain
ARG TEX_REPO_URL=https://texlive.info/tlnet-archive/2026/10/01/tlnet/
# Short, filesystem-safe key derived from the snapshot date, used to namespace the
# /cache/tl-<key>/ trees at runtime (section 6.6: caches must never mix package dates
# across a pinned-release change — a flat /cache/texmf-user would otherwise silently
# carry packages installed against an old snapshot into a rebuild against a new one).
ARG TL_SNAPSHOT_KEY=2026-10-01
ARG PANDOC_VERSION=3.5

RUN apt-get update && apt-get install -y --no-install-recommends \
    perl \
    fontconfig \
    python3-pygments \
    librsvg2-bin \
    xz-utils \
    curl \
    ca-certificates \
    gnupg \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /tmp/texlive-install
RUN curl -fsSL "${TEX_REPO_URL}install-tl-unx.tar.gz" -o install-tl-unx.tar.gz \
    && tar -xzf install-tl-unx.tar.gz --strip-components=1 \
    && rm install-tl-unx.tar.gz
COPY docker/texlive.profile ./texlive.profile
# -no-verify-downloads would silence this cleanly, but the upstream flag for turning
# verification ON by default already applies here: install-tl verifies the tlpdb's
# GPG signature against its own bundled keyring when gnupg is available (installed
# above), so no extra flag is needed — only its absence would need one.
RUN ./install-tl -profile texlive.profile -repository "${TEX_REPO_URL}" \
    && rm -rf /tmp/texlive-install
ENV PATH="/opt/texlive/bin/x86_64-linux:${PATH}"

RUN tlmgr install \
    latexmk \
    collection-xetex \
    collection-luatex \
    biber biblatex \
    hyphen-polish babel-polish polski \
    minted \
    collection-fontsrecommended

# Rebuild all formats now that hyphenation/babel packages are installed (they affect
# format contents), and bake the result into the image so no compile ever triggers
# mktexfmt itself (architecture.md section 6.6: the kernel/formats must never be built
# or updated lazily — baking them here is the image-build-time equivalent).
RUN fmtutil-sys --all

# minted v3's shell-escape helper ships as a Python script; tlmgr's user-mode install
# cannot create the bin/ symlink (architecture.md section 6.2), so link it explicitly.
RUN latexmint_path="$(find /opt/texlive -name 'latexminted' -type f | head -n1)" \
    && if [ -n "$latexmint_path" ]; then \
         ln -sf "$latexmint_path" /opt/texlive/bin/x86_64-linux/latexminted; \
       fi

# Pandoc publishes no official checksum file for its releases, so these hashes are
# pinned from a one-time local `sha256sum` of the 3.5 release tarballs (verified
# 2026-11-01) rather than compared against an upstream-published value. They still
# protect against a corrupted or tampered download on every subsequent build.
RUN dpkgArch="$(dpkg --print-architecture)" \
    && case "$dpkgArch" in \
         amd64) pandocArch="amd64"; pandocSha256="a46b448ad9e7e5bd898a0606a2a67acbf4bc7714b24dc68931e9a47d7b807015" ;; \
         arm64) pandocArch="arm64"; pandocSha256="1bd96209bb16a0c0890d1f55eac5d4b6faac975bee20bf703df263f0408f2b51" ;; \
         *) echo "unsupported architecture: $dpkgArch" >&2; exit 1 ;; \
       esac \
    && curl -fsSL "https://github.com/jgm/pandoc/releases/download/${PANDOC_VERSION}/pandoc-${PANDOC_VERSION}-linux-${pandocArch}.tar.gz" -o pandoc.tar.gz \
    && echo "${pandocSha256}  pandoc.tar.gz" | sha256sum -c - \
    && tar -xzf pandoc.tar.gz --strip-components=2 -C /usr/local/bin "pandoc-${PANDOC_VERSION}/bin/pandoc" \
    && rm pandoc.tar.gz \
    && pandoc --version

#### Stage: runtime ####
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ARG TEX_REPO_URL=https://texlive.info/tlnet-archive/2026/10/01/tlnet/
ARG TL_SNAPSHOT_KEY=2026-10-01

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    perl \
    fontconfig \
    python3-pygments \
    librsvg2-bin \
    wget \
    && rm -rf /var/lib/apt/lists/*

COPY --from=toolchain /opt/texlive /opt/texlive
COPY --from=toolchain /usr/local/bin/pandoc /usr/local/bin/pandoc
ENV PATH="/opt/texlive/bin/x86_64-linux:${PATH}"
# TL_IMAGE_REPO_URL and TL_SNAPSHOT_KEY record what the image was actually built
# against. Kept separate from the runtime TEX_REPO_URL env var (set in
# docker-compose.yml), which docker/entrypoint.sh checks against this at container
# start — the two must always refer to the same snapshot (see section 6.6).
ENV TL_IMAGE_REPO_URL=${TEX_REPO_URL}
ENV TL_SNAPSHOT_KEY=${TL_SNAPSHOT_KEY}

# Without this, fontconfig (and therefore XeTeX/fontspec) cannot see TeX Live's
# bundled fonts (Latin Modern, TeX Gyre, etc.) at all, since /opt/texlive is outside
# fontconfig's default search dirs.
COPY docker/texlive-fonts.conf /etc/fonts/conf.d/09-texlive.conf
RUN fc-cache -f

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/backend/package.json apps/backend/package.json
RUN corepack enable \
    && pnpm config set fetch-timeout 600000 \
    && pnpm config set fetch-retries 10 \
    && pnpm config set fetch-retry-factor 2 \
    && pnpm config set fetch-retry-mintimeout 20000 \
    && pnpm config set fetch-retry-maxtimeout 120000 \
    && pnpm config set network-concurrency 4
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --prod --filter backend...

COPY --from=backend-build /repo/apps/backend/dist apps/backend/dist
COPY --from=frontend-build /repo/apps/frontend/dist/frontend/browser apps/backend/public

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DATA_DIR=/data
ENV CACHE_DIR=/cache

EXPOSE 3000
VOLUME ["/data", "/cache"]

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "apps/backend/dist/main.js"]
