#!/usr/bin/env bash
set -euo pipefail

cfg="${1:-.github/ci/projects.json}"
test -f "$cfg"

jq -e '
  .schema_version == 2 and
  (.pipeline.runner_labels | type == "array" and length > 0 and all(.[]; type == "string" and length > 0)) and
  (.pipeline.project_roots | type == "array" and all(.[]; type == "string" and length > 0)) and
  (.projects | type == "array" and length > 0) and
  (.deploy | type == "object") and
  (.deploy | all(.environment, .host, .user, .registry, .compose_file, .config_file, .remote_dir;
    type == "string" and length > 0)) and
  all(.projects[];
    ((keys | sort) == (["name", "type", "framework", "version", "path", "package_manager", "build_tool",
      "dockerfile", "image", "package_name", "Trivy_exceptions", "check_script", "build_output", "server_config",
      "start_command", "ports"] | sort)) and
    (.name | type == "string" and length > 0) and
    (.type | IN("node", "python", "springboot")) and
    (.framework | type == "string" and length > 0) and
    (.version | type == "string" and length > 0) and
    ((.path | type == "string" and length > 0) and ((.path | startswith("/")) | not)) and
    ((.dockerfile | type == "string" and length > 0) and ((.dockerfile | startswith("/")) | not)) and
    (.image | type == "string" and length > 0) and
    (.Trivy_exceptions | type == "array" and all(.[]; ((keys | sort) == (["name", "cause"] | sort)) and (.name | type == "string" and length > 0) and (.cause | type == "string" and length > 0))) and
    ((.ports | keys | sort) == (["container", "host"] | sort)) and
    (.ports.host | type == "number" and floor == . and . >= 1 and . <= 65535) and
    (.ports.container | type == "number" and floor == . and . >= 1 and . <= 65535) and
    (if .type == "node" then
       (.package_manager | type == "string" and length > 0) and
       (.package_name | type == "string" and length > 0) and
       (.check_script | type == "string" and test("^[A-Za-z0-9:_-]+$")) and
       (.build_tool == null)
     else
       (.package_manager == null) and (.package_name == null) and (.check_script == null)
     end) and
    (if .framework == "angular" then
       (.build_output | type == "string" and length > 0) and
       (.server_config | type == "string" and length > 0) and
       (.start_command == null)
     else
       (.server_config == null) and
       (.start_command | type == "string" and length > 0)
     end) and
    (if .type == "springboot" then
       (.build_tool | IN("maven", "gradle")) and
       (.build_output | type == "string" and length > 0)
     elif .type == "python" then
       (.build_tool | type == "string" and length > 0) and
       (.build_output == null)
     else true end)
  ) and
  ([.projects[].name] | length == (unique | length)) and
  ([.projects[].path] | length == (unique | length)) and
  ([.projects[].image] | length == (unique | length)) and
  ([.projects[].ports.host] | length == (unique | length)) and
  ([.projects[].name | ascii_upcase | gsub("[^A-Z0-9]"; "_")] | length == (unique | length))
' "$cfg" >/dev/null

while IFS= read -r path; do
  test -d "$path" || { echo "Project directory does not exist: $path" >&2; exit 2; }
done < <(jq -r '.projects[].path' "$cfg")

while IFS= read -r dockerfile; do
  test -f "$dockerfile" || { echo "Dockerfile does not exist: $dockerfile" >&2; exit 2; }
done < <(jq -r '.projects[].dockerfile' "$cfg" | sort -u)

while IFS= read -r server_config; do
  test -f "$server_config" || { echo "Server configuration does not exist: $server_config" >&2; exit 2; }
done < <(jq -r '.projects[].server_config // empty' "$cfg")

for deploy_file in compose_file config_file; do
  path="$(jq -er --arg key "$deploy_file" '.deploy[$key]' "$cfg")"
  test -f "$path" || { echo "Deployment file does not exist: $path" >&2; exit 2; }
done

# An empty pipeline.project_roots means projects are declared explicitly
# (e.g. a single-image monorepo whose one project path is "."), so there is
# no directory-discovery contract to enforce against pipeline.project_roots.
if [ "$(jq -r '.pipeline.project_roots | length' "$cfg")" -gt 0 ]; then
  declared_paths="$(mktemp)"
  discovered_paths="$(mktemp)"
  trap 'rm -f "$declared_paths" "$discovered_paths"' EXIT
  jq -r '.projects[].path' "$cfg" | sort > "$declared_paths"

  while IFS= read -r root; do
    test -d "$root" || { echo "Project root does not exist: $root" >&2; exit 2; }
    find "$root" -mindepth 1 -maxdepth 1 -type d -printf '%p\n'
  done < <(jq -r '.pipeline.project_roots[]' "$cfg") | sort > "$discovered_paths"

  diff -u "$discovered_paths" "$declared_paths" || {
    echo "projects.json must cover every directory from pipeline.project_roots exactly once" >&2
    exit 2
  }
fi

# Domyślne wartości zmiennych w Compose (`${VAR:-default}`) muszą być zgodne z
# projects.json: pozwalają uruchamiać stos lokalnie bez projects.env.
compose_dir="$(dirname "$(jq -er '.deploy.compose_file' "$cfg")")"
compose_files=("$(jq -er '.deploy.compose_file' "$cfg")")
test -f "$compose_dir/compose.dev.yml" && compose_files+=("$compose_dir/compose.dev.yml")

while IFS=$'\t' read -r prefix image host_port container_port; do
  for compose_file in "${compose_files[@]}"; do
    for var in "IMAGE:$image" "HOST_PORT:$host_port" "CONTAINER_PORT:$container_port"; do
      suffix="${var%%:*}"
      expected="\${${prefix}_${suffix}:-${var#*:}}"
      found="$(grep -o "\${${prefix}_${suffix}[^}]*}" "$compose_file" | sort -u || true)"
      # A variable may be unused (e-* host ports are only reserved; compose.dev.yml
      # has no images), but when present it must match projects.json. Image and
      # container port are mandatory in the main compose file.
      if [ -z "$found" ]; then
        if [ "$compose_file" = "${compose_files[0]}" ] && [ "$suffix" != "HOST_PORT" ]; then
          echo "$compose_file does not reference ${prefix}_${suffix}" >&2
          exit 2
        fi
        continue
      fi
      [ "$found" = "$expected" ] || {
        echo "$compose_file: expected only $expected but found: $found" >&2
        exit 2
      }
    done
  done
done < <(jq -r '.projects[] |
  [(.name | ascii_upcase | gsub("[^A-Z0-9]"; "_")), .image, (.ports.host | tostring), (.ports.container | tostring)] | @tsv' "$cfg")
