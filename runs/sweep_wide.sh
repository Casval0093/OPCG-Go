#!/usr/bin/env bash
# Widened-instrument mutation sweep: pre-OP15 sets ONLY, 8 workers x private engine clone.
#
# Same mechanics as runs/sweep_all.sh (per-PID waits, 130 = paused), minus OP15/OP16:
# runs/OP15.jsonl and runs/OP16.jsonl are contended by other work and are NOT re-run here.
# The old five-operator results live in runs/v2/; the 62.3 % baseline in docs/mutation-sweep.md
# refers to them. This sweep writes runs/<SET>.jsonl fresh with the widened operator set
# (tools/mutation_check.py operators 6-11, adopted from docs/mutation-operators.md ranks 1-6).
#
# Bounded mode: `SWEEP_BUDGET=270 ./runs/sweep_wide.sh` stops the workers cleanly after N
# seconds (SIGTERM; mutation_sweep.py restores every encoding and exits 130). Re-run with the
# same command to resume — every set runs with --resume.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

run() {
  local w="$1"; shift
  local engine="$ROOT/.clones/w$w/submodules/one-piece/packages/engine"
  local rc=0
  for s in "$@"; do
    # Do not stop at the first bad set: the remaining ones are independent. The worst status wins.
    # --cap 16, not the default 120: records are written per COMPLETED batch, and a 120-card
    # batch costs (1 + max-mutants) full-union vitest runs — over 10 min on this host, longer
    # than the budget stop, so no batch ever finished and every round restarted it. At 16 a
    # batch is ~100 s and several complete per round. Disjointness (the correctness property)
    # is cap-independent.
    python3 "$ROOT/tools/mutation_sweep.py" --vendor-set "$s" --cap 16 \
      --engine "$engine" --repo "$ROOT" --jsonl "$ROOT/runs/$s.jsonl" --resume || rc=$?
    # 130 means paused by design; stop this worker's remaining sets so a budget stop is prompt.
    if [ "$rc" -eq 130 ]; then return 130; fi
  done
  return $rc
}

declare -a PIDS=() LABELS=()
launch() { local w="$1"; shift; run "$w" "$@" > "$ROOT/runs/w$w.out" 2>&1 & PIDS+=("$!"); LABELS+=("w$w: $*"); }

launch 0 OP14EB04 EB02
launch 1 OP10 EB03
launch 2 OP05 OP01
launch 3 OP06 OP13
launch 4 OP08 OP03 EB01
launch 5 OP07 OP04 PRB01
launch 6 OP11 OP02
launch 7 OP12 OP09 PRB02

if [ "${SWEEP_BUDGET:-0}" -gt 0 ]; then
  # Stop all sweep processes after the budget so an external timeout never SIGKILLs a mutant
  # into place. TERM is trapped by the tool: encodings restored, records flushed, exit 130.
  ( sleep "$SWEEP_BUDGET"; pkill -TERM -f "mutation_sweep.py" 2>/dev/null || true ) &
  TIMER=$!
fi

failed=0
for i in "${!PIDS[@]}"; do
  if wait "${PIDS[$i]}"; then
    echo "ok      ${LABELS[$i]}"
  else
    status=$?
    failed=$((failed + 1))
    if [ "$status" -eq 130 ]; then
      echo "PAUSED  ${LABELS[$i]} — re-run to resume"
    else
      echo "FAILED  ${LABELS[$i]} (exit $status) — see runs/w${LABELS[$i]%%:*}.out" >&2
    fi
  fi
done

if [ "${SWEEP_BUDGET:-0}" -gt 0 ]; then
  kill "$TIMER" 2>/dev/null || true
  wait "$TIMER" 2>/dev/null || true
fi

if [ "$failed" -ne 0 ]; then
  # An all-PAUSED run is a clean budget stop, not a failure.
  echo "sweep INCOMPLETE this round: $failed of ${#PIDS[@]} worker(s) stopped (pause or failure)." >&2
  exit 1
fi
echo "sweep complete"
