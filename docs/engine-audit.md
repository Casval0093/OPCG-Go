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
| Cards with printed effects but no encoding | **331** (206 of them in promo sets PRB01/PRB02) |
| Same, excluding promos | **125** across mainline OP/EB |
| Sets OP15, OP16, OP17 | **absent entirely**, ~400 cards |
| Search AI | none — best policy is a static heuristic |
| Simplified Chinese layer | i18n structure exists, only `en` populated |

180 further cards are unencoded but genuinely vanilla, which is correct. Regenerate this table
with `python3 tools/coverage_report.py`.

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
