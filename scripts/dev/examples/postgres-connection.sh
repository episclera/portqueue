#!/usr/bin/env bash
# Real Postgres connection example. Set DATABASE_URL to point at your database.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
run_example_db @portqueue-examples/postgres-connection start
