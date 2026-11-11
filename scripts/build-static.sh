#!/usr/bin/env bash
# Assemble a static, single-player-only build of The Long Street.
# Mirrors the layout server.js serves, so the same relative paths work
# both under `npm start` and on a static host (GitHub Pages, Vercel).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist"

rm -rf "$OUT"
mkdir -p "$OUT/vendor/three/build" "$OUT/vendor/three/examples"

cp -r "$ROOT/public/." "$OUT/"
cp -r "$ROOT/shared"   "$OUT/shared"
cp "$ROOT/node_modules/three/build/three.module.js" "$OUT/vendor/three/build/"
cp -r "$ROOT/node_modules/three/examples/jsm" "$OUT/vendor/three/examples/jsm"

# Stop GitHub Pages running the output through Jekyll.
touch "$OUT/.nojekyll"

echo "Built static bundle -> $OUT"
