#!/usr/bin/env bash
# Recurring jobs example — interval + cron (PGLite, file-backed under tmp/). Ctrl+C to stop.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
run_example @portqueue-examples/job-scheduling recurring portqueue-example-scheduling
