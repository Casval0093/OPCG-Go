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

| A | B | A wins | 95% CI |
|---|---|---|---|
| valueRanked | passOnly | 100.0% | 98.1 – 100 |
| valueRanked | random | 100.0% | 98.1 – 100 |
| valueRanked | firstLegal | 96.0% | 92.3 – 98.0 |
| **valueRanked** | **greedy** | **71.5%** | **64.9 – 77.3** |
| greedy | random | 100.0% | 98.1 – 100 |
| greedy | firstLegal | 94.0% | 89.8 – 96.5 |
| random | firstLegal | 2.5% | 1.1 – 5.7 |
| firstLegal | passOnly | 100.0% | 98.1 – 100 |

Measured order: **passOnly < random < firstLegal < greedy < valueRanked.**

**Two prior assumptions were refuted, both of which had been written down as if known.**

- **`firstLegal` beats `random` 97.5%** — the reverse of the assumed ordering. Picking the first legal
  command is accidentally competent because the legal-command list leads with plays and attacks, while
  `random` throws turns away on `endTurn`/pass. **So `random`, not `firstLegal`, is the honest
  "no policy" control**, and `firstLegal` is not the trivial baseline it looks like.
- **`passOnly` produces 0 timeouts** — not the round-clock double-losses that were predicted. Across
  all 1600 ladder games there were **zero** timeouts; a player that only passes loses outright. Still
  a useful control, just not for the stated reason.

**The pair that mattered came out in the default's favour.** `valueRanked` beats `greedy` **71.5%
[64.9, 77.3]** — the interval excludes 50% decisively, so the extra machinery is worth roughly 21
points and the sim's default policy is **not** "greedy wearing a hat."

### What this does not establish

It is a **floor test**. It shows the ladder is ordered and that `valueRanked` is the strongest of five
simple heuristics. **Being best-of-five weak heuristics is not evidence of playing well**, and nothing
here licenses trusting a tech-slot ΔWR.

There is one *inference* worth drawing, labelled as inference rather than measurement: **a 21-point
gap between the top two rungs suggests the policy is nowhere near saturated.** If `valueRanked` were
close to a ceiling, the next rung down would sit close behind it; a large gap at the top of the ladder
is the signature of a steep part of the curve, where further policy work still returns a lot. That is
evidence *for* policy quality being the binding constraint, and *against* spending on throughput next
— consistent with the decision rule in CLAUDE.md.

Next: step 2, the puzzle suite, which is the first measurement that can say something about absolute
quality rather than relative ordering.

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
