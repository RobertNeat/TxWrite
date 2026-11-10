#!/usr/bin/env bash
set -euo pipefail

: "${PROJECT_PATH:?PROJECT_PATH is required}"
: "${RUNTIME_VERSION:?RUNTIME_VERSION is required}"
: "${PACKAGE_MANAGER:=pnpm}"
: "${PACKAGE_NAME:?PACKAGE_NAME is required}"
: "${CHECK_SCRIPT:?CHECK_SCRIPT is required}"

command -v mise >/dev/null
command -v trivy >/dev/null
command -v semgrep >/dev/null
test -f "$PROJECT_PATH/package.json"

run_node() {
  mise exec "node@${RUNTIME_VERSION}" -- "$@"
}

run_node node --version
# corepack downloads the pinned package manager from registry.npmjs.org by default,
# ignoring .npmrc; point it at the local registry too.
export COREPACK_NPM_REGISTRY=http://192.168.1.163
if ! run_node sh -c 'command -v corepack >/dev/null 2>&1'; then
  run_node npm install --global corepack
fi
run_node corepack enable

case "$PACKAGE_MANAGER" in
  pnpm)
    run_node pnpm install --frozen-lockfile
    # Resolve and build workspace dependencies from the package graph. The check
    # remains independent of application-specific package and dependency names.
    run_node pnpm --filter "${PACKAGE_NAME}..." --filter "!${PACKAGE_NAME}" run --if-present build
    ;;
  npm) (cd "$PROJECT_PATH" && run_node npm ci) ;;
  yarn) run_node yarn install --immutable ;;
  *) echo "Unsupported package manager: $PACKAGE_MANAGER" >&2; exit 2 ;;
esac

cd "$PROJECT_PATH"
run_node "$PACKAGE_MANAGER" run "$CHECK_SCRIPT"

trivy fs --exit-code 1 --severity HIGH,CRITICAL --scanners vuln .
semgrep scan --config auto --error .
