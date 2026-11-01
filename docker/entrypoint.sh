#!/bin/sh
set -eu

# /cache is a named volume: Docker only seeds it from image content on first
# creation, and even then our image writes nothing there at build time (the
# toolchain installs into /opt/texlive, not /cache). So the TeX user tree and
# font caches must be initialized here, at container start, every time —
# not lazily on the first user compile, which could otherwise time out
# (architecture.md section 7).
#
# TEXMFHOME *is* tlmgr's "user tree" location by convention — they are not
# separate directories. Pointing TEXMFHOME somewhere other than the
# --usertree path used below means tlmgr-installed packages are invisible to
# kpathsea (the earlier version of this script had exactly that bug).
CACHE_DIR="${CACHE_DIR:-/cache}"
export TEXMFHOME="${CACHE_DIR}/texmf-user"
export TEXMFVAR="${CACHE_DIR}/texmf-var"
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
export TEXMFCACHE="${CACHE_DIR}/texmf-var"
mkdir -p "$TEXMFHOME" "$TEXMFVAR" "${CACHE_DIR}/fonts" "${CACHE_DIR}/downloads" "${CACHE_DIR}/work"

if [ ! -d "${TEXMFHOME}/tlpkg" ]; then
  tlmgr --usertree "$TEXMFHOME" init-usertree
fi
# --usermode must come before the action, and the repository option is set
# without a leading "--" (it's the option *name*, not a flag).
tlmgr --usertree "$TEXMFHOME" --usermode option repository "$TEX_REPO_URL"

luaotfload-tool -u

exec "$@"
