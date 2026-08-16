#!/usr/bin/env bash
# Bootstrap the OPCG-Go working environment.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/vendor"
[ -d "$ROOT/vendor/tcg-engines" ] || git clone --depth 1 https://github.com/TheCardGoat/tcg-engines.git "$ROOT/vendor/tcg-engines"
cd "$ROOT/vendor/tcg-engines/submodules/one-piece"
corepack enable && corepack prepare pnpm@10.33.0 --activate
pnpm install --ignore-scripts
"$ROOT/.venv/bin/python" "$ROOT/tools/graft_cards.py"   # copy cards/OP15|OP16 into the vendored engine
"$ROOT/.venv/bin/python" "$ROOT/tools/patch_engine.py"
cd packages/engine && ./node_modules/.bin/vp test run   # expect 2631 pass in ~60s
echo "Bootstrap OK."
