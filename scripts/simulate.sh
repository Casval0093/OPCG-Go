#!/usr/bin/env bash
# Run the matchup simulator inside the vendored engine.
#   ./scripts/simulate.sh --games 200 [--a DECK] [--b DECK] [--compare DECK] [--strategy NAME]
# Policy-quality ladder: give each DECK its own policy and read the win rate as a policy score.
#   ./scripts/simulate.sh --games 200 --a D --b D --strategy-a valueRanked --strategy-b random
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENG="$ROOT/vendor/tcg-engines/submodules/one-piece/packages/engine"
[ -d "$ENG" ] || { echo "vendored engine missing - run ./scripts/bootstrap.sh first" >&2; exit 1; }
# An unpatched engine does not fail loudly, it produces GARBAGE: the orderCards bug abandoned 88%
# of games on Block 2+ decks, and the search-to-hand bug aborted mirrors with illegal-command. Both
# fixes live in tools/patch_engine.py and vendor/ is gitignored, so any fresh clone starts
# unpatched. Gate here rather than discovering it in the results. Stdlib-only, same as bootstrap.
PY_BIN="$ROOT/.venv/bin/python"; [ -x "$PY_BIN" ] || PY_BIN="$(command -v python3)"
if ! "$PY_BIN" "$ROOT/tools/patch_engine.py" --check --engine "$ENG"; then
  echo "refusing to simulate against an unpatched engine - run ./scripts/bootstrap.sh" >&2
  exit 1
fi
export SIM_ROOT="$ROOT" SIM_RUN=1
while [ $# -gt 0 ]; do case "$1" in
  --a) export SIM_DECK_A="$2"; shift 2;;
  --b) export SIM_DECK_B="$2"; shift 2;;
  --compare) export SIM_COMPARE="$2"; shift 2;;
  --games) export SIM_GAMES="$2"; shift 2;;
  --seed) export SIM_SEED="$2"; shift 2;;
  --turn-budget) export SIM_TURN_BUDGET="$2"; shift 2;;
  --strategy) export SIM_STRATEGY="$2"; shift 2;;
  --strategy-a) export SIM_STRATEGY_A="$2"; shift 2;;
  --strategy-b) export SIM_STRATEGY_B="$2"; shift 2;;
  --first) export SIM_FIRST="$2"; shift 2;;
  --out) export SIM_OUT="$2"; shift 2;;
  --dump-catalog) export SIM_DUMP_CATALOG=1; shift;;
  --diag-prompts) export SIM_DIAG_PROMPTS=1; shift;;
  --patch-ordercards) export SIM_PATCH_ORDERCARDS=1; shift;;
  *) echo "unknown option: $1" >&2; exit 2;;
esac; done
mkdir -p "$ENG/tests/cards"
cp "$ROOT/sim/matchup.sim.test.ts" "$ENG/tests/cards/matchup.sim.test.ts"
cp "$ROOT/sim/catalog.dump.test.ts" "$ENG/tests/cards/catalog.dump.test.ts"
cp "$ROOT/sim/prompt-diag.test.ts" "$ENG/tests/cards/prompt-diag.test.ts"
cd "$ENG"
if [ "${SIM_DIAG_PROMPTS:-}" = "1" ]; then
  exec ./node_modules/.bin/vp test run tests/cards/prompt-diag.test.ts --reporter=verbose
fi
if [ "${SIM_DUMP_CATALOG:-}" = "1" ]; then
  exec ./node_modules/.bin/vp test run tests/cards/catalog.dump.test.ts --reporter=verbose
fi
exec ./node_modules/.bin/vp test run tests/cards/matchup.sim.test.ts --reporter=verbose
