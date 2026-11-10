#!/usr/bin/env bash
set -euo pipefail

: "${REGISTRY:?REGISTRY is required}"
: "${IMAGE:?IMAGE is required}"
: "${SHA:?SHA is required}"

image_ref="${REGISTRY}/${IMAGE}:${SHA}"
if docker manifest inspect "$image_ref" >/dev/null 2>&1; then
  remote_digest="$(docker manifest inspect "$image_ref" --verbose | jq -r '.Descriptor.digest // empty' | head -n 1)"
  local_digest="$(docker image inspect "$image_ref" --format '{{index .RepoDigests 0}}' 2>/dev/null | sed 's/^.*@//' || true)"
  if [ -n "$remote_digest" ] && [ -n "$local_digest" ] && [ "$remote_digest" != "$local_digest" ]; then
    echo "Refusing to overwrite immutable tag $image_ref" >&2
    exit 3
  fi
  echo "Immutable tag already exists: $image_ref@$remote_digest"
  exit 0
fi

docker push "$image_ref"
docker inspect --format='{{index .RepoDigests 0}}' "$image_ref"
echo "ZOD image registry labels: $(docker image inspect "$image_ref" --format '{{json .Config.Labels}}')"

