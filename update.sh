#!/usr/bin/env bash
set -euo pipefail

BRANCH="${1:-main}"

echo "Pulling latest from origin/$BRANCH..."
git fetch origin
git pull origin "$BRANCH"

# If a package.json exists, reinstall deps
if [ -f package.json ]; then
  if command -v bun &>/dev/null; then
    bun install
  elif command -v npm &>/dev/null; then
    npm install
  fi
fi

echo "Up to date."
