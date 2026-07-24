#!/usr/bin/env bash
# Delayed (one-off) jobs example (PGLite, file-backed under tmp/).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
run_example @portqueue-examples/job-scheduling delayed portqueue-example-scheduling
