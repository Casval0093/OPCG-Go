# Mutation sweep of the pre-OP15 encodings

**Run 2026-08-19.** The first time any of upstream's 1,771 pre-OP15 card encodings has been
mutation-checked. Until now `tools/mutation_check.py` resolved cards from `<repo>/cards/`, which
holds OP15/OP16 only, so every encoding the vendored engine owns was outside its reach.

> **Superseded instrument, standing baseline.** This page records the five-operator measurement.
> The widened eleven-operator re-sweep (2026-08-21, kill rate **74.3 %**) is in
> *The widened instrument* below; the per-file records it produced have replaced the ones this
> run wrote, which are archived under `runs/v2/`.

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
Running the same encoded cards through `--set` instead gives **105 OP15 + 108 OP16 = 213 records,
182 `ok` and 31 `no-mutants`**. Neither count is wrong; they answer different questions. The 33-card
gap between 213 and 180 decomposes exactly, and it is worth doing the arithmetic rather than
hand-waving at it: **31 of the 33 are zero-mutant cards** that `--vendor-set` skips, and **the other
2 are `OP16-015` and `OP16-106`**, which generate mutants only once the `setBasePower` clauses are
encoded — so they are absent from the sweep's own files, and the `ok` column reads 182 against 180
for that reason alone, not because of any path difference. Two things cause the gap:

- **`--vendor-set` SKIPS a zero-mutant card rather than recording it.** `--set` records it as
  `no-mutants`. That accounts for 31 of the 33, and it matters because **"no mutants generated" and
  "all mutants killed" are the same green today and they are not the same fact.** A
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
changes landed: the `tests: OP07-030 Pappag asserted a condition that is always true` patch fixed that card's always-true assertion (one survivor became a
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

---

## The widened instrument — run 2026-08-21

The six top-ranked proposals in `docs/mutation-operators.md` are now implemented operators in
`tools/mutation_check.py`: player flip, delete a condition, negative-value sign/step, zones narrow,
amount −1, and keyword drop. The five original operators are unchanged, so the 62.3 % baseline
above still means what it meant — this section is a separate measurement with a wider instrument,
not a correction of it.

**Run conditions.** Measured on the `origin/main` patch-25 tree in a pristine worktree (the shared
checkout's vendor tree was dirty and 20 baseline tests were red there — measuring against it would
have attributed foreign breakage to survivors). Suite: **3,666 files / 6,111 pass / 2 skipped /
0 fail**. The batched runner was re-verified against the serial `mutation_check.py` on this tree
before the sweep: 10 cards / 86 mutants, **10/10 card-for-card and label-for-label**. Clone
cleanliness was verified afterwards (`diff -rq` per clone against the worktree's cards dir).

### Headline

| corpus | cards with mutants | mutants | killed | kill rate | cards where **no** mutant died | zero-mutant cards |
|---|---:|---:|---:|---:|---:|---:|
| pre-OP15, five operators (2026-08-19) | 1,419 | 4,307 | 2,685 | 62.3 % | 177 | 352 |
| pre-OP15, eleven operators (2026-08-21) | 1,750 | 9,237 | 6,862 | **74.3 %** | **16** | **21** |

OP15/OP16 were not re-swept in this run; they were re-swept on **2026-08-22** and have their own
section below, *The sets this repo owns*.

The wider instrument kills a *larger* share of a *larger* corpus. That is not a contradiction of
the baseline: the new sites (player scoping, amounts, keywords) are exactly the ones upstream's
fixtures happen to exercise, because driving a test through the engine requires getting targets
and counts right. The old sites (filters, comparisons) are where a test can look thorough while
sitting on a boundary — and those operators' kill rates barely moved.

**Drift check.** The original five operators alone produce exactly 4,307 mutants on this tree —
the same count as the 2026-08-19 run — and 1,619 of them survive, a 62.4 % kill rate against the
recorded 62.3 %. Aggregate engine drift between the two trees is ~0.1 pp; card-level drift was not
re-measured.

### Per-operator, measured

| operator | mutants | survived | killed |
|---|---:|---:|---:|
| `zone: "field"` → `"character"` | 15 | 15 | **0 %** |
| delete a `condition` object *(new)* | 1,179 | 573 | **51.4 %** |
| drop `oncePerTurn` | 223 | 106 | 52.5 % |
| delete a `filter` object | 2,350 | 1,047 | 55.4 % |
| `value: N` → `N−1000` | 507 | 139 | 72.6 % |
| `comparison` flip | 1,212 | 312 | 74.3 % |
| `zones: […]` drop `"leader"` *(new)* | 245 | 40 | 83.7 % |
| `amount: N` → `N−1` *(new)* | 347 | 22 | 93.7 % |
| `player` self ↔ opponent *(new)* | 2,633 | 92 | 96.5 % |
| drop a `keywords` member *(new)* | 230 | 8 | 96.5 % |
| `value: -N` sign flip / step *(new)* | 296 | 9 | 97.0 % |
| **total** | **9,237** | **2,366 labelled** | **74.3 %** |

Labelled survivors sum to 2,366; the headline arithmetic gives 2,375 (9,237 − 6,862). The gap is
9 mutants on the 3 cards with no runnable test (`ST04-003`, `ST04-005_p1`, `PRB02-006_p2`), which
are recorded once per card rather than once per mutant.

Three readings:

- **`zone: "field"` → `"character"` is still 15/15 unkillable.** The new `zones:` narrow operator
  was expected to be the same story and is not: 83.7 % of `"leader"`-dropping mutants die. The
  corpus does exercise Leader-inclusion through the array spelling — just never through the
  singular one.
- **Condition objects are the new largest finding surface.** 573 surviving deletions — gates no
  test consults — nearly matching the filter-deletion surface (1,047) at half the sites. This is
  the "never consulted" defect class in its second spelling, now measured for the first time.
- **Player flips almost always die (96.5 %).** Targeting the wrong side of the board is the one
  defect class upstream's tests reliably catch — plausible, since a fixture's chosen target simply
  is not there for the flipped mutant. The 92 survivors are the interesting residue, not the rate.

### The 21 zero-mutant cards

`OP01-008`, `OP01-093`, `OP01-113`, `OP02-075`, `OP02-104`, `OP03-059`, `OP03-100`, `OP04-113`,
`OP05-073`, `OP05-105`, `OP06-099`, `OP08-058`, `OP08-063`, `OP08-068`, `OP09-068`, `OP09-076`,
`ST12-012`, `OP14-023`, `OP14-056`, `EB02-053`, `ST20-003`.

These are honestly thin, not operator misses: their entire decision surface is a `playThisCard`
trigger, an `addDon amount: 1, upTo: true` (the amount operator skips both guards deliberately),
or a self-targeted grant with no condition. They become reachable only with rank 7 (delete a
cost), which remains an open proposal.

### Runner changes in this run

`tools/mutation_sweep.py` gained three things, each in response to an observed stall:

- **Per-card record flushing** plus a **persistent mid-card progress file**
  (`runs/<SET>.jsonl.progress.json`, transient, not committed): a card's partial tally survives a
  budget stop, so re-runs resume mid-card instead of restarting it.
- **Batches sorted by mutant count ascending.** Batch depth is near-uniform; without the sort, a
  deep batch exceeded the 300 s execution window and was restarted forever by `--resume`.
- **`--cap 16`** (was effectively 120): records are written per *completed* batch, and a 120-card
  batch costs `(1 + max-mutants)` full-union vitest runs — over 10 minutes on this host — so no
  batch ever finished inside a budget window. At 16 a batch is ~100 s. Disjointness, the
  correctness property, is cap-independent.

The driver is `runs/sweep_wide.sh` (8 workers, `SWEEP_BUDGET=270` per invocation, per-PID waits).
Total wall time was ~3.5 h across the bounded invocations.

---

## The sets this repo owns — run 2026-08-22

The 2026-08-21 sweep above left OP15/OP16 on the five-operator instrument, so the corpus was
**mixed**: 19 sets at eleven operators, two at five, and a naive aggregate over `runs/*.jsonl`
reported a kill rate that described neither. This run closes that, and adds the two encodings `main`
gained after 08-21 (`EB04-058`, `ST12-010`), which were in no record at all.

**Run conditions.** Merged-`main` tree, engine rebuilt from pristine upstream `e3200bad` → 51
patches → 707 files grafted → 985 corrections, `patch_engine.py --check` and
`correct_cards.py --check` both clean. Baseline suite **3,670 files / 6,136 pass / 2 skipped /
0 fail**. OP15/OP16 via `runs/mutation_shard.py` (the `--set` path, one `mutation_check.py --card`
process per card) on 5 workers; the vendor sets via `mutation_sweep.py --vendor-set` on 8 clones.
No card recorded `baseline-red`.

**The first attempt was abandoned, and the reason is a defect in the instrument.** It ran at load
**67** on this 10-core host because another process was running the engine suite out of the shared
`vendor/`. `vite.config.ts` sets no `testTimeout`, so vitest's default is 5 s per test, and
`_run_tests` returns `proc.returncode == 0` — a timeout is scored as a **killed mutant**, and the
bias is one-directional: it inflates the kill rate and hides survivors. The run was re-done at load
< 15. Every kill rate on this page is therefore a statement about the machine it was measured on,
not only about the encodings.

### The sets this repo owns

| set | cards | mutants | killed | kill rate |
|---|---:|---:|---:|---:|
| OP15, five operators (archived to `runs/v2/`) | 105 | 256 | 256 | 100 % |
| OP16, five operators (archived to `runs/v2/`) | 108 | 286 | 286 | 100 % |
| **OP15, eleven operators** | 105 | **611** | **602** | **98.5 %** |
| **OP16, eleven operators** | 108 | **595** | **593** | **99.7 %** |
| `ST12-010` (never swept before) | 1 | 10 | 10 | 100 % |
| `EB04-058` (never swept before) | 1 | 5 | 5 | 100 % |

**Every one of the 11 survivors is in an operator class that did not exist on 08-19.** Under the
original five, OP15/OP16 still kill 100 %. So this is not a regression in the encodings or their
tests; it is the wider instrument reaching sites the old one could not perturb — and it reaches them
in tests that were authored *with* `mutation_check.py` in the loop, which is the interesting part.

| card | surviving mutant |
|---|---|
| `OP15-021` | `player opponent->self @L72` |
| `OP15-021` | `value -3000->-2000 @L73` |
| `OP15-021` | `value -3000->3000 @L73` |
| `OP15-024` | `delete condition:turn @L47` |
| `OP15-054` | `amount 2->1 @L39` |
| `OP15-056` | `amount 2->1 @L57` |
| `OP15-056` | `delete condition:leaderName @L44` |
| `OP15-056` | `player self->opponent @L57` |
| `OP15-095` | `delete condition:zoneCount @L59` |
| `OP16-048` | `zones drop "leader" @L70` |
| `OP16-076` | `zones drop "leader" @L64` |

By class: `delete condition:` 3, `player` flip 2, negative-`value` sign/step 2, `amount N−1` 2,
`zones drop "leader"` 2. Four cards produce zero mutants (1 OP15, 3 OP16) and are **unverified**,
not passing.

### Triage 2026-08-22 — all 11 are bucket A

Print plus `parse_rulings.py --card` on each of the 7 cards agrees with the existing encodings.
No card is B, C, or D; no DSL change. The 08-22 sweep row above is the measurement; this is
the adjudication. Pinning tests landed on the same tree and
`python3 tools/mutation_check.py --card` now reports, card for card:

| card | before (08-22 sweep) | after pinning tests |
|---|---|---|
| `OP15-021` | 8/11 | **11/11** |
| `OP15-024` | 4/5 | **5/5** |
| `OP15-054` | 8/9 | **9/9** |
| `OP15-056` | 6/9 | **9/9** |
| `OP15-095` | 12/13 | **13/13** |
| `OP16-048` | 7/8 | **8/8** |
| `OP16-076` | 9/10 | **10/10** |

The 11 labels that died are exactly the 11 in the table. `runs/OP15.jsonl` and `runs/OP16.jsonl`
are left as the 08-22 sweep record. `OP15-112` was already 6/6 and was not re-opened.

**Independently replicated.** A different session, on a different tree, ran
`mutation_shard.py --fresh` over OP15+OP16 on 2026-08-21 after the operator widening merged and
recorded the same eight cards at the same per-card figures — `OP15-021` 8/11, `OP15-024` 4/5,
`OP15-054` 8/9, `OP15-056` 6/9, `OP15-095` 12/13, `OP15-112` 5/6, `OP16-048` 7/8, `OP16-076` 9/10
(banked in `CLAUDE.md`). Eight of eight, card for card and label for label. That measurement read
all eight as *stale records* and deferred them to this run; seven of the eight were exactly that,
and the eighth (`OP15-112`) was not — see below. Treat the agreement as the strongest corroboration
either run has, and the one disagreement as the reason a "stale corpus" explanation still has to be
checked card by card.

### One card was a real regression, and the cause was a fixture the trait fix de-fanged

`OP15-112` Raki's `delete filter:cardCategory` mutant was **killed** in the five-operator record and
**survived** here — the only killed→survivor move anywhere in this run, and it reproduced on an
independent re-run. It is not engine drift. `cards/tests/OP15/112-raki.test.ts` built its
false-positive Stage with a **joined trait string**, `traits: ["Sky Island Shandian Warrior"]` — the
exact shape PR #30 eliminated across 838 real cards:

- under substring matching, `filter: "trait", value: "Shandian Warrior"` matched that joined
  string, so the Stage reached the candidate pool and only `cardCategory` excluded it — deleting
  `cardCategory` changed the answer, and the mutant died;
- under whole-trait equality, the trait filter rejects the Stage by itself, `cardCategory` stops
  being load-bearing, and the mutant survives while the test stays green.

#30 corrected 17 upstream fixtures of this shape and missed this one, because the sweep that would
have caught it had not been re-run under the widened instrument. Split to
`["Sky Island", "Shandian Warrior"]`: test still passes, card back to **6/6**. Every trait string in
`cards/tests/` was then checked against the 160 exact trait tokens in the corrected catalog —
**this was the only one**.

### Drift, measured rather than assumed

`main` moved 40 commits past the 08-21 measurement, including #31 (the `basePower` filter, ruling
#762 — 50 filter sites across 13 sets) and #34 (timed base-power replacements). `OP14EB04` was
re-swept fresh as the probe: it carries **13 of the 50** `basePower` sites, the densest pre-OP15 set,
and it is where `EB04-058` landed.

| | cards | mutants | killed |
|---|---:|---:|---:|
| recorded 08-21 | 141 | 919 | 659 |
| re-swept 08-22 | 142 | 930 | 670 |

Every change is attributable to #30's trait work, and **not one mutant moved killed → survivor**:

- `OP14-043`, `OP14-046`, `OP14-047` each lost a `delete filter:trait` **survivor** — whole-trait
  matching made those filters load-bearing, so three mutants that used to survive now die;
- `OP14-084`, `OP14-087`, `OP14-088` each gained a `delete condition:leaderTrait` site from the
  trait-closure corrections (their sources grew, which is also why their other labels shifted line);
- `EB04-058` records `ok`, 5/5.

So #31 and #34 caused no regression, consistent with the standing note that no encoded
`setBasePower` target uses a power/basePower filter.

### Ten more sets were stale, and a guard found them

`runs/merge_results.py` compares each set's recorded mutant total against what the current
`tools/mutation_check.py` produces for that set's encodings. Ten pre-OP15 sets disagreed — their
records predated `main`'s trait-closure corrections and new encodings, which **added** mutation
sites. All ten were re-swept: `EB01`, `EB02`, `OP02`, `OP03`, `OP04`, `OP08`, `OP10`, `OP12`,
`OP13`, `PRB02`. This is why the corpus total below is not the 08-21 figure plus OP15/OP16.

### The whole corpus, one instrument, one tree

| corpus | cards | mutants | killed | kill rate |
|---|---:|---:|---:|---:|
| pre-OP15, five operators (2026-08-19) | 1,419 | 4,307 | 2,685 | 62.3 % |
| pre-OP15, eleven operators (2026-08-21) | 1,750 | 9,237 | 6,862 | 74.3 % |
| **everything, eleven operators (2026-08-22)** | **1,961** | **10,548** | **8,106** | **76.8 %** |

Every one of the 22 sets reports 100 % coverage — every encoded card that produces a mutant has a
record. `runs/status.sh` totals it; `runs/merge_results.py` writes `runs/all-results.json` and exits
0 only when no set is stale.

**Do not read the 76.8 % as the 74.3 % having improved.** They are different corpora on different
trees: ten pre-OP15 sets were re-swept between them, OP15/OP16/ST12/EB04-058 were added, and the
trait fix moved individual mutants in both directions. The comparison that *is* meaningful is
within this row: **the encodings this repo authored kill 99.1 % (1,210/1,221 counting `ST12-010` and
`EB04-058`) against upstream's 63–84 % per set**, same instrument, same tree, same day. That gap is
the whole argument for authoring against a mutation harness — and the 11 survivors are the argument
for widening the harness afterwards.

### Loose ends

- ~~`runs/all-results.json` is stale~~ — **closed 2026-08-22.** It had no producer at all; there is
  now `runs/merge_results.py`, which rebuilds it and refuses to write a mixed-instrument aggregate.
- The 16 fully-vacuous cards (`EB02-037`, `EB03-018`, `OP03-110`, `OP04-102`, `OP04-058`,
  `OP06-002`, `OP06-110`, `OP06-109`, `ST04-005_p1`, `OP09-103`, `OP10-113`, `OP10-043`,
  `OP12-072`, `OP13-106`, `PRB02-006_p2`, `ST04-003`) are the priority adjudication list — down
  from 177. `runs/triage/group*.json` still reflects the old list.
