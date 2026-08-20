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

> **AND every one of them predates Phase 1 as well. All of it is superseded by "Task 2.2 —
> play/draw, and the magnitude of the illegal-attack bias".** The short version: the second
> player's illegal first-turn attack was worth **+52.5 pts** of play/draw gap on this page's
> usual deck, so the small gaps recorded below were a rules bug cancelling first-player
> advantage rather than a measurement of it. The figures below are kept as the record of what
> was measured, not as facts about the game.

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

> **SUPERSEDED for the numbers, kept for the method — see "Phase 2 — the baseline re-measured,
> once".** Everything in this section was measured before the first-turn attack ban and the
> counter policy. Re-measured post-Phase-1: `valueRanked` beats `greedy` **56.5%**, not 76.0%,
> and **the strict total order below no longer holds** — `greedy > firstLegal` is a tie and
> `random vs passOnly` is 100% double losses. Do not quote the chain from this section.

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

**Total order, now measured rather than assumed** — *and RETIRED by Phase 2: post-Phase-1 this is a
PARTIAL order only, `greedy ≈ firstLegal` and `random vs passOnly` unorderable. Do not quote the
chain below.*

> **passOnly < random < firstLegal < greedy < valueRanked**  ← pre-Phase-1 only

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

**Re-run 2026-08-20 after the `setBasePower` primitive changed `getCardPower`: every number above
is byte-identical, class by class and puzzle by puzzle.** It was re-run because the primitive
substitutes a set base power inside `getCardPower`, so the suite is a cheap regression check that
the change did not perturb the positions it does cover.

**Do NOT read it as evidence that live play is unaffected in general, and this is the important
part.** No puzzle contains a card that uses `setBasePower`, so an identical result here is equally
consistent with "nothing was perturbed" and with "the attacking policy could not have noticed", and
this suite cannot distinguish the two. `battle.ts` resolves combat through `getCardPower` and is
correct, so the primitive changed battle OUTCOMES while changing no policy CHOICE.

**The second half of that — the ATTACK-side blindness — HAS SINCE BEEN CLOSED, and the line numbers
this paragraph used to cite are gone.** As written it said `bot-strategies.ts` imports `getCardPower`
zero times and computes power off the printed card at `:169-171`, `:163-164`, `:329-330` and `:342`,
with Phase 1's `counter-policy.ts` (`:415-416`) the lone exception, so the defender saw a set base
power and the attacker did not. The `bot-strategies: the policy compared PRINTED power` patch fixes
exactly that: attacker selection and DON!! concentration now go through `getCardPower`, so a live
`setBasePower` reaches the attacking policy too. **Three of the four sites that paragraph cited are
deliberately still printed, and the fourth — `getTotalPower` — is the one the patch fixes.** The
three that stay are `cardValue`'s hand read, `valueRanked`'s `playCard` hand read, and the
`attacker.power >= 5000` big-body gate; all three are measured decisions rather than omissions.
(The paragraph's "four" was its own citation count, not the total — there were five `.power` sites.)
**Sites are named rather than cited by line, because LINE numbers rot exactly the way patch numbers
do:** the `:163-164` / `:329-330` / `:342` above are PRE-fix positions, and this patch's own
insertion shifted the last two to `:346-347` and `:359`. A reader with either tree checked out would
find one set wrong, so trust the names. See "The decision layer read PRINTED power" below. The puzzle this
paragraph asked for ("closing it starts with a puzzle whose correct attacker is only correct under a
live power-changing effect") is `lethal-effective-power-attacker`, and it was written before the fix
so that it went red first. **Do not re-derive the blindness from this paragraph; it is history.**

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

**2. The prompt resolver never counters and never blocks.** *(Historical, as measured on 2026-08-19.
The counter half was fixed by Phase 1 Task 1.2 on 2026-08-20 — see "Task 1.2 — the counter policy".
The block half is still true and now deliberate. The test named at the end of this paragraph has been
renamed accordingly. Everything above and below this paragraph in the batch-2 section was measured
under the never-counter resolver.)* `resolveBotPromptCommand`'s `selectCards`
branch takes `Math.min(prompt.maxSelections, prompt.minSelections)` — which is always
`minSelections` — and both defensive prompts are built with `minSelections: 0`: the counter step in
`battle.ts:146` and the block step in `engine/queue.ts:52`. So the count is always 0 and the
selection is always empty. Measured, not just read: a defender holding one and then three real
counter cards took the damage both times, and an **active** character with the genuine `blocker`
keyword was offered in the prompt and declined. Asserted then in `the prompt resolver never counters
and never blocks`, now split between `counterPlay` and `the prompt resolver never blocks, and always
activates a [Trigger]`.
**This is Task 5's answer and it is worse than "the resolver plays counters badly": it never plays
them at all.** Combined with fact 1, simulated combat has *no defensive interaction whatsoever* —
every battle resolves on the attacker's power against the defender's, with nothing added by the
defender. (**That sentence used to read "on printed power plus attached DON!!" and it was wrong** —
`battle.ts` has always resolved combat through `getCardPower`, so power-changing effects always
counted in the *outcome*. What read printed power was the POLICY, on the attacker's side only, and
that is a separate defect fixed 2026-08-20 by the `bot-strategies: the policy compared PRINTED power` patch — see "The decision layer read PRINTED power"
below.) Every number in this file was measured
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

### Audited against the Official Rule Manual — 2026-08-19

Everything the batch-2 puzzles and the counter-policy design rest on was checked against the manual
rather than against memory of the paper rules. Confirmed correct in the engine:

- **Attack targets** — "you can either target your opponent's Leader or a **rested** Character".
  Matches `legalAttackTargets`.
- **Damage gate** — "the attacking card will win if its power is **greater than or equal to** the
  power of the card being attacked". Matches `attackPower >= defensePower`; ties go to the attacker,
  and damage is binary with no partial mitigation.
- **Counter Step** — the defender "may perform the following actions in any order and as many times
  as they like". Matches the prompt's `maxSelections = hand size`.
- **Main Phase ordering** — "you may perform actions A to D in any order and as many times as you
  wish". This is what makes the `sequencing` puzzle class legitimate rather than an artefact.
- **DON!! giving** — no limit on the number of times; power is gained "during your turn" only, which
  is exactly `shared.ts:462`'s `state.activeSeat === instance.controller` guard.
- **First player** — places 1 DON!! on their first turn and does not draw. Both already fixed
  (patches 4/5) and now confirmed against the manual.
- **DON!! on a Character leaving the field** returns to the cost area **rested**. Matches
  `koBattleCharacter`.
- **Deck-out** — reducing a deck to 0 loses the game, including the replacement-effect case where a
  Leader wins instead. Implemented as `processEmptyDeckDefeat` (`state.ts:61`). No gap.
- **`[Blocker]` / `[Rush]` / `[Banish]` / `[Double Attack]`** glossary definitions all match the
  engine's keyword handling, including `[Banish]` trashing the life card without its `[Trigger]`.

Two things the audit found:

**1. The second player may illegally attack on their own first turn — FIXED 2026-08-20, Phase 1
Task 1.1 below.** The manual's Battle Flow footnote is *"Neither player can attack on their first
turn."* The engine's only gate was
`state.turnNumber === 1 && state.activeSeat === state.config.firstPlayer`, and turn numbering is per
player-turn, so the second player's first turn (`turnNumber === 2`) passed it. Measured before the
fix:

| turnNumber | seat | that seat's own turn | `declareAttack` offered |
|---|---|---|---|
| 1 | north (first player) | #1 | `false` — correct |
| 2 | south (second player) | **#1** | **`true` — wrong** |
| 3 | north (first player) | #2 | `true` — correct |
| 4 | south (second player) | #2 | `true` — correct |

**Every play/draw figure in this file understates first-player advantage as a result**, because the
second player got one extra attack — the Leader only, since anything played that turn is
summoning-sick. That applies to the 8.5 pts on a real Block 2+ deck, the 26.7 on a vanilla pile and
the 54.5 on ST01. **The fix does not retroactively change those numbers, and Phase 2 has now measured
what it cost them:** +52.50 pts [43.31, 62.04] of play/draw gap on `mihawk-green-proxy` and +26.00
[17.16, 35.02] on `ace-op16`. "Understates" was the right direction and much too gentle a word — on
the primary deck the pre-fix gap was −28.50 pts, i.e. the second player was substantially favoured.

The coupling this section predicted — that fixing it "breaks the batch-2 puzzle fixtures" — **did not
happen, and 39 other tests broke instead.** See "The plan predicted the puzzle fixtures would break"
below; the prediction assumed a formulation of the rule that no reachable game state distinguishes
from the one shipped.

**2. The resolver always activates a `[Trigger]`, which is a real choice it is not making — STILL
TRUE, and deliberately so as of Phase 1 Task 1.3, where it is documented as an open policy surface
and pinned by a test rather than quietly fixed.** The
manual: when your Leader takes damage you check the top life card privately and "may reveal the card
and activate its `[Trigger]` effect **instead of** adding it to your hand", or decline and add it to
hand unrevealed. The engine builds that as `choiceKind: "confirm"` (`battle.ts:197`) with
`activate`/`skip`, and `resolveBotPromptCommand`'s confirm branch takes `activate` unconditionally.
So the bot never banks a Trigger life card. This is the third resolver-owned decision that looks like
policy and is not, after counter play and blocker use.

It also **qualifies the premise behind "tank early, counter late"**: taking damage only funds a later
counter when the life card has no `[Trigger]`, because a Trigger card goes to resolution instead of
hand. The measured probe used a vanilla body, so it showed the full effect; expected hand gain per
damage taken is below 1 in a real deck.

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

## Phase 0 — the primary deck was 99x more expensive per command, and is not any more

Measured 2026-08-19. `OP16-017` LittleOars Jr. made `sim/decks/ace-op16.json` unaffordable to batch,
with a cost **super-exponential in the number of copies in play**. Fixed by the `permanent: getPermanentSetCost evaluates conditions it then discards` patch in
`tools/patch_engine.py`.

### The mechanism was not the one the plan predicted

`docs/plans/engine-fidelity-and-derived-counter-policy.md` and `CLAUDE.md` both recorded this as
**power** recursion, reasoning from the card's `modifyPower -4000 … self: true`. That reasoning was
structural, not measured, and it was wrong. Instrumented call counts for a single `getCardPower` on a
board of N copies show `getPermanentModifierTotal:power` called **exactly once at every N**, before
and after the fix. The blowup is entirely on the **cost** path:

```
getCardCost(C)
  -> getPermanentSetCost(C)
       -> evaluateConditions(source)      for EVERY permanentEffect of EVERY source in play,
                                          including ones with no setCost action at all
            -> candidatePoolForTarget -> matchesTargetFilter   `filter: "cost"`
                 -> getCardCost(C')       a DIFFERENT instance -> re-entry
```

`getPermanentSetCost` evaluates an effect's `conditions` **before** checking whether the effect has a
`setCost` action. `OP16-017` has none — but its `notHasCard` condition carries
`{ filter: "cost", comparison: "gte", value: 8 }`, so cost evaluation computes a condition it then
throws away, and that condition asks for the cost of every sibling. The existing re-entrancy guard is
keyed `` `${type}:${instanceId}` ``: it breaks the *direct* self-cycle but permits re-entry along
every distinct permutation of siblings, so with S copies of the source and T targets the branching is
(S x T) per level.

**So the fix is neither a recursion guard nor a cache**, both of which the plan proposed. It is a
three-line pre-filter that skips an effect before evaluating conditions whose result is discarded —
exactly what `getPermanentModifierTotal` already does 40 lines above in the same file, and the only
one of that file's 14 condition-evaluating functions that did.

### Before / after

`getCardCost` calls for ONE `getCardPower`, instrumented:

| copies of OP16-017 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| before | 2 | 52 | 2,034 | 126,224 | 11,450,650 |
| after | 1 | 4 | 9 | 16 | 25 |

After is exactly N². One `getCardPower` on a constructed board, wall clock:

| copies | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| before | 0.09 ms | 0.62 ms | 22.58 ms | 1,558.71 ms | *not reached* |
| after | 0.08 ms | 0.11 ms | 0.19 ms | 0.39 ms | 0.71 ms |

Deck-level, 1 game at `--turn-budget 6`, seed 7 (`matchup` wall clock, N copies + vanilla filler):

| copies | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| before | 350 ms | 1,499 ms | 16,789 ms | **228,271 ms** |
| after | 287 ms | 600 ms | 940 ms | **1,057 ms** |

216x at 4 copies, and the ×10-per-copy curve is gone. Per-command cost, mirrors at seed 7 — the only
figure comparable across hosts:

| deck | before | after |
|---|---|---|
| `mihawk-green-proxy`, 8 games | 8.24 ms | 5.51 ms |
| `ace-op16`, 4 games | 814.60 ms | 14.12 ms |
| **ace ÷ mihawk** | **98.9x** | **2.56x** |

**Read the 2.56x honestly: the Task 0.1 criterion was "within ~2x" and this is 2.56x, so it misses
the stated target.** The pathology is gone — 98.9x to 2.56x — but `ace-op16` is still measurably more
expensive per command than the Mihawk proxy, which is unsurprising given it is the more
effect-dense list. Do not quote it as "within 2x".

### The fix changes speed and nothing else

`ace-op16` mirror, 4 games, seed 7, turn budget 40, before vs after:

| | before | after |
|---|---|---|
| winner sequence | `L W W L` | `L W W L` |
| per-game commands | `[100, 95, 109, 111]` | `[100, 95, 109, 111]` |
| per-game turns | `[8, 8, 9, 9]` | `[8, 8, 9, 9]` |
| mean cmds / median turns | 103.75 / 9 | 103.75 / 9 |

Identical, including termination reason per game. Engine suite **6078 passed / 0 failed / 10
skipped**; puzzle suite 5/5 across 14 positions. The scaling probe also asserts `power === 4000` at
every board size, so a future "optimisation" that changed the answer would fail rather than pass
quietly.

Why it cannot change results, independent of the measurements: for an effect with no `setCost`
action the inner loop `continue`s on every action, so the effect could never contribute a return
value — the condition's result was computed and discarded. `evaluateConditions` is a pure read
(no assignment to `state.*` anywhere in `conditions.ts`, `targeting.ts` or `permanent.ts`), which is
the same assumption `getPermanentModifierTotal` already relies on.

### Catalog exposure after the fix

Across all 2,537 cards, 12 permanent effects carry a `cost` filter. **No multi-copy character** pairs
one with a cost-path action (`setCost`/`modifyCost`), so the copies term that drives the blowup is
gone. Two single-copy sources remain — `OP05-097` (stage) and `OP10-042` (leader) — and both are
structurally bounded: one source plus the 5-slot character area caps the permutations at
Σ P(5,k) = 325.

### The regression guard is a constructed board, because a deck did not work

`bench/throughput.test.ts` benchmarked only a 4-card synthetic deck and ST01, both effect-light,
which is why this went unnoticed. The first attempt at a guard was a per-command ratio on a deck
running 4 copies of `OP16-017` — and **it passed on the unpatched engine**, at 1.55x ST01. Whether
the blowup happens depends on how many copies are *simultaneously on the board*, and that is decided
by the shuffle: the bench seeds (1000+i) never stacked them, while the sim harness at seed 7 did and
cost 3,682 ms/command on the same 50 cards. The guard even had a non-vacuity check, and the check
passed while the measurement meant nothing — the vacuous-test failure mode one level down.

The guard now **constructs** the board via `OnePieceTestEngine.create` and times one `getCardPower`
at 1–5 copies, ascending, throwing on the first result over `PERMANENT_EFFECT_MS_LIMIT`. That
threshold is a **knob**, in the same category as `SIM_TURN_BUDGET`, and is not a measured result:
250 ms sits ~50x above the worst post-fix value (0.71 ms) and ~6x below the first pre-fix violation
(1,558 ms). Red-green verified: reverting the `permanent: getPermanentSetCost evaluates conditions it then discards`
patch alone fails at 4 copies in ~1.6 s, restoring it
passes. Checking ascending is what keeps a broken engine from grinding 154 s through 5 copies.

## Phase 1 — rules fidelity, and a counter step that is actually a decision

Plan: `docs/plans/engine-fidelity-and-derived-counter-policy.md`. Two engine-fidelity fixes and one
new policy. **Phase 2 re-measures the ladder and the play/draw split once, after both** — every rules
fix invalidates them, so they are batched deliberately and NOTHING on this page's earlier play/draw
or ladder numbers has been re-run yet.

Engine suite across the whole phase: **3666 files / 6079 tests / 0 failures**, identical to the
pre-Phase-1 baseline measured on the same host the same day.

### Task 1.1 — neither player may attack on their own first turn

The manual's Battle Flow footnote is *"Neither player can attack on their first turn."*
`canAttackWith` gated only the first player, and turn numbering is per PLAYER-turn, so the second
player's own first turn is `turnNumber === 2` and sailed through. Fixed by
`battle: neither player may attack on their own first turn` in `tools/patch_engine.py`.

Measured by driving a **real match** through 猜拳, mulligan and startGame, then walking four turns.
`config.firstPlayer` is discarded by the engine, so the probe picks the winner's `chooseFirstPlayer`
command deliberately to get each seat into each role:

| first player | turn | active seat | that seat's own turn | `declareAttack` offered |
|---|---|---|---|---|
| north | 1 | north | #1 | `false` |
| north | 2 | south | **#1** | `false` — was `true` |
| north | 3 | north | #2 | `true` |
| north | 4 | south | #2 | `true` |
| south | 1 | south | #1 | `false` |
| south | 2 | north | **#1** | `false` — was `true` |
| south | 3 | south | #2 | `true` |
| south | 4 | north | #2 | `true` |

Asserted per row by `neither player may attack on their own first turn` in `sim/puzzles.test.ts`,
which prints this table and a second one built from fixtures with the escape hatch below cleared.

**Consequence for every play/draw number above: unchanged so far, and still understating first-player
advantage until Phase 2 re-runs them.** The direction was already recorded; the magnitude is Phase
2's, and guessing it here would be inventing a number.

### The plan predicted the puzzle fixtures would break. They did not, and 39 other tests did

The plan (and CLAUDE.md) said fixing this would break the batch-2 puzzle fixtures, which sit at
`turnNumber: 1` acting as south with `firstPlayer: "north"`, and that the SOLVABLE guards would catch
it. **That is wrong, and the result wins.** Under the rule as expressed — *this seat's own first turn*
is turn 1 for the first player and turn 2 for the second — south seated as the SECOND player at turn
1 is not on its own first turn at all, so its attacks stay legal. The batch-1 and batch-2 tables below
are byte-identical after the fix.

What broke instead was **39 tests in 31 files**, every one `declareAttack failed: The selected
attacker cannot attack.` — 5 in upstream's `src/cards`, 21 in upstream's `tests/cards`, and 5 in our
own grafted OP15/OP16 tests. The shape is always the same: a fixture starts at `turnNumber: 1`,
plays one `endTurn`, and attacks with the other seat on turn 2 — which in a real game is that seat's
own first turn.

The cause is that **a fixture's turn counter is not the game's turn counter.**
`createTestMatchState({ skipSetup: true })`, the default, materialises an arbitrary mid-game board —
bodies with `playedOnTurn: 0`, DON!! already active, stocked hands — and leaves `turnNumber` at 1
because there is nothing to count. `buildConfig` already suspends three other opening-turn rules for
exactly that reason (`shuffleDecks: false`, `openingHandSize: 0`, `skipFirstTurnDraw: true`), so the
fix is a fourth: an opt-in `allowFirstTurnAttacks`, set by the fixture builder and by nothing else.
Real matches — `sim/matchup.sim.test.ts`, `arena/`, `starter-decks.ts`, `bot-harness.test.ts` — build
their configs directly and are banned as the rules require.

Two alternatives were measured and rejected:

- **Express the ban as `turnNumber <= 2 && activeSeat === seat`**, which refuses those fixtures
  outright. **1020 of the 1248 test files that declare an attack use the seat trick** (622
  north-first/south-active, 398 south-first/north-active), so this rewrites most of the suite to
  enforce a rule that is already right in every reachable state.
- **Start fixtures at `turnNumber: 3`.** One line, but it silently un-sickens the 15 fixtures that
  use `playedOnTurn: 1` to mean "played this turn" and breaks the two cases asserting `turnNumber`
  2/3. A wrong fixture that still passes is this project's most frequent defect; see `OP06-054`.

**What the escape hatch costs, stated rather than buried:** no fixture exercises the ban, so no card
test can catch a regression in it. That is why its verification is a real match, and why the same
test also asserts the flag is present — deleting it has to fail loudly instead of silently reverting
39 tests.

### Task 1.2 — the counter policy

Before this, the bot never countered: the resolver's `selectCards` branch takes
`Math.min(maxSelections, minSelections)` and the counter prompt is built with `minSelections: 0`.
The policy is `src/automation/counter-policy.ts`, created by
`counter-policy: the defender's counter step, with every knob in a config object`, and called from
one branch added to `resolveBotPromptCommand`.

The rules, in the order they are evaluated:

| # | step | rule | why |
|---|---|---|---|
| 1 | `already-holds` | spend nothing if `defensePower` already exceeds `attackPower` | ties go to the attacker, so `needed <= 0` means the defence holds; spending is the purest waste |
| 2 | choose | cheapest sufficient set: fewest cards, then lowest total play value, then least counter overshoot | exhaustive over subsets up to `maxCardsPerCounter`, so exact within that bound rather than greedy |
| 3 | `cannot-flip` | if no affordable set lifts `defensePower` **above** `attackPower`, spend nothing | damage is binary; a set that falls short buys literally nothing |
| 4 | character target | spend only if that set is at most `maxCardsForCharacter` cards | the R rule below is about life; a saved body is purely offensive while no policy can choose an attack target |
| 5 | override | lethal — 0 life cards and the Leader is the target | `continueLeaderDamage` declares the attacker the winner |
| 6 | override | `[Double Attack]`, `[Banish]` | `[Banish]` trashes the life card instead of putting it in hand, which is what makes tanking cheap |
| 7 | floor | counter if `remainingAttacksThisTurn >= life` | this turn alone can reach zero life |
| 8 | horizon | counter if `life <= R`, else TANK, where `R = (opponent characters + 1) + floor(opponent DON!! in play / avgCost)` | first term refreshes and attacks next turn; second is growth that cannot attack the turn it arrives |

Steps 5–8 apply only when the Leader is the target; step 4 is the whole rule for a character target.
`decideCounter` returns the step's name as its `reason`, which is what the tables below count.

"Tank early, counter late" is dominant rather than a compromise because leader damage puts the life
card **in hand**, usable as a counter later the same turn — but only for a life card without a
`[Trigger]`, which routes to resolution instead, and the resolver always activates it (Task 1.3).

**Counter EVENTS are off by default, and the reason is a different defect, not card evaluation.** An
Event's `[Counter]` power grant is applied by a SECOND prompt (`selectTargets`), which this same
resolver answers with `Math.min(max, min)` = the empty selection. Spending one today trashes the card
and grants nothing. `useEventCounters` exists and is `false`; flip it only together with a targeting
policy. Character counters are exact integers, so the arithmetic above is exact.

Where an Event's grant IS read (only when that knob is on), the reader takes the **first** positive
`modifyPower` in the block and ignores conditional clauses — a deliberate UNDER-count. Under-counting
can only decline a counter that would have sufficed; over-counting would spend a card that does not
flip the battle, which is the one thing this policy must never do.

### The has-effect observable was reading one of four collections — Codex, PR #24

`playValueOf` computed `hasEffect` as `(card.effects?.effects?.length ?? 0) > 0`, which is only the
TRIGGERED blocks. `CardEffects` (`types/src/effect/effect.ts:57`) declares five properties, and an
encoding may live entirely in any one of them:

| collection | runtime consumer | ability? |
|---|---|---|
| `keywords` | `getKeywords`, `shared.ts:432` | yes — `[Blocker]`, `[Rush]`, `[Double Attack]` |
| `effects` | `effectBlocksFor`, `shared.ts:95` | yes — triggered/activated |
| `permanentEffects` | 14 sites in `effects/permanent.ts` | yes — continuous |
| `replacementEffects` | `effects/replacements.ts:176`, `state.ts:67` | yes — "instead of X, do Y" |
| `deckBuildingRules` | **none anywhere under `engine/src`** | **no** — construction-time only |

So a card whose whole ability was a keyword or a permanent effect was valued as a vanilla and could
be trashed as counter fodder ahead of a genuinely blank body. **Measured against the engine's live
runtime catalog: 180 of 1523 counter-bearing character printings, 11.8%** — the suite recomputes and
prints that number every run rather than quoting this paragraph. By distinct definition rather than
printing the same figure is 164 of 1368 (12.0%); the units differ and are worth naming, because the
runtime catalog counts `_pN` variant printings separately.

The sharpest case is a keywords-only **`[Blocker]`** — close to the most valuable card in hand to
KEEP — scoring identically to a blank body.

**It reaches the decks the project actually simulates**, which is what makes it more than a
theoretical mis-ranking:

| deck | reclassified by the fix |
|---|---|
| `ace-op16` | `OP16-017` ×4 (keywords + permanentEffects, counter 1000) |
| `mihawk-green-proxy` | `OP10-032` ×4 (**replacementEffects**, counter 2000), `OP14-026` ×4 (permanentEffects, counter 2000) |

Now `hasEncodedAbility(card)`, an exported predicate over the four ability-bearing collections.
`deckBuildingRules` is **deliberately excluded** and that exclusion is asserted, not commented: it
constrains deck construction and does nothing once the card is in hand, and `grep -rn
deckBuildingRules engine/src/` finds no consumer at all. `OP16-042`'s own source says so — *"nothing
in packages/engine reads it"*.

**Three things about how this was handled, since the review itself was incomplete in one direction
and the fix had to be wider than what was reported.** Codex named two of the four collections and
missed `replacementEffects`, which is 29 of the 180 — including `OP10-032`, a 4-of in
`mihawk-green-proxy`. A fix limited to the two reported collections would have left those wrong and
passed any test pinned to the two named example cards. So the guard discovers one real card per
collection *by shape* from `allCards` and fails if the catalog stops offering an example, and the
mutation harness carries one mutant per clause — the `replacementEffects` mutant is what makes a
two-property fix fail.

**A limitation to carry into Phase 3, stated now rather than discovered then:** the flag is BINARY,
so `OP14-026`'s *"[Opponent's Turn] if rested, +2000 power"* scores the same +2 as a `[Blocker]`. It
is the right value for "does this card do anything", and the wrong value for "how much". If the
learned coefficient on this feature comes out unstable, that is the likely reason, and the answer is
to split the feature rather than to re-weight it. The flag still splits the population (84% ability /
16% vanilla catalog-wide), so it is not degenerate — but inside `mihawk-green-proxy` all 50 cards are
ability-bearing, so it carries no information in that matchup at all.

### The counterPlay positions, and what they deliberately do not assert

`./scripts/simulate.sh --puzzles`. Reported apart from the ladder totals, like the blocker and
`[Trigger]` checks and for the same reason: `runBotMatch` resolves a defender-side prompt through
`resolveBotPromptCommand`, which never sees a strategy, so scoring it as policy quality is a category
error.

Every answer is adjudicated by the engine. Each position's candidate selections are applied through
`applyCommand` and the outcome read out of the resulting state; "minimal spend" is the minimum over
the selections the ENGINE reports as surviving, never a hand-written notion of which card is right.
Each position also proves its own premise before the policy is asked anything — `flippable` (some
selection saves the defender, so declining is a real decision) or `unflippable` (none can, so
spending is provably waste).

| position | answer | premise | solvable/legal | minimal spend | result |
|---|---|---|---|---|---|
| counter-cannot-flip | spend nothing | unflippable | 1/4 | 0 | pass (`cannot-flip`) |
| counter-lethal-must-flip | survive, fewest cards | flippable | 1/2 | 1 | pass (`lethal`) |
| counter-lethal-cheapest | survive, fewest cards | flippable | 2/4 | 1 | pass (`lethal`) |
| counter-tank-early | spend nothing | flippable | 1/2 | 1 | pass (`tank`) at every `avgCost` 1–10 |

**The R rule's middle is not asserted, on purpose.** Exactly where tanking turns into countering is
opinion calibrated by `avgCost`, and Phase 3 measures it; pinning it here would freeze a knob that is
meant to move. `counter-tank-early` therefore has to hold across the whole plausible knob range
rather than at the default, which is a statement about the policy instead of about `avgCost`.

The block also asserts the **control arm** (`enabled: false` reproduces the empty selection exactly,
or Phase 2 has nothing to compare against), the **env plumbing** (`OPCG_COUNTER_AVG_COST` is read, an
unparseable value falls back to the default rather than to `NaN`, and the in-process override wins),
and a **wiring check**: four `runBotMatch` games on real 50-card decks with 0 illegal commands. A
counter selection the engine refuses would abort a game with `illegal-command`, which is exactly how
the `orderCards` and search-to-hand defects presented. No win rate is read off those four games.

### Task 1.3 — blocking and `[Trigger]` are OPEN POLICY SURFACES, not oversights

Both are left exactly as they are, deliberately, and pinned by
`the prompt resolver never blocks, and always activates a [Trigger]`:

- **Blocking has no waste-free rule.** Countering is binary — it either flips the battle or does
  nothing — so "never spend a counter that does not flip it" has no free parameter. Blocking trades a
  permanent body for roughly two cards of hand and redirects the attack; there is no threshold at
  which it is provably right, so a heuristic here would be an opinion shipped as a fix.
- **Declining a `[Trigger]` is a genuine value call.** The manual makes it a choice: activate the
  `[Trigger]` **instead of** adding the card to hand, or decline and bank it unrevealed. The confirm
  branch takes `activate` unconditionally, so the bot never banks a Trigger card. Whether that is
  right depends on the card.

The test now asserts a real `[Trigger]` life card (`EB02-030`, whose printed Trigger is "Draw 1
card.") is offered both `activate` and `skip` and that the resolver takes `activate`. The command is
not applied: what is pinned is the choice, not what the card then does.

### Knobs introduced by Phase 1

In the same category as `SIM_TURN_BUDGET` and `PERMANENT_EFFECT_MS_LIMIT`: **assumptions, never
measured results.** All readable from the environment so a Phase 3 sweep needs no code edit —
`./scripts/simulate.sh --counter avg-cost=3 --counter enabled=0`, or `OPCG_COUNTER_*` directly.

| knob | env var | default | what it is |
|---|---|---|---|
| `avgCost` | `OPCG_COUNTER_AVG_COST` | 4 | DON!! per future body in the R horizon. **THE** calibration constant; Phase 3 sweeps it |
| `maxCardsPerCounter` | `OPCG_COUNTER_MAX_CARDS` | 2 | largest set spent on one battle; also bounds the exhaustive subset search |
| `maxCardsForCharacter` | `OPCG_COUNTER_MAX_CARDS_FOR_CHARACTER` | 1 | largest set spent to save a body rather than life |
| `maxSearchCandidates` | `OPCG_COUNTER_MAX_CANDIDATES` | 10 | candidates considered, lowest play value first |
| `playValueCostWeight` | `OPCG_COUNTER_W_COST` | 1 | the coefficients Phase 3 is meant to learn |
| `playValueEffectWeight` | `OPCG_COUNTER_W_EFFECT` | 2 | ditto |
| `playValueCounterWeight` | `OPCG_COUNTER_W_COUNTER` | 0.001 | ditto |
| `enabled` | `OPCG_COUNTER_ENABLED` | true | master switch; `false` is the never-counter control arm |
| `useEventCounters` | `OPCG_COUNTER_USE_EVENT_COUNTERS` | false | see above — off because of the second-prompt defect, not because Events are weak |
| `hardFloor` | `OPCG_COUNTER_HARD_FLOOR` | true | individually switchable so a sweep can isolate the branches |
| `lethalOverride` | `OPCG_COUNTER_LETHAL_OVERRIDE` | true | ditto |
| `doubleAttackOverride` | `OPCG_COUNTER_DOUBLE_ATTACK_OVERRIDE` | true | ditto |
| `banishOverride` | `OPCG_COUNTER_BANISH_OVERRIDE` | true | ditto |

Resolution order is defaults ← environment ← `setCounterPolicyConfig()`, resolved per decision and
never cached, so a sweep that changes the environment between games is honoured. An unparseable value
falls back to the default rather than to `NaN`; that is asserted, because a `NaN` `avgCost` would
silently make `R` never fire.

**One structural choice that is deliberately NOT a knob:** the cheapest-sufficient comparator ranks
by CARD COUNT first and only then by play value. Card count is the resource being spent from hand, so
one card with an effect beats two vanillas even when the two score lower on play value. If Phase 3
wants to test the other ordering, that is a code change and should be described as one.

### What the policy actually does over real games — 30 games, and NOT a win rate

Instrumented probe, not committed: step three 10-game pairings with `valueRanked` on both seats,
recording `decideCounter`'s reason at every counter prompt. **This describes the policy's behaviour.
It is not a ladder run and no win rate is read off it** — that is Phase 2.

Re-measured after the `hasEncodedAbility` correction above, with the pre-fix figures kept beside
them — the games genuinely diverge, which is the evidence that the correction reaches real play and
not only puzzles:

| pairing | games | mean turns | counter prompts | spent on | cards spent | illegal |
|---|---|---|---|---|---|---|
| ace-op16 mirror | 10 | 10.6 | 280 | 74 (26.4%) | 86 (was 85) | 0 |
| mihawk-green-proxy mirror | 10 | 14.0 (was 13.8) | 471 (was 457) | 139 (29.5%, was 141) | 150 (was 152) | 0 |
| ace-op16 vs mihawk-green-proxy | 10 | 11.6 | 341 (was 339) | 104 (30.5%, was 103) | 121 | 0 |

The mihawk mirror moves most, as it must: 8 of its 50 cards change classification, against 4 of
`ace-op16`'s 28 counter candidates. Play value only decides WHICH card is spent among equally-sized
sufficient sets, never whether to spend — so no reason-code logic changed, but the cards left in hand
did, and the games diverge from there.

Reasons, ace mirror / mihawk mirror / cross (post-fix):

| reason | ace | mihawk | cross | what it means |
|---|---|---|---|---|
| `already-holds` | 112 | 263 | 154 | the attack was already going to fail; countering would be pure waste |
| `cannot-flip` | 76 | 55 | 65 | no affordable set lifts defence above the attack |
| `hard-floor` | 31 | 101 | 61 | this turn's remaining attacks alone reach zero life |
| `within-horizon` | 34 | 28 | 33 | `life <= R` |
| `tank` | 18 | 14 | 18 | declined because life is comfortably above `R` |
| `lethal` | 8 | 9 | 8 | 0 life cards, Leader targeted |
| `double-attack` / `save-character` | 1 / 0 | 0 / 1 | 2 / 0 | the rare override paths, each exercised at least once |

Three things worth reading off this, all of them Phase 3's business rather than conclusions:

1. **`already-holds` is the single largest bucket (40–56% of prompts).** Those are battles the
   defender already wins, so the prompt exists only because the attacker swung something that cannot
   connect. That is the `futile` puzzle class showing up in aggregate — an attacker-side policy
   weakness, visible here as a defender-side statistic.
2. **`tank` fires rarely (3–6%) while the floor and the horizon fire often.** With `avgCost` at 4 and
   games ending in 10–14 turns, life drops below `R` early, so the policy spends more readily than
   "tank early, counter late" might suggest. Whether that is right is exactly what sweeping `avgCost`
   in Phase 3 answers; it is not evidence the default is wrong.
3. **0 illegal commands in 30 games.** A counter selection the engine refuses aborts a game, and none
   did.

**The knob passthrough was verified the same way, end to end.** `./scripts/simulate.sh --puzzles
--counter enabled=0` turns the policy off from the command line: the `counterPlay` block reports
`reason=disabled` and goes red on both lethal positions, which is the control arm working rather than
a defect. Incidentally, the two fixed-seed wiring games ran **101 and 158 commands with counters and
62 and 76 without** — counters lengthen a game substantially. That is n=2 on command counts, not a
win rate or a turn-count distribution; it is here only as evidence that the policy changes whole games
and not just puzzles.

### Nine mutants, and the one that made a guard better

Every new guard was mutation-checked, and the harness is committed rather than thrown away:
`python3 tools/mutation_check_engine.py`, ~5 min, exit 1 if an expected kill survives. It mutates the
ENGINE patches and the counter policy they install and checks `sim/puzzles.test.ts` notices — a
different corpus from the three existing mutation tools, which mutate card encodings
(`mutation_check.py`, `mutation_sweep.py`) and `arena/log.test.ts` (`mutation_check_arena.py`).

| mutant | verdict | caught by |
|---|---|---|
| revert the first-turn attack ban | KILLED | `neither player may attack…` |
| revert the fixture `allowFirstTurnAttacks` flag | KILLED | `neither player may attack…` |
| revert the counter step's call into the policy | KILLED | `counterPlay` |
| accept counter sets that do NOT flip the battle | KILLED | `counterPlay` |
| never tank — counter whenever a set exists | KILLED | `counterPlay` |
| prefer the LARGEST sufficient set | KILLED | `counterPlay` |
| ignore the `enabled: false` master switch | KILLED | `counterPlay` |
| misname the `avgCost` env var | KILLED | `counterPlay` |
| `hasEncodedAbility` ignores `keywords` ([Blocker] bodies) | KILLED | `hasEncodedAbility…` |
| `hasEncodedAbility` ignores `permanentEffects` | KILLED | `hasEncodedAbility…` |
| `hasEncodedAbility` ignores `replacementEffects` — the one the review missed | KILLED | `hasEncodedAbility…` |
| `hasEncodedAbility` counts `deckBuildingRules` as an ability | KILLED | `hasEncodedAbility…` |
| `hasEncodedAbility` calls an effect-less card ability-bearing | KILLED | `hasEncodedAbility…` |
| drop the lethal override only | **SURVIVED, expected** | nothing can |

**13 of 14 killed.** The four `hasEncodedAbility` clause mutants are what stop a partial fix passing:
covering only the two collections the review named leaves the `replacementEffects` mutant alive.

**The survivor is honest and worth keeping in writing.** At 0 life the hard floor
(`remainingAttacks >= life`) and the R rule (`life <= R`, and `R >= 1` always) both fire, so the
lethal override is redundant belt-and-braces rather than a load-bearing branch, and no position can
isolate it. That is an equivalent mutant, the same category the 2026-08-19 mutation sweep used.

**One guard was genuinely weak and mutation is what found it.** `counter-cannot-flip` originally sat
at 3 life, where the tank rule declines anyway — so a policy that accepted insufficient counter sets
still spent nothing and the position passed. It now sits at 0 life, where every override wants to
counter and only the never-waste rule holds it back. Same shape as the masked `oncePerTurn`
assertions in `docs/mutation-triage.md`: a guard whose subject is shadowed by an unrelated rule reads
as the best-written test in the file.

**And the harness itself shipped both of this project's favourite defects before it worked.** Its
first verdict parser did not strip ANSI, so it reported SURVIVED for nine mutants while the suite was
red for an unrelated reason; and its revert helper replaced "patched text" with "anchor text", which
is wrong for a patch that makes two replacements — it left an import behind, the `already` marker
went missing, and the next apply added a second import until the file would not transform. Both were
caught only because the rewritten harness asserts its own baseline is green before reading any
mutant. Assert the baseline.

## Phase 2 — the baseline re-measured, once

Phase 1 changed what a battle does twice over: neither player may attack on their own first turn, and
the defender now counters. Every ladder, play/draw and mirror figure above predates both, so all of
it is re-measured here in one pass — which is why Phases 1 and 2 were planned as a single unit.

Run on the merged Phase 1 tree (`8eed908`). Four measurement arms ran in parallel against separate
APFS engine clones, because two runs sharing one vendored engine overwrite each other's copied test
files.

### The instrument reproduces the pre-Phase-1 number exactly, so the comparisons below are sound

Before trusting any before/after, the "before" was re-run on a clone with **only** the first-turn
attack ban reverted and the counter policy switched off — i.e. the pre-Phase-1 rules, everything else
held at Phase 1:

| `valueRanked` vs `greedy`, 200 games | measured now | published pre-Phase-1 |
|---|---|---|
| ban OFF, counters OFF | **76.00% [69.63%, 81.39%]** | **76.0% [69.6%, 81.4%]** |

Identical to the published figure to two decimal places on both bounds. That is what licenses reading
every difference below as an effect of the Phase 1 changes rather than of drift in the harness, the
decks or the host.

**Reverting the ban is done by restoring the pristine `battle.ts`, not by setting
`allowFirstTurnAttacks`.** The flag exempts BOTH seats; the pre-fix rule banned the first player on
turn 1 and let only the second player through on turn 2. Using the flag would have measured a third
rule set that never shipped.

### Task 2.1 — dominance ladder, the complete round robin

`./scripts/policy_ladder.sh 200`, all C(5,2)=10 pairs, `mihawk-green-proxy` mirror so the deck cancels
and the win rate reads as a policy score. 2000 games, 78.6 minutes.

| A | B | A's win rate | 95% CI | timeouts |
|---|---|---|---|---|
| valueRanked | greedy | 57.50% | [50.57%, 64.15%] | 0 |
| valueRanked | firstLegal | 55.50% | [48.57%, 62.22%] | 0 |
| valueRanked | random | 100.00% | [98.12%, 100.00%] | 0 |
| valueRanked | passOnly | 100.00% | [98.12%, 100.00%] | 0 |
| greedy | firstLegal | **47.50%** | [40.69%, 54.40%] | 0 |
| greedy | random | 100.00% | [98.12%, 100.00%] | 0 |
| greedy | passOnly | 100.00% | [98.12%, 100.00%] | 0 |
| firstLegal | random | 100.00% | [98.12%, 100.00%] | 0 |
| firstLegal | passOnly | 100.00% | [98.12%, 100.00%] | 0 |
| random | passOnly | **0.00%** | [0.00%, 1.88%] | **200 of 200** |

Two cells came back unresolved at n=200, so both were extended by 400 more games at a fresh seed
rather than reported as-is:

| pair | round robin (200) | extension (400, fresh seed) | pooled (600) | verdict |
|---|---|---|---|---|
| valueRanked–greedy | 57.50% | 56.00% [51.10, 60.78] | **56.50% [52.50, 60.41]** | valueRanked wins |
| valueRanked–firstLegal | 55.50% | 57.00% [52.10, 61.76] | **56.50% [52.50, 60.41]** | valueRanked wins |
| greedy–firstLegal | 47.50% | 50.25% [45.37, 55.12] | **49.33% [45.35, 53.33]** | **a TIE** |

#### THE STRICT TOTAL ORDER DOES NOT SURVIVE PHASE 1, and two of its five relations are why

Pre-Phase-1 the ladder was `passOnly < random < firstLegal < greedy < valueRanked`. What holds now:

**valueRanked > { greedy ≈ firstLegal } > { random, passOnly }, with random and passOnly unordered.**

- **`greedy > firstLegal` is gone.** 600 games put it at 49.33% [45.35, 53.33] — a tie, straddling 50
  with room to spare. The extra machinery in `greedy` no longer buys anything over taking the first
  legal action.
- **`random > passOnly` is gone, and not because of a cycle.** All 200 games time out, so neither
  side wins any: a timeout is 双方败北 and scores against both. The pair produces 100% double losses
  and cannot order its two policies at all. Pre-Phase-1 this cell had 22 timeouts (11%); it is now
  200 (100%). The mechanism is plain — `passOnly` never attacks, `random` attacks rarely, and now the
  defender COUNTERS the few attacks that land, so nothing closes inside the budget.
- **`SIM_TURN_BUDGET` sensitivity is now extreme, and the existing warning about it holds harder than
  before.** That 100% is a statement about a 40-turn cap, NOT a real-world timeout rate; the
  turns-to-minutes mapping is still uncalibrated and must never be quoted against the 30-minute clock.

The ordering that survives is still enough for the ladder's actual job — the default policy is not
"greedy wearing a hat", now with 600 games behind it rather than 200. But **it is a partial order, and
this file must not restate the old chain.**

#### valueRanked's edge over greedy collapsed from 76.0% to 56.5%, and both Phase 1 changes share the blame

The pre-Phase-1 figure for the pair the plan calls the one that matters was **76.0% [69.6, 81.4]**. A
2×2 on that single pair, 200 games per cell, attributes the collapse rather than leaving it hanging:

| `valueRanked` vs `greedy` | counters OFF | counters ON |
|---|---|---|
| **ban OFF** (pre-Phase-1 rules) | **76.00% [69.63, 81.39]** — reproduces the published figure | 60.50% [53.59, 67.02] |
| **ban ON** (current rules) | 65.50% [58.68, 71.74] | **57.50% [50.57, 64.15]** |

- the attack ban alone: 76.0 → 65.5, **−10.5 pts**
- the counter policy alone: 76.0 → 60.5, **−15.5 pts**
- both: 76.0 → 57.5, **−18.5 pts** — sub-additive, so they overlap rather than stack

Both changes move the same way for the same reason: they add decisions that are **not
policy-attributable**. Countering is resolver-owned and identical for every rung, and the ban removes
one attacker-side decision from whoever is second. Longer games with a larger share of non-policy
decisions dilute the attacker-side differences that separate these two rungs.

**This matters for Phase 3 far more than it matters for the ladder.** The measurement Phase 3 needs is
a 1–3 point differential between two 50-card lists. Phase 1 shrank the *policy* signal on this deck by
a factor of ~3.4 (26 points above 50% down to 6.5) while roughly doubling game length — 116 to 252
commands. Effect sizes are smaller and each game costs more than twice as much, so the games-per-point
of resolution has gone up sharply. Size the Phase 3 sweep against the post-Phase-1 numbers here, not
against anything measured earlier on this page.

### Task 2.2 — play/draw, and the magnitude of the illegal-attack bias

Four arms, `mihawk-green-proxy` mirror, `valueRanked` both seats, **400 games each on identical seeds
(424242)** so game *i* begins identically in every arm and a paired estimator is available. Paired
matters here: an independent 400-game proportion carries a ±7-point CI, which is wider than some of
the effects being measured.

| arm | rules | overall | on play | on draw | **gap** | turns | cmds |
|---|---|---|---|---|---|---|---|
| **A** | ban ON, counters ON — **the current engine** | 51.25% [46.4, 56.1] | 68.50% | 34.00% | **+34.50** | 14.8 | 252.5 |
| **B** | ban OFF, counters ON | 54.50% [49.6, 59.3] | 45.50% | 63.50% | **−18.00** | 14.3 | 243.3 |
| **C** | ban ON, counters OFF | 47.50% [42.7, 52.4] | 84.00% | 11.00% | **+73.00** | 9.1 | 124.2 |
| **D** | ban OFF, counters OFF — **the pre-Phase-1 engine** | 45.25% [40.4, 50.1] | 43.50% | 47.00% | **−3.50** | 8.7 | 116.1 |

Zero timeouts and `rules-win` in all 1600 games. Mirror sanity holds: every arm's overall CI contains
50%, as a mirror must.

**Reproducing this.** The per-game rows are deliberately NOT committed — `sim/results/` is gitignored
because per-game output is disposable, and 2400 games of it is 550 KB of unreviewable diff. The runs
are deterministic given the seed, so regenerate instead. Arm A, and the same line with the deck and
the two toggles varied for B/C/D:

```bash
./scripts/simulate.sh --games 400 --seed 424242 \
  --a sim/decks/mihawk-green-proxy.json --b sim/decks/mihawk-green-proxy.json \
  --strategy valueRanked --out /tmp/pd/armA-mihawk.json     # ban ON, counters ON
# arms C and D add: --counter enabled=0
# arms B and D need patch `battle: neither player may attack on their own first turn` REVERTED, by
#   restoring the pristine src/battle.ts in a throwaway engine clone -- NOT by setting
#   allowFirstTurnAttacks, which exempts both seats and is a different rule set.
python3 tools/analyse_playdraw.py /tmp/pd
```

**Paired differences** (same seeds, same seat order; win-rate CI by the harness's own `pairedDiff`
estimator, gap CI by a 20,000-draw paired bootstrap over game indices).

`tools/analyse_playdraw.py` **checks the pairing instead of assuming it** — it refuses to compute a
paired statistic unless the two arms agree on `seed0`, `games`, both decks, both strategies and the
turn budget, AND agree on `seed` and `aOnPlay` at every row index. Index-zipping two arms that are
not seed-aligned yields a confident interval that means nothing, and truncating to the shorter arm
hides it; both were possible until Codex flagged it on PR #25. Each contrast also seeds its OWN
bootstrap RNG, so an interval does not depend on which other arms happen to be in the directory —
before that fix the ace interval moved from [+17.03, +34.97] to [+16.99, +35.06] on identical data
purely by loading four more files first:

| contrast | what it isolates | play/draw GAP difference | overall win rate |
|---|---|---|---|
| A − B | **the first-turn attack ban** | **+52.50 pts [+43.31, +62.04]** | −3.25 [−8.59, +2.09] n.s. |
| C − D | the attack ban, counters OFF | **+76.50 pts [+65.96, +86.59]** | +2.25 [−4.12, +8.62] n.s. |
| A − C | the counter policy | −38.50 pts [−49.71, −27.32] | +3.75 [−2.15, +9.65] n.s. |
| B − D | the counter policy, ban OFF | −14.50 pts [−26.77, −2.03] | +9.25 [+3.05, +15.45] |
| D − A | all of Phase 1 together | −38.00 pts [−51.24, −24.84] | −6.00 [−12.88, +0.88] n.s. |

**THE ANSWER TO THE QUESTION THIS TASK EXISTS TO ANSWER.** The second player's illegal first-turn
attack was worth **+52.50 pts [43.31, 62.04]** of play/draw gap under current rules, and **+76.50 pts
[65.96, 86.59]** with counters off. The recorded direction was right — every prior figure understated
first-player advantage — but the recorded framing was far too gentle. **The bug was not shading the
gap; it was cancelling it and pushing it negative.** On the pre-Phase-1 engine the gap is −3.50 pts,
i.e. the player going SECOND was very slightly favoured, which is what an extra Leader attack buys in
a race.

Why one attack is worth that much: with no blocking and no attack-target selection, a mirror is close
to a pure race up the Leader, and the first player is exactly one tempo ahead. Restore that tempo and
the first player wins 84% of the time (arm C). Hand the second player one compensating attack and the
race levels (arm D). The counter policy then gives the defender something to spend and damps it by
38.5 points (A − C), which is the single largest thing standing between this simulator and a pure
race.

**Do not read the +34.50 as "the engine's play/draw gap" — it is that DECK's.** Same rules as arm A,
same 400 games, same seeds, `ace-op16` instead:

| deck (arm A rules) | overall | on play | on draw | gap | turns | cmds |
|---|---|---|---|---|---|---|
| `mihawk-green-proxy` | 51.25% | 68.50% | 34.00% | **+34.50** | 14.8 | 252.5 |
| `ace-op16` — **the primary deck** | 48.25% [43.4, 53.1] | 47.00% | 49.50% | **−2.50** | 11.0 | 142.7 |

Both are legal 50-card lists, max 4 copies, so this is not a deck-legality artefact. The primary deck
shows **essentially no play/draw gap**, which is the plausible answer for a real game; the proxy deck
shows +34.50. That is the project's own rule about ST01 reappearing one rung up: **the gap tracks how
much interaction a deck has, and `mihawk-green-proxy` behaves like the degenerate end even though it
is a real Block 2+ pile.** It is a *proxy* — OP09–OP14 stand-ins that predate the OP15/OP16
encoding — and on this evidence it should not be used for play/draw calibration again.

**So the honest summary of 2.2 is two findings, not one:** the illegal attack was worth ~52 points on
the deck that has always been used for this measurement, and that deck is the wrong one to measure it
on. The number to carry forward is `ace-op16`'s **−2.50 pts**.

**A confound worth naming, unchanged from before:** the 猜拳 roll is deterministic and north leads
every game, so "on play" and "seat north" are the same column and cannot be separated. In a mirror
with one policy on both seats the only seat-linked difference IS turn order, so the split is still
readable — but a future non-mirror measurement cannot lean on it.

### Task 2.3 — the puzzle suite: nothing moved, and the fixtures no longer need the exemption

**Batch 1 is confirmed exactly as published**, row for row, including which single puzzle `firstLegal`
fails and every guards figure:

| puzzle | valueRanked | greedy | firstLegal | random | passOnly | correct/legal |
|---|---|---|---|---|---|---|
| lethal-bare | pass | pass | pass | FAIL | FAIL | 2/3 |
| lethal-decoy-body | pass | pass | pass | FAIL | FAIL | 2/5 |
| lethal-reaching-attacker | pass | pass | pass | FAIL | FAIL | 2/4 |
| lethal-leader-rested | pass | pass | **FAIL** | FAIL | FAIL | 1/3 |
| futile-unbeatable-body | pass | pass | pass | FAIL | FAIL | 2/5 |
| futile-pick-any-productive | pass | pass | pass | FAIL | FAIL | 4/7 |

**valueRanked 6/6, greedy 6/6, firstLegal 5/6, random 0/6** — the published numbers, unchanged by two
rules fixes and a new counter policy. Batch 2 is also unchanged (`valueRanked` 2/5, `greedy` 4/5;
combined 8/11 and 10/11; by class lethal 4/4, futile 2/2, donAllocation 2/3, sequencing 0/2).

**The fixtures Task 1.1 was expected to break never broke** — Phase 1 measured that and the reason is
recorded above. They have nonetheless been moved off turn 1, which is what the plan asked for, and
the point is what that buys rather than the move itself:

- `advancePastFirstTurn()` sets the state's turn to the acting seat's SECOND turn (`ownFirstTurn + 2`),
  computed from `config.firstPlayer` rather than hardcoded, and set directly on the state rather than
  by playing `endTurn` — a real `endTurn` would run a refresh, a DON!! phase and a draw, rewriting the
  exact hand and DON!! counts every puzzle depends on.
- **The re-run is byte-identical to the run before it**, every cell and every guards figure. An inert
  change is the correct outcome: it proves the answers never depended on being at turn 1.
- **The suite no longer depends on the fixture exemption at all, and that is verified rather than
  argued.** With `allowFirstTurnAttacks` forced to `false` in a scratch clone, **7 of 8 tests pass** —
  all 14 puzzles at unchanged scores, plus `counterPlay`. The only failure is the Phase 1 assertion
  that deliberately pins the flag's *presence*, which must keep firing because 39 upstream card tests
  in 31 files still need it.

So the exemption remains necessary for upstream's fixtures and is no longer load-bearing for ours.

### What Phase 2 changes about what comes next

1. **Blocking is now the highest-value fidelity gap, and Phase 2 is what promoted it.** The counter
   policy alone damps the play/draw gap by 38.5 points on the proxy deck. Blocking is the other
   defensive tool the defender still does not have, and the arms above show how much a single
   defensive lever is worth. It remains an OPEN POLICY SURFACE by decision (Task 1.3) — this is
   evidence about its size, not a decision to build it.
2. **`mihawk-green-proxy` should not be used for play/draw calibration again.** +34.50 pts against
   `ace-op16`'s −2.50 under identical rules. It is a proxy of OP09–OP14 stand-ins that predates the
   OP15/OP16 encoding, and it behaves like the degenerate end of the interaction scale. It remains
   fine as the LADDER deck, where both seats play it and the deck cancels.
3. **Phase 3 must be sized against the numbers here.** Policy signal on the ladder deck fell ~3.4x
   while game length roughly doubled (116 → 252 commands). Both move the games-per-point of
   resolution the wrong way.
4. **The 100%-timeout cell is a live warning about `SIM_TURN_BUDGET`,** not a result. Any future
   measurement involving a policy that cannot close needs the budget varied before its numbers mean
   anything.

## The decision layer read PRINTED power — fixed 2026-08-20

Carried by the `bot-strategies: the policy compared PRINTED power` patch in
`tools/patch_engine.py`. **Cited by NAME, not by number**, for two reasons and the second is the
stronger one. (1) Numbering is positional and therefore branch-local: any insertion above a patch
renumbers it, so whoever merges second silently rots every `patch N` reference. (2) **A number can
be wrong the day it is written** — this section was drafted saying "patch 15" when the patch was
14th, because the list was counted by eye instead of being asked. That makes a number not merely
perishable but never load-bearing evidence in the first place.

If you do need a position, derive it rather than count it, and prefer stating a SHIFT over a
destination ("pushed down five" survives later insertions; "moved to 15-24" does not):

```bash
python3 -c "import sys; sys.path.insert(0,'tools'); import patch_engine as pe; print([(i+1,p['name']) for i,p in enumerate(pe.PATCHES)])"
```

Section headers in `tools/patch_engine.py` are unnumbered for the same reason: a numbered header is
what re-seeds stale citations, because a reader takes the number off the header and cites it.

`src/automation/bot-strategies.ts` decided *which body to attack with* and *which body to put DON!!
on* from the number printed on the card. `src/battle.ts` resolves the resulting attack through
`getCardPower`. So **every power-changing effect in the game changed battle OUTCOMES while changing
no policy CHOICE**, and the two disagreed silently.

The helper:

```ts
function getTotalPower(state: MatchState, instanceId: string): number {
  const card = getCardForInstance(state, instanceId);
  const base = card.cardType === "leader" || card.cardType === "character" ? (card.power ?? 0) : 0;
  const instance = state.cards[instanceId];
  const donBonus = instance ? instance.attachedDon * 1000 : 0;
  return base + donBonus;
}
```

against `shared.ts`'s `getCardPower` = `basePower + attached DON!! (only while its controller is the
active seat) + power modifiers + permanent power modifiers`. `grep -rn getCardPower src/automation/`
returned **nothing at all**.

**Which rungs this reached, counted rather than assumed.** Only two of the five consult power: `greedy`
(one read) and `valueRanked` (four). Both went through this one helper. `firstLegal`, `random` and
`passOnly` have **zero** power reads between them. So no rung could see an effect-modified power, and
**`random` is not a control for it** — it has no power-based preference to be right or wrong about.
This is the same shape as the attack-target finding above but not the same mechanism, and it is the
fourth member of that family: attack-target selection, counter/blocker play and `[Trigger]`
activation are resolver-owned; this one was policy-owned and simply wrong.

### Reproduced as a puzzle before anything was changed

`lethal-effective-power-attacker` in `sim/puzzles.test.ts`. North on 0 life behind a 6000 Leader;
South's own Leader rested; two bodies, `OP05-012` Hack (vanilla 5000) and `OP10-005` Sanji
(**prints 3000, plays 6000** — `[Your Turn] This Character gains +3000 power`). The 5000 whiffs
against a 6000 Leader, the 6000 connects and wins. Printed power ranks the two the wrong way round.

The fixture card was found **by measurement, not by reading encodings** — the standing rule in this
repo. A probe asked the engine for `getCardPower` on a bare board for every character in the catalog
with printed power ≤ 6000 and reported the seven that answer above their printed value; `OP10-005`
has the largest gap. `fixture integrity` re-measures both halves of the premise (prints 3000, plays
6000, no keywords, and the inversion against the decoy still holds), so the puzzle cannot quietly
stop meaning what its prose says.

Red baseline, single-command mode, guards `1/3 correct of legal` (solvable and discriminating):

| puzzle | valueRanked | greedy | firstLegal | random | passOnly |
|---|---|---|---|---|---|
| `lethal-effective-power-attacker` (before) | FAIL | FAIL | FAIL | FAIL | FAIL |
| `lethal-effective-power-attacker` (after) | pass | pass | FAIL | FAIL | FAIL |

Failing for **all five** is what localises the cause to the shared helper rather than to any one
policy — though the three that stay red do so for a different reason and the fix cannot help them:
they never consult power at all. Every one of the other 14 puzzles keeps its exact result, before and
after, which is what says the change is scoped to the defect.

### Two reads are deliberately LEFT on printed power

Neither is an oversight, and both decisions are asserted in the suite rather than written down here
and left to rot.

**(a) `valueRanked`'s `attacker.power >= 5000` "big body" bonus stays printed.** It is *inert* for
attacker choice, and routing it through `getCardPower` is measurably *worse*.

*Inert, exactly.* A `declareAttack` scores `600 + 300*(target is a Leader) + 100*(gate) +
150*(sourceId === bestAttacker)`. `bestAttacker` is a single instanceId, so among any set of attacks
**exactly one** is awarded the 150 — and 150 > 100. For two attacks on the same target class the
bestAttacker one therefore scores ≥ 150 from those two terms while the other scores ≤ 100, and it
wins under **either** reading of the gate. (With the gate on *effective* power it cannot even
disagree with `bestAttacker`, which is then the argmax of the very quantity the gate thresholds: if
any attacker clears 5000, `bestAttacker` does.) The gate cannot reorder two attacks. It is not an
attacker-selection input at all.

*Worse.* Its only live effect is to lift `declareAttack` (1150) above `attachDon` (1050) — the
swing-before-buff defect already recorded above. On effective power that defect fires **sooner**,
because a body that has just taken one DON!! crosses 5000. A/B of the puzzle suite, gate on printed
vs gate on effective, everything else identical:

| | valueRanked donAllocation | `don-concentrate-to-reach` |
|---|---|---|
| gate on printed power (shipped) | 2/3 | pass |
| gate on effective power | **1/3** | **FAIL** |

Nothing else moved. So the change costs a measured puzzle and buys no fidelity anywhere. **The gate
is mis-DESIGNED, not mis-sourced** — it belongs on the sequencing worklist, and CLAUDE.md's standing
instruction is not to reweight it without re-running the ladder. `lethal-effective-power-attacker` is
also the guard on this decision: its board is one where the gate (printed) and `bestAttacker`
(effective) point at *different* bodies, so if the 150/100 weighting is ever changed so the gate
wins, that puzzle goes red and this paragraph has to be revisited.

**(b) The two reads that score a card in HAND stay printed** (`cardValue`, and `valueRanked`'s
`playCard` branch). Measured over the whole catalog: `getCardPower` on a hand instance disagrees with
printed power for **0 of 1968** characters, and **0** permanent power modifiers target a hand zone.
Routing them through `getCardPower` is provably a no-op today, at the price of a permanent-effect
sweep per hand card per decision — the hot path Phase 0's `permanent: getPermanentSetCost
evaluates conditions it then discards` patch exists to keep cheap. Both facts
are asserted by `hand-card power is printed power, so the two hand reads stay printed`, so the day a
card modifies power in hand the suite says so.

### The ladder did not move — and that is attributed, not assumed

`./scripts/policy_ladder.sh 200`, the full C(5,2)=10 pair round robin on the `mihawk-green-proxy`
mirror, run on the patched tree. The control is **Phase 2's own post-Phase-1 table**, measured on the
same script, same deck, same 200 games, on the same tree this branch started from.

| A | B | with the fix | 95% CI | Phase 2 control | Δ |
|---|---|---|---|---|---|
| valueRanked | greedy | 56.50% | [49.57%, 63.18%] | 57.50% | **−1.00** |
| valueRanked | firstLegal | 55.50% | [48.57%, 62.22%] | 55.50% | 0.00 |
| valueRanked | random | 100.00% | [98.12%, 100.00%] | 100.00% | 0.00 |
| valueRanked | passOnly | 100.00% | [98.12%, 100.00%] | 100.00% | 0.00 |
| greedy | firstLegal | 49.00% | [42.16%, 55.88%] | 47.50% | **+1.50** |
| greedy | random | 100.00% | [98.12%, 100.00%] | 100.00% | 0.00 |
| greedy | passOnly | 100.00% | [98.12%, 100.00%] | 100.00% | 0.00 |
| firstLegal | random | 100.00% | [98.12%, 100.00%] | 100.00% | 0.00 |
| firstLegal | passOnly | 100.00% | [98.12%, 100.00%] | 100.00% | 0.00 |
| random | passOnly | 0.00% (200 timeouts) | [0.00%, 1.88%] | 200 timeouts | 0.00 |

**Eight of ten pairs are byte-identical.** The two that move do so by −1.00 and +1.50 points, both
far inside their own ±7-point CIs, and both on pairs Phase 2 had *already* extended to 600 games
because they were unresolved. **Phase 2's ordering stands unchanged:**
`valueRanked > {greedy ≈ firstLegal} > {random, passOnly}`, with the bottom two unordered.

**Why Phase 2's table is a legitimate control.** A second arm was started — a detached worktree at
`8eed908` with the fix absent, its own APFS engine clone, everything else held — and its first pair
returned **57.50% [50.57%, 64.15%]**, reproducing Phase 2's cell to the digit on both bounds. The
ladder is seed-deterministic, so the remaining nine control pairs were redundant and that arm was
stopped rather than burned.

**What this does NOT say.** It does not rehabilitate the pre-Phase-1 `76.0%`: that collapse is Phase
1's, already measured and attributed by Phase 2 (attack ban −10.5 pts, counter policy −15.5 pts,
both −18.5 pts). This fix simply is not part of it. Nor does an unmoved ladder mean the fix is
worthless — the ladder is a *mirror* on a deck whose bodies mostly have no live power effects, which
is exactly the blind spot the puzzle exists to cover.

### No measurable throughput cost

Routing the hottest read in the policy loop into `getCardPower` was the obvious risk.
`bench/throughput.test.ts`, same host, back to back, nothing else running:

| deck | games/s before | games/s after | cmds/s before | cmds/s after | cmds/game before → after |
|---|---|---|---|---|---|
| synthetic-4card | 1.32 | 1.35 | 148 | 152 | 112.3 → 112.3 |
| ST01-real-50 | 1.17 | 1.22 | 165 | 172 | 140.8 → 140.8 |
| oars-x4 | 0.51 | 0.55 | 68 | 71 | 134.0 → 130.3 |

Every "after" is *faster*, which adding work cannot cause — so it is noise, and the noise was
measured rather than asserted. Three repeats of the **same patched binary**: synthetic
**1.35 / 1.45 / 1.55** (±15%), ST01 **1.22 / 1.29 / 1.31** (±7%), oars-x4 **0.55 / 0.57 / 0.53**
(±8%). The whole before/after delta (+2% to +8%) sits inside that.

The decisive column is the last one. On synthetic-4card and ST01 `cmds/game` is **identical** across
arms, so the patch changed no decision on those decks and the comparison is a *pure cost*
measurement — and the cost is below the noise floor. On oars-x4 it moved (134.0 → 130.3), so there
the policy genuinely played differently and games/s is not a cost comparison at all.
Per the standing rule, only the within-run ratios above are quotable; the absolute ms are
host-dependent.

**Incidental finding: the recorded realism ratio is stale, and it is Phase 1's doing, not this
patch's.** `CLAUDE.md` and this file record **1.79x per game / 0.97x per command**. Measured now:
**1.11–1.18x / 0.88–0.94x** — and the *unpatched* arm already reads 1.12x/0.90x, which is what
attributes it to Phase 1. The mechanism is the one the original fact already names: game length. The
counter policy lengthens games and lengthens the synthetic deck's proportionally more —
post-Phase-1 `cmds/game` is **ST01 140.8, synthetic 112.3**, which compresses the ratio between them.

**Do not difference those against the 94.6 / 51.1 recorded pre-Phase-1.** Those are an older
session's figures from a different run, and this project only treats *within-run* ratios as
quotable — subtracting across runs is the same category error as comparing absolute ms across hosts.
What licenses the attribution to Phase 1 is the **unpatched arm** measured here (1.12x/0.90x), which
is like-for-like against the patched arm in the same session. A fresh like-for-like pre-Phase-1
baseline is being measured on the in-flight `setBasePowerLiteral` branch; when that lands, take its
before-figures and keep this arm as the attribution. Corroboration that the *after* side is solid:
that branch independently measured **112.3 / 140.8**, matching to the decimal across two trees.
Phase 2 re-measured the ladder and the play/draw split but not the bench, so this is the first
sighting. The engine-audit's assumed 2–5x realism multiplier is now further out than ever.

## What is not done

- ~~**The Phase 2 re-measure.**~~ **DONE** — see "Phase 2 — the baseline re-measured, once". The
  ladder, the play/draw split and the puzzle suite were all re-run against the merged Phase 1 tree,
  and the pre-Phase-1 instrument was reproduced exactly (76.00% vs a published 76.0%) before any
  comparison was read off it.
- **Blocking**, promoted by Phase 2 from "an open surface" to "the largest measured defensive gap":
  the counter policy alone is worth 38.5 points of play/draw gap, and blocking is the other lever the
  defender still does not have. Still a decision not to build it, not an oversight.
- **A play/draw calibration deck.** `mihawk-green-proxy` is unfit for it (+34.50 pts against
  `ace-op16`'s −2.50 under identical rules) and `ace-op16` is a mono-red list with 15 distinct cards.
  Neither is a field-representative deck.
- **Blocking and `[Trigger]` declining** remain unimplemented, on purpose (Task 1.3). Pinned by a
  test so a silent change is loud, not so they stay that way forever.
- **`valueRanked`'s `>= 5000` big-body bonus still reads PRINTED power, by decision** — it is inert
  for attacker choice and routing it through `getCardPower` costs a measured puzzle (see the
  printed-power section below). It is on the *sequencing* worklist, not the fidelity one.
- **The two hand-card reads still read printed power, by decision**, on a measurement (0 of 1968
  characters disagree) that is asserted rather than assumed. A card that modifies power in hand would
  reopen it.
- **The realism ratio in `bench/throughput.test.ts` has not been re-measured deliberately** — the
  1.11–1.18x figure below was a by-product of the printed-power throughput A/B, not a designed
  re-measurement, and Phase 2 did not cover the bench.
- **Attack target selection** is still unreachable, so a body saved by a counter is purely
  offensive. This is the honest cost of Phase 1's scope, and it will bias Phase 3's weight on any
  "keep a body" feature toward zero.
- **No *meta* matchup yet — but the blocker is gone.** This used to read "every deck in the current
  field is OP15/OP16 and those cards are still shells". **That is no longer true:** OP15/OP16
  encoding completed and was verified 2026-08-19 (119 imported = 119 definitions per set, 0 cards
  unencoded-and-unparked). The Mihawk proxy deck is still OP09–OP14 only because it predates that.
  Real deck-vs-deck calibration against the EN ladder matrix is now *available* and simply has not
  been run — that is step 3 of the policy-quality plan.
- The `orderCards` fix uses identity order, which is legal but not a policy. Ordering
  top-of-deck cards deliberately is real strategy and is unimplemented.
- Policy quality has a **floor** but no **ceiling**, and Phase 2 lowered the floor. The ladder no
  longer orders the five policies — it is a PARTIAL order (`greedy ≈ firstLegal`, and `random` vs
  `passOnly` unorderable at 100% double losses) — and `valueRanked` clears `greedy` by **6.5 points**
  over 600 games, not the ~21 measured before Phase 1. Nothing yet speaks to absolute quality: a
  plausible play/draw split is a sanity check, not a skill test, and beating two weaker heuristics
  while tying a third is weaker evidence than beating four. Steps 5–7 of the plan in CLAUDE.md are
  what would close this.
- The turns-to-minutes mapping is unmeasured, so the timeout column is a knob, not a prediction.
- The bot does not value Life, which the elimination-bracket tiebreak rewards.
- Mulligan policy is whatever the engine's default is; the Comprehensive Rules allow one
  all-or-nothing mulligan (5-2-1-6) and it has not been checked that the bot uses it sensibly.
