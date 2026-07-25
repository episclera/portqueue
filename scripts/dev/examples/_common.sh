# Shared helpers for the example launcher scripts (sourced, not executed).
#
# Each example script sources this file, then calls `run_example <workspace> <npm-script> <data-subdir>`.
# It resolves the repo root, builds @portqueue/core and @portqueue/dashboard on first run (when
# their dist is missing), points the example at a file-backed PGLite dir under the repo-root tmp/
# (gitignored, same convention as scripts/cli), and runs the workspace's npm script.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

# Build the runtime deps on first use (examples resolve @portqueue/* from their dist).
build_if_needed() {
  [ -f "$REPO_ROOT/packages/core/dist/index.mjs" ] ||
    npm --prefix "$REPO_ROOT" run build --workspace @portqueue/core
  [ -f "$REPO_ROOT/packages/dashboard/dist/index.mjs" ] ||
    npm --prefix "$REPO_ROOT" run build --workspace @portqueue/dashboard
}

# run_example <workspace-name> <npm-script> <tmp-subdir>
run_example() {
  local workspace="$1"
  local script="$2"
  local subdir="$3"
  build_if_needed
  export PORTQUEUE_DATA_DIR="$REPO_ROOT/tmp/$subdir"
  mkdir -p "$(dirname "$PORTQUEUE_DATA_DIR")"
  exec npm --prefix "$REPO_ROOT" run "$script" --workspace "$workspace"
}

# run_example_db <workspace-name> <npm-script>
# For examples that talk to a real database instead of file-backed PGLite. Passes DATABASE_URL
# through from the environment (the example falls back to a localhost default if it's unset).
run_example_db() {
  local workspace="$1"
  local script="$2"
  build_if_needed
  exec npm --prefix "$REPO_ROOT" run "$script" --workspace "$workspace"
}
