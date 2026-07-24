#!/usr/bin/env bash
# Run the local CLI against a SQLite database (file-backed so state persists between runs):
#
#   scripts/cli/sqlite.sh queues
#   scripts/cli/sqlite.sh add --queue emails --data '{"to":"a@b.com"}'
#   scripts/cli/sqlite.sh jobs --queue emails
#
# The connection string is the SQLite file path. Override it with SQLITE_PATH, or set
# SQLITE_PATH=:memory: for a throwaway in-memory database. Builds @portqueue/core and
# @portqueue/cli on first run.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

pq_exec sqlite "${SQLITE_PATH:-/tmp/portqueue-cli.sqlite}" "$@"
