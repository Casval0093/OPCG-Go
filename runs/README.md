# Mutation sweep results

`<SET>.jsonl` — one record per card: `{card, status, killed, mutants, survivors}`.
`all-results.json` — the same, merged and keyed by card id, with a `set` field added. Built by
`./runs/merge_results.py`, which **refuses to write a mixed-instrument aggregate**: if any set's
recorded mutant total disagrees with what the current `tools/mutation_check.py` produces for that
set's encodings, the set is stale and the merge exits 1 (`--allow-stale` overrides, `--check`
reports without writing). That guard exists because this file previously had *no producer at all* —
the line above described it and nothing built it, so it could only ever be current by someone
remembering to rebuild it by hand, and it was silently stale for as long as the widened sweep took
to land.

`v2/` archives the five-operator per-set files for all 21 sets that had one — the 62.3 % baseline
in `docs/mutation-sweep.md` refers to those, and kill rates are **not comparable across
instruments**. `triage/group*.json` — the fully-vacuous pre-OP15 cards under the *old* instrument
(178 cards), split for parallel adjudication; the widened run has 16.

Regenerate the pre-OP15 vendor sets with `./runs/sweep_wide.sh` (needs 8 engine clones in
`.clones/`; runs each invocation under a `SWEEP_BUDGET=270` cap and resumes from the jsonl and its
`.progress.json` sidecar). Re-sweep the sets this repo owns — OP15, OP16, and its cards grafted into
upstream sets — with `./runs/mutation_shard.py --clones ... --fresh`, which is the `--set` path.
Aggregate with `./runs/status.sh`; gate OP15/OP16 with `./runs/mutation_shard.py --aggregate`.
Findings are written up in `docs/mutation-sweep.md`.

**Measure on a quiet machine.** `vite.config.ts` sets no `testTimeout`, so vitest's default is 5 s
per test, and `mutation_check._run_tests` scores any non-zero exit as a *killed* mutant — a
load-induced timeout is indistinguishable from a detection. The bias is one-directional: it inflates
the kill rate and hides survivors. A sweep started at load 67 on this 10-core host was abandoned for
this reason and re-run at load < 15.
