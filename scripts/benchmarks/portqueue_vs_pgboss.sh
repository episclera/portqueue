#!/usr/bin/env bash
# PortQueue vs pg-boss benchmark (both on in-memory PGLite). Pass scenario names to run a subset:
#   ./scripts/benchmarks/portqueue_vs_pgboss.sh process latency
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
run_benchmark @portqueue-benchmarks/portqueue-vs-pgboss "$@"
