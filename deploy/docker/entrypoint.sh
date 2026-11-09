#!/bin/sh
set -eu

# /cache is a named volume: Docker only seeds it from image content on first
# creation, and even then our image writes nothing there at build time (the
# toolchain installs into /opt/texlive, not /cache). So the TeX user tree and
# font caches must be initialized here, at container start, every time —
# not lazily on the first user compile, which could otherwise time out
# (architecture.md section 7).
CACHE_DIR="${CACHE_DIR:-/cache}"

# Runtime TEX_REPO_URL (deploy/docker-compose.yml env) must match what the
# image was actually built against (TL_IMAGE_REPO_URL, baked in as an ENV from
# the TEX_REPO_URL build ARG). If they drift, lazily-installed packages would
# come from a different snapshot than the baked-in TeX Live install and
# kernel/formats — exactly the package-date mixing section 6.6 says must
# never happen. Refuse to start rather than silently using the wrong
# repository.
if [ "${TEX_REPO_URL:-}" != "${TL_IMAGE_REPO_URL:-}" ]; then
  echo "entrypoint: TEX_REPO_URL ('${TEX_REPO_URL:-unset}') does not match the image's TL_IMAGE_REPO_URL ('${TL_IMAGE_REPO_URL:-unset}')." >&2
  echo "entrypoint: refusing to start — update deploy/docker-compose.yml so both the build arg and the runtime env var point at the same snapshot." >&2
  exit 1
fi

# Namespace the TeX user tree and caches by snapshot key, so a rebuild against a
# newer snapshot gets a fresh tree instead of silently mixing old lazily-installed
# packages (and the old luaotfload font database) with the new image's TeX Live
# install (section 6.6, section 4 storage layout).
TL_SNAPSHOT_KEY="${TL_SNAPSHOT_KEY:?TL_SNAPSHOT_KEY must be set (baked in via the Dockerfile ARG/ENV of the same name)}"
TL_CACHE_ROOT="${CACHE_DIR}/tl-${TL_SNAPSHOT_KEY}"

# TEXMFHOME *is* tlmgr's "user tree" location by convention — they are not separate
# directories. Pointing TEXMFHOME somewhere other than the --usertree path used
# below means tlmgr-installed packages are invisible to kpathsea.
export TEXMFHOME="${TL_CACHE_ROOT}/texmf-user"
export TEXMFVAR="${TL_CACHE_ROOT}/texmf-var"
# luaotfload writes its font-name database/cache to $TEXMFCACHE, which by default
# resolves to "$TEXMFSYSVAR;$TEXMFVAR" — a search list where TEXMFSYSVAR (baked into
# the image at /opt/texlive/texmf-var, ephemeral) comes first and wins, so just
# setting TEXMFVAR above is not enough: without this, luaotfload silently writes into
# the container's ephemeral filesystem instead of /cache (verified: TEXMFVAR alone
# left luaotfload-names.lua.gz under /opt/texlive, not under $CACHE_DIR). Override
# TEXMFCACHE directly instead of TEXMFSYSVAR — overriding TEXMFSYSVAR itself also
# breaks engine lookup of the formats (*.fmt) baked into /opt/texlive/texmf-var at
# image-build time (verified: with TEXMFSYSVAR redirected to /cache, xelatex could no
# longer find its preloaded format and fell back to mktexfmt on every compile, which
# is exactly what section 6.6 says must never happen lazily).
export TEXMFCACHE="${TL_CACHE_ROOT}/texmf-var"
mkdir -p "$TEXMFHOME" "$TEXMFVAR" "${CACHE_DIR}/fonts" "${CACHE_DIR}/downloads" "${CACHE_DIR}/work"

if [ ! -d "${TEXMFHOME}/tlpkg" ]; then
  tlmgr --usertree "$TEXMFHOME" init-usertree
fi
# --usermode must come before the action, and the repository option is set
# without a leading "--" (it's the option *name*, not a flag).
tlmgr --usertree "$TEXMFHOME" --usermode option repository "$TEX_REPO_URL"

# Makes lazily-installed font packages (architecture.md section 7, resolution
# chain step 3) visible to XeTeX/fontspec via fontconfig. The baked-in image
# config (deploy/docker/texlive-fonts.conf) only covers /opt/texlive's
# bundled fonts; TEXMFHOME is a /cache path only known at runtime, so this
# entry can't be baked in at build time. Filename must carry fontconfig's
# numeric-prefix naming convention (e.g. "09-..."): verified empirically
# that a conf.d file without one is silently never read, so a lazily
# installed font would otherwise "install" successfully via tlmgr yet still
# fail to compile with the same "font not found" error as before the install.
cat > /etc/fonts/conf.d/09-texlive-user-fonts.conf <<EOF
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${TEXMFHOME}/fonts/opentype</dir>
  <dir>${TEXMFHOME}/fonts/truetype</dir>
</fontconfig>
EOF
fc-cache -f

luaotfload-tool -u

exec "$@"
