#!/usr/bin/env bash
# Run the local CLI against a PostgreSQL database:
#
#   scripts/cli/postgresql.sh queues
#   scripts/cli/postgresql.sh add --queue emails --data '{"to":"a@b.com"}'
#   scripts/cli/postgresql.sh jobs --queue emails
#
# Override the connection string with PG_URL. Rebuilds @portqueue/core and @portqueue/cli each run
# (PORTQUEUE_SKIP_BUILD=1 skips it).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

pq_exec postgresql "${PG_URL:-postgres://postgres:postgres@localhost:5432/portqueue}" "$@"
