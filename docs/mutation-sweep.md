# Mutation sweep of the pre-OP15 encodings

**Run 2026-08-19.** The first time any of upstream's 1,771 pre-OP15 card encodings has been
mutation-checked. Until now `tools/mutation_check.py` resolved cards from `<repo>/cards/`, which
holds OP15/OP16 only, so every encoding the vendored engine owns was outside its reach.

## Headline

| corpus | cards | mutants | killed | kill rate | cards where **no** mutant died |
|---|---:|---:|---:|---:|---:|
| pre-OP15 (upstream's encodings) | 1,419 | 4,307 | 2,685 | **62.3 %** | **177** |
| OP15 + OP16 (this repo's encodings) | 180 | 523 | 523 | **100 %** | **0** |

The 1,419 pre-OP15 rows are the cards that produce at least one mutant; the other 352 of the
1,771 encoded pre-OP15 definitions produce none and are discussed under *Instrument coverage*.

### The OP15/OP16 row depends on WHICH path measured it, and the two disagree by 33 cards

`mutation_check.py` has two entry points for these two sets and they are not interchangeable. The
**180 cards / 523 mutants** above came from `--vendor-set`, which is what `runs/sweep_all.sh` drives.
Running the same 213 encoded cards through `--set` instead gives **105 OP15 + 108 OP16 = 213
records, 182 `ok` and 31 `no-mutants`**. Neither count is wrong; they are answers to different
questions, and two things cause the 33-card gap:

- **`--vendor-set` SKIPS a zero-mutant card rather than recording it.** `--set` records it as
  `no-mutants`. That is the whole difference in the `ok` column, and it matters because **"no mutants
  generated" and "all mutants killed" are the same green today and they are not the same fact.** A
  zero-mutant card is *unperturbable*, not verified — the five operators found no filter, threshold,
  zone or once-per-turn flag to touch. `runs/mutation_shard.py --aggregate` therefore prints the two
  buckets separately and labels the second UNVERIFIED, so a run cannot be quoted as "every encoding
  verified".
- **`--vendor-set` attributes tests by imported symbol, from the grafted copy under `vendor/`.** So it
  cannot see a test file that exists in `cards/tests/` but has not been grafted, and it mutates the
  graft rather than the repo's pristine encoding. `--set` reads the encoding from `cards/` — the
  documented source of truth (`docs/plans/encode-op15-op16.md`, Global Constraint #1) — and derives
  the test path from the card filename.

So `--set` is the correct path for the two sets this repo OWNS, and `--vendor-set` is the correct one
for the 1,771 upstream encodings, where there is no second copy. Only `--vendor-set` has a batched
implementation (`tools/mutation_sweep.py`); `--set` is one process per card, which is why
`runs/mutation_shard.py` exists to shard it across APFS engine clones.

**The 523 figure is also set-relative and moves when this repo encodes more.** Unparking the six
`setBasePowerLiteral` clauses added 19 mutants — OP15-070 1→4, OP15-071 1→4, OP15-092 3→6,
OP16-058 2→5, and OP16-015/OP16-106 appearing at 6 and 1 where they generated none — taking the
`--set` total to **542/542, 0 survivors**. Quote 523 for the state this sweep measured and 542 only
against a tree that has those six encoded.

Both halves were measured with the same tool, the same operators and the same attribution, on the
same day, against a suite that is green (3,665 files / 6,078 pass / 2 skipped).

**Read the contrast carefully.** It is not evidence that this repo encodes better than upstream. It
is evidence about *test authoring*: OP15/OP16 were written with `mutation_check.py` in the loop and
upstream's were not. The sweep measures whether a test can detect a wrong encoding — it says nothing
about whether the encoding is right. A card whose text and encoding are wrong in the same direction
still passes every mutant, in both corpora.

**37.7 % of upstream's decision surface is unprotected**: 1,622 perturbations of a filter,
threshold, comparison, zone or once-per-turn flag changed the encoding and no test in the entire
6,078-test suite noticed. 177 cards are unprotected in full — not one of their mutants died.

## Which operators survive, and why that ordering matters

| operator | mutants | survived | survival |
|---|---:|---:|---:|
| `zone: "field"` → `"character"` | 15 | 15 | **100 %** |
| delete `filter: "cardCategory"` | 318 | 261 | **82 %** |
| delete `filter: "color"` | 61 | 39 | 64 % |
| `comparison: "eq"` → `"gte"` | 112 | 70 | **62 %** |
| delete `filter: "baseCost"` | 39 | 22 | 56 % |
| delete `filter: "state"` | 100 | 56 | 56 % |
| drop `oncePerTurn` | 223 | 106 | 48 % |
| delete `filter: "name"` | 155 | 71 | 46 % |
| delete `filter: "trait"` | 536 | 221 | 41 % |
| delete `filter: "cost"` | 690 | 273 | 40 % |
| delete `filter: "anyOf"` | 92 | 35 | 38 % |
| `comparison: "gte"` → `"lte"` | 248 | 94 | 38 % |
| delete `filter: "basePower"` | 38 | 12 | 32 % |
| `value: N` → `N−1000` | 507 | 139 | 27 % |
| delete `filter: "power"` | 116 | 31 | 27 % |
| delete `filter: "excludeName"` | 111 | 20 | 18 % |
| `comparison: "lte"` → `"gte"` | 852 | 148 | 17 % |
| delete `filter: "hasTrigger"` | 20 | 1 | 5 % |
| delete `filter: "excludeSelf"` / `dynamicCost` / `noBaseEffect` / `allOf` | 56 | 0 | 0 % |
| **total** | **4,307** | **1,621** | **37.6 %** |

The labelled survivors sum to 1,621 rather than the 1,622 the headline arithmetic gives
(4,307 − 2,685). The two cards with no runnable test at all carry 3 mutants between them but are
recorded once per card rather than once per mutant, since none of the three was ever run.

The top three rows are the ones with teeth, because each maps onto a defect class this project has
already been bitten by:

- **`zone: "field"` → `"character"` survives 15/15.** This is the C1/C2 defect verbatim — `field`
  includes the Leader, `character` does not, and rulings #979/#993 turn on exactly that. Not one
  test in the corpus distinguishes them. (The operator only reaches 15 cards; the same distinction
  is spelled `zones: ["leader", "character"]` on 272 more sites it cannot see at all. See
  *Instrument coverage* below.)
- **Deleting a `cardCategory` filter survives 82 %.** The tool's own docstring cites a
  `cardCategory` filter that was never consulted as one of the three original hand-found defects.
  It is the least-tested filter in the corpus by a wide margin.
- **`eq` → `gte` survives 62 %.** Rulings #962/#963 say "power N" means exactly N. Where an
  encoding correctly writes `eq`, nothing checks that it is not `gte` — the mis-encoding those
  rulings exist to prevent is invisible to the suite on 70 of 112 sites.

At the other end, `lte` → `gte` dies 83 % of the time. That is the reassuring end of the table:
inclusive threshold flips are the perturbation upstream's fixtures are most likely to catch.

**These figures are the second run.** The first put the corpus at 4,297 mutants / 62.4 %, then two
changes landed: patch 8 fixed `OP07-030` Pappag's always-true assertion (one survivor became a
kill), and operator 5 was fixed to use `finditer` rather than `search`, so a card with more than one
`oncePerTurn` guard now has all of them mutated instead of just the first — +10 mutants across 9
cards. The first run's results are kept under `runs/v1/`.

## The dominant survivor shape: boundary-only fixtures

The most common reason a mutant survives is that the test's fixture sits exactly **on** the
threshold, so no perturbation of the threshold changes the outcome.

`OP05-001` Sabo filters `{ filter: "power", comparison: "gte", value: 5000 }`. Its test
(`tests/cards/leaders/op05-001-sabo.test.ts`) is substantive — it drives real battles and pins
concrete post-state — but the only body it ever uses is `op05Bellamy035`, which is 5000 power. So
deleting the filter, flipping `gte`→`lte` and shifting 5000→4000 all still admit Bellamy, and all
three mutants survive a test that looks thorough.

This is the same shape as the already-documented `OP06-054` Borsalino defect, where a one-sided
threshold test hid a wrong `lte` bound. Borsalino was found by hand and fixed by patch 6; the sweep
shows the shape is systemic, not a one-off.

## Instrument coverage — what the sweep does NOT cover

A 62.4 % kill rate is a statement about the 4,297 perturbations the five operators can make. It is
not a statement about the whole decision surface, and the gap is large:

- **352 pre-OP15 cards (19.9 %) generate zero mutants.** They are not verified by this sweep; they
  are unperturbable by it. A clean sweep would silently exclude them.
- **Player scoping is entirely unmodelled.** `player: "self" | "opponent"` appears on ~3,000 sites
  across ~1,750 files and no operator touches it, so "KO one of your opponent's Characters" encoded
  as `self` cannot be detected.
- **Negative values cannot be matched at all.** The threshold operator's regex is `value:\s*(\d{3,6})`,
  which a leading minus defeats — so every debuff in the corpus (~200 sites) is unmutated. This is
  the exact field where `tools/variant_audit.py` already found 16 printings that lost their `−`.
- **`zones: [...]` is unreachable.** The Leader-exclusion operator matches the singular `zone:`
  spelling, which the corpus barely uses; the array spelling carries 272 `["leader", "character"]`
  sites.
- **Condition objects are never deleted.** ~1,300 `{ condition: ... }` gates — the same "never
  consulted" shape as the filter-deletion operator, in a different spelling.

`docs/mutation-operators.md` carries the full inventory and a ranked, type-checked proposal list.
Adopting the top proposals would take the corpus from 4,297 to roughly 14,000 mutants and reduce
the zero-mutant set from 352 to about 2 — at roughly 3x the runtime. **It is deliberately left for
its own branch**, because it changes what the number means and the baseline above should stand as
measured first.

## A prior claim this run corrects

CLAUDE.md records that patch 3 wired up 2,065 orphaned test files and that "our OP01–OP14
conformance baseline roughly doubled at zero cost, so quote 6078, not 3370."

The file count is right; the conformance reading is not. **1,594 of those 2,065 files assert
nothing.** They are a single `validateCardAbility(card)` call, and upstream stubbed that function's
body out:

```ts
export function validateCardAbility(card: OPCard) {
  void card;
  // validatePrintedAbilityText(card);
  // ... 11 further commented lines ...
  assert.ok(true);
}
```

So 1,594 of the ~6,078 tests (26 %) are `assert.ok(true)`. The real increment from patch 3 is
**470 files / ~913 engine-driven cases**, covering ~397 card ids that `tests/cards/**` never tested
— genuine value, including `OP12-086` Koala, whose test is one of the substantive ones and whose
absence is correctly recorded as the reason the patch-2 search-to-hand bug survived. But
behaviour-bearing cases went from about 3,369 to 4,282, **+27 %, not double.**

Two consequences worth keeping:

- Zero substantive `src/cards` tests exist for OP01–OP08 or EB01–EB03; every one of those files is
  the stub.
- **2 cards have no runnable test at all** — `PRB02-006_p2` and `ST04-003` — because the stub is
  their only coverage. That is the strongest survivor class in the corpus: nothing could detect any
  wrong encoding of them.

This does not change the standing rule: nothing goes upstream. The harness is upstream's own code,
`tools/patch_engine.py` does not touch it, and the local record is the deliverable.

## How the sweep is run

```bash
./runs/sweep_all.sh          # 8 workers, private engine clone each, ~35 min
./runs/status.sh             # aggregate runs/*.jsonl
```

`tools/mutation_sweep.py` batches many cards' mutants into one `vp test run`. That is sound only
because batches are built so that no two cards in a batch share a test file — attribution is by
**imported symbol** (resolved through local `*.shared.ts` helpers) unioned with card ids named as
strings, so a batch-mate cannot reach a file that decides another card's verdict. Inert stub files
and whole-catalog tests are excluded from attribution and never run.

Two harness details that exist because their obvious versions are silently wrong. A red baseline
quarantines **only the cards that own the red file** and the batch continues — batches are disjoint,
so a red file belongs to exactly one card, and an earlier version that failed the whole batch could
discard up to 120 healthy cards' measurements over one unrelated failure. And `runs/sweep_all.sh`
waits on each worker PID individually: a bare `wait` with no job id returns 0 even when a child
died, so the script would have printed `sweep complete` over a partial corpus.

**The batching is not trusted on the strength of that argument.** It was verified against the
serial `tools/mutation_check.py` on 40 cards / 134 mutants spanning OP01, OP06, OP10 and EB01:
**40/40 cards agree, card-for-card and label-for-label.** Re-run that check after touching either
tool:

```bash
python3 tools/mutation_sweep.py --verify runs/serial.jsonl --engine PATH
```

The sweep is deterministic: re-running OP06 (94 cards, 283 mutants) on a fresh clone reproduces
the recorded verdicts exactly — same killed counts, same survivor labels, card for card.

Both tools trap `SIGTERM` and restore every mutated encoding before exiting, and `--resume` picks
up from the jsonl, so a sweep can be stopped at any moment. This is not theoretical: an early run
killed with a plain `pkill` left an `oncePerTurn: false` mutant behind in a clone. Verify with

```bash
diff -rq .clones/wN/submodules/one-piece/packages/cards/src/cards \
         vendor/tcg-engines/submodules/one-piece/packages/cards/src/cards
```

### Why the runner is ~17x faster than one-mutant-per-run

A `vp test run` costs ~9s almost entirely in fixed startup — transform and import of the card barrel
— and milliseconds in the test. One file is 9.3s; the whole 3,665-file suite is 21s. Serial, the
corpus is ~5,700 invocations, about 8 hours at the 8-worker rate; batched it is ~35 minutes. The
speed is a side effect of the batching, not the point of it — the point is that a sweep you can
re-run in half an hour is a sweep you can iterate on.

## Reproducing

```bash
./scripts/bootstrap.sh                                  # note: run tools from the repo root
for i in 0 1 2 3 4 5 6 7; do cp -Rc vendor/tcg-engines .clones/w$i; done
./runs/sweep_all.sh
```

`scripts/bootstrap.sh` `cd`s into the engine before invoking `tools/patch_engine.py`, whose default
engine path is repo-relative — so the patch and card-correction steps silently do not run. Run them
from the repo root until that is fixed:

```bash
python3 tools/patch_engine.py && python3 tools/correct_cards.py
```
