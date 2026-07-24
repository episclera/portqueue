#!/usr/bin/env bash
# Run the local CLI against a MySQL database:
#
#   scripts/cli/mysql.sh queues
#   scripts/cli/mysql.sh add --queue emails --data '{"to":"a@b.com"}'
#   scripts/cli/mysql.sh jobs --queue emails
#
# Override the connection string with MYSQL_URL. Builds @portqueue/core and @portqueue/cli
# on first run.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

pq_exec mysql "${MYSQL_URL:-mysql://root:root@localhost:3306/portqueue}" "$@"
