#!/usr/bin/env bash
# Full mutation sweep over the card encodings, 8 workers x private engine clone.
# Uses tools/mutation_sweep.py, whose verdicts were verified identical to the serial
# tools/mutation_check.py on 40 cards / 134 mutants (see docs/mutation-sweep.md).
# Interrupt-safe: SIGTERM restores every encoding; --resume picks up from the jsonl.
#
# Failure handling is explicit because the obvious version is silently wrong: a bare `wait` with no
# job id waits for every child and ALWAYS returns 0, so a worker that died would still print
# "sweep complete" and exit 0 over a partial corpus — a false green in the very harness whose job is
# to find false greens. Each PID is waited on individually and its status is reported.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

run() {
  local w="$1"; shift
  local engine="$ROOT/.clones/w$w/submodules/one-piece/packages/engine"
  local rc=0
  for s in "$@"; do
    # Do not stop at the first bad set: the remaining ones are independent, and a partial corpus
    # you know the shape of beats one that stopped at an arbitrary point. The worst status wins.
    python3 "$ROOT/tools/mutation_sweep.py" --vendor-set "$s" \
      --engine "$engine" --repo "$ROOT" --jsonl "$ROOT/runs/$s.jsonl" --resume || rc=$?
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
launch 5 OP07 OP04 PRB01 OP15
launch 6 OP11 OP02
launch 7 OP12 OP09 PRB02 OP16

failed=0
for i in "${!PIDS[@]}"; do
  if wait "${PIDS[$i]}"; then
    echo "ok      ${LABELS[$i]}"
  else
    status=$?
    failed=$((failed + 1))
    # 130 is mutation_sweep's own "paused on SIGTERM, encodings restored" exit.
    if [ "$status" -eq 130 ]; then
      echo "PAUSED  ${LABELS[$i]} — re-run to resume"
    else
      echo "FAILED  ${LABELS[$i]} (exit $status) — see runs/w${LABELS[$i]%%:*}.out" >&2
    fi
  fi
done

if [ "$failed" -ne 0 ]; then
  echo "sweep INCOMPLETE: $failed of ${#PIDS[@]} worker(s) did not finish cleanly." >&2
  echo "runs/*.jsonl holds whatever they did record; ./runs/status.sh shows the gap." >&2
  exit 1
fi
echo "sweep complete"
