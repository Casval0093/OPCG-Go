# OPCG-Go

Competitive deck research and simulation for the **One Piece Card Game, Simplified Chinese (简中) format**.

Goal: determine and field the highest-EV deck in the SC format, continuously, across set rotations.

## Status

| Phase | State |
|---|---|
| Engine audit | **done** — see [`docs/engine-audit.md`](docs/engine-audit.md) |
| Competitive research | **done** — see [`docs/research-findings.md`](docs/research-findings.md) |
| Card encoding backlog | **0 gaps in existing sets** (the 331 figure was a measurement bug); OP15/16 *shells* generated, effects outstanding |
| Simulation harness | **working** — real Block 2+ decks run end to end. See [`docs/simulation.md`](docs/simulation.md) |
| Environment data layer | **contract complete, offline-verified** — SC/EN Environments, evidence classes, fail-closed resolution. No live SC or EN Manifest exists yet. See [`docs/environment-data.md`](docs/environment-data.md) |
| Search AI | not started; the Tier-3 lever needs re-deciding (see below) |
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
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
./scripts/bootstrap.sh                          # clones + installs the vendored engine, runs its test suite
./.venv/bin/python tools/ev_analysis.py         # field-weighted EV, Nash, sensitivity
./.venv/bin/python tools/coverage_report.py     # card-effect encoding coverage
./.venv/bin/python tools/coverage_report.py --exclude-promos
```

`ev_analysis.py` needs numpy and it exits without it; scipy is optional and only
gates the Nash solve. The other three tools are stdlib-only and run on a bare
`python3`. `bootstrap.sh` needs node + corepack and ends with the engine suite passing (2648 at
the time of writing; the count grows as cards are encoded, so read the output).

`ev_analysis.py` reads the **legacy** EN matrix and says so on its first line
(`legacy-provenance: {...}`). It is historical evidence, it covers 88.29% of the field with 11.71%
unmodelled, and it can never become an Environment. Environment strength lives elsewhere:

```bash
node --test tests/environment-e2e.test.mjs               # whole environment pipeline, offline, no device
node tools/environment_data.mjs resolve --root R --selector SC/latest ...
node tools/environment_evaluate.mjs evaluate --plan P --runner RUNNER --results-root R ...
```

## Environment data and evidence classes

Everything the project measures now carries the class of evidence it came from, and the classes
never mix — see [`docs/environment-data.md`](docs/environment-data.md) for the full contract,
commands, and boundaries.

| Class | May set field share? | May score strength? |
|---|---|---|
| Empirical field (SC events, `full-field` frame) | yes | no |
| Empirical matchup (recorded results) | no | yes |
| Simulated (engine games) | no | yes, but never as an unqualified official claim today |
| Proxy (another edition's matchups, named explicitly) | no | only in a `proxy` Manifest |
| Market (prices, indices) | no | **never** — metadata only |
| Legacy (`data/op16-matchup-matrix.json`) | no | no |

Three boundaries worth knowing before reading any output:

- **No live SC or EN Manifest exists.** SC acquisition is built and owner-gated; EN waits for a
  source whose participant denominator and decklist rows describe the same population. A public
  Limitless page may declare the full entrant count while its statistics rows cover only the
  submitted subset — that is subset evidence, not a field share.
- **Simulated reports withhold the official strength claim.** Nothing infers a ClockModel yet and no
  round-timeout adjudicator has run, so reports are blocker-bearing `diagnostic_estimate`s. A
  timed-out round in this format is a double loss, so that is a missing outcome class, not noise.
- **Prices never move a win rate.** Market snapshots reach a report only as metadata; the
  end-to-end test proves that changing a market fixture leaves every EV and confidence value
  identical.

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

`one-piece-card-game-json` on npm republishes the **official Bandai card list** (its `image_url`
fields point at `en.onepiece-cardgame.com`), which makes it a mirror of the primary source rather
than the aggregator summaries this project rules out. That is why the importer uses it.

> **Corrected 2026-08-17.** This section previously said every direct card source was blocked by an
> egress policy. That was true of the environment the project was scoped in, not universally: on the
> owner's machine `onepiece.limitlesstcg.com`, `en.onepiece-cardgame.com` and
> `onepiece-cardgame.cn` all return 200, and only `optcgapi.com` times out. Limitless `robots.txt`
> is `Disallow:` with an empty value, so automated fetch is permitted — **verify card text against
> Limitless directly.** `onepiece-cardgame.cn` is not robots-blocked either; it is a JavaScript SPA,
> so a plain fetch returns an empty shell. See `CLAUDE.md`.

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

**Deck realism, measured 2026-08-17** — same host, same match settings, deck is the only variable:

| Deck | distinct | games/s | cmds/s | cmds/game |
|---|---|---|---|---|
| synthetic 4-card | 4 | 4.09 | 209 | 51.1 |
| ST01 real 50-card | 16 | 2.29 | 217 | 94.6 |

**1.79x slower per game, 0.97x per command.** The audit assumed 2–5x and attributed it to live
effects; that mechanism is wrong. Per-command cost is flat — the real deck is marginally *faster*
per command. The slowdown is entirely game length. Optimisation should target state transitions,
not effect resolution. ST01 is a starter deck, so 1.79x is a lower bound.

Absolute games/s above is not comparable across hosts (4.09 vs the 2.80 baseline is a different
machine, not a change in the engine). Only the within-run ratio is meaningful.

Reproduce with [`bench/throughput.test.ts`](bench/throughput.test.ts) (drop into
`packages/engine/tests/cards/` in the vendored engine).

## Simulation

Working as of 2026-08-17. Mirror matches on real Block 2+ decks complete 400/400.

```bash
./scripts/simulate.sh --games 400                                    # ST01 mirror, smoke test
./scripts/simulate.sh --a A.json --b OPP.json --games 2000           # a matchup
./scripts/simulate.sh --a A.json --compare A-tech.json --b OPP.json  # a tech-slot A/B
./scripts/simulate.sh --dump-catalog                                 # engine card catalog -> JSON
./scripts/simulate.sh --diag-prompts                                 # bot prompt diagnostics
```

Built from the **SC rulebooks**, which changed the design. Per 官方公认赛赛事守则 V1.6.0 §II, a round
that hits time with no winner is **双方败北 — both players lose**, not a draw. So outcomes are
`win | loss | timeout` and a timeout counts against both decks; a win rate over decided games only
would flatter slow decks. Extra turns and the Life→deck→猜拳 tiebreak apply *only* in elimination,
never in Swiss.

**Getting here required fixing an engine bug.** The bot abandoned **88% of games** on Block 2+ decks
with `illegal-command`. Cause: `resolveBotPromptCommand` handles four of six prompt `ChoiceKind`s
and falls through to a single `optionId`, which cannot express an ordering — so **`orderCards`
failed 17/17**. The ~8-line fix is in [`tools/patch_engine.py`](tools/patch_engine.py), re-applied
by bootstrap since `vendor/` is gitignored. A/B on the same seeds: **3/20 → 20/20** games completed.
The bug is upstream's — `tcg-engines` is MIT — but the fix is carried locally by owner decision, so
`patch_engine.py` is permanent infrastructure rather than a stopgap.

**A second engine bug turned up the same way.** A `search` that reveals to **hand** was gated on
open **character** slots: `effectSearchSelection` applied the board-space test to every search
regardless of `revealDestination`, so a full board made the engine refuse every Character its own
prompt had just offered. It surfaced on `OP16-118` Portgas.D.Ace and looked like a bad trait filter;
it was not — the prompt's eligibility list was correct throughout. **171 of the 185 encodings with a
`search` action reveal to hand, and 152 of those are upstream's own cards.** One-line fix, patch 2
in the same file; A/B on a 10-game mirror: **`illegal-command=1` → `rules-win=10`**.

That reframes the audit: its four options are all *throughput* levers, and throughput was never the
binding constraint. Policy legality was.

| Deck | completion | play/draw gap |
|---|---|---|
| ST01 starter (Block 1) | 100% | 54.5 pts |
| Block 2+ vanilla control (no effects) | 100% | 26.7 pts |
| **Block 2+ real cards, patched** | **100%** | **8.5 pts** |

Only the last is plausible — real first-player advantage is a few points. **Do not calibrate on
ST01:** the gap tracks how much interaction a deck has, and a degenerate deck gives degenerate
calibration. Statistical design uses common random numbers so a 1–2 card swap is measured against
identical shuffles; the null test (identical decks) returns exactly 0.00 pts with 0/100 discordant
pairs.

## Layout

```
docs/         charter, engine audit, research findings, simulation, environment data
environment/  the environment layer: snapshots, identity, legality, gates, Manifests, reports
sim/          simulation harness, decks, engine card catalog, the environment job contract
tools/        analysis scripts, JiHuanShe capture/normalize/refresh, environment CLIs
tests/        cross-cutting tests and shared fixtures
bench/        throughput benchmarks
data/         generated datasets
scripts/      bootstrap
vendor/       cloned engine (gitignored)
```

## Licensing note

The vendored engine is MIT. It is cloned at bootstrap rather than committed, so this repo carries
no upstream code. `BAA-Studios/MOOgiwara` was evaluated and rejected — AGPL-3.0, and a 30%-complete
MVP with no card logic.
