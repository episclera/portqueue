#!/usr/bin/env bash
# Run the local CLI against a PGLite database (file-backed dataDir so state persists between runs):
#
#   scripts/cli/pglite.sh queues
#   scripts/cli/pglite.sh add --queue emails --data '{"to":"a@b.com"}'
#   scripts/cli/pglite.sh jobs --queue emails
#
# The connection string is the PGLite dataDir. Defaults to tmp/portqueue-cli-pglite in
# the repo root (gitignored). Override it with PGLITE_DIR. Builds @portqueue/core and
# @portqueue/cli on first run.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

PGLITE_DATA_DIR="${PGLITE_DIR:-$REPO_ROOT/tmp/portqueue-cli-pglite}"
mkdir -p "$(dirname "$PGLITE_DATA_DIR")"
pq_exec pglite "$PGLITE_DATA_DIR" "$@"
