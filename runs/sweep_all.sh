#!/usr/bin/env bash
# Full mutation sweep over the vendored (pre-OP15) encodings, 8 workers x private engine clone.
# Uses tools/mutation_sweep.py, whose verdicts were verified identical to the serial
# tools/mutation_check.py on 40 cards / 134 mutants (see docs/mutation-sweep.md).
# Interrupt-safe: SIGTERM restores every encoding; --resume picks up from the jsonl.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
run() {
  local w="$1"; shift
  local engine="$ROOT/.clones/w$w/submodules/one-piece/packages/engine"
  for s in "$@"; do
    python3 "$ROOT/tools/mutation_sweep.py" --vendor-set "$s" \
      --engine "$engine" --repo "$ROOT" --jsonl "$ROOT/runs/$s.jsonl" --resume
  done
}
run 0 OP14EB04 EB02   > "$ROOT/runs/w0.out" 2>&1 &
run 1 OP10 EB03       > "$ROOT/runs/w1.out" 2>&1 &
run 2 OP05 OP01       > "$ROOT/runs/w2.out" 2>&1 &
run 3 OP06 OP13       > "$ROOT/runs/w3.out" 2>&1 &
run 4 OP08 OP03 EB01  > "$ROOT/runs/w4.out" 2>&1 &
run 5 OP07 OP04 PRB01 > "$ROOT/runs/w5.out" 2>&1 &
run 6 OP11 OP02       > "$ROOT/runs/w6.out" 2>&1 &
run 7 OP12 OP09 PRB02 > "$ROOT/runs/w7.out" 2>&1 &
wait
echo "sweep complete"
