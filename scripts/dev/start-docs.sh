#!/usr/bin/env bash
# Start the Docusaurus docs site locally with hot reload.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
echo "Starting docs at http://localhost:3000 …"
npm --prefix "$REPO_ROOT" run start --workspace docs
