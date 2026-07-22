#!/usr/bin/env bash
# Run the local CLI against a throwaway PGLite database, so you can try commands end-to-end:
#
#   scripts/cli/run.sh queues
#   scripts/cli/run.sh add --queue emails --data '{"to":"a@b.com"}'
#   scripts/cli/run.sh jobs --queue emails
#
# Builds @portqueue/core and @portqueue/cli on first run. Pass --config <path> to point at
# your own config instead of the bundled PGLite one.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="$REPO_ROOT/packages/cli/dist/cli.mjs"
DEFAULT_CONFIG="$REPO_ROOT/scripts/cli/portqueue.config.mjs"

# Build dependencies on first use (the CLI resolves @portqueue/core from its dist).
[ -f "$REPO_ROOT/packages/core/dist/index.mjs" ] || npm --prefix "$REPO_ROOT" run build --workspace @portqueue/core
[ -f "$CLI" ] || npm --prefix "$REPO_ROOT" run build --workspace @portqueue/cli

# Use the bundled dev config unless the caller passed their own --config.
args=("$@")
case " $* " in
  *" --config "* | *" --config="*) ;;
  *) args+=(--config "$DEFAULT_CONFIG") ;;
esac

exec node "$CLI" "${args[@]}"
