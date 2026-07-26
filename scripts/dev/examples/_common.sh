# Shared helpers for the example launcher scripts (sourced, not executed).
#
# Each example script sources this file, then calls `run_example <workspace> <npm-script> <data-subdir>`
# — or `run_dashboard_example` with the same arguments for the ones that serve the dashboard.
# It resolves the repo root, builds @portqueue/core and @portqueue/dashboard, points the example at
# a file-backed PGLite dir under the repo-root tmp/ (gitignored, same convention as scripts/cli),
# and runs the workspace's npm script.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

# Rebuild the runtime deps unconditionally. These are development launchers: a present `dist/` says
# nothing about whether it matches the working tree, so "build only when missing" reliably runs an
# example against stale code after any source edit. Set PORTQUEUE_SKIP_BUILD=1 to skip the build
# (e.g. restarting an example without having touched any package source).
build_always() {
  if [ "${PORTQUEUE_SKIP_BUILD:-0}" = "1" ]; then
    echo "Skipping the @portqueue/core + @portqueue/dashboard build (PORTQUEUE_SKIP_BUILD=1)."
    return
  fi
  echo "Building @portqueue/core and @portqueue/dashboard…"
  npm --prefix "$REPO_ROOT" run build --workspace @portqueue/core
  npm --prefix "$REPO_ROOT" run build --workspace @portqueue/dashboard
}

# _exec_pglite_example <workspace-name> <npm-script> <tmp-subdir>
_exec_pglite_example() {
  local workspace="$1"
  local script="$2"
  local subdir="$3"
  export PORTQUEUE_DATA_DIR="$REPO_ROOT/tmp/$subdir"
  mkdir -p "$(dirname "$PORTQUEUE_DATA_DIR")"
  exec npm --prefix "$REPO_ROOT" run "$script" --workspace "$workspace"
}

# run_example <workspace-name> <npm-script> <tmp-subdir>
run_example() {
  build_always
  _exec_pglite_example "$@"
}

# run_dashboard_example <workspace-name> <npm-script> <tmp-subdir>
# For the examples that serve the dashboard — the build also refreshes the client assets, so the UI
# you open is the one in your working tree.
run_dashboard_example() {
  build_always
  _exec_pglite_example "$@"
}

# run_example_db <workspace-name> <npm-script>
# For examples that talk to a real database instead of file-backed PGLite. Passes DATABASE_URL
# through from the environment (the example falls back to a localhost default if it's unset).
run_example_db() {
  local workspace="$1"
  local script="$2"
  build_always
  exec npm --prefix "$REPO_ROOT" run "$script" --workspace "$workspace"
}
