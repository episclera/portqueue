# Shared helpers for the benchmark launcher scripts (sourced, not executed).
#
# Each benchmark script sources this file, then calls `run_benchmark <workspace> [scenario…]`.
# It builds @portqueue/core from the working tree — a benchmark measures the code in this repo, never
# a published release or a stale dist/ — runs the workspace's `bench` script, then rebuilds the
# cross-comparison summary (repo README + docs homepage chart).

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# run_benchmark <workspace-name> [scenario…]
# Set PORTQUEUE_SKIP_BUILD=1 to skip the build when no package source has changed.
run_benchmark() {
  local workspace="$1"
  shift
  if [ "${PORTQUEUE_SKIP_BUILD:-0}" = "1" ]; then
    echo "Skipping the @portqueue/core build (PORTQUEUE_SKIP_BUILD=1)."
  else
    echo "Building @portqueue/core…"
    npm --prefix "$REPO_ROOT" run build --workspace @portqueue/core
  fi
  npm --prefix "$REPO_ROOT" run bench --workspace "$workspace" -- "$@"
  node "$REPO_ROOT/scripts/benchmarks/update-summary.mjs"
}
