#!/usr/bin/env bash
# Bootstrap the OPCG-Go working environment.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/vendor"
[ -d "$ROOT/vendor/tcg-engines" ] || git clone --depth 1 https://github.com/TheCardGoat/tcg-engines.git "$ROOT/vendor/tcg-engines"
cd "$ROOT/vendor/tcg-engines/submodules/one-piece"
corepack enable && corepack prepare pnpm@10.33.0 --activate
pnpm install --ignore-scripts
# Both of these are stdlib-only on purpose, so bootstrap works on a clean clone before anyone has
# made a venv. Prefer the venv when it exists so a contributor's pinned interpreter wins.
PY="$ROOT/.venv/bin/python"
[ -x "$PY" ] || PY="$(command -v python3)"
[ -n "$PY" ] || { echo "no python3 found; install Python 3 and re-run" >&2; exit 1; }

"$PY" "$ROOT/tools/graft_cards.py"    # copy cards/OP15|OP16 into the vendored engine
"$PY" "$ROOT/tools/patch_engine.py"   # local engine fixes; vendor/ is gitignored so they re-apply
"$PY" "$ROOT/tools/correct_cards.py"  # verified card-data corrections, same reason: vendor/ is disposable
cd packages/engine && ./node_modules/.bin/vp test run   # expect 6079 pass in ~90s
echo "Bootstrap OK."
