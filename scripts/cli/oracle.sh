#!/usr/bin/env bash
# Run the local CLI against an Oracle database:
#
#   scripts/cli/oracle.sh queues
#   scripts/cli/oracle.sh add --queue emails --data '{"to":"a@b.com"}'
#   scripts/cli/oracle.sh jobs --queue emails
#
# Override the connect string with ORACLE_URL. Rebuilds @portqueue/core and @portqueue/cli each run
# (PORTQUEUE_SKIP_BUILD=1 skips it).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

pq_exec oracle "${ORACLE_URL:-oracle://system:oracle@localhost:1521/XEPDB1}" "$@"
