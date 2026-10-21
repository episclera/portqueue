#!/usr/bin/env bash
# Transactional enqueue example (PostgreSQL). Set DATABASE_URL to point at your database.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
run_example_db @portqueue-examples/transactional-enqueue start
