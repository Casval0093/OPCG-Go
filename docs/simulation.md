# The simulation system

Status 2026-08-17: **working. Real Block 2+ decks simulate end to end at 100% completion.**

Getting there took finding and fixing one missing branch in the engine's bot prompt resolver, which
had been abandoning 88% of games on modern decks. See "The blocker was one unimplemented prompt
kind". That is a policy-legality problem, and none of `docs/engine-audit.md`'s four options — all
about throughput — would have found or fixed it.

```bash
./scripts/simulate.sh --games 400                       # ST01 mirror, the validation case
./scripts/simulate.sh --a DECK --b DECK --games 2000    # a matchup
./scripts/simulate.sh --a A.json --compare A-tech.json --b OPP.json --games 2000
```

## What it measures, and why it is not "win rate"

Built against the rulebooks, not against intuition. From **官方公认赛赛事守则 V1.6.0 §II**, the SC
tournament rules Ping's event runs under:

> 在各对战中，如果在宣布的结束时间到来时还没有决定胜负，则不进行胜负判定，该对战结果为**双方败北**。

**If the round clock expires with no winner, both players lose.** Not a draw. Three consequences:

1. An unfinished game is strictly worse than a coin flip, for both decks.
2. A win rate computed over *decided* games only would systematically flatter slow decks. Every
   game therefore resolves to `win | loss | timeout`, and timeout counts against both.
3. The 30-minute clock is not a soft preference for tempo. **Failing to close is a loss on your
   record**, which is sharper than the charter's original wording.

Extra turns exist **only in finals and elimination brackets**, never in Swiss rounds: +3 turns if
time is called on the first player's turn, +2 on the second player's, then tiebreak by **Life count
→ deck count → rock-paper-scissors**. Ping's event is Swiss + top cut, so both regimes apply and
they score differently. The Life-count tiebreak also gives Life a terminal value in the cut that
the bot policy ignores entirely.

**The turn budget is an uncalibrated proxy.** The engine has no wall clock, so real minutes are not
simulable. `--turn-budget` caps turns and calls the rest timeouts; the mapping from turns to 30
minutes has *not* been measured against real games. Until it is, treat the timeout column as a
sensitivity knob and use the reported turn distribution to apply a threshold afterwards. Observed
so far: ST01 mirror games run a **median of 7 turns**, so the default budget of 40 never binds.

## Two engine facts that would have silently corrupted every result

**1. `MatchConfig.firstPlayer` is discarded.** It only sets the initial `activeSeat`. The engine
models the 猜拳 roll of Comprehensive Rules 5-2-1, and the winner's `chooseFirstPlayer` command
overwrites it during setup. Evidence: forcing the config to `south` and to `north` produced
**byte-identical** results — same win rate, same median turns, same mean commands. A strategy
wrapper cannot intercept it either, because `runBotMatch` consumes that command from its prompt
queue before any strategy is consulted.

Worse, the outcome is **deterministic**: over 120 games, north led every single one.

So turn order is controlled by **seat assignment** — north always leads, so seating a deck north
puts it on the play. The mirror test is what makes this safe: identical decks must produce ~50%
overall, which they do.

**2. Card ids resolve through a runtime registry** populated as a side effect of importing
`@tcg/op-cards`. Decks are id strings, so without that import every lookup throws.

## Mirror validation

ST01 vs ST01, `valueRanked` both seats, 400 games, seats alternated strictly by index:

| | win rate | 95% CI | n |
|---|---|---|---|
| overall | **46.75%** | [41.91%, 51.65%] | 400 |
| on the play | 74.00% | [67.51%, 79.59%] | 200 |
| on the draw | 19.50% | [14.61%, 25.54%] | 200 |

**The overall interval contains 50%**, which is the symmetry the mirror has to satisfy. Before the
seat fix it read 25% with all 120 games on the draw — the harness was measuring turn order and
calling it deck strength.

## The blocker was one unimplemented prompt kind

A Block 2+ mono-green deck abandoned **88% of games** at turn 2 with `illegal-command`. A vanilla
control — same leader, colour, set range and deck size, differing only in having no card effects —
completed 100%. So effects were the cause.

`sim/prompt-diag.test.ts` replays the match loop manually and reports the engine's own rejection
reason per prompt kind. 20 games:

| choiceKind | seen | rejected |
|---|---|---|
| selectCards | 149 | 0 |
| confirm | 51 | 0 |
| costPayment | 23 | 0 |
| **orderCards** | **17** | **17** |
| selectTargets | 16 | 0 |
| chooseOption | 13 | 0 |

**`orderCards` failed 100% of the time**, with *"Prompt resolution could not be applied."*

`resolveBotPromptCommand` branches on four of the six `ChoiceKind`s and lets the other two fall
through to `optionId = prompt.options[0]?.id`. That fall-through is fine for `chooseOption` —
picking an option is what it wants, and it never failed. It is meaningless for `orderCards`, which
needs a full permutation in `selectedIds`. One rejected command is fatal to `runBotMatch`, so a
single missing branch abandoned seven games in eight.

The fix is ~8 lines and lives in `tools/patch_engine.py`, re-applied by `scripts/bootstrap.sh`
because `vendor/` is gitignored and recreated. A/B on the same 20 games:

| resolver | games completed | prompts resolved | rejected |
|---|---|---|---|
| stock | **3/20 (15%)** | 252 | 17 |
| patched | **20/20 (100%)** | 890 | 0 |

The engine's own suite still passes unchanged (2632) with the patch applied. **This belongs
upstream** — `TheCardGoat/tcg-engines` is MIT and the bug is in their harness, not in our use of it.

Ordering cards *well* is a strategy question and identity order is a placeholder. Ordering them
*legally* is not, and that is all this fixes.

## Every play/draw number below predates the first-turn DON!! fix — 2026-08-19

`tools/patch_engine.py` patch 4 corrects a rules bug: the engine placed 2 DON!! every DON!! Phase
including the first player's first turn, where the rule is 1. So **the first player in every run
recorded on this page held a turn-1 DON!! surplus.**

**Re-measured after the fix, and the practical effect is small:** Mihawk proxy mirror, 160 games,
post-fix — overall **50.63%** [42.95%, 58.27%] (contains 50%, as a mirror must), on play 55.00%, on
draw 46.25%, **gap 8.75 pts**. The figure recorded below for a real Block 2+ deck was **8.5 pts**, so
the fix does not move this deck's play/draw gap out of noise. The rules were wrong; the measured
first-player advantage was not materially inflated by it. Other decks are unmeasured — a deck that
leans on a turn-1 play is where the surplus would have mattered most.

## Play/draw gap: an earlier conclusion here was wrong

An earlier version of this document claimed the policy "exaggerates the first-player advantage by
roughly an order of magnitude" and that matchup numbers were therefore unusable. **That was
measured on degenerate decks and does not hold.** Corrected picture:

| Deck | play/draw gap | completion |
|---|---|---|
| ST01 starter (Block 1) | 54.5 pts | 100% |
| Green Block 2+, vanilla control (no effects) | 26.7 pts | 100% |
| **Green Block 2+, real cards, patched resolver** | **8.5 pts** | **100%** |

8.5 points is a plausible first-player advantage for OPTCG, where going first also costs you a draw
(Comprehensive Rules 6-3-1). The gap tracks how much *interaction* a deck has: a starter deck and a
vanilla pile have no blockers, counters or removal worth speaking of, so whoever attacks first
snowballs unopposed. Give the policy real defensive tools and it uses them.

The lesson is about the validation deck, not the policy: **a degenerate deck produces degenerate
calibration.** ST01 was chosen because it ships with the engine and cannot rot, which makes it a
good smoke test and a bad calibration target.

This weakens — it does not settle — the case for Option A/B over Option C in
`docs/engine-audit.md`. The trigger stated there is "calibration proves heuristic play distorts
matchup results", and the distortion now looks far smaller than it did an hour ago. The honest
position is that policy quality is still unmeasured: a plausible play/draw split shows the policy
is not obviously broken, not that it plays well.

## First tech-slot A/B — and why its headline number is not real

Swapped 4x `OP13-024` Gordon (1-cost, 0 power, 2000 counter) for 4x `EB04-016` Bird Neptunian
(5-cost, 7000 power, **no counter**) in the Mihawk proxy, 400 paired games per arm:

| | win rate | timeouts/unfinished | median turns | mean commands |
|---|---|---|---|---|
| A (proxy) | 53.75% | 0 | 9 | 119.9 |
| A′ (tech) | 25.25% | **208 / 400** | 7 | **487.2** |

Paired difference **−28.50 pts, 95% CI [−33.95, −23.05]**, 156/400 discordant pairs.

**Do not quote that number.** A′ hit the 800-command ceiling in 52% of games, and the harness was
scoring command exhaustion as a clock timeout — a double loss. So most of the "effect" is the
policy failing to close games, not the cards being worse. The swap probably *is* bad (it removes
four cheap counters and worsens the curve), but this run cannot say by how much.

Fixed: `timeout` now means the turn budget only, `unfinished` means our ceiling or an engine
give-up, and unfinished games are excluded from win rates and skipped in paired differences rather
than scored as losses.

**Re-run on the same decks confirms the fix inverts the conclusion:**

| | paired difference | verdict |
|---|---|---|
| before | **−28.50 pts**, CI [−33.95, −23.05] | "A′ is WORSE, significant at 95%" |
| after | **−6.25 pts**, CI [−27.93, 15.43] | not significant — 14/30 pairs skipped as unfinished |

The corrected run reports the unfinished rate loudly (46.67%) and says it does not know, which is
the true answer from 16 usable pairs. The lesson is the same as the earlier `termination`
conflation, one level down — **a tool limit that looks like a rules outcome will manufacture
statistically significant results.** The first version of this harness would have told Ping, with
95% confidence, to keep a card on the strength of an artefact.

**Throughput reality check.** That run took **11,045 s for 800 games — 0.07 games/s**, against the
~2 games/s the section below assumes. Decks the policy cannot close are ~30x slower, because games
run to the command ceiling instead of ending. The 4,400-games-per-arm estimate below therefore
holds only for decks that finish cleanly; budget an order of magnitude more for anything that
stalls, or fix the policy first.

## Statistical design

**Common random numbers.** A tech slot changes 1–2 of 50 cards, so the effect is small and the
noise is not. `--compare` runs both arms over the *same* seed sequence, pairing each game with its
twin: identical shuffles, identical opponent draws, differing only by the swapped cards. The
reported interval is on the mean of per-seed differences, which is far tighter than differencing
two independent samples. Only discordant pairs carry information, and the count is printed.

**Sample size.** Unpaired, detecting a 3-point difference at 80% power and 95% confidence needs
roughly `2 × 7.85 × 0.25 / 0.03² ≈ 4,400 games per arm`. At the measured ~2 games/s that is about
35 minutes per arm single-core, so ~70 minutes per matchup and ~7 core-hours to sweep a six-deck
field — feasible overnight on one core, comfortable on several. Pairing should cut this
substantially; the achieved reduction is not yet measured because a real two-deck comparison needs
the OP15/OP16 encodings.

**Wilson intervals** throughout, not the normal approximation, since win rates near 0 and 1 appear
in the play/draw split.

## Policy quality, step 1: the dominance ladder

`./scripts/policy_ladder.sh [GAMES] [DECK]`, 200 games per pair, deck
`sim/decks/mihawk-green-proxy.json`, 2026-08-19. **Both seats play the same deck, so the deck cancels
and the win rate is a read on the policy rather than on the list.** This required per-deck strategies
(`--strategy-a` / `--strategy-b`); the policy binds to the *deck*, not the seat, because `aSeat`
alternates by game index to control turn order and a seat-bound policy would make deck A swap
policies mid-run.

| A | B | A wins | 95% CI | timeouts |
|---|---|---|---|---|
| valueRanked | greedy | **76.0%** | 69.6 – 81.4 | 0 |
| valueRanked | firstLegal | 95.5% | 91.7 – 97.6 | 0 |
| valueRanked | random | 100.0% | 98.1 – 100 | 0 |
| valueRanked | passOnly | 100.0% | 98.1 – 100 | 0 |
| greedy | firstLegal | 92.0% | 87.4 – 95.0 | 0 |
| greedy | random | 100.0% | 98.1 – 100 | 0 |
| greedy | passOnly | 100.0% | 98.1 – 100 | 0 |
| firstLegal | random | 98.0% | 95.0 – 99.2 | 0 |
| firstLegal | passOnly | 100.0% | 98.1 – 100 | 0 |
| **random** | **passOnly** | **89.0%** | 83.9 – 92.6 | **22** |

**Total order, now measured rather than assumed:**

> **passOnly < random < firstLegal < greedy < valueRanked**

All 10 pairs were played, every pair has a decisive winner, and the win counts come out 4-3-2-1-0
with **no cycles**. That last part had to be checked rather than assumed: pairwise policy strength
need not be transitive, and an earlier 8-pair version of this table stated the same order while
never having played `random` against `passOnly`.

**The pair that mattered went the default's way.** `valueRanked` beats `greedy` **76.0%
[69.6, 81.4]** — the interval excludes 50% decisively, so the extra machinery is real and the sim's
default is **not** "greedy wearing a hat."

**Two prior assumptions were refuted, both previously written down as if known.**

- **`firstLegal` beats `random` 98.0%** — the reverse of the assumed ordering. Picking the first
  legal command is accidentally competent because the legal-command list leads with plays and
  attacks, while `random` throws turns away on `endTurn`/pass. **So `random`, not `firstLegal`, is
  the honest "no policy" control**, and `firstLegal` is not the trivial baseline it looks like.
- **`passOnly`'s timeout behaviour is opponent-dependent, which neither the original claim nor its
  first correction got right.** The original comment said passOnly "mostly produces round-clock
  timeouts"; the first correction replaced that with "0 timeouts, it loses outright", measured on a
  table where passOnly only ever faced competent opponents. The round robin shows both were wrong as
  stated: **9 pairs produced 0 timeouts, and `random vs passOnly` produced 22 (11%)**. A competent
  opponent kills passOnly quickly; when *both* sides are incompetent neither can close inside the
  budget and the game is scored `timeout` = double loss.
  **Do NOT call this a validation of the 30-minute clock.** An earlier version of this line did, and
  it contradicted this document two sections away: the timeout trigger is `turns > turnBudget` with
  `turnBudget` defaulting to **40 turns**, and "the turns-to-minutes mapping is unmeasured, so the
  timeout column is a knob, not a prediction." **The 11% is a sensitivity to a configured threshold,
  not a real-world timeout rate**, and it must not be quoted as one. What the run *does* support is
  narrower and still worth having: the harness's timeout **scoring path** fires only when neither
  side can close, and scores it as a double loss rather than a win — the right shape for 双方败北.
  Whether 40 turns is the right threshold needs timed games.

### The first-turn DON!! fix did not move the ladder

The first run of this table predates patch 4, on an engine that gave the player on the play **2
DON!! on turn one instead of 1**. It also covered only **8 of the 10 pairs**, so the comparison below
is restricted to those 8 — `greedy vs passOnly` and `random vs passOnly` have **no pre-fix baseline at
all** and are first measurements, not re-measurements.

Across the **8 repeated pairs**, every one is within noise of its old figure: `valueRanked vs greedy`
71.5% → 76.0% with overlapping intervals ([64.9, 77.3] vs [69.6, 81.4]), `firstLegal vs random`
97.5% → 98.0%, `greedy vs firstLegal` 94.0% → 92.0%, and the five 100% pairs unchanged. **For those 8,
the mirror design was robust to the rules defect**, as predicted: seats alternate, so the surplus
DON!! fell on both policies equally.

**Nothing is claimed about the two new pairs**, and that matters here rather than being a technicality:
**`random vs passOnly` is one of them, and it is the pair carrying all 22 timeouts.** There is no
pre-fix number to compare it against, so the DON!! fix can be neither credited nor cleared for it.
The numbers above are the post-fix ones throughout; the pre-fix run is cited as evidence nowhere.

### What this does not establish

It is a **floor test**. It shows the ladder is ordered and that `valueRanked` is the strongest of five
simple heuristics. **Being best-of-five weak heuristics is not evidence of playing well**, and nothing
here licenses trusting a tech-slot ΔWR.

**A ceiling inference was drawn here and is RETRACTED.** It read: a 21-point gap between the top two
rungs means the policy is nowhere near saturated, because a near-ceiling policy would have the next
rung close behind. **That reasoning is invalid** and labelling it "inference" did not rescue it. The
gap between rung N and rung N−1 measures the *spacing of five arbitrarily chosen heuristics*, not the
distance from rung N to the ceiling: **if `valueRanked` were already optimal and `greedy` simply poor,
the same 21 points would appear.** The premise that rungs are evenly spaced up to the ceiling is
unfounded — the rungs were picked by hand from whatever the engine happened to ship.

Nothing in this experiment bears on absolute quality, and **no ladder result may be used to argue for
or against buying throughput.** Distance from the ceiling requires a ceiling: steps 2 (puzzle suite),
4 (oracle agreement) or 5 (human benchmark).

**The decision rule survives on independent grounds, which is why the retraction does not change
it.** "Measure quality before buying speed" rests on the bias argument — a policy that cannot use a
conditional card systematically under-reports every tech card's ΔWR, and precision does not repair
bias. That argument never depended on the ladder.

Next: step 2, the puzzle suite, which is the first measurement that can say something about absolute
quality rather than relative ordering.

## Policy quality, step 2: the puzzle suite

`./scripts/simulate.sh --puzzles`. Unlike the ladder, a puzzle has a single defensible answer, so the
score is **absolute** — no opponent, no statistics, and a failure names the broken decision class.

**Every puzzle is guarded, because a puzzle that cannot fail is worse than none:** SOLVABLE (some
legal command satisfies the answer) and DISCRIMINATING (some legal command does not). Both are
asserted at run time and the suite throws if either fails. The whole ladder is then run against the
suite so puzzle *difficulty* is visible: if `random` solves it, it is too easy to be diagnostic.

| puzzle | valueRanked | greedy | firstLegal | random | passOnly | correct/legal |
|---|---|---|---|---|---|---|
| lethal-bare | pass | pass | pass | FAIL | FAIL | 2/3 |
| lethal-decoy-body | pass | pass | pass | FAIL | FAIL | 2/5 |
| lethal-reaching-attacker | pass | pass | pass | FAIL | FAIL | 2/4 |
| lethal-leader-rested | pass | pass | **FAIL** | FAIL | FAIL | 1/3 |
| futile-unbeatable-body | pass | pass | pass | FAIL | FAIL | 2/5 |
| futile-pick-any-productive | pass | pass | pass | FAIL | FAIL | 4/7 |

`valueRanked` **6/6** — lethal 4/4, futile 2/2.

### The suite is working and too easy, and that is the finding

**The floor result is real:** this is the first *absolute* statement about the policy. `valueRanked`
does not blunder basic lethal recognition or waste attacks on bodies it cannot beat. Step 1 could not
say that.

**But `greedy` also scores 6/6, so these puzzles cannot explain the 76% ladder gap.** Whatever
`valueRanked` does better is not in this sample. And `firstLegal` — "submit the first legal command" —
solves 5 of 6, which puts the suite near the bottom of the difficulty range. Only
`lethal-leader-rested` separates it.

So step 2 has established a floor and **not** met its real goal, which was to explain where the ladder
gap comes from. The next batch has to target where `greedy`'s myopia specifically fails — sequencing
across a turn, DON!! allocation, choosing between a K.O. and leader damage on a board where only one
is right, holding a counter rather than spending it. Those need more setup per position than an
attack-only puzzle. **Do not read 6/6 as "the policy is good."**

### The answer is adjudicated by the engine, not by a hand-written predicate

The first version of this suite hard-coded one puzzle's answer as "an attack by the 8000 body". That
**misclassified a winning command**: south's own 5000 leader is a legal attacker and reaches a 5000
leader on 0 life, so it wins outright. The puzzle reported 1/4 correct instead of 2/4, and `firstLegal`
was marked FAIL on a puzzle it had actually solved.

**The SOLVABLE/DISCRIMINATING guards cannot catch that**, and it is worth being precise about why: both
were satisfied: a correct answer existed and an incorrect answer existed. The guards detect *broken*
and *vacuous* positions, never a *mislabelled* one. Only the engine knows which commands win, so the
engine is now asked — a candidate command is applied and the resulting state inspected (`winner`,
opponent life delta, opponent bodies K.O.'d). Verified that battles resolve fully inside
`applyCommand` here, with no pending prompts, because the bodies are vanilla and the defender's hand
is empty.

`lethal-leader-rested` is the variant that preserves the original intent: with the leader rested, the
8000 body is the only winning command, and that is the one puzzle `firstLegal` still fails.

### The valueRanked baseline is asserted, not just printed

Each puzzle declares `expect: "pass" | "fail"` for `valueRanked` and the suite throws on a mismatch in
either direction. Before this, a regression from 6/6 to 0/6 still exited 0 — the primary result could
be lost silently. Lower rungs stay diagnostics only; their scores calibrate difficulty and nothing
more. Both directions were mutation-checked: flipping an `expect` to `"fail"`, and inverting the
adjudicator, each turn the suite red.

### Two classes, both verified against engine source first

Written only after checking `battle.ts`, not from memory of the paper rules:

- **lethal** — `if (defender.life.length === 0)` plus a connecting attack makes the attacker the
  winner. So lethal means 0 life cards *and* an attack that reaches.
- **futile** — `if (battle.attackPower >= battle.defensePower)` gates all damage, and the else branch
  does nothing to the attacker. **There is no mutual destruction in this game**, so "suicide attack"
  is not a real class; the real error is spending an attack on a body you cannot beat while a
  productive attack exists. A puzzle class was dropped on this basis before being written.

## Policy quality, step 2, batch 2: the classes that separate the policies

Batch 1 established a floor and admitted it was too easy: `valueRanked` and `greedy` both scored 6/6,
so nothing in it explained the 76% ladder gap. Batch 2 adds three classes aimed at where a greedy
one-command-at-a-time heuristic should break down — DON!! allocation, command order within a turn,
and choosing between a K.O. and leader damage. 14 positions total.

| puzzle | class | valueRanked | greedy | firstLegal | random | passOnly | correct/legal |
|---|---|---|---|---|---|---|---|
| lethal-bare | lethal | pass | pass | pass | FAIL | FAIL | 2/3 |
| lethal-decoy-body | lethal | pass | pass | pass | FAIL | FAIL | 2/5 |
| lethal-reaching-attacker | lethal | pass | pass | pass | FAIL | FAIL | 2/4 |
| lethal-leader-rested | lethal | pass | pass | **FAIL** | FAIL | FAIL | 1/3 |
| futile-unbeatable-body | futile | pass | pass | pass | FAIL | FAIL | 2/5 |
| futile-pick-any-productive | futile | pass | pass | pass | FAIL | FAIL | 4/7 |
| don-attach-before-attack | donAllocation | **FAIL** | pass | FAIL | FAIL | FAIL | 1/8 |
| don-pick-the-body-that-reaches | donAllocation | pass | pass | FAIL | FAIL | FAIL | 4/38 |
| don-concentrate-to-reach | donAllocation | pass | pass | FAIL | FAIL | FAIL | 10/209 |
| seq-attach-then-swing-for-lethal | sequencing | **FAIL** | pass | FAIL | FAIL | FAIL | 1/8 |
| seq-spread-not-concentrate | sequencing | **FAIL** | **FAIL** | FAIL | FAIL | FAIL | 6/209 |
| ko-or-die-single-threat | koVsDamage† | FAIL | FAIL | FAIL | FAIL | FAIL | 4/12 |
| ko-or-die-pick-the-attacker | koVsDamage† | FAIL | FAIL | FAIL | FAIL | FAIL | 21/67 |
| ko-or-die-thin-the-swarm | koVsDamage† | FAIL | FAIL | FAIL | FAIL | FAIL | 12/23 |

† architecture probe, excluded from the policy totals — see below.

**Policy totals (11 scored positions):** `greedy` **10/11**, `valueRanked` **8/11**, `firstLegal`
5/11, `random` 0/11, `passOnly` 0/11.
**`valueRanked` by class:** lethal 4/4, futile 2/2, donAllocation 2/3, **sequencing 0/2**.

### Batch 2 separates the two top policies — and the default one loses

This is the finding, and it is not the one the batch was designed to get. The plan asked for puzzles
`greedy` fails. What the run shows is the opposite: **`greedy` beats `valueRanked` 10/11 to 8/11**,
and every point of the gap is command ORDER.

The mechanism is in the scoring tables in `bot-strategies.ts`, and it is exact:

- `valueRanked` scores `declareAttack` at `600 + 300 (target is a leader) + 150 (best attacker)`, plus
  **`+100` when the attacker's PRINTED power is ≥ 5000** — total **1150**. It scores `attachDon` on
  that same body at `400 + 150 + 100 + 400` = **1050**.
- `greedy`'s two scores are `500 + 200 + 100` = **800** and `300 + 100 + 100 + 300` = **800** — a tie,
  broken by the stable sort in favour of whichever descriptor `legal.ts` emitted first, and
  `legal.ts` emits every `attachDon` (line 152) before every `declareAttack` (line 171).

So for any attacker printed 5000 or more, **`valueRanked` swings before it buffs**, and the DON!! is
then attached to a body that has already rested and attacked. `greedy` ties and buffs first. Both
`donAllocation` and `sequencing` failures are that one behaviour: in
`seq-attach-then-swing-for-lethal` it costs `valueRanked` the *game* — the buffed swing is lethal and
it plays the two commands in the losing order.

**This does not contradict the ladder, and must not be read as overturning it.** Step 1 measured
whole games and `valueRanked` beat `greedy` 76.0% [69.6, 81.4]. Both results stand. What batch 2
establishes is narrower and still useful: **the ladder gap does not come from DON!! sequencing**, and
in that specific dimension the policy every simulation actually uses is the worse of the two. Where
the 76% does come from remains unmeasured.

`seq-spread-not-concentrate` is a **shared** blind spot: both policies hard-code "concentrate DON!! on
the best attacker", and the position rewards spreading one DON!! onto each of two bodies so both
reach a 6000 Leader. Both fail. Its mirror, `don-concentrate-to-reach`, rewards stacking, and both
pass — the pair exists so neither can be solved by one fixed habit.

### Three engine facts the batch turned up, all found by measurement

**1. No policy can choose an attack target — every attack hits the defending leader.** Written up in
full in its own section below. It is why `koVsDamage` is an architecture probe rather than a policy
class: all five policies fail all three positions for one structural reason, so scoring them as
policy quality would be a category error. They are kept because they demonstrate the *consequence* —
a game lost that the position could have won — and because `expect: "fail"` flips the day target
choice becomes reachable.

**2. The prompt resolver never counters and never blocks.** `resolveBotPromptCommand`'s `selectCards`
branch takes `Math.min(prompt.maxSelections, prompt.minSelections)` — which is always
`minSelections` — and both defensive prompts are built with `minSelections: 0`: the counter step in
`battle.ts:146` and the block step in `engine/queue.ts:52`. So the count is always 0 and the
selection is always empty. Measured, not just read: a defender holding one and then three real
counter cards took the damage both times, and an **active** character with the genuine `blocker`
keyword was offered in the prompt and declined. Asserted now in `the prompt resolver never counters
and never blocks`.
**This is Task 5's answer and it is worse than "the resolver plays counters badly": it never plays
them at all.** Combined with fact 1, simulated combat has *no defensive interaction whatsoever* —
every battle resolves on printed power plus attached DON!!. Every number in this file was measured
under those conditions. Per the architecture note already recorded, counter and blocker use are not
policy decisions in this engine (the strategy never sees a prompt), so this is not a mark against
any rung of the ladder — it is a property of the simulator that biases every matchup it produces.

**3. `OP01-001` Roronoa Zoro — the leader both seats use in all six batch-1 puzzles — is not a
vanilla leader,** and a printed power is not evidence of the power a card plays at. Zoro is
`[DON!! x1] [Your Turn] All of your Characters gain +1000 power`, encoded as a `permanentEffect` keyed
on `donAttached >= 1`, so a single DON!! on the *leader* silently buffs every character. It surfaced
as a 5000 body attacking at 6000 after DON!! went to the leader, which made no sense until the card
was read. The six batch-1 puzzles are unaffected **only** because they hold 0 active DON!! so the
condition cannot fire — `fixture integrity` now asserts exactly that, so adding DON!! to one of them
fails loudly instead of quietly rewriting its arithmetic. Separately, `OP13-003` Gol.D.Roger prints
7000 and **plays at 9000**; a puzzle built on the printed value was silently unwinnable.
**There is no vanilla leader in the game — all 135 have effect text** — so batch 2 screens leaders
for *inertness* instead (`OP16-060`, `OP05-022`, `OP11-040`) and asserts it.

### What is different about how batch 2 is measured

- **Turn mode.** A DON!!-then-swing decision cannot be scored from one command, so batch-2 puzzles run
  the strategy's **whole turn** and judge the resulting position. Batch 1 stays on single-command
  scoring so its published numbers remain comparable; the two modes are never averaged.
- **Guards are exhaustive over the line space, not over single commands.** SOLVABLE and
  DISCRIMINATING are computed by enumerating every legal line the position allows (up to depth 6,
  209 lines for the two-body two-DON!! positions) and playing each one out in the engine. That is
  what the `correct/legal` column counts, and it is why the suite needs a 60s timeout.
- **An opponent-reply puzzle also asserts THREATENED**: passing the turn must actually lose. Without
  it a position where South survives regardless would score every policy "pass" and look clean.
  Doing nothing is played out and checked, per puzzle.
- **`random`'s two columns are not comparable.** Batch 1's published table was measured by calling the
  strategy with no decision context, which makes `randomStrategy` fall back to `() => 0` and always
  take the first descriptor. Turn mode gives it a seeded LCG instead. Feeding real randomness to the
  batch-1 puzzles moved `random` from 0/6 to 4/6 — a change in the measuring instrument, not in the
  policy — so command mode keeps the original context-free call and the original numbers.
- **Every new guard was mutation-checked**, since tests that cannot fail are this project's most
  frequent defect. Five mutants, all confirmed to turn the suite red: flipping an `expect`; giving
  South 9 life so the K.O. position is no longer threatened; swapping the non-inert `OP01-001` in as a
  batch-2 leader; and asserting the counter and blocker resolvers select 1 instead of 0.

### What batch 2 still does not establish

The suite now has a floor across five classes and one confirmed defect in the default policy. It
still says nothing about a ceiling. `greedy` at 10/11 is not evidence that `greedy` plays well — it is
evidence that it plays these eleven positions well, and the positions were built to probe known
heuristic weaknesses rather than sampled from real games. Steps 3–5 of the plan in CLAUDE.md are what
would close that.

### The bot cannot choose an attack target at all — verified 2026-08-19, do not re-derive

**Every attack any ladder policy declares hits the defending leader.** Not by preference — the choice
is not reachable through the code path all five strategies use.

Three source facts compose into it:

- `src/engine/legal.ts:181` emits **one `declareAttack` descriptor per ATTACKER**, with every legal
  target bundled into one `targetIds` array — not one descriptor per (attacker, target) pair.
- `src/automation/bot-strategies.ts:81` — `commandFromDescriptor` turns that descriptor into a
  command with `targetId: descriptor.targetIds[0]!`, **unconditionally**. Every one of the five
  strategies routes its final command through this helper, `randomStrategy` included.
- `src/battle.ts:737` — `legalAttackTargets` pushes the defending **leader first**
  (`const targets = hasRushCharacterOnly ? [] : [defender.leaderInstanceId]`), appending characters
  after it.

So the target is always `legalAttackTargets(...)[0]`, which is the leader whenever the leader is a
legal target. The sole exception is a `rushCharacter`-only attacker on the turn it was played, where
the leader is excluded and `targets[0]` is a rested character.

Confirmed empirically before this was written up, not inferred from reading alone: on a board where
north's leader **and** a rested 4000 character were both legal targets — the descriptor carrying
`targetIds: [leader, character]` — 200 samples per strategy with varied `random` produced **only**
leader attacks from `valueRanked`, `greedy`, `firstLegal` and `random`. None ever emitted a character
target. (`passOnly` never attacks.)

**This is NOT an engine rules bug and does not belong with the `orderCards` and search-to-hand
defects.** Those produced *illegal* commands and aborted games. This produces legal, blind play: a
limitation of the descriptor→command helper plus the five sample strategies. A strategy may construct
a `declareAttack` command directly and pick its own target; nothing forbids it. Recorded locally only,
per the standing rule on third-party repos.

**What it costs the measurements.** Battle-based removal never happens in any simulated game — boards
shrink only through card effects, never through combat. Every number in this file was measured in that
world. It does not invalidate them as *relative* comparisons between policies that share the
blindness, but the simulated game is systematically racier than the real one.

**It bites the tech-slot objective specifically**, which is the whole reason the simulator exists. A
card whose job is interacting with bodies — the plan's own example, `OP17-016` Rakuyo as anti-aggro
tech — would be evaluated in a world where attacking a body is impossible. This is the failure mode
CLAUDE.md already warns about ("a policy that cannot use a conditional card will report that every
tech card is bad"), now with a concrete mechanism attached. **`random` is not a control for it:** it
shares the same helper, so "even random does not do it" carries no information.

**One existing claim above is weakened by this, and the weakening is real.**
`futile-pick-any-productive` and `futile-unbeatable-body` were passed by policies that attacked the
leader. The `futile` class accepts *any* material gain, and a leader attack always gains material when
the leader is reachable — so those passes **did not** demonstrate target discrimination, and are fully
consistent with a policy that has no target choice whatsoever. The four `lethal` puzzles are
unaffected: their answer is "win", and a leader attack is what wins.

**Consequence for any future puzzle batch.** A `koVsDamage` class — "attacking the leader and K.O.ing
a body are both material but only one is right" — is **not buildable as a policy measurement**. Every
such puzzle is failed by all five policies for one architectural reason, so it would measure the
descriptor API, not policy quality. Build it only as an explicitly labelled API-limitation probe with
all five marked `expect: "fail"`, or give the strategies target choice first.

Attack target selection therefore joins counter play and blocker use (owned by
`resolveBotPromptCommand`, which never receives the strategy) on the list of things that **look** like
policy decisions and are not. What remains genuinely policy-attributable: which attacker to attack
with, DON!! attachment, and the order of commands within a turn.

## What is not done

- **No *meta* matchup yet — but the blocker is gone.** This used to read "every deck in the current
  field is OP15/OP16 and those cards are still shells". **That is no longer true:** OP15/OP16
  encoding completed and was verified 2026-08-19 (119 imported = 119 definitions per set, 0 cards
  unencoded-and-unparked). The Mihawk proxy deck is still OP09–OP14 only because it predates that.
  Real deck-vs-deck calibration against the EN ladder matrix is now *available* and simply has not
  been run — that is step 3 of the policy-quality plan.
- The `orderCards` fix uses identity order, which is legal but not a policy. Ordering
  top-of-deck cards deliberately is real strategy and is unimplemented.
- Policy quality has a **floor** but no **ceiling**. The dominance ladder above orders the five
  policies and shows `valueRanked` clears `greedy` by ~21 points, so it is not broken and not
  trivial. Nothing yet speaks to absolute quality — a plausible play/draw split is a sanity check,
  not a skill test, and neither is beating four weaker heuristics. Steps 2–5 of the plan in CLAUDE.md
  are what would close this.
- The turns-to-minutes mapping is unmeasured, so the timeout column is a knob, not a prediction.
- The bot does not value Life, which the elimination-bracket tiebreak rewards.
- Mulligan policy is whatever the engine's default is; the Comprehensive Rules allow one
  all-or-nothing mulligan (5-2-1-6) and it has not been checked that the bot uses it sensibly.
