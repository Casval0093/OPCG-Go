#!/usr/bin/env bash
# Run the matchup simulator inside the vendored engine.
#   ./scripts/simulate.sh --games 200 [--a DECK] [--b DECK] [--compare DECK] [--strategy NAME]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENG="$ROOT/vendor/tcg-engines/submodules/one-piece/packages/engine"
[ -d "$ENG" ] || { echo "vendored engine missing - run ./scripts/bootstrap.sh first" >&2; exit 1; }
export SIM_ROOT="$ROOT" SIM_RUN=1
while [ $# -gt 0 ]; do case "$1" in
  --a) export SIM_DECK_A="$2"; shift 2;;
  --b) export SIM_DECK_B="$2"; shift 2;;
  --compare) export SIM_COMPARE="$2"; shift 2;;
  --games) export SIM_GAMES="$2"; shift 2;;
  --seed) export SIM_SEED="$2"; shift 2;;
  --turn-budget) export SIM_TURN_BUDGET="$2"; shift 2;;
  --strategy) export SIM_STRATEGY="$2"; shift 2;;
  --first) export SIM_FIRST="$2"; shift 2;;
  --out) export SIM_OUT="$2"; shift 2;;
  *) echo "unknown option: $1" >&2; exit 2;;
esac; done
mkdir -p "$ENG/tests/cards"
cp "$ROOT/sim/matchup.sim.test.ts" "$ENG/tests/cards/matchup.sim.test.ts"
cd "$ENG"
exec ./node_modules/.bin/vp test run tests/cards/matchup.sim.test.ts --reporter=verbose
