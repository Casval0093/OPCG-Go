#!/usr/bin/env bash
# Bootstrap the OPCG-Go working environment.
set -euo pipefail
mkdir -p vendor
[ -d vendor/tcg-engines ] || git clone --depth 1 https://github.com/TheCardGoat/tcg-engines.git vendor/tcg-engines
cd vendor/tcg-engines/submodules/one-piece
corepack enable && corepack prepare pnpm@10.33.0 --activate
pnpm install --ignore-scripts
cd packages/engine && ./node_modules/.bin/vp test run   # expect 2631 pass in ~60s
echo "Bootstrap OK."
