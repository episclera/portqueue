#!/usr/bin/env bash
# One-shot repo setup: select the pinned Node version (.nvmrc) and install all workspaces.
# This is all you need to get the repo ready for development.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# Select the Node version pinned in .nvmrc via nvm, if it's available.
if [ -z "${NVM_DIR:-}" ] && [ -d "$HOME/.nvm" ]; then
  export NVM_DIR="$HOME/.nvm"
fi
if [ -s "${NVM_DIR:-}/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm install # installs the .nvmrc version if it isn't present yet
  nvm use
else
  echo "nvm not found — using the current Node ($(node -v))."
  echo "Make sure it matches .nvmrc ($(cat .nvmrc))."
fi

echo "Installing all workspaces…"
npm install

echo "Done — the repo is set up. Try: npm run build && npm test"
