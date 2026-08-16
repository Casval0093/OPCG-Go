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

Re-measured 2026-08-16 over 2,282 card definitions, after correcting two classification
bugs in `coverage_report.py`:

| State | Count |
|---|---|
| Encoded (executable) | 2,080 |
| — declared on the card | 1,771 |
| — inherited by spread from a base printing | 309 |
| **Gap** (printed effect, no encoding) | **0** |
| Vanilla (no printed effect — correctly unencoded) | 202 |

**There is no encoding backlog in the existing sets.** The previously reported 331 gaps
were entirely a measurement artifact, and they reconcile exactly:

- **309** are alternate-art printings declared as `{ ...baseCard, id: "..._p2" }`. They
  execute the base card's encoding. The old check regexed each file for a literal
  `effects: {` and never followed the spread.
- **22** have no printed effect at all. The importer writes a null effect as
  `effect: "NULL"` or `effect: ""` rather than omitting the key, and the old check treated
  a present-but-null key as evidence of printed text.

309 + 22 = 331. The mainline figure reconciles the same way: 103 + 22 = 125.

The real gap is unchanged and unaffected: sets **OP15, OP16 and OP17 are absent from the
engine** — and those are the ones that decide the current SC meta. Card data for OP15 and
OP16 is now imported (see below); OP17 is not yet published by Bandai.

Raw data: [`data/card-coverage.json`](data/card-coverage.json). Audit the spread resolution
with `python3 tools/coverage_report.py --show-inherited`.

## Card data for OP15–OP17

Every direct card source is blocked by the working environment's egress policy, which allows
GitHub and package registries only — `optcgapi.com`, `onepiece.limitlesstcg.com`,
`onepiece-cardgame.cn` and `en.onepiece-cardgame.com` all fail. The npm registry is reachable,
and `one-piece-card-game-json` republishes the **official Bandai card list** (its `image_url`
fields point at `en.onepiece-cardgame.com`), which makes it a mirror of the primary source
rather than the aggregator summaries this project rules out.

```bash
python3 tools/import_cards.py --validate          # trust check against the engine
python3 tools/import_cards.py --set OP15 --set OP16
python3 tools/import_cards.py --list              # what upstream has
```

Trust is established, not assumed. `--validate` cross-checks every card the dataset shares
with the engine's 2,282 hand-checked definitions:

| Field | Agreement |
|---|---|
| power | 1503/1503 (100%) |
| life | 97/97 (100%) |
| cost | 1858/1859 (99.95%) |
| counter | 1199/1204 (99.58%) |

The six disagreements are listed by card ID in the tool's output; one side is wrong in each
and they are worth checking by hand. As a further check, `OP16-001` Portgas.D.Ace imports with
effect text matching [`docs/research-findings.md`](docs/research-findings.md) verbatim — and
that was verified independently against Limitless.

| Set | Cards | With printed effects | Status |
|---|---|---|---|
| OP15 | 119 | 113 | imported → `data/cards-OP15-en.json` |
| OP16 | 119 | 110 | imported → `data/cards-OP16-en.json` |
| OP17 | — | — | **not yet published by Bandai**; EN 2026-08-28, SC ~2026-08-23 |

OP17 needs no code change — re-run `python3 tools/import_cards.py --set OP17 --refresh` once
it is on the official list.

## Variant/base text integrity

Alternate-art printings inherit the base card's `effects` but carry their own copy of the
printed text. Nothing enforces that the two agree, and 39 of 315 do not
([`data/variant-audit.json`](data/variant-audit.json), regenerate with
`python3 tools/variant_audit.py`):

| Category | Count | Meaning |
|---|---|---|
| identical / absent / formatting | 276 | fine |
| **sign** | **16** | a `−` is missing from a debuff |
| **keyword** | **12** | one side has a bracketed keyword clause the other lacks |
| other | 11 | mostly errata wording — review individually |

In all 16 sign cases the base is correct and the variant's text has lost the minus, e.g.
`OP09-004_p6` reads "Give all of your opponent's Characters 1000 power" where the base reads
"−1000 power". **Gameplay today is correct**, because the engine executes the base's encoding
and only the display text is wrong.

It matters anyway: the plan is to LLM-author encodings for OP15–OP17 from printed text. Any
process that reads variant text as ground truth will encode a buff where a debuff belongs.
`OP02-013_p3` additionally misspells the trait as `"Whitebeard Piratess"`, which is the exact
trait the Ace archetype keys on.

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
