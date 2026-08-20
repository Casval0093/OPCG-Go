# Triage of the fully-vacuous cards

Companion to `docs/mutation-sweep.md`. The sweep produced 178 pre-OP15 cards on which **not one**
mutant died. Four independent passes read every one of them against its encoding, its tests, the
engine source and `data/rulings-sc.json`.

(The current sweep reports **177**: `OP07-030` Pappag was fixed as a direct result of this triage —
see below — so it now kills its only mutant. The 178 figure is what was triaged.)

## Headline

| bucket | mutants | share |
|---|---:|---:|
| **A — genuine vacuity.** A test exists and looks like it covers the clause, but its fixtures or assertions cannot distinguish the mutant. Fixable. | **348** | 91 % |
| **B — equivalent mutant.** The perturbation cannot change observable behaviour for any legal input, so no test could kill it. Not a defect. | **20** | 5 % |
| **C — collateral.** The clause is never executed by any test, or the card has no runnable test at all. | **13** | 3 % |
| **D — suspected wrong encoding.** | **1** | 0.3 % |
| total | **382** | |

**The single most important result is the shape of that table: 91 % of the vacuity is in the tests,
and exactly one encoding was flagged as wrong — and it was already known.** Four passes read 178
encodings against their printed text and their official SC rulings and found no new disagreement.
Roughly a dozen candidates looked like divergences and every one was cleared by reading a ruling or
the engine source.

That does **not** license the conclusion that the encodings are right. The sweep and this triage
both look hardest at cards whose tests are weakest, and a card whose printed text and encoding are
wrong *in the same direction* reads as correct to both. It is a real but bounded result: **on the
178 worst-tested cards in the corpus, no new encoding defect was found.**

### The one bucket-D finding is already on the books

`OP13-084` St. Shepherd Ju Peter carries an encoded `[On Play]` deck search that is **not on the
card**. Official SC ruling #747 quotes the card in full and its second ability is
*"[Your Turn] If you have 10 or more cards in your trash, all of your {Five Elders} type
Characters' base power becomes 7000"* — which needed a literal base-power setter. **That primitive
exists as of 2026-08-20 (`setBasePower`, patches 10-16 of `tools/patch_engine.py`), so this card is
unblocked; it is still unfixed.**
The engine's own printed `effect` string agrees with the fabricated encoding, which is exactly why
no check has ever caught it. Already recorded in `docs/encoding-audit.md`; listed here because it
is the one card on which fixing the test would be wasted work — the clause the mutant perturbs does
not exist.

## The six fixture habits that produce almost all of it

All four passes converged on the same causes independently. In rough order of volume:

1. **Boundary-only fixtures.** A threshold is tested at exactly one value: the threshold. `power gte
   5000` with a 5000 body, `cost lte 5` with a cost-5 body, `lifeCount lte 3` with exactly 3 Life,
   `zoneCount gte 15` with exactly 15 trash. One fixture choice loses three independent mutants at
   once — deletion, comparison flip and value shift are all invisible together. **At least a dozen
   test names advertise the boundary** (*"at the cost-5 boundary"*, *"the fifteenth trash card"*,
   *"at 6 opposing DON!!"*), so the author picked it deliberately and then tested only its inside.
   This is the `OP06-054` Borsalino lesson, reproduced roughly 90 times.
2. **Containment assertions where equality was meant.** `toContain`, `expect.arrayContaining`,
   `.some(...)` and the `find(...)?.legal === true` idiom are all **monotone**: they can only detect
   a candidate pool that got *smaller*, and every `delete filter` mutant makes it *bigger*. This one
   habit accounts for most surviving filter deletions. `expect(...).not.toEqual(arrayContaining([a,
   b, c]))` is worse still — it passes unless **all three** are present, so it tolerates any single
   filter being deleted (`OP07-045` Jinbe, 4 mutants from one assertion).
3. **Single-candidate pools.** The filter has nothing to exclude because the zone holds exactly one
   eligible card. `expect(candidates).toEqual([theOnlyCard])` *looks* rigorous and proves nothing.
   The cheapest systemic fix in the corpus is one decoy per zone.
4. **One negative control that fails several filters at once.** Where a negative fixture does exist
   it usually fails two or three filters simultaneously, so deleting any single one leaves another
   still excluding it. **A clause with k filters needs k near-misses, each failing exactly one.**
5. **Once-per-turn assertions that pass for the wrong reason — the most dangerous rows.** Around a
   dozen tests *do* attempt a second activation and assert refusal, but the second attempt was
   already impossible: the DON!! was spent, the hand was emptied by the cost, the Life card was
   already face-up, the trash was emptied, or the source K.O.'d itself. `legal.ts` ANDs `oncePerTurn`
   with `canPayCosts`, so an exhausted cost masks the flag completely. These read as the
   best-written tests in review.
6. **Power grants observed only as "did the attack land".** The mutation step is 1000 and the
   fixture margin is usually 2000+, so nothing moves. `OP03-110` is the near-miss worth knowing:
   `battle.ts` compares `attackPower >= defensePower`, so a mutated +1000 turns a 7000-vs-6000 win
   into a 6000-vs-6000 win — still a K.O. **Assert the resulting power number, not the outcome.**

## One test that could not fail — fixed

`OP07-030` Pappag's negative case asserted

```ts
expect(withoutCamie.getView("south").decisions.some((d) => d.title.includes("Blocker"))).toBe(false);
```

`decisions[].title` is `prompt.label` (`src/projection.ts:590`) and the blocker prompt's label is
built as `` `${playerName} may block` `` (`src/engine/queue.ts:55`). The substring `"Blocker"`
never appears in any prompt label, so the assertion was `false === false` unconditionally.

Fixed as **patch 8** in `tools/patch_engine.py`, using the idiom the Borsalino patch already
established — `expect(() => engine.pendingDecision("battleBlocker", seat)).toThrow()`. Verified: the
test still passes, and Pappag's `delete filter:name` mutant now **dies** (0/1 → 1/1).

This is the third test of this exact class carried locally, after `OP06-054` Borsalino (patch 6) and
`EB03-008` Hibari (patch 7). Per the standing rule, nothing goes upstream.

## Equivalent mutants worth suppressing rather than re-triaging

20 of the 382 can never be killed, and most fall into two mechanical classes a pre-filter could
retire automatically:

- **The catalog admits only one value.** `donFieldCount eq 10` → `gte 10` is unkillable because the
  field is capped at 10 DON!! (`DEFAULT_DON_DECK_COUNT`). Likewise `cost lte 7` paired with
  `name: "King"` when no card named King costs more than 7, and `OP08-070`'s Viscount Hiyoko, of
  which exactly one printing exists. A check for "does any catalog card satisfy the name/trait
  filter but violate the paired numeric bound?" would retire these without human reading.
- **A filter restated behind a gate that already applied it.** `OP12-058` states three predicates in
  a `conditional` gate and again in the nested `play` action, over the same single card
  (`topOnly: true`), so each copy masks the other. `OP12-081` re-states `cardCategory: "character"`
  where `sourceFromZone: "character"` already implies it. `OP10-119` restates a reveal's filters
  inside a `previousActionTargets` follow-up, which `actions.ts` resolves by intersecting with the
  prior targets — provably dead. **This is a lint for the encoding side, not fixture work.**

One operator artifact worth knowing: deleting the only filter inside an `anyOf` group leaves an
*empty* group, and `targeting.ts` treats an empty group as matching. So "delete one trait" and
"delete the whole `anyOf`" behave identically — which conveniently means one non-matching fixture
body kills all three mutants at once.

## What this triage does not cover

**Only the 178 fully-vacuous cards were triaged. 595 further cards have *some* surviving mutants
and were not read at all.** The partition enrolled `killed == 0` only, so a card that killed one
mutant of six was excluded no matter how important it is.

That is not academic: **`OP14-020` Dracule Mihawk — one of the two chosen decks — killed 1 of 6 and
is therefore on no worklist.** Its five survivors were read out of band and are all bucket A:

- `delete filter:attribute` — the only opposing Leader in its test is Slash, so the +1000 applies
  either way.
- `delete filter:cost` and `gte→lte` — the only body is cost exactly 5, on a `gte 5` bound.
- `delete filter:cardCategory` — the "cannot play Character cards" restriction is only ever tested
  against a Character.
- `drop oncePerTurn` — one activation, never retried.

`OP14-024` Kin'emon carries the same "set DON!! active, then you cannot play Character cards this
turn" package and shows the same surviving `cardCategory` mutant, so one fixture idiom fixes both:
after the effect resolves, assert a **non-Character** card in hand is still playable.

## Highest-value fixes, if this is taken further

Not implemented here — the fixes are upstream test edits and belong in their own branch, the way
the 48 card-data corrections did. Ranked by mutants killed per edit:

| edit | kills | where |
|---|---:|---|
| `OP07-059` Foxy: 4 Foxy Pirates + 1 non-Foxy body, leave one north Character active, add a 2-body negative case | 6 | `tests/cards/leaders/op07-059-foxy.test.ts` |
| `EB04-017` Mystoms: add a 6-cost Minks, a ≤5-cost non-Minks, and a ≤5-cost Minks **Event** to hand; raise the board to 4 | 6 | `tests/cards/characters/eb04-017-mystoms.test.ts` |
| `OP14-041` Boa Hancock: swap the K.O. target off the 5000 base-power boundary, add two negatives | 6 | `tests/cards/leaders/op14-041-boa-hancock.test.ts` |
| `OP11-097`: assert the resulting leader power, and seed trash with one near-miss per filter | 6 | `tests/cards/events/op11-097-….test.ts` |
| `EB01-040` Kyros: two Life cards + one non-Ice-Aged body | 3 | `tests/cards/leaders/eb01-040-kyros.test.ts` |
| `EB01-046` Brook: assert the candidate list before resolving | 4 | `tests/cards/characters/eb01-046-brook.test.ts` |
| `OP07-045` Jinbe: split the `not.toEqual(arrayContaining([a,b,c]))` into three `not.toContain` | 4 | `tests/cards/characters/op07-045-jinbe.test.ts` |
| `OP10-036` Perona: add `expect(prompts).toHaveLength(0)` | 1 | `src/cards/OP10/characters/036-perona.test.ts` |
| `OP10-034` Franky: give the fixture 2 Life so the second K.O. is decided by `oncePerTurn`, not by an empty Life zone | 1 | `src/cards/OP10/characters/034-franky.test.ts` |

One mutant is **not killable with the current card pool**: `OP13-098`'s `eq→gte` needs a Stage
costing more than 7 and the catalog's Stages top out at 7. It needs a synthetic card via
`registerCards`, a pattern `src/cards/OP13/characters/084-st-shepherd-ju-peter.test.ts` already
establishes.

## Rulings consulted and cleared

Roughly a dozen encodings looked like divergences and were cleared by reading the official SC
rulings rather than by assumption. Worth recording so they are not re-investigated:

- `OP07-059` Foxy #437/#438 — the EN text reads as if the rested Leader is mandatory; the SC text is
  「最多1张」 for **both** the Leader and the Character. The DSL's `upTo: true` matches the official
  text; the EN wording is the loose one.
- `OP09-103` Koala #525 — playing 0 Characters must not draw; the engine guards `thenActions` on a
  non-empty selection.
- `OP11-072` Mont-d'or #642 — `count: { amount: 2 }` without `upTo` looked wrong, but the prompt
  clamps `maximum` to the number of options, so returning the only 1 card available is legal.
- `OP10-032` Tashigi #547 — an already-rested Tashigi may not use the replacement; enforced by
  `restActionCandidateIds`, not by the encoding.
- `OP10-098` Liberation #573/#574 — the threshold is 原本的费用, base cost; the encoding uses
  `filter: "baseCost"`.
- `OP12-081` #709 — `sourceFromZone` is the ruling-critical guard, and a `[Trigger]` Character's
  effect correctly does not qualify.
- Also cleared: `OP06-024` #347, `OP08-043` #461, `OP09-001` #484, `OP09-061` #499, `OP11-040` #631,
  `OP11-097` #650, `OP10-116` #580, `EB04-011` #837, `OP12-059` #699, `OP13-098` #749,
  `OP12-048` #692/#693.
