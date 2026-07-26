#!/usr/bin/env bash
# Run the local CLI against a SQLite database (file-backed so state persists between runs):
#
#   scripts/cli/sqlite.sh queues
#   scripts/cli/sqlite.sh add --queue emails --data '{"to":"a@b.com"}'
#   scripts/cli/sqlite.sh jobs --queue emails
#
# The connection string is the SQLite file path. Defaults to tmp/portqueue-cli.sqlite in
# the repo root (gitignored). Override it with SQLITE_PATH, or set SQLITE_PATH=:memory: for
# a throwaway in-memory database. Rebuilds @portqueue/core and
# @portqueue/cli each run (PORTQUEUE_SKIP_BUILD=1 skips it).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

SQLITE_DB_PATH="${SQLITE_PATH:-$REPO_ROOT/tmp/portqueue-cli.sqlite}"
[ "$SQLITE_DB_PATH" != ":memory:" ] && mkdir -p "$(dirname "$SQLITE_DB_PATH")"
pq_exec sqlite "$SQLITE_DB_PATH" "$@"
