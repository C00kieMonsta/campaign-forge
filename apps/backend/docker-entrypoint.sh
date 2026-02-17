#!/bin/sh
# Docker entrypoint script for backend
# Handles both webpack bundle (dist/main.js) and tsc output (dist/src/main.js)
# Uses tsconfig-paths to resolve @packages/* aliases at runtime
# Must run from apps/backend directory so tsconfig-paths can resolve paths correctly

cd /usr/src/app/apps/backend

# Set TS_NODE_PROJECT to use runtime tsconfig that points to dist/ paths
export TS_NODE_PROJECT=tsconfig.runtime.json

if [ -f "dist/main.js" ]; then
  echo "Starting from webpack bundle: dist/main.js"
  exec node -r tsconfig-paths/register dist/main.js
elif [ -f "dist/src/main.js" ]; then
  echo "Starting from tsc output: dist/src/main.js"
  exec node -r tsconfig-paths/register dist/src/main.js
else
  echo "ERROR: main.js not found in dist/ or dist/src/"
  find dist -name "main.js" || echo "No main.js found"
  exit 1
fi

