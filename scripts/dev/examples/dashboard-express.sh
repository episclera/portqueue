#!/usr/bin/env bash
# Mount the dashboard as Express middleware (PGLite, file-backed under tmp/).
#   Then open http://127.0.0.1:4322/portqueue
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
run_example @portqueue-examples/dashboard-express start portqueue-example-dashboard-express
