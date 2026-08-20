# Plan — engine fidelity, then a DERIVED counter policy

Written 2026-08-19, after the batch-2 puzzle suite (PR #19) and an audit against the Official Rule
Manual. Supersedes nothing; it is the next phase of step 2→3 of the policy-quality plan in CLAUDE.md.

## Why this order

Ping's decision 2026-08-19: **key cards are to be DERIVED from batch simulation, not designated** —
"improvement through batch is the main purpose of this project." That is the goal of Phase 3 below.
Phases 0–2 exist because a derivation is only as good as the simulator it runs on, and three things
currently make it either unaffordable or wrong:

1. ~~**Unaffordable.**~~ **RESOLVED 2026-08-19 by the `permanent: getPermanentSetCost evaluates conditions it then discards` patch — see Task 0.1.** `ace-op16` measured
   84.6 s/game before and **1.465 s/game** after; per command, 814.60 ms → 14.12 ms, which is
   98.9× → 2.56× the Mihawk proxy. The 6,000-game sweep is **2.4 h single-core** (~0.3 h across 8
   APFS clones), against 5.9 days before. **The "~1 hour after the fix" estimate here was optimistic
   by ~2.4×**; affordable either way, which was the point.
2. **Wrong dimension.** The counter policy cannot be derived on a simulator that never counters.
3. **Circular.** The policy needs the weights; the weights come from batches run with the policy.
   Resolved by fixed-point iteration (Phase 3), but it must be named rather than discovered.

## Facts established before this plan — do not re-derive

All measured this session; full detail in `CLAUDE.md` and `docs/simulation.md`.

- `OP16-017` scales ×10 per copy in play: 1/2/3/4 copies → 405 / 1,982 / 20,065 / 192,908 ms.
  ~~Its `permanentEffect` applies `modifyPower -4000` to **itself** behind a `notHasCard` scan of your
  own character zone, so `getCardPower` re-enters itself across sibling copies.~~
  **The struck-through mechanism is WRONG — corrected 2026-08-19 by measurement, see Task 0.1.**
  Power evaluation runs exactly once; the re-entry is in COST evaluation, via `getPermanentSetCost`
  evaluating conditions it discards. The `modifyPower` is a red herring; the `cost` filter inside the
  `notHasCard` condition is the actual cycle. Re-measured on this host: 350 / 1,499 / 16,789 /
  228,271 ms.
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
   gitignored. **Amended 2026-08-19: existing patches are 1–7, not 1–5** — PR #20 landed patches 6
   (`OP06-054` Borsalino) and 7 (`EB03-008` Hibari) after this plan was written, so the patches
   below are 8+. **Amended again 2026-08-20: patches are now 1–14** (Phase 1 added four:
   `battle: neither player may attack on their own first turn`, `counter-policy: …`,
   `bot-harness: resolve the counter step through the counter policy`, plus the two-file fixture
   flag). **CITE PATCHES BY NAME, NEVER BY NUMBER** — two clean-merging branches have already
   renumbered each other once, and a number in prose goes stale silently while a name does not.
3. **Nothing goes to any external repository, and it is never proposed.** Standing rule, Ping
   2026-08-19.
4. **Phases 1 and 2 are one unit.** Every rules fix invalidates the ladder, the play/draw split and
   the mirror validations, so they are batched and re-measured once. **Status 2026-08-20: BOTH ARE
   DONE.** Phase 2 re-measured the ladder, the play/draw split and the puzzle suite against the merged
   Phase 1 tree in one pass, validating the instrument against the published pre-Phase-1 figure before
   reading any comparison. `docs/simulation.md`'s older ladder and play/draw sections now carry
   supersession pointers rather than being deleted.
5. **No new calibration constant ships unlabelled.** Anything tunable is named in
   `docs/simulation.md` as a knob, in the same category as `SIM_TURN_BUDGET`, and never quoted as a
   measured result.
6. Report measured numbers, not expected ones. If a phase's result contradicts this plan, the result
   wins and the plan is amended in place, as Task 2 of the batch-2 plan was.

## Phase 0 — make the primary deck affordable to simulate

### Task 0.1 — fix `OP16-017`'s exponential ~~power~~ COST evaluation
Patch 8 (see the amendment to constraint 2). **DONE 2026-08-19.**

**The plan's stated mechanism was WRONG, and the profiling instruction is what caught it.** This
section assumed power recursion, from the card's `modifyPower … self: true`. Instrumented call
counts show `getPermanentModifierTotal:power` is called **exactly once** at every copy count, before
and after. The blowup is entirely on the **cost** path: `getPermanentSetCost` evaluates every
permanent effect's `conditions` *before* checking whether that effect has a `setCost` action, and
`OP16-017`'s condition carries a `{ filter: "cost" }` scan of your own character zone. So cost
evaluation evaluates a condition it then discards, and that condition asks for the cost of every
sibling copy. The existing guard is keyed `${type}:${instanceId}`, which breaks the direct self-cycle
but not re-entry across permutations of siblings.

**The fix is therefore neither a recursion guard nor a cache** — both were the right instincts for
the assumed mechanism, and both are unnecessary for the real one. It is a three-line pre-filter that
skips an effect before evaluating conditions whose result is discarded, mirroring what
`getPermanentModifierTotal` already does 40 lines above in the same file. That is why constraint 1
holds without argument: the skipped computation had no consumer.

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
**DONE 2026-08-20**, patch `battle: neither player may attack on their own first turn`. The condition
is `state.turnNumber === (seat === state.config.firstPlayer ? 1 : 2)` — "this seat's own first turn",
keyed on `config.firstPlayer` exactly as the first-turn DON!! rule in `state.ts` is.

**Verified on a REAL match** driven through 猜拳, mulligan and startGame, four turns, each seat in
each role (`config.firstPlayer` is discarded by the engine, so the probe picks the winner's
`chooseFirstPlayer` deliberately): `offered=false` on turns 1 and 2, `true` on 3 and 4, both ways
round. Engine suite **3666 files / 6079 tests / 0 failures**, identical to the pre-Phase-1 baseline.

**THIS SECTION'S PREDICTION WAS WRONG AND THE RESULT WINS.** The batch-2 puzzle fixtures did **not**
break: they seat south as the SECOND player at `turnNumber: 1`, and south's own first turn is turn 2,
so their attacks stay legal and both puzzle tables are byte-identical. The SOLVABLE guards therefore
had nothing to catch — not because they are wrong, but because the breakage was somewhere else.

What broke was **39 tests in 31 files**, all `declareAttack failed: The selected attacker cannot
attack.` — 5 in upstream `src/cards`, 21 in upstream `tests/cards`, 5 in our grafted OP15/OP16 tests
— each a fixture that starts at `turnNumber: 1`, plays one `endTurn`, and attacks with the other seat
on turn 2. The cause is that **a fixture's turn counter is not the game's**:
`createTestMatchState({ skipSetup: true })` materialises an arbitrary mid-game board and leaves
`turnNumber` at 1. `buildConfig` already suspends three other opening-turn rules for that reason, so
this adds a fourth — an opt-in `allowFirstTurnAttacks`, set by the fixture builder and nothing else.
Real matches build configs directly and are banned as the rules require.

Two alternatives measured and rejected: expressing the ban as `turnNumber <= 2 && activeSeat === seat`
would rewrite most of the suite (**1020 of the 1248 test files that declare an attack use the seat
trick**), and starting fixtures at `turnNumber: 3` silently un-sickens the 15 fixtures that use
`playedOnTurn: 1` to mean "played this turn". **Cost of the flag, stated:** no fixture exercises the
ban, so the probe walks a real match AND asserts the flag's presence, or deleting it would silently
revert those 39 tests.

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

**DONE 2026-08-20.** `src/automation/counter-policy.ts`, written by
`counter-policy: the defender's counter step, with every knob in a config object` and called from one
branch in `resolveBotPromptCommand`. Every parameter resolves defaults ← `OPCG_COUNTER_*` ←
`setCounterPolicyConfig()`, and `./scripts/simulate.sh --counter avg-cost=3` plumbs the environment
side, so a sweep needs no code edit. Knob table in `docs/simulation.md`.

**One design decision this plan did not anticipate: counter EVENTS are OFF by default.** An Event's
`[Counter]` power grant is applied by a SECOND (`selectTargets`) prompt, which this same resolver
answers with `Math.min(max, min)` = the empty selection — so spending one trashes the card and grants
nothing. That is a targeting defect, not an evaluation choice, and it is out of Phase 1's scope.
`useEventCounters` exists and is `false`; character counters are exact integers, so the arithmetic is
exact without it.

**Verification, done:** a `counterPlay` block in `sim/puzzles.test.ts`, engine-adjudicated, reported
apart from the ladder totals (the resolver never sees a strategy, so scoring it as policy quality
would be a category error). Four positions — never spend a set that cannot flip the battle, always
counter lethal, spend the fewest cards that flip it, and tank while life is comfortably above R —
plus the `enabled: false` control arm, the env plumbing, and a `runBotMatch` wiring check with 0
illegal commands. The R-dependent middle is NOT asserted; `counter-tank-early` instead has to hold at
every `avgCost` from 1 to 10, which is a statement about the policy rather than about the knob.

**Nine mutants, one expected survivor, and one guard that had to be hardened because of them.** The
first `counter-cannot-flip` position sat at 3 life, where the tank rule declines anyway — so accepting
counter sets that cannot flip the battle passed it. Moved to 0 life, where every override wants to
counter and only the never-waste rule holds it back, it kills that mutant. The expected survivor is
the lethal override itself: at 0 life the hard floor and the R rule both fire, so it is redundant
belt-and-braces rather than a load-bearing branch, and no position can isolate it.

### Task 1.3 — leave blockers and triggers alone, in writing
Blocking has no waste-free rule (it trades a permanent for ~2 cards of hand) and declining a
`[Trigger]` is a genuine value call. Both stay as they are and are documented as **open policy
surfaces**, not oversights. Do not silently fix either.

**DONE 2026-08-20.** Written up in `docs/simulation.md` ("Task 1.3 — blocking and `[Trigger]` are
OPEN POLICY SURFACES") and in CLAUDE.md, and pinned by
`the prompt resolver never blocks, and always activates a [Trigger]` in `sim/puzzles.test.ts` — which
now also asserts that a real `[Trigger]` life card is offered BOTH `activate` and `skip` and that the
resolver takes `activate`, so the surface cannot change silently.

## Phase 2 — re-measure the baseline once

### Task 2.1 — dominance ladder, full round robin
All 10 pairs, 200 games, post-Phase-0/1. Keep the round robin **complete**: pairwise strength need not
be transitive, so a total order may only be stated when every pair has been played.

**DONE 2026-08-20, and the round robin earned its keep: THERE IS NO LONGER A TOTAL ORDER TO STATE.**
`valueRanked > { greedy ≈ firstLegal } > { random, passOnly }`, with `random` and `passOnly`
unordered. `greedy > firstLegal` became a tie (49.33% [45.35, 53.33] over 600 games) and
`random vs passOnly` became 200/200 timeouts — a 100% double-loss stalemate that orders nothing.
`valueRanked > greedy` fell from 76.0% to **56.50% [52.50, 60.41]**.

**Two amendments to how this task should be read in future.** First, "played" is not enough — two
cells came back with CIs straddling 50 and had to be EXTENDED by 400 games at a fresh seed before
anything could be said about them. A round robin at n=200 can leave a pair unresolved, and an
unresolved pair is not a tie. Second, the collapse was attributed with a 2×2 rather than reported
bare: the attack ban costs −10.5 pts of it, the counter policy −15.5, both together −18.5. The
instrument was validated first by reproducing the published 76.0% exactly.

### Task 2.2 — play/draw, and the question currently unanswered
Re-measure the play/draw gap. This is where the magnitude of the second-player illegal-attack bias
gets answered. Direction is known (every prior figure **understates** first-player advantage);
magnitude is not, and must not be guessed before this run.

**DONE 2026-08-20. The magnitude is +52.50 pts [43.31, 62.04]** on `mihawk-green-proxy` and **+26.00
pts [17.16, 35.02]** on `ace-op16` — four paired arms, 400 games each on identical seeds, one rule
changed at a time. **The direction recorded in this plan was right and its framing was far too
gentle:** the bug was not shading the gap, it was cancelling it and pushing it negative. On the
primary deck the pre-fix gap was **−28.50 pts** — the second player substantially favoured — against
**−2.50 pts** now.

**AN UNPLANNED FINDING THAT CHANGES THIS TASK'S PREMISE: the gap is deck-specific, and the deck this
project has always measured it on is the wrong one.** Identical rules and seeds, 400 games:
`ace-op16` **−2.50 pts**, `mihawk-green-proxy` **+34.50 pts**. The plan inherited "8.5 pts on a real
Block 2+ deck" as if a single deck answered the question; it does not. `mihawk-green-proxy` is a proxy
of OP09–OP14 stand-ins and behaves like the degenerate end of the interaction scale — the same lesson
this plan already carried about ST01, one rung up. Use `ace-op16` for play/draw; keep the proxy for
the ladder, where the deck cancels.

### Task 2.3 — puzzle suite
Repair the fixtures from Task 1.1, re-run, and either confirm batch 1's published numbers
(valueRanked 6/6, greedy 6/6, firstLegal 5/6, random 0/6) or document exactly what moved and why.

**DONE 2026-08-20. Batch 1 confirmed exactly — 6/6, 6/6, 5/6, 0/6 — and batch 2 unchanged.** Nothing
moved under two rules fixes and a new counter policy.

**"Repair the fixtures from Task 1.1" had nothing to repair**, because Task 1.1 established they never
broke. They were moved off turn 1 anyway, and the value is not the move: the re-run is byte-identical
cell for cell, which proves the answers never depended on being at turn 1, and with
`allowFirstTurnAttacks` forced false the suite still passes 7 of 8 — the only failure being the
assertion that deliberately pins the flag's presence. So the puzzle suite no longer depends on the
fixture exemption, verified rather than argued.

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
