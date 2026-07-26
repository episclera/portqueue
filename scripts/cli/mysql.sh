#!/usr/bin/env bash
# Run the local CLI against a MySQL database:
#
#   scripts/cli/mysql.sh queues
#   scripts/cli/mysql.sh add --queue emails --data '{"to":"a@b.com"}'
#   scripts/cli/mysql.sh jobs --queue emails
#
# Override the connection string with MYSQL_URL. Rebuilds @portqueue/core and @portqueue/cli each run
# (PORTQUEUE_SKIP_BUILD=1 skips it).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

pq_exec mysql "${MYSQL_URL:-mysql://root:root@localhost:3306/portqueue}" "$@"
