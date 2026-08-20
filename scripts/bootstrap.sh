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

# Run from $ROOT, not from the engine directory. patch_engine.py and correct_cards.py default to
# a REPO-RELATIVE engine path, so invoking them from inside the engine makes them miss it: they
# print "engine not found ... run ./scripts/bootstrap.sh" and exit, which is what silently skipped
# both steps and left the tree un-patched and un-corrected while bootstrap still reported success.
(cd "$ROOT" \
  && "$PY" tools/graft_cards.py \
  && "$PY" tools/patch_engine.py \
  && "$PY" tools/correct_cards.py)
# Expect 6110 pass / 0 fail / 10 skipped in ~90s (2026-08-20: Phase 1 + Phase 2 + setBasePower,
# the last of which added 32 tests across the 6 unparked OP15/OP16 cards). The 4 skipped FILES are
# this repo's env-gated harnesses (puzzles, matchup.sim, catalog.dump, prompt-diag), not failures.
# This line used to say 6079, which was one too many, and the reason recurs: bench/throughput.test.ts
# is NOT part of the suite, and a tree with it copied into tests/cards/ reports exactly one extra
# test. Bootstrap does not copy it. Measured here instead of inferred: OP15+OP16 went 738 -> 770 and
# the total 6078 -> 6110, which reconciles exactly.
cd packages/engine && ./node_modules/.bin/vp test run
echo "Bootstrap OK."
