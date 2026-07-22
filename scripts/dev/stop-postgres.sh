#!/usr/bin/env bash
# Stop the local Postgres container (data volume is preserved).
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"
compose stop postgres
