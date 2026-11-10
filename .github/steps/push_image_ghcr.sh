#!/usr/bin/env bash
set -euo pipefail

: "${LOCAL_REGISTRY:?LOCAL_REGISTRY is required}"
: "${IMAGE:?IMAGE is required}"
: "${SOURCE_SHA:?SOURCE_SHA is required}"
: "${RELEASE_TAG:?RELEASE_TAG is required}"
: "${GHCR_OWNER:?GHCR_OWNER is required}"

[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "A lowercase full commit SHA is required" >&2; exit 2; }
source_image="${LOCAL_REGISTRY}/${IMAGE}:${SOURCE_SHA}"

version="${RELEASE_TAG#release_}"
destination="ghcr.io/${GHCR_OWNER,,}/${IMAGE}:${version}"
docker pull "$source_image"
source_digest="$(docker image inspect "$source_image" --format '{{index .RepoDigests 0}}' | sed 's/^.*@//')"

if docker manifest inspect "$destination" >/dev/null 2>&1; then
  destination_digest="$(docker manifest inspect "$destination" --verbose | jq -r '.Descriptor.digest // empty' | head -n 1)"
  [ "$source_digest" = "$destination_digest" ] || { echo "Refusing to overwrite release $destination" >&2; exit 3; }
  echo "Release already exists: $destination@$destination_digest"
  exit 0
fi

docker tag "$source_image" "$destination"
docker push "$destination"
echo "$destination@$source_digest"
echo "ZOD image registry labels: $(docker image inspect "$destination" --format '{{json .Config.Labels}}')"

