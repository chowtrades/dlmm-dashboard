#!/usr/bin/env bash
# Rebuilds dist/app.js (only needed if you change src/). The site itself needs no build step.
set -e
cd "$(dirname "$0")"
npx esbuild src/main.js --bundle --minify --format=iife --platform=browser --target=es2020 \
  --inject:src/shim.js --define:global=globalThis --define:process.env.NODE_ENV='"production"' \
  --main-fields=browser,module,main --outfile=dist/app.js --legal-comments=none
