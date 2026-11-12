#!/usr/bin/env bash
# One command to get the latest code from GitHub and run the game locally.
#   ./play.sh          update, then run            (http://localhost:3000)
#   ./play.sh dev      same, restarting the server whenever you edit server code
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js 18+ is required: https://nodejs.org"; exit 1; }
echo "Updating from GitHub..."
git pull --ff-only || echo "(could not update: continuing with the code you have)"
npm install --no-audit --no-fund
if [ "$1" = "dev" ]; then npm run dev; else npm start; fi
