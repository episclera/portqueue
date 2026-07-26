# Shared helpers for the per-database CLI dev scripts (sourced, not executed).
#
# Each engine script sources this file, then calls `pq_exec <engine> <connection-string>`.
# It resolves the repo root, builds @portqueue/core and @portqueue/cli, and finally execs the CLI
# with the engine's flags so the caller's own flags/args are appended after them.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="$REPO_ROOT/packages/cli/dist/cli.mjs"

# Rebuild the CLI and its runtime dep unconditionally. This is a development launcher: a present
# `dist/` says nothing about whether it matches the working tree, so "build only when missing"
# reliably runs the CLI from stale code after any source edit. Set PORTQUEUE_SKIP_BUILD=1 to skip
# the build (e.g. re-running a command without having touched any package source).
pq_build() {
  if [ "${PORTQUEUE_SKIP_BUILD:-0}" = "1" ]; then
    echo "Skipping the @portqueue/core + @portqueue/cli build (PORTQUEUE_SKIP_BUILD=1)." >&2
    return
  fi
  echo "Building @portqueue/core and @portqueue/cli…" >&2
  # Build chatter goes to stderr so `portqueue … --json | jq` still sees only the CLI's own output.
  npm --prefix "$REPO_ROOT" run build --workspace @portqueue/core >&2
  npm --prefix "$REPO_ROOT" run build --workspace @portqueue/cli >&2
}

# pq_exec <engine> <connection-string> [caller args...]
pq_exec() {
  local engine="$1"
  local connection_string="$2"
  shift 2
  pq_build
  exec node "$CLI" --driver "$engine" --connection-string "$connection_string" "$@"
}
