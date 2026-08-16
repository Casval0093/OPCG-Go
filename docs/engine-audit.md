# Engine Audit

**Date:** 2026-08-16 · **Verdict: fork `TheCardGoat/tcg-engines` (`submodules/one-piece`). Decisive.**

## Head to head

| | MOOgiwara | tcg-engines / one-piece |
|---|---|---|
| License | **AGPL-3.0** (copyleft) | **MIT** |
| Size | 50 TS files, MVP 30% | 8,298 TS files, ~20.8k LOC engine core |
| Card definitions | none | **2,282**, structured |
| Encoded effects | none | **1,771**, compositional DSL |
| Tests | none meaningful | **2,631 passing / 1,388 files in 61s** |
| Play policy | none | 5 bot strategies + legal-move generation |
| Stack | Phaser + MongoDB, UI-coupled | headless packages, pnpm workspace |

MOOgiwara is not competitive. Rejected.

## What the fork already gives us

- **Working rules engine.** Full combat state machine: `battleBlockStep` → `battleCounterStep` →
  `battleKoReplacement` → `battleLifeTriggerPrompt` → `battleCleanupFinalize`. Turn machinery,
  `chooseJoKenPo` turn-order, mulligan/`compareHands`, prompt queue.
- **The effect DSL we planned to design already exists.** 53+ action primitives — `modifyPower`
  (471 uses), `draw` (269), `ko` (254), `play` (205), `search` (168), `rest`, `grantKeyword`,
  `addDon`, `returnToHand`, `modifyCost`, `addToLife`, `negateEffects`, `freeze` — with real
  composition: `choice`, `sequence`, `conditional`, `optional`, `delayed`, `allOf`, `anyOf`,
  `compound`.
- **Validation layer 1 already built.** `card-behavior-harness.ts` cross-checks each card's
  structured effect against its printed text via trigger regexes.
- **`projection.ts`** — state projection, the primitive ISMCTS determinization needs.
- **`tools/op-card-parser`** and an `.agents/skills/op-rules` skill.

## Gaps to fill

| Gap | Size |
|---|---|
| Cards with printed effects but no encoding | **0** — see correction below |
| Sets OP15, OP16, OP17 | **absent entirely**, ~400 cards |
| Search AI | none — best policy is a static heuristic |
| Simplified Chinese layer | i18n structure exists, only `en` populated |

202 cards are unencoded but genuinely vanilla, which is correct. Regenerate with
`python3 tools/coverage_report.py`.

### Correction, 2026-08-16 — the 331/125 gap figures were wrong

This audit originally reported 331 unencoded cards (125 excluding promos) and made them the
third priority of the project. That number was an artifact of `coverage_report.py`, not a
property of the corpus. Both causes are now fixed in the tool:

1. **Spread inheritance was not followed.** Alternate-art printings are declared as
   `{ ...op01Nami016, id: "OP01-016_p2", ... }` and execute the base card's encoding. The
   check regexed each file for a literal `effects: {`, so every such printing looked
   unencoded. **309 cards**, 103 of them mainline.
2. **A null printed effect was read as printed text.** The importer emits `effect: "NULL"`
   or `effect: ""` instead of omitting the key; the check tested only for the key's
   presence. **22 cards**, all mainline, all genuinely vanilla.

309 + 22 = 331, and 103 + 22 = 125. Both reported figures reconcile exactly to zero real work.

**Consequence for the plan:** the "fill the 125 mainline gaps" work item does not exist.
The engine's coverage of existing sets is complete. The only encoding work outstanding is
OP15–OP17, which is a data-acquisition problem before it is an encoding problem.

### Variant/base text integrity — a real defect the gap count was hiding

Spread printings inherit the base's `effects` while keeping their own printed text, and
nothing checks that the two agree. `tools/variant_audit.py` compares all 315:

| Category | Count |
|---|---|
| identical / absent / formatting-only | 276 |
| **sign** — a `−` missing from a debuff | **16** |
| **keyword** — a bracketed keyword clause on one side only | **12** |
| other — mostly errata wording | 11 |

The engine runs the base's encoding, so play is correct today and no test fails. The risk is
downstream: the OP15–OP17 plan is to author encodings from printed text, and 16 cards' text
says "give 3000 power" where the card gives −3000. Verify against the base, not the variant.

## Throughput — the hard constraint on Tier 3

Measured single-core, `valueRanked` mirror, 100/100 games decided:

| Configuration | games/s | commands/s |
|---|---|---|
| Baseline | 2.80 | 143 |
| Cycle detector disabled | 3.54 | 181 |

The per-step `JSON.parse(JSON.stringify(state))` cycle detector is only **26%** of runtime. The
floor is the immutable-state engine core itself, so there is no cheap fix.

**What that means for ISMCTS** (~50 decisions/game, rollout ≈ 25 commands ≈ 0.14s):

| MCTS budget | per game | full 36-pair × 400-game matrix |
|---|---|---|
| 1,000 rollouts/decision | ~1.9 h | ~28,000 core-hours (**36 days on 32 cores**) |
| 200 rollouts/decision | ~0.4 h | ~5,600 core-hours (**7 days on 32 cores**) |
| Heuristic only, no search | 0.28 s | ~1.1 core-hours |

These numbers use a **4-card test deck**. Real 51-card decks with live effects will be 2–5x slower.

**Tier 3 as specified is off by roughly two orders of magnitude on this engine.** The open decision
is which lever to pull, not whether.

> **Decision, 2026-08-16 — do not re-measure until the benchmark deck is fixed.** The table
> above is derived from a 4-card test deck, and the note under it (real decks run 2–5x slower)
> is not carried into the options below, so Option C's "runs today on 2 cores" is optimistic by
> that factor. Re-running the benchmark as-is would only reproduce a number already known to be
> unrepresentative. `bench/throughput.test.ts` must first be pointed at a real 50-card list —
> the Teach reference deck in `docs/research-findings.md` §7 is the obvious candidate, since
> every one of its cards is now in `data/cards-OP16-en.json`. Then measure once, and re-derive
> the options table from that.

## Options to close the gap

- **A. Rust port of the hot path.** Keep the TS card DSL as source of truth; compile state and
  effect resolution to a native core. 100–1000x. Largest effort; the only path to full-strength ISMCTS.
- **B. Learned value network.** Replace rollouts with a trained evaluator — cuts required
  simulations ~10-100x. Needs bootstrap games, which are themselves expensive.
- **C. Tier 2.5.** Strong heuristic policy plus shallow search (depth-limited, 20–50 rollouts).
  Runs today on 2 cores. Weaker play, but calibration against real matchup data tells us honestly
  how much that costs.
- **D. Rent compute.** 32–64 cores makes the 200-rollout tier a 3–7 day sweep. Buys one order of
  magnitude, not two.

**Recommendation: C now, B next, A only if calibration proves heuristic play distorts matchup
results.** Ship a calibrated Tier 2.5 matrix early, then buy strength where the data shows it matters.

## Reproduction

```bash
./scripts/bootstrap.sh
cd vendor/tcg-engines/submodules/one-piece/packages/engine
cp ../../../../../bench/throughput.test.ts tests/cards/
./node_modules/.bin/vp test run tests/cards/throughput.test.ts --reporter=verbose
RUN_OP_BOT_BATCHES=1 ./node_modules/.bin/vp test run src/automation/bot-harness.test.ts
```
