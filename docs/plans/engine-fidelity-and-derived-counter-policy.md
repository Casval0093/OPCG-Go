# Plan — engine fidelity, then a DERIVED counter policy

Written 2026-08-19, after the batch-2 puzzle suite (PR #19) and an audit against the Official Rule
Manual. Supersedes nothing; it is the next phase of step 2→3 of the policy-quality plan in CLAUDE.md.

## Why this order

Ping's decision 2026-08-19: **key cards are to be DERIVED from batch simulation, not designated** —
"improvement through batch is the main purpose of this project." That is the goal of Phase 3 below.
Phases 0–2 exist because a derivation is only as good as the simulator it runs on, and three things
currently make it either unaffordable or wrong:

1. **Unaffordable.** `ace-op16` costs **106 s/game** against 0.57 s for every other deck, because of
   one card (`OP16-017`, exponential in copies). A 15-card × 2-arm × 200-game sweep is ~7.4 days
   single-core now, ~1 hour after the fix.
2. **Wrong dimension.** The counter policy cannot be derived on a simulator that never counters.
3. **Circular.** The policy needs the weights; the weights come from batches run with the policy.
   Resolved by fixed-point iteration (Phase 3), but it must be named rather than discovered.

## Facts established before this plan — do not re-derive

All measured this session; full detail in `CLAUDE.md` and `docs/simulation.md`.

- `OP16-017` scales ×10 per copy in play: 1/2/3/4 copies → 405 / 1,982 / 20,065 / 192,908 ms.
  Its `permanentEffect` applies `modifyPower -4000` to **itself** behind a `notHasCard` scan of your
  own character zone, so `getCardPower` re-enters itself across sibling copies.
- **Encoded decks are NOT slow in general.** `mihawk-green-proxy`, a real encoded Block 2+ deck, is
  6.3 ms/command. CLAUDE.md's ~2–4 games/s stands; do not retract it.
- The Official Rule Manual's Battle Flow footnote is *"Neither player can attack on their first
  turn."* The engine gates only the first player, so the **second player attacks a turn early**.
- `resolveBotPromptCommand` takes `Math.min(maxSelections, minSelections)`, and both defensive
  prompts set `minSelections: 0` — the bot **never counters and never blocks**. It also **always**
  activates a `[Trigger]`, which the manual makes a real choice.
- Damage is **binary** (`attackPower >= defensePower`, ties to the attacker): a counter either flips
  the outcome or is entirely wasted. There is no "counter harder" axis.
- Taking leader damage puts the life card **in hand**, and it is usable as a counter later in the
  **same** turn — verified. So "tank early, counter late" is the dominant shape, not a compromise.
  But only for life cards **without** a `[Trigger]`, since a Trigger card goes to resolution instead.
- No policy can choose an attack target; every attack hits the defending leader.

## Global constraints

1. **Phase 0 must not change game results, only speed.** Any fix is verified by running a fixed-seed
   mirror before and after and asserting an **identical** winner sequence and command count. A
   memoisation bug that silently changes outcomes is worse than the slowness.
2. **Every engine fix lands in `tools/patch_engine.py`**, never as a hand-edit to `vendor/`, which is
   gitignored. Existing patches are 1–5; these are 6+.
3. **Nothing goes to any external repository, and it is never proposed.** Standing rule, Ping
   2026-08-19.
4. **Phases 1 and 2 are one unit.** Every rules fix invalidates the ladder, the play/draw split and
   the mirror validations, so they are batched and re-measured once.
5. **No new calibration constant ships unlabelled.** Anything tunable is named in
   `docs/simulation.md` as a knob, in the same category as `SIM_TURN_BUDGET`, and never quoted as a
   measured result.
6. Report measured numbers, not expected ones. If a phase's result contradicts this plan, the result
   wins and the plan is amended in place, as Task 2 of the batch-2 plan was.

## Phase 0 — make the primary deck affordable to simulate

### Task 0.1 — fix `OP16-017`'s exponential power evaluation
Patch 6. Prefer a **recursion guard** (a per-evaluation in-progress set that breaks the cycle) over
caching: a cache keyed on mutable state is the easy way to change results by accident, and constraint
1 forbids that. Investigate in a profiler first to confirm the mechanism rather than assuming it from
the encoding.

**Verification**
- 1/2/3/4-copy decks: growth must be roughly linear, not ×10 per copy.
- `ace-op16` per-command cost within ~2× of `mihawk-green-proxy`'s 6.3 ms.
- Fixed-seed Ace mirror: identical winner sequence and `mean cmds` before and after.
- Engine suite 6078 pass / 0 fail.
- Record the before/after table in `docs/simulation.md`.

### Task 0.2 — a throughput regression guard
`bench/throughput.test.ts` currently benchmarks a 4-card synthetic deck and ST01 — both effect-light,
which is exactly why this class of blowup went unnoticed. Add `ace-op16` (or a deck containing the
pathological shape) so a per-command cost regression fails loudly.

**Verification** the guard fails on the unpatched engine and passes on the patched one.

## Phase 1 — rules fidelity

### Task 1.1 — neither player may attack on their own first turn
Patch 7. Condition must express "this seat's own first turn", not `turnNumber === 1`.

**Verification** the probe table (turns 1–4, both seats) shows `declareAttack offered` false only on
each seat's own first turn. Engine suite green. **Batch-2 puzzle fixtures will break** — they sit at
`turnNumber: 1` acting as south; fix them by advancing past turn 1, not by re-seating. The SOLVABLE
guards must be the thing that catches it.

### Task 1.2 — a counter policy, parameterised from the start
Replace the always-empty selection. Shape agreed with Ping (C+B):

```
hard floor : if remainingAttacksThisTurn >= life        -> counter if a sufficient set exists
R          = (opponent characters + 1)                  # all refresh; can attack next turn
           + floor(opponentDon / avgCost)               # turn+2 growth; CANNOT attack next turn
rule       : tank while life > R, counter once life <= R
never       : spend a counter that does not flip attackPower >= defensePower (binary damage)
overrides   : lethal, [Double Attack], [Banish] -> counter regardless of R
card choice : cheapest-sufficient, preferring low play-value cards (Phase 3 learns the weights)
```

`avgCost` is **the** calibration constant and must be labelled per constraint 5. Everything must be
readable from a config object so a Phase 3 sweep can vary it **without a code edit** — that is the
difference between a sweep and fifteen hand-runs.

**Verification** a new `counterPlay` puzzle class in `sim/puzzles.test.ts`, engine-adjudicated on the
threshold-free parts only: never waste a counter; always counter lethal; prefer tank-early. The
R-dependent middle is opinion and is measured in Phase 3, not asserted here. Mutation-check every new
guard.

### Task 1.3 — leave blockers and triggers alone, in writing
Blocking has no waste-free rule (it trades a permanent for ~2 cards of hand) and declining a
`[Trigger]` is a genuine value call. Both stay as they are and are documented as **open policy
surfaces**, not oversights. Do not silently fix either.

## Phase 2 — re-measure the baseline once

### Task 2.1 — dominance ladder, full round robin
All 10 pairs, 200 games, post-Phase-0/1. Keep the round robin **complete**: pairwise strength need not
be transitive, so a total order may only be stated when every pair has been played.

### Task 2.2 — play/draw, and the question currently unanswered
Re-measure the play/draw gap. This is where the magnitude of the second-player illegal-attack bias
gets answered. Direction is known (every prior figure **understates** first-player advantage);
magnitude is not, and must not be guessed before this run.

### Task 2.3 — puzzle suite
Repair the fixtures from Task 1.1, re-run, and either confirm batch 1's published numbers
(valueRanked 6/6, greedy 6/6, firstLegal 5/6, random 0/6) or document exactly what moved and why.

## Phase 3 — DERIVE the counter weights (the actual goal)

### Task 3.1 — learn FEATURE weights, not a card list
Per-card tables are stale the day OP17 lands (~2026-08-23 SC), and continuous handling of rotations is
the project's purpose. Learn coefficients on observables the engine can read for any card: has-effect,
cost, counter value, is-my-only-body, character count, castable-next-turn.

**Known limitation, stated up front:** features cannot see **combos**, which are pair/set facts. Add
pair-interaction terms only for the cards the feature model demonstrably mispredicts — never
speculatively, since each term multiplies the sweep.

### Task 3.2 — the estimator
**Counterfactual counter-spend A/B**, not ablation: for each feature bucket, run paired arms where the
policy may vs may not spend cards in that bucket, and read ΔWR. Ablation (N vs N−1 copies) measures
"does the deck need this card", which is a different quantity. Purely observational correlation
("spending X correlates with losing") is **confounded** — you spend counters when losing — and must
not be used.

Use common random numbers across arms, as `--compare` already does; the effects are small and pairing
is what makes them measurable.

**Cost:** 15 buckets × 2 arms × 200 games = 6,000 games ≈ 1 hour at post-Phase-0 speed, and it
parallelises over APFS engine clones.

### Task 3.3 — fixed-point iteration
Start neutral (cheapest-sufficient, no protection). Measure → feed weights back → re-run. Stop when
weight changes fall inside their confidence intervals, or after K iterations, whichever first. Report
the iteration count; a table that never stabilises is itself the finding.

**Verification** the derived policy must beat the neutral policy in a **held-out** ladder run. If it
does not, the derivation failed, and that is the result to report rather than a table to ship.

## Phase 4 — meta calibration

Step 3 of the CLAUDE.md plan: simulated matchup win rates against the 213k-game EN ladder matrix. Now
meaningful, because combat has defensive interaction and the primary deck is affordable to run.

## Deliberately NOT in scope

- **Attack target selection** — Ping deferred it 2026-08-19. **But note the cost honestly:** because
  bots never attack characters, board presence in simulation is purely offensive. The counter policy's
  "keep a body" feature (Task 3.1) will therefore be **systematically undervalued**, since a body is
  never needed defensively. If Phase 3's weight on that feature comes out near zero, that is the
  likely cause and not evidence the feature is worthless. This may be worth revisiting before Phase 3.
- **`valueRanked`'s `+100` printed-power bonus** — deferred; it is a confirmed defect but changing it
  is bundled with a ladder re-run.
- **Numeric rules from the Official Rule Manual** — the PDF's digits do not survive text extraction,
  so Life totals, the character-area limit and "reduced to 0 cards" were NOT audited. Needs a
  rendering path (poppler) or Ping's confirmation.
