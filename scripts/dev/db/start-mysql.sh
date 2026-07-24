#!/usr/bin/env bash
# Start a local MySQL 8 for development / manual driver testing.
#   host=localhost port=3306 user=portqueue password=portqueue db=portqueue
source "$(dirname "${BASH_SOURCE[0]}")/../../utils/compose.sh"
compose up -d mysql
echo "MySQL is starting on mysql://portqueue:portqueue@localhost:3306/portqueue"
echo "Stop it with: scripts/dev/db/stop-mysql.sh"
