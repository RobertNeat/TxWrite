#!/usr/bin/env bash
set -euo pipefail

: "${REGISTRY:?REGISTRY is required}"
: "${IMAGE:?IMAGE is required}"
: "${SHA:?SHA is required}"

exceptions="${TRIVY_EXCEPTIONS:-[]}"

if jq -e 'length == 0' <<<"$exceptions" >/dev/null; then
  trivy image --exit-code 1 --severity HIGH,CRITICAL --scanners vuln --vuln-type library --ignore-unfixed --timeout 15m "${REGISTRY}/${IMAGE}:${SHA}"
  exit 0
fi

report="$(mktemp)"
filtered_report="$(mktemp)"
trap 'rm -f "$report" "$filtered_report"' EXIT

trivy image --exit-code 0 --format json --severity HIGH,CRITICAL --scanners vuln --vuln-type library --ignore-unfixed --timeout 15m "${REGISTRY}/${IMAGE}:${SHA}" > "$report"

jq --argjson exceptions "$exceptions" '
  def base_path: (.PkgPath // "" | split("/") | last);
  def display_name: if base_path == "" then .PkgName else "\(.PkgName) (\(base_path))" end;
  def is_exception:
    . as $v
    | any($exceptions[]; .name == $v.PkgName or .name == ($v | display_name));

  .Results = [
    .Results[]
    | if .Vulnerabilities then
        .Vulnerabilities = [.Vulnerabilities[] | select(is_exception | not)]
      else
        .
      end
    | select((.Vulnerabilities // []) | length > 0)
  ]
' "$report" > "$filtered_report"

remaining="$(jq '[.Results[]?.Vulnerabilities[]?] | length' "$filtered_report")"

if [ "$remaining" -gt 0 ]; then
  trivy convert --format table "$filtered_report"
  exit 1
fi

echo "Trivy scan passed after applying configured dependency exceptions:"
jq -r '.[] | "- \(.name): \(.cause)"' <<<"$exceptions"
