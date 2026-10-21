#!/usr/bin/env bash
# Start a local PostgreSQL 16 for development / manual driver testing.
#   host=localhost port=5432 user=portqueue password=portqueue db=portqueue
source "$(dirname "${BASH_SOURCE[0]}")/../../utils/compose.sh"
compose up -d postgresql
echo "PostgreSQL is starting on postgresql://portqueue:portqueue@localhost:5432/portqueue"
echo "Stop it with: scripts/dev/db/stop-postgresql.sh"
