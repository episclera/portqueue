#!/usr/bin/env bash
# Serve the dashboard from a plain node:http server (PGLite, file-backed under tmp/).
# Rebuilds @portqueue/core + @portqueue/dashboard first, so the served UI matches the working tree.
#   Then open http://127.0.0.1:4321/portqueue
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
run_dashboard_example @portqueue-examples/dashboard-node-server start portqueue-example-dashboard-node
