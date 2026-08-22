#!/usr/bin/env bash
# Run the matchup simulator inside the vendored engine.
#   ./scripts/simulate.sh --games 200 [--a DECK] [--b DECK] [--compare DECK] [--strategy NAME]
# Policy-quality ladder: give each DECK its own policy and read the win rate as a policy score.
#   ./scripts/simulate.sh --games 200 --a D --b D --strategy-a valueRanked --strategy-b random
# Counter-policy knobs (see docs/simulation.md, "Knobs"): --counter avg-cost=3 --counter enabled=0
# Task 10: a strict, fixed-seat environment job (mutually exclusive with every flag above):
#   ./scripts/simulate.sh --job path/to/job.json --out /private/tmp/out.raw.json
# Task 10: the vendored harness suite (batch-runner + environment-job adapter, end to end):
#   ./scripts/simulate.sh --harness-tests
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

# Task 10: per-flag tracking for mode exclusivity, checked AFTER the parse loop below (never
# during it) so that an individual option's OWN value is validated first regardless of what else
# was passed — e.g. `--job x --first banana` must report invalid_first_player, not an
# argument-combination failure, even though --job+--first is also, separately, forbidden.
opt_a=0; opt_b=0; opt_compare=0; opt_games=0; opt_seed=0; opt_first=0
opt_strategy=0; opt_strategy_a=0; opt_strategy_b=0; opt_turn_budget=0; opt_max_commands=0
opt_dump_catalog=0; opt_diag_prompts=0; opt_puzzles=0; opt_patch_ordercards=0
opt_job=0; opt_out=0; opt_harness=0; opt_counter=0
job_path=""

while [ $# -gt 0 ]; do case "$1" in
  --a) export SIM_DECK_A="$2"; opt_a=1; shift 2;;
  --b) export SIM_DECK_B="$2"; opt_b=1; shift 2;;
  --compare) export SIM_COMPARE="$2"; opt_compare=1; shift 2;;
  --games) export SIM_GAMES="$2"; opt_games=1; shift 2;;
  --seed) export SIM_SEED="$2"; opt_seed=1; shift 2;;
  --turn-budget) export SIM_TURN_BUDGET="$2"; opt_turn_budget=1; shift 2;;
  --max-commands) export SIM_MAX_COMMANDS="$2"; opt_max_commands=1; shift 2;;
  --strategy) export SIM_STRATEGY="$2"; opt_strategy=1; shift 2;;
  --strategy-a) export SIM_STRATEGY_A="$2"; opt_strategy_a=1; shift 2;;
  --strategy-b) export SIM_STRATEGY_B="$2"; opt_strategy_b=1; shift 2;;
  --first)
    # Value validated HERE, immediately, before any mode-exclusivity check below.
    case "$2" in
      play|draw|alternate) ;;
      *)
        echo "invalid_first_player: --first must be play, draw, or alternate (got: $2)" >&2
        exit 2
        ;;
    esac
    export SIM_FIRST="$2"; opt_first=1; shift 2;;
  --out) export SIM_OUT="$2"; opt_out=1; shift 2;;
  --job) job_path="$2"; opt_job=1; shift 2;;
  --dump-catalog) export SIM_DUMP_CATALOG=1; opt_dump_catalog=1; shift;;
  --diag-prompts) export SIM_DIAG_PROMPTS=1; opt_diag_prompts=1; shift;;
  --puzzles) export SIM_PUZZLES=1; opt_puzzles=1; shift;;
  # From main (#25): counter-policy knobs, e.g. --counter avg-cost=3 --counter enabled=0. NAME is
  # upper-cased and dashes become underscores, so it maps to OPCG_COUNTER_<NAME>; counter-policy.ts
  # holds the table of names it reads. Deliberately generic: a knob added there needs no change
  # here. opt_counter makes it participate in --job/--harness-tests mode exclusivity like every
  # other legacy override, and clear_ambient_legacy_vars() unsets the whole OPCG_COUNTER_* family.
  --counter)
    _k="${2%%=*}"; _v="${2#*=}"
    [ "$_k" != "$2" ] || { echo "--counter wants NAME=VALUE, got: $2" >&2; exit 2; }
    export "OPCG_COUNTER_$(printf '%s' "$_k" | tr 'a-z-' 'A-Z_')=$_v"
    opt_counter=1; shift 2;;
  --patch-ordercards) export SIM_PATCH_ORDERCARDS=1; opt_patch_ordercards=1; shift;;
  --harness-tests) opt_harness=1; shift;;
  *) echo "unknown option: $1" >&2; exit 2;;
esac; done

any_legacy_or_diagnostic_flag() {
  [ "$opt_a" = "1" ] || [ "$opt_b" = "1" ] || [ "$opt_compare" = "1" ] || [ "$opt_games" = "1" ] \
    || [ "$opt_seed" = "1" ] || [ "$opt_first" = "1" ] || [ "$opt_strategy" = "1" ] \
    || [ "$opt_strategy_a" = "1" ] || [ "$opt_strategy_b" = "1" ] || [ "$opt_turn_budget" = "1" ] \
    || [ "$opt_max_commands" = "1" ] || [ "$opt_dump_catalog" = "1" ] || [ "$opt_diag_prompts" = "1" ] \
    || [ "$opt_puzzles" = "1" ] || [ "$opt_patch_ordercards" = "1" ] \
    || [ "$opt_counter" = "1" ]
}

# Task 10: --job is mutually exclusive with every legacy override, turn/command budget flag,
# compare flag, and diagnostic/catalog/puzzle/patch/harness mode, and requires --out.
if [ "$opt_job" = "1" ]; then
  if [ "$opt_out" != "1" ]; then
    echo "argument_combination_invalid: --job requires --out" >&2
    exit 2
  fi
  if any_legacy_or_diagnostic_flag || [ "$opt_harness" = "1" ]; then
    echo "argument_combination_invalid: --job is mutually exclusive with every legacy override, turn/command budget flag, compare flag, and diagnostic/catalog/puzzle/patch/harness mode" >&2
    exit 2
  fi
fi

if [ "$opt_harness" = "1" ]; then
  if any_legacy_or_diagnostic_flag || [ "$opt_job" = "1" ] || [ "$opt_out" = "1" ]; then
    echo "argument_combination_invalid: --harness-tests is mutually exclusive with every other flag" >&2
    exit 2
  fi
fi

# M3 fix (fix round 1): shared by BOTH --job mode and --harness-tests mode, so a caller's dirty
# shell (e.g. an ambient SIM_STRATEGY=nonsense left over from an unrelated command) cannot leak
# into either — clearing it only for --job left --harness-tests exposed, and batch-runner.test.ts's
# runLegacyMatchupCli call reads SIM_STRATEGY before it ever reaches the --first check.
clear_ambient_legacy_vars() {
  unset SIM_DECK_A SIM_DECK_B SIM_COMPARE SIM_FIRST SIM_GAMES SIM_SEED \
    SIM_STRATEGY SIM_STRATEGY_A SIM_STRATEGY_B SIM_TURN_BUDGET SIM_MAX_COMMANDS \
    SIM_DUMP_CATALOG SIM_DIAG_PROMPTS SIM_PUZZLES SIM_PATCH_ORDERCARDS
  # Merge with main (#25): the counter-policy knobs are a SECOND ambient family. A job is meant to
  # be immutable, so an OPCG_COUNTER_* left in the caller's shell must not silently retune the bot
  # mid-job any more than an ambient SIM_STRATEGY may. Prefix expansion needs bash, which this is.
  for _cv in ${!OPCG_COUNTER_@}; do unset "$_cv"; done
}

if [ "$opt_job" = "1" ]; then
  # Before job mode: clear every ambient legacy/diagnostic SIM_* value — whether it came from the
  # CLI above (impossible here, per the exclusivity check just run) or from the CALLER's own shell
  # environment — then set ONLY SIM_ENV_JOB and SIM_OUT (the latter already exported by --out).
  clear_ambient_legacy_vars
  export SIM_ENV_JOB="$job_path"
fi

mkdir -p "$ENG/tests/cards" "$ENG/tests/environment"
cp "$ROOT/sim/matchup.sim.test.ts" "$ENG/tests/cards/matchup.sim.test.ts"
cp "$ROOT/sim/catalog.dump.test.ts" "$ENG/tests/cards/catalog.dump.test.ts"
cp "$ROOT/sim/prompt-diag.test.ts" "$ENG/tests/cards/prompt-diag.test.ts"
cp "$ROOT/sim/puzzles.test.ts" "$ENG/tests/cards/puzzles.test.ts"
# Task 10: matchup.sim.test.ts now imports runLegacyMatchupCli from batch-runner.ts, so this copy
# is unconditional (every mode), not only for --harness-tests/--job. environment-contract.mjs is
# batch-runner.ts's own dependency (classifyTermination, parseFirstPlayerValue), and it in turn
# depends on environment/canonical.mjs + environment/hash.mjs — the project's ONE canonical hash
# implementation — copied here at the matching relative layout (tests/environment/ sits next to
# tests/cards/, mirroring environment/ sitting next to sim/ at the repo root) so nothing here
# duplicates hashing logic.
cp "$ROOT/sim/batch-runner.ts" "$ENG/tests/cards/batch-runner.ts"
cp "$ROOT/sim/batch-runner.test.ts" "$ENG/tests/cards/batch-runner.test.ts"
cp "$ROOT/sim/environment-contract.mjs" "$ENG/tests/cards/environment-contract.mjs"
cp "$ROOT/sim/environment-job.sim.test.ts" "$ENG/tests/cards/environment-job.sim.test.ts"
cp "$ROOT/environment/canonical.mjs" "$ENG/tests/environment/canonical.mjs"
cp "$ROOT/environment/hash.mjs" "$ENG/tests/environment/hash.mjs"
cd "$ENG"
if [ "${SIM_PUZZLES:-}" = "1" ]; then
  exec ./node_modules/.bin/vp test run tests/cards/puzzles.test.ts --reporter=verbose
fi
if [ "${SIM_DIAG_PROMPTS:-}" = "1" ]; then
  exec ./node_modules/.bin/vp test run tests/cards/prompt-diag.test.ts --reporter=verbose
fi
if [ "${SIM_DUMP_CATALOG:-}" = "1" ]; then
  exec ./node_modules/.bin/vp test run tests/cards/catalog.dump.test.ts --reporter=verbose
fi
if [ "$opt_harness" = "1" ]; then
  # M3 fix (fix round 1): clear ambient legacy/diagnostic SIM_* here too, same as job mode, before
  # setting anything harness-specific.
  clear_ambient_legacy_vars
  # Genuinely exercises the full environment-job adapter end to end (not just its pieces), using
  # the project's own tiny fixed-seat smoke fixture, so environment-job.sim.test.ts's one test
  # cannot silently skip under its own designated harness mode.
  HARNESS_TMP_DIR="$(mktemp -d)"
  export SIM_ENV_JOB="$ROOT/tests/fixtures/environment/minimal-job-play.json"
  export SIM_OUT="$HARNESS_TMP_DIR/harness-env-job.raw.json"
  # I4 fix (fix round 1): gates batch-runner.test.ts's 12 real engine tests (see that file's own
  # header) so a bare `vp test run` in this same vendor tree, at any later time, sees them skip
  # rather than execute — the pinned "6078 tests, 0 failures" suite count must not silently change.
  export SIM_HARNESS_TESTS=1
  exec ./node_modules/.bin/vp test run tests/cards/batch-runner.test.ts tests/cards/environment-job.sim.test.ts --reporter=verbose
fi
if [ "$opt_job" = "1" ]; then
  exec ./node_modules/.bin/vp test run tests/cards/environment-job.sim.test.ts --reporter=verbose
fi
exec ./node_modules/.bin/vp test run tests/cards/matchup.sim.test.ts --reporter=verbose
