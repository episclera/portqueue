#!/usr/bin/env bash
# Stop the local Postgres container (data volume is preserved).
source "$(dirname "${BASH_SOURCE[0]}")/../../utils/compose.sh"
compose stop postgres
