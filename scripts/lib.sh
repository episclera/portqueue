#!/usr/bin/env bash
# Shared helpers for the dev scripts. Source this from a script:
#   source "$(dirname "$0")/../lib.sh"
set -euo pipefail

# Repo root, resolved relative to this file (works from any cwd).
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/.docker/docker-compose.yml"

# Pick `docker compose` (v2) or fall back to `docker-compose` (v1).
compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose -f "$COMPOSE_FILE" "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose -f "$COMPOSE_FILE" "$@"
  else
    echo "error: docker compose is not installed or not on PATH." >&2
    exit 1
  fi
}
