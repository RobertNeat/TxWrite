#!/usr/bin/env bash
set -euo pipefail

: "${PROJECT_PATH:?PROJECT_PATH is required}"
: "${RUNTIME_VERSION:?RUNTIME_VERSION is required}"

command -v mise >/dev/null
command -v uv >/dev/null
command -v trivy >/dev/null
command -v semgrep >/dev/null
test -f "$PROJECT_PATH/pyproject.toml"

python_bin="$(mise exec "python@${RUNTIME_VERSION}" -- python -c 'import sys; print(sys.executable)')"
export UV_PYTHON="$python_bin"

uv sync --project "$PROJECT_PATH"
uv run --project "$PROJECT_PATH" ruff check "$PROJECT_PATH"
uv run --project "$PROJECT_PATH" ruff format --check "$PROJECT_PATH"
uv run --project "$PROJECT_PATH" mypy "$PROJECT_PATH"
uv run --project "$PROJECT_PATH" python -m unittest discover -s "$PROJECT_PATH"
uv build --project "$PROJECT_PATH"
trivy fs --exit-code 1 --severity HIGH,CRITICAL --scanners vuln "$PROJECT_PATH"
semgrep scan --config auto --error "$PROJECT_PATH"
