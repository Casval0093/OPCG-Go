# What the mutation operators cannot see

Companion to `docs/mutation-sweep.md`. The sweep's 62.4 % kill rate is a statement about the 4,297
perturbations five operators can make. This is the inventory of everything they cannot, so the kill
rate is never read as coverage.

Every count here was computed over the 1,983 card definitions carrying an `effects:` block, scoped
to the `effects: { … }` body in a comment-masked copy — unscoped, the card's own `name:`,
its printings' `id:` and `artVariants[].type:` all become false mutation sites.

## The five current operators

| # | site | perturbation | defect class it models |
|---|---|---|---|
| 1 | `{ filter: "…" … }` | delete the object | a target filter no test consults |
| 2 | `comparison: "…"` | `gte→lte`, `lte→gte`, `eq→gte` | ruling #962/#963: "power N" means exactly N |
| 3 | `value: N` (N ≥ 1000) | `N − 1000` | threshold off by one power step |
| 4 | `zone: "field"` | `→ "character"` | C1/C2: the Leader silently excluded |
| 5 | `oncePerTurn: true` | `→ false` | a frequency guard that is never charged |

## Reach, measured

**352 of the 1,771 pre-OP15 encodings (19.9 %) produce no mutant at all** — 384 of 1,983 across all
sets. Those cards are not verified by a sweep; they are unperturbable by it, which is a different
and much weaker statement. Characters carry the overwhelming majority of the gap (~91 %), because
event text is almost always a filtered removal or search and so trips operator 1.

The reason is that four of the five operators key on syntax this corpus barely uses:

| decision site inside `effects: {}` | sites | files | reachable today? |
|---|---:|---:|---|
| `amount:` (counts and quantities) | 3,736 | 1,874 | no |
| `player: "self" \| "opponent"` | 3,364 | 1,842 | no |
| `zones: [ … ]` | 1,900 | 1,366 | no |
| `upTo: true` | 1,858 | 1,404 | no |
| `{ condition: "…" … }` | 1,305 | 935 | no |
| `value:` 0–999 | 1,184 | 919 | no — operator 3 guards on `N ≥ 1000` |
| `duration: "…"` | 934 | 776 | no |
| `match: "includes"` | 864 | 706 | no |
| `{ cost: "…" … }` | 779 | 668 | no |
| `optional: true` | 666 | 641 | no |
| `zones: ["leader", "character"]` | 272 | 235 | no — **this is operator 4's real target** |
| `keywords: [ … ]` | 257 | 257 | no |
| `value:` negative | 200 | 183 | no — the regex cannot match a `-` |
| `selfComparison:` | 41 | 40 | no — operator 2's needle is lowercase `comparison:` |
| `zone: "field"` | 27 | 23 | **yes**, operator 4 |

Two of these are outright bugs rather than gaps:

- **Operator 4 is aimed at the wrong spelling.** `Target` declares `zones: Zone[]`; the singular
  `zone:` exists only on four *condition* types. So the operator fires on 27 sites while the
  Leader-inclusion distinction it exists to test lives on 272 `["leader", "character"]` sites. It
  survives 15/15 where it does fire, so the defect class is real and almost entirely unmeasured.
- **Every debuff in the corpus is unmutated.** Operator 3's site regex is `value:\s*(\d{3,6})`,
  which a leading minus defeats. That is the exact field where `tools/variant_audit.py` already
  found 16 printings that lost their `−` — the project has a documented instance of this defect
  class and no instrument that can look for it.

A third, smaller one: operator 5 uses `re.search`, not `re.finditer`, so it mutates only the first
`oncePerTurn` in a file. Nine files carry more than one.

## Proposed operators, ranked

Reach is measured, not estimated. Type validity was checked against the union declarations in
`packages/types/src/effect/`; a proposal that cannot be shown type-valid is not listed.

| rank | operator | site | perturbation | reach (cards / mutants, all sets) | models |
|---|---|---|---|---|---|
| 1 | **player flip** ✅ | `player: "self"\|"opponent"`, excluding objects with `self: true` and `shuffleDeck` | swap | ~1,640 / ~2,950 | targeting the wrong side of the board |
| 2 | **delete a condition** ✅ | `{ condition: "…" … }` under `conditions`/`condition` | delete the element, or the whole key for the singular form | ~837 / ~1,183 | a gate no test consults — operator 1's shape, different spelling |
| 3 | **negative value sign / step** ✅ | `value: -N` | `-N → N`, and `-N ∓ 1000` for power | ~163 / ~178 and ~106 / ~118 | the documented lost-`−` defect |
| 4 | **zones narrow** ✅ | `zones: [ … ]`, length ≥ 2 | drop `"leader"` | ~219 / ~518 | C1/C2, in the spelling the corpus actually uses |
| 5 | **amount ± 1** ✅ | `amount:` outside `upTo` blocks | `N → N−1` (N ≥ 2) | ~526 sites | "up to 2" encoded as "up to 1" |
| 6 | **drop a keyword** ✅ | `keywords: [ … ]` | remove one member | ~229 / ~230 | a missing or spurious `[Blocker]`/`[Rush]` |

**Ranks 1–6 were adopted on 2026-08-21** (`claude/mutation-operators-widened`). Measured reach on the
pre-OP15 corpus, against the estimates above:

| rank | estimated mutants | measured mutants (pre-OP15) | killed |
|---|---:|---:|---:|
| 1 player flip | ~2,950 | 2,633 | **96.5 %** |
| 2 delete condition | ~1,183 | 1,179 | **51.4 %** |
| 3 negative value | ~296 | 296 | **97.0 %** |
| 4 zones narrow | ~518 | 245 | 83.7 % |
| 5 amount −1 | ~526 | 347 | 93.7 % |
| 6 keyword drop | ~230 | 230 | 96.5 % |

Ranks 2, 3 and 6 landed almost exactly on the estimates. Rank 1 came in ~11 % under (the
`self: true`/`shuffleDeck` exclusions bite more than the window count suggested). Rank 4 is the
outlier at about half the estimate: the estimate counted every `zones:` array of length ≥ 2, but
the operator only fires where `"leader"` is actually a member — 245 such sites exist, the rest are
`["character", "stage"]`-type arrays where narrowing models nothing. Rank 5's guard (skip
`upTo: true` objects, skip `amount: 1`) removes about a third of the raw `amount:` sites the
estimate counted.

**The zero-mutant set fell from 352 to 21, not to ~2.** The ~2 estimate assumed ranks 1–6 *plus*
rank 7 (delete a cost). Without rank 7, a card whose only decision surface is a cost — a
`playThisCard` trigger with no filter, an `addDon` with `amount: 1, upTo: true` (amount −1 skips
both guards), a self-targeted grant with no condition — still produces no mutant. The 21 are
listed in `docs/mutation-sweep.md`; they are honestly thin, not operator misses.
| 7 | **delete a cost** | `{ cost: "…" … }` | delete the element | ~598 / ~698 | a printed cost never charged |
| 8 | **boundary shift** | `(self)?comparison: "lte"\|"gte"` | `lte→lt`, `gte→gt` | ~983 files | ruling #962/#963, without touching the threshold |
| 9 | **match flip** | `match: "includes"` | `→ "exact"` | ~621 / ~768 | ties directly to the open trait-matching work |
| 10 | **duration swap** (guarded) | `duration: "thisTurn"\|"thisBattle"` outside `permanentEffects` | swap | ~679 / ~814 | a temporary buff encoded as permanent |

Adopting ranks 1–6 took the pre-OP15 corpus from 4,307 to 9,237 mutants (~2.1x, not the ~3x the
all-sets estimate implied) and the zero-mutant set from 352 to 21. The sweep took ~3.5 h with the
batched runner across 8 clones. Ranks 7–10 remain open proposals.

### Type-validity traps found while checking

Three proposals would emit code that does not type-check unless guarded, and the guard has to be
the *innermost enclosing object's discriminant*, not a character window:

- `BattleKoReplacementAction.duration` is `Extract<Duration, "thisTurn">` and
  `ModifyLeaderPowerCost.duration` is the literal `"thisTurn"`. A naive duration swap breaks the
  build on 8 constrained sites.
- `ReturnCharacterToDeckCost.zones` is `Array<"character" | "stage">`, so widening zones with
  `"leader"` would be rejected there.
- `ConditionalAction.predicate` is a **required** `Condition`, so the condition-deletion operator
  must skip it (4 sites). It must also detect a preceding `:` and delete the key along with the
  object, or it emits `condition: ,`.

### Rejected, and why

The design constraint is that operators model real ruling-conformance defects, not maximise a
coverage percentage. These were rejected on that basis:

- **`trigger:` mutation (~2,335 sites).** A test must fire the trigger for the ability to run at
  all, so mutating it makes the ability unreachable and the mutant dies ~100 % of the time by an
  unrelated mechanism. Maximum runtime, no diagnostic content — the mirror image of a vacuous
  assertion.
- **`upTo: true` deletion (~1,858 sites).** With `amount: 1, upTo: true` and at least one legal
  target, a test that selects that target resolves identically without `upTo`. Over a thousand
  equivalent-by-fixture survivors would drown the real findings.
- **Raising a `count.amount` under `upTo: true` (~1,537 sites).** Raising an upper bound the
  fixture does not saturate is unobservable. Only the narrowing direction can be killed.
- **Widening `zones: ["character"]` to include the Leader (~1,260 sites).** The Leader is not a
  legal object for `ko`/`trashFromField`/`returnToHand`, so the engine filters it and the mutant is
  exactly equivalent. It also models the rarer direction of the C1/C2 defect.
- **`duration: "permanent"` inside `permanentEffects` (236 of 239 sites).** The block type forces
  permanence; no encoder writes that defect.

One accepted proposal with a stated weakness: `optional: true → false` will die at close to 100 %,
but usually because the mutant removes a prompt the test's command queue expects, not because
anything asserts optionality. Keep it — it is a named defect class — but do not read its kill rate
as evidence about ruling conformance.

## Why this was a separate branch

Adding operators changes what the kill rate means, so the 62.3 % baseline in
`docs/mutation-sweep.md` was left standing as measured before the instrument was widened. The
widening landed on `claude/mutation-operators-widened` with its own verification burden discharged:
each new operator's reach counted (table above), its type validity shown (a fully-mutated tree
passes `tsc` with zero diff against the baseline diagnostics), its guards mutation-verified
red-when-removed, and the batched runner's agreement with the serial one re-checked afterwards
(10 cards / 86 mutants, card-for-card and label-for-label, on the same tree the sweep ran on).
