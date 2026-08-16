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

## What is not done

- **No *meta* matchup yet.** Block 2+ decks now simulate fine, but every deck in the current field
  is OP15/OP16 and those cards are still shells — Task 1 generated definitions, not encodings. The
  Mihawk proxy deck is built from OP09–OP14 cards precisely because those are encoded today.
- The `orderCards` fix uses identity order, which is legal but not a policy. Ordering
  top-of-deck cards deliberately is real strategy and is unimplemented.
- Policy quality is unmeasured. A plausible play/draw split is a sanity check, not a skill test.
- The turns-to-minutes mapping is unmeasured, so the timeout column is a knob, not a prediction.
- The bot does not value Life, which the elimination-bracket tiebreak rewards.
- Mulligan policy is whatever the engine's default is; the Comprehensive Rules allow one
  all-or-nothing mulligan (5-2-1-6) and it has not been checked that the bot uses it sensibly.
