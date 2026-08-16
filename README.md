# OPCG-Go

Competitive deck research and simulation for the **One Piece Card Game, Simplified Chinese (简中) format**.

Goal: determine and field the highest-EV deck in the SC format, continuously, across set rotations.

## Status

| Phase | State |
|---|---|
| Engine audit | **done** — see [`docs/engine-audit.md`](docs/engine-audit.md) |
| Competitive research | **done** — see [`docs/research-findings.md`](docs/research-findings.md) |
| Card encoding backlog | scoped — 331 gaps + ~400 new cards for OP15–17 |
| Search AI | blocked on throughput decision |
| Chosen archetypes | Ace (`OP16-001`) primary, Mihawk (`OP14-020`) secondary |

## Approach

Fork [`TheCardGoat/tcg-engines`](https://github.com/TheCardGoat/tcg-engines) (MIT) as the rules core. It already ships a working
One Piece engine: full combat state machine, legal-move generation, 53+ compositional effect
primitives, 1,771 encoded cards, and 2,631 passing tests. We add what it lacks — OP15/16/17
cards, a Simplified Chinese layer, a search-based play policy, and the EV analysis pipeline.

Objective function: **field-weighted expected match win rate against the real SC field, split by
play/draw** (turn-order asymmetry in OPTCG is severe — going first skips the draw and cannot
attack on turn 1, so averaging the two hides the signal).

Validation is three layers: per-card assertion tests → Comprehensive Rules conformance →
calibration of simulated matchup rates against observed tournament data.

## Quick start

```bash
python3 tools/ev_analysis.py             # field-weighted EV, Nash, sensitivity
./scripts/bootstrap.sh                  # clones + installs the vendored engine, runs its test suite
python3 tools/coverage_report.py        # card-effect encoding coverage
python3 tools/coverage_report.py --exclude-promos
```

## Card encoding backlog

Measured 2026-08-16 over 2,282 card definitions:

| State | Count |
|---|---|
| Encoded (executable) | 1,771 |
| **Gap** (printed effect, no encoding) | **331** |
| Vanilla (no printed effect — correctly unencoded) | 180 |

Of the 331 gaps, 206 are in promo sets PRB01/PRB02. Excluding those, **125 cards** across
mainline OP/EB sets need encoding. Sets **OP15, OP16 and OP17 are absent entirely** (~400 cards)
— and those are the ones that decide the current SC meta.

Raw data: [`data/card-coverage.json`](data/card-coverage.json).

## Throughput

Single-core, `valueRanked` mirror match, 100/100 games decided:

| Configuration | games/s | commands/s |
|---|---|---|
| Baseline | 2.80 | 143 |
| Cycle detector disabled | 3.54 | 181 |

The per-step full-state JSON serialization is only 26% of runtime, so there is no cheap fix —
the immutable-state core is the floor. This puts full-strength ISMCTS roughly two orders of
magnitude out of reach on the current engine. See the audit for the options.

Reproduce with [`bench/throughput.test.ts`](bench/throughput.test.ts) (drop into
`packages/engine/tests/cards/` in the vendored engine).

## Layout

```
docs/     charter, engine audit, research findings
tools/    analysis scripts
bench/    throughput benchmarks
data/     generated datasets
scripts/  bootstrap
vendor/   cloned engine (gitignored)
```

## Licensing note

The vendored engine is MIT. It is cloned at bootstrap rather than committed, so this repo carries
no upstream code. `BAA-Studios/MOOgiwara` was evaluated and rejected — AGPL-3.0, and a 30%-complete
MVP with no card logic.
