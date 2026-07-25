#!/usr/bin/env bash
# Graceful shutdown example (PGLite, file-backed under tmp/).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
run_example @portqueue-examples/graceful-shutdown start portqueue-example-graceful
