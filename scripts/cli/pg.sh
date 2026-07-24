#!/usr/bin/env bash
# Run the local CLI against a Postgres database:
#
#   scripts/cli/pg.sh queues
#   scripts/cli/pg.sh add --queue emails --data '{"to":"a@b.com"}'
#   scripts/cli/pg.sh jobs --queue emails
#
# Override the connection string with PG_URL. Builds @portqueue/core and @portqueue/cli
# on first run.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

pq_exec postgres "${PG_URL:-postgres://postgres:postgres@localhost:5432/portqueue}" "$@"
