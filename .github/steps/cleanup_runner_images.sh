#!/usr/bin/env bash
set -euo pipefail

: "${SHA:?SHA is required}"
cfg=.github/ci/projects.json
test -f "$cfg"
registry="$(jq -r '.deploy.registry' "$cfg")"

while IFS= read -r image; do
  repository="${registry}/${image}"
  current_ref="${repository}:${SHA}"
  mapfile -t refs < <(docker image ls "$repository" --format '{{.Repository}}:{{.Tag}}' | grep -v ':<none>$' || true)
  [ "${#refs[@]}" -gt 0 ] || continue

  keep_ref="${refs[0]}"
  for ref in "${refs[@]}"; do
    if [ "$ref" = "$current_ref" ]; then
      keep_ref="$current_ref"
      break
    fi
  done

  echo "Keeping runner image: $keep_ref"
  for ref in "${refs[@]}"; do
    [ "$ref" = "$keep_ref" ] && continue
    if ! docker image rm "$ref"; then
      echo "Warning: image is still in use and was not removed: $ref" >&2
    fi
  done
done < <(jq -r '.projects[].image' "$cfg")

docker system df

