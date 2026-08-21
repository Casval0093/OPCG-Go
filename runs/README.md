# Mutation sweep results

`<SET>.jsonl` — one record per card: `{card, status, killed, mutants, survivors}`.
`all-results.json` — the same, merged and keyed by card id. **Stale**: it was built from the
five-operator run; the per-set files for OP01–OP14EB04, EB01–EB03 and PRB01/PRB02 now hold the
widened eleven-operator measurement (2026-08-21), while `OP15.jsonl`/`OP16.jsonl` remain the
old-instrument records. `v2/` archives the five-operator per-set files. `triage/group*.json` — the fully-vacuous pre-OP15 cards under the *old*
instrument (178 cards), split for parallel adjudication; the widened run has 16.

Regenerate the widened pre-OP15 files with `./runs/sweep_wide.sh` (needs 8 engine clones in
`.clones/`; runs each invocation under a `SWEEP_BUDGET=270` cap and resumes from the jsonl and its
`.progress.json` sidecar). Aggregate with `./runs/status.sh`. Findings are written up in
`docs/mutation-sweep.md`.
