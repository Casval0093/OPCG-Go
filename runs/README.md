# Mutation sweep results

`<SET>.jsonl` — one record per card: `{card, status, killed, mutants, survivors}`.
`all-results.json` — the same, merged and keyed by card id.
`triage/group*.json` — the 178 fully-vacuous pre-OP15 cards, split for parallel adjudication.

Regenerate with `./runs/sweep_all.sh` (needs 8 engine clones in `.clones/`); aggregate with
`./runs/status.sh`. Findings are written up in `docs/mutation-sweep.md`.
