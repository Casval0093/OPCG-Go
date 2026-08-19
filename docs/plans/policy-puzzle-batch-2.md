# Plan — policy puzzle suite, batch 2

## Context

`sim/puzzles.test.ts` (step 2 of the policy-quality plan in CLAUDE.md) currently holds 6 puzzles in
2 classes. `valueRanked` scores 6/6 — but so does `greedy`, and `firstLegal` scores 5/6. The suite is
therefore **too easy to explain the 76% ladder gap** measured in step 1
(`docs/simulation.md`, dominance ladder). Batch 2 exists to build puzzles that `greedy` fails.

## Architectural fact established before this plan (do not re-derive)

`runBotMatch` resolves **pending prompts in an earlier branch, via
`resolveBotPromptCommand(state, prompt)`, which does not receive the strategy at all.** The strategy
is consulted only when no prompt is pending, and only over `legalCommands` for the active seat
(`bot-harness.ts:209`).

Consequences that bind this plan:

- **Counter play and blocker use are NOT policy decisions.** They are defender-side prompts owned by
  `resolveBotPromptCommand`. A puzzle about them measures the prompt resolver, not the policy, and
  must say so. This is why "holding a counter" is Task 5 and is labelled separately, not folded into
  the policy score.
- Policy-attributable classes are main-phase command choices: attack target selection, DON!!
  attachment, and the order of commands within a turn.

## Global Constraints

1. **`sim/puzzles.test.ts` is the source of truth**; `scripts/simulate.sh` copies it into
   `vendor/.../tests/cards/`. Never hand-edit the vendored copy. Run via
   `./scripts/simulate.sh --puzzles`.
2. **Answers are adjudicated by the engine, never hand-written.** Apply the candidate command(s) and
   inspect the resulting state. A hand-written predicate already mislabelled a winning command once
   (south's leader attack) — see `docs/simulation.md`.
3. **Every puzzle keeps both run-time guards**: SOLVABLE (some legal command satisfies the answer) and
   DISCRIMINATING (some legal command does not). The suite must throw when either fails.
4. **`valueRanked`'s result is asserted** per puzzle via `expect: "pass" | "fail"`. A puzzle this
   batch expects it to fail must be marked `expect: "fail"` with the reason in `why`.
5. **The whole ladder runs against every puzzle** so difficulty stays visible. A puzzle `random`
   solves is not diagnostic and must be reported as such.
6. **Verify each rule against engine source before authoring a puzzle on it**, and cite the file in a
   comment. This has already killed one invented class ("suicide attack") and caught the turn-1
   attack rule.
7. **The first player may not attack on turn 1** (`canAttackWith`, `battle.ts`). Puzzle boards seat the
   acting player as the second player (`firstPlayer: "north"`).
8. Vanilla (no-`effects`) bodies only, unless a puzzle's whole point requires an effect card.
9. Verification for every task: `./scripts/simulate.sh --puzzles` passes, and
   `vp check` on the changed file reports no lint or type errors. Report the actual output.
10. Do not weaken or delete an existing puzzle to make a new one pass.

## Task 1 — harness: multi-command puzzles and prompt pass-through

`adjudicate()` currently applies exactly one command. Sequencing and DON!! puzzles need a puzzle to
evaluate a *line* of several commands, and any command may open a prompt that would otherwise stall
the position.

- Extend the harness so a puzzle's candidate answer may be a **sequence** of commands, while
  single-command puzzles keep working unchanged.
- After each applied command, drain any pending prompts using the engine's own
  `resolveBotPromptCommand`, so a puzzle never deadlocks on a prompt. Cap the drain (e.g. 50
  iterations) and fail loudly rather than looping forever.
- Report, per puzzle, whether prompts were drained — a puzzle whose result depends on the prompt
  resolver is not purely a policy measurement and must be visible as such.
- Keep all 6 existing puzzles passing with identical scores (valueRanked 6/6, greedy 6/6,
  firstLegal 5/6).

## Task 2 — class `koVsDamage`: attack target selection where only one choice is right

At least 3 puzzles. A board where attacking the leader and K.O.ing a body are both *material* (so
batch 1's `futile` predicate would accept either) but only one is correct, and the answer is derived
from the engine.

Make the distinction objective, not a matter of taste. Suggested basis: a body that will otherwise
win the game for the opponent, versus one point of leader damage that changes nothing — e.g. the
opponent has lethal-on-board next turn unless a specific attacker is removed. Derive "correct" from
the engine by evaluating the resulting position, not from an opinion about tempo.

At least one puzzle in this class must be one `greedy` fails; if none do, say so explicitly in the
report rather than forcing it.

## Task 3 — class `donAllocation`: DON!! attachment

At least 3 puzzles. `attachDon` appeared in the arena's branching table, so it is a real policy
decision. Build positions where attaching DON!! to a specific body is required to make an attack
connect (attach to reach a power threshold) and where spreading or mis-assigning it wastes the turn.

Verify the DON!! attachment rules against engine source first (how many, to whom, when) and cite it.

## Task 4 — class `sequencing`: order of commands within one turn

At least 2 puzzles. Positions where the same set of commands wins if played in one order and does not
in another — e.g. attach DON!! before attacking rather than after, or attack with the body that will
be needed as a target later. These use Task 1's sequence support.

The answer must be the engine's verdict on the whole line, not on the first command.

## Task 5 — separate suite: `resolveBotPromptCommand`, not the policy

At least 2 positions covering defender-side counter play and, if reachable, blocker use.

**This is explicitly not a policy measurement** and must be reported under its own heading, with the
architectural reason stated (the strategy never sees a prompt). Do not add these to the
`valueRanked by decision class` totals. The point is to learn whether the prompt resolver throws
away counters, which would bias every simulated matchup independently of the policy.

## Task 6 — record the results

Update `docs/simulation.md` (step 2 section) and the step-2 line in `CLAUDE.md` with the batch-2
table and the honest headline: whether batch 2 actually separates `valueRanked` from `greedy`. If it
does not, say so — that is the finding, and it points at the next measurement instead.

Do not overstate. No claim may exceed what the run shows, and any inference must be labelled as one.
