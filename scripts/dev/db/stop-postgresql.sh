#!/usr/bin/env bash
# Stop the local PostgreSQL container (data volume is preserved).
source "$(dirname "${BASH_SOURCE[0]}")/../../utils/compose.sh"
compose stop postgresql
