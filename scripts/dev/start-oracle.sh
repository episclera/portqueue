#!/usr/bin/env bash
# Start a local Oracle (gvenzl/oracle-free) for development / manual driver testing.
#   host=localhost port=1521 service=FREEPDB1 user=portqueue password=portqueue
# First boot downloads the image and initializes the DB — this can take a few minutes.
source "$(dirname "${BASH_SOURCE[0]}")/../utils/compose.sh"
compose up -d oracle
echo "Oracle is starting on localhost:1521 (service FREEPDB1, user portqueue/portqueue)."
echo "First boot initializes the database and may take several minutes — watch with:"
echo "  docker logs -f portqueue-oracle"
echo "Stop it with: scripts/dev/stop-oracle.sh"
