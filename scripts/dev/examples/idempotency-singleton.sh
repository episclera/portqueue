#!/usr/bin/env bash
# Idempotency & singleton dedup example (PGLite, file-backed under tmp/).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
run_example @portqueue-examples/idempotency-singleton start portqueue-example-idempotency
