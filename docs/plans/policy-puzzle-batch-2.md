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

## Task 1 — harness: multi-command puzzles and prompt pass-through — DONE

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

## Task 2 — class `koVsDamage` — AMENDED 2026-08-19, then DONE

**As specified this task was not buildable, and the reason is architectural.** The plan asked for
attack-target puzzles measuring policy quality. Verified against engine source and then confirmed by
probe: `engine/legal.ts:181` emits ONE `declareAttack` descriptor per *attacker* with every legal
target bundled into `targetIds`; `bot-strategies.ts:81` `commandFromDescriptor` takes `targetIds[0]`
unconditionally; `battle.ts:737` `legalAttackTargets` pushes the defending leader first. All five
ladder strategies build their command through that helper, `random` included, so **no policy can
choose an attack target at all** — every attack hits the defending leader. A `koVsDamage` puzzle is
therefore failed by all five for one structural reason and measures the descriptor API, not the
policy.

Rebuilt as an **architecture probe** instead, per constraint 4 and the same reasoning that keeps
Task 5 separate:

- 3 positions, all `expect: "fail"`, all marked `architectural: true` and **excluded from the policy
  totals**, reported under their own heading.
- Kept rather than dropped because they demonstrate the *consequence* — a game lost that the position
  could have won — which an API-level assertion cannot, and because `expect: "fail"` flips the day
  target selection becomes reachable, so the suite reports it.
- The mechanism is pinned separately and precisely by `no ladder strategy can choose an attack
  target`, which asserts the descriptor really does carry ≥2 targets, that the leader is first, that
  `commandFromDescriptor` collapses to it, and that 200 varied samples per strategy never name the
  character.
- Each carries a THREATENED guard: passing the turn must actually lose, verified by playing the idle
  line out. Otherwise a position South survives regardless would score every policy "pass".

## Task 3 — class `donAllocation`: DON!! attachment — DONE

At least 3 puzzles. `attachDon` appeared in the arena's branching table, so it is a real policy
decision. Build positions where attaching DON!! to a specific body is required to make an attack
connect (attach to reach a power threshold) and where spreading or mis-assigning it wastes the turn.

Verify the DON!! attachment rules against engine source first (how many, to whom, when) and cite it.

## Task 4 — class `sequencing`: order of commands within one turn — DONE

At least 2 puzzles. Positions where the same set of commands wins if played in one order and does not
in another — e.g. attach DON!! before attacking rather than after, or attack with the body that will
be needed as a target later. These use Task 1's sequence support.

The answer must be the engine's verdict on the whole line, not on the first command.

## Task 5 — separate suite: `resolveBotPromptCommand`, not the policy — DONE

At least 2 positions covering defender-side counter play and, if reachable, blocker use.

**This is explicitly not a policy measurement** and must be reported under its own heading, with the
architectural reason stated (the strategy never sees a prompt). Do not add these to the
`valueRanked by decision class` totals. The point is to learn whether the prompt resolver throws
away counters, which would bias every simulated matchup independently of the policy.

## Task 6 — record the results — DONE

Update `docs/simulation.md` (step 2 section) and the step-2 line in `CLAUDE.md` with the batch-2
table and the honest headline: whether batch 2 actually separates `valueRanked` from `greedy`. If it
does not, say so — that is the finding, and it points at the next measurement instead.

Do not overstate. No claim may exceed what the run shows, and any inference must be labelled as one.

## Outcome — 2026-08-19

**Batch 2 does separate `valueRanked` from `greedy`, in `greedy`'s favour: 10/11 to 8/11.** Every
point of the gap is command ORDER. `valueRanked` adds +100 to a `declareAttack` when the attacker's
printed power is ≥5000, lifting the swing (1150) above the DON!! attach (1050), so it attacks before
it buffs and then wastes the DON!! on a rested body; `greedy`'s two scores tie at 800 and the stable
sort puts `attachDon` first because `legal.ts` emits those descriptors earlier. In
`seq-attach-then-swing-for-lethal` that costs `valueRanked` the game.

This does not overturn the step-1 ladder, where `valueRanked` beat `greedy` 76.0% over whole games.
Both stand. What it establishes is that **the ladder gap does not come from DON!! sequencing**, and
that the policy every simulation uses is the worse of the two in that dimension.

The plan asked for at least one puzzle `greedy` fails. `seq-spread-not-concentrate` is one — but both
policies fail it, for the same hard-coded "concentrate DON!! on the best attacker" habit, so it is a
shared blind spot rather than a `greedy`-specific one. Stated here rather than forced, per Task 2's
own instruction.

Three engine facts fell out, all found by measurement and all recorded in `docs/simulation.md` and
`CLAUDE.md`: no policy can choose an attack target; the prompt resolver never counters and never
blocks (`Math.min(maxSelections, minSelections)` against `minSelections: 0`); and `OP01-001`, the
leader all six batch-1 puzzles use, silently buffs every character when it holds a DON!!.

Verification: `./scripts/simulate.sh --puzzles` → 5 tests pass, 14 positions. `vp check` on the
changed file → no warnings, lint errors, or type errors. Five mutants confirmed to turn the suite
red. Batch 1's published numbers are unchanged (valueRanked 6/6, greedy 6/6, firstLegal 5/6,
random 0/6).
