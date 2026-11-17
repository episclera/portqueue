#!/usr/bin/env bash
# Retries & backoff example (PGLite, file-backed under tmp/).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
run_example @portqueue-examples/retries-backoff start portqueue-example-retries
