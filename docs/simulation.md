# The simulation system

Status 2026-08-17: **harness built and validated on a mirror. Not yet trustworthy for matchup
numbers** — see "The bot exaggerates the first-player advantage", which is the finding that matters
most and is a direct input to the Tier-3 lever decision.

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

## The bot exaggerates the first-player advantage — treat matchup numbers as unusable until fixed

**A 54.5-point play/draw gap is not plausible.** Real OPTCG first-player advantage is on the order
of a few points; the first player skips a draw as compensation (Comprehensive Rules 6-3-1). A gap
this size says the `valueRanked` heuristic cannot defend: whoever attacks first snowballs and the
game is decided by turn order rather than by cards.

This is direct evidence for the question `docs/engine-audit.md` leaves open. Its recommendation was
"Option C now, B next, **A only if calibration proves heuristic play distorts matchup results**".
Calibration now shows a distortion large enough to swamp the 2–3 point effects the tech-slot
question is trying to measure. **Any matchup number produced with this policy is measuring the bot,
not the deck.**

Two caveats against over-reading it: ST01 is a Block 1 starter deck with weak defensive tools, and
the mirror is the configuration most sensitive to tempo. Re-measure on a real Block 2+ deck before
concluding the policy is unusable in general. That needs the OP15/OP16 encodings.

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

- No real matchup has been simulated. Every deck in the current meta is OP15/OP16, and the engine
  only got those card *shells* in Task 1 — the effects are not encoded yet.
- The turns-to-minutes mapping is unmeasured, so the timeout column is a knob, not a prediction.
- The bot does not value Life, which the elimination-bracket tiebreak rewards.
- Mulligan policy is whatever the engine's default is; the Comprehensive Rules allow one
  all-or-nothing mulligan (5-2-1-6) and it has not been checked that the bot uses it sensibly.
