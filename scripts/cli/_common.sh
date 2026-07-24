# Shared helpers for the per-database CLI dev scripts (sourced, not executed).
#
# Each engine script sources this file, then calls `pq_exec <engine> <connection-string>`.
# It resolves the repo root, builds @portqueue/core and @portqueue/cli on first run (when
# their dist is missing), and finally execs the CLI with the engine's flags so the caller's
# own flags/args are appended after them.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="$REPO_ROOT/packages/cli/dist/cli.mjs"

# Build dependencies on first use (the CLI resolves @portqueue/core from its dist).
pq_build_if_needed() {
  [ -f "$REPO_ROOT/packages/core/dist/index.mjs" ] ||
    npm --prefix "$REPO_ROOT" run build --workspace @portqueue/core
  [ -f "$CLI" ] ||
    npm --prefix "$REPO_ROOT" run build --workspace @portqueue/cli
}

# pq_exec <engine> <connection-string> [caller args...]
pq_exec() {
  local engine="$1"
  local connection_string="$2"
  shift 2
  pq_build_if_needed
  exec node "$CLI" --driver "$engine" --connection-string "$connection_string" "$@"
}
