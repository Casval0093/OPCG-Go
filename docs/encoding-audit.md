# Encoding audit — OP01–OP14 correctness, and what is missing from the catalog

Run date **2026-08-19**. Engine: vendored `TheCardGoat/tcg-engines`, patched by
`tools/patch_engine.py` (all 5 patches applied). Reference: the official Bandai
list via `one-piece-card-game-json@0.2.53`. Adjudicator for every disputed card:
`onepiece.limitlesstcg.com/cards/<ID>`.

Re-run with:

```bash
python3 tools/audit_encodings.py --json data/encoding-audit.json
```

## The headline, and why the test suite did not already tell us

**The engine's per-card suite is green — 3666 files, 6078 tests, 0 failures, 87s —
and OP01–OP14 still contains verified defects.** The suite cannot see them,
because a per-card test asserts that the encoding matches *the text the encoder
read*. When that text was wrong, the test is wrong in the same direction and
passes.

The proof case is **`OP06-054` Borsalino**, Block 2, Standard-legal. Printed
(Limitless): *"If you have **5 or less** cards in your hand, this Character gains
[Blocker]."* The encoding is `condition: handCount, comparison: lte, value: 4`.
And `tests/cards/characters/op06-054-borsalino.test.ts` contains:

```ts
test("does not gain Blocker with five cards in hand", () => { ... })
```

That assertion is the opposite of the card. It passes. **A green suite is
therefore evidence that the encodings are self-consistent, not that they are
correct** — and this test will actively resist the fix.

## Neither source is authoritative — check both

Of the printed-text divergences adjudicated on Limitless, **the engine was right
as often as it was wrong**:

| Card | Engine | Dataset | Winner |
|---|---|---|---|
| `OP06-054` | hand ≤ 4 | hand ≤ 5 | **dataset** |
| `OP13-084` | `[On Play]` search | `[Your Turn]` set base power 7000 | **dataset** |
| `OP09-058` | opponent chooses | you return | **engine** |
| `OP11-020` | `[Main]` −2000 power | `[Counter]` +2000 power | **engine** |
| `OP13-077` | "during this turn" | "during this battle" | **engine** |
| `OP05-032` | "rest 1" | "rest up to 1" | **engine** |

Do not bulk-apply the dataset over the engine. `audit_encodings.py` reports
divergences and deliberately declines to pick a winner.

## Findings, by severity

### 1. Wrong numeric stats — 13 cards, 11 Standard-legal

Counter and cost feed combat math directly, so these change game outcomes.
All verified against Limitless; **the engine is wrong in every case**.

| Card | Field | Engine | Correct | Legal |
|---|---|---|---|---|
| `OP06-051` Tsuru | counter | 4000 | **2000** | Standard |
| `OP08-082` Sasaki | counter | 1000 | **2000** | Standard |
| `OP10-043` Moocy | counter | 1000 | **2000** | Standard |
| `OP14-019` | cost | 4 | **1** | Standard |
| `EB03-009` Makino | power, counter | *both absent* | **0 / +2000** | Standard |
| `EB03-050` Conis | power | *absent* | **0** | Standard |
| `EB04-025` Vivi | counter | *absent* | **+1000** | Standard |
| `OP08-061` Oven | counter | *absent* | **+1000** | Standard |
| `OP14-031` Nami | counter | *absent* | **+1000** | Standard |
| `ST17-002` Law | counter | *absent* | **+1000** | Standard |
| `OP01-016` Nami | counter | 2000 | **1000** | rotated |
| `OP03-112` Pudding | counter | 2000 | **1000** | rotated |

The six *absent* rows are a distinct bug from the four wrong-value rows: the
engine omits the key entirely. Two are 0-power characters, which is the mirror of
the `-`-means-0 defect already documented in `CLAUDE.md` for the importer — here
it is the engine's own data that dropped the field.

### 2. Trait matching is structurally unsound — 175 Standard-legal false matches

Upstream sets store a multi-trait card as **one space-joined string**:
`OP01-003` Luffy has traits *Straw Hat Crew* and *Supernovas* and is stored
`traits: ["Straw Hat Crew Supernovas"]`. This project's own OP15/OP16 encodings
store them correctly as `["A", "B"]`, so the defect is upstream's, not ours.

`effects/targeting.ts` matches a trait filter two ways:

```ts
filter.match === "includes"
  ? (card.traits ?? []).some((trait) => trait.includes(expectedTrait))  // substring
  : (card.traits ?? []).includes(expectedTrait),                        // exact element
```

**597 of 599 trait filters set `match: "includes"`**, so substring matching is
what makes the joined store work at all. It also makes the store wrong, because
**19 of the 164 official traits are proper substrings of another official trait**.

- `Animal` matches all 84 `Animal Kingdom Pirates` cards (41 Standard)
- `Fish-Man` matches 29 `Fish-Man Island` cards
- `Baroque Works` matches 17 `Former Baroque Works` cards
- **`Whitebeard Pirates` matches 16 `Former Whitebeard Pirates` / `Whitebeard Pirates Allies` cards (10 Standard)**
- `Navy` matches 14 `Former Navy` / `Neo Navy` cards
- `Roger Pirates` matches 8 `Former Roger Pirates` cards

The `Whitebeard Pirates` row is on this project's critical path: **`OP16-001`
Ace's [Rush] grant keys on that trait**, and ruling #961 already establishes the
grant is narrower than it reads, not wider. The engine is currently more generous
than the card in a way that flatters the Ace deck.

`CP` (14 filters) and `GERMA` (7) are *not* official traits — upstream appears to
use them as deliberate prefix matches over `CP0/CP6/CP7/CP9` and
`GERMA 66/Kingdom of GERMA`. Those two are plausibly intentional; the other 13
are not.

The reverse also occurs, though far more rarely — **3 Standard-legal missed
matches**, where the card has the trait and the engine denies it: `OP05-096`
(traits `[]`, and its own effect keys on `{Celestial Dragons}`), `OP05-040`
(`["NULL"]`), `OP11-012`. Case matters too: 15 cards store `Film` against the 15
filters looking for `FILM` (all rotated).

#### The fix is two halves, and neither works alone

Splitting the joined strings is a **precondition, not the fix**. With traits
split but `includes` semantics kept, the false matches survive untouched —
`"Former Whitebeard Pirates".includes("Whitebeard Pirates")` is still true.
Exact matching alone does not work either, because it fails against a joined
store. Both halves are required:

1. Split the 838 joined `traits` values into real arrays. Mechanical.
2. Collapse the two branches in `targeting.ts` to the array-membership form
   `(card.traits ?? []).includes(expectedTrait)`.

**Step 2 leaves all 597 `match: "includes"` declarations untouched** — once
traits are split, "the card's trait list includes this value" is exactly what
those filters already mean. That is the whole simplification: no filter rewrite,
one matcher line.

The only casualties are the **21 filters with genuine prefix intent** — `CP`
(14) and `GERMA` (7), neither of which is an official trait. Rewrite them to
enumerate `CP0/CP6/CP7/CP9` and `GERMA 66/Kingdom of GERMA`, or add a distinct
`match: "prefix"` mode for them. `projection.ts:283` emits
`operator: "includes"` as display metadata only and does not affect matching,
but should be aligned for consistency.

Note that the 15 false-match values have two different causes and both are
resolved by the pair above: some are joined-store artifacts (`Merfolk` via
`["The Sun Pirates Merfolk Fish-Man Island"]`, `SWORD` via `["Navy SWORD"]`),
which step 1 fixes; the rest are genuine trait-substring collisions
(`Whitebeard Pirates`, `Navy`, `Animal`), which need step 2.

This is an engine behaviour change, not a data correction, so it wants its own
branch and a before/after run of the full 6078-test suite.

### 3. Wrong or missing trait values — 41 cards, 9 Standard-legal

Verified on Limitless; the engine is wrong in each checked case.

| Card | Engine | Correct |
|---|---|---|
| `OP11-012` Franky | `["Navy SWORD"]` | **Straw Hat Crew** |
| `EB03-034` Linlin | `["Big Mom Pirates"]` | **Rocks Pirates** |
| `OP05-096` | `[]` | **Celestial Dragons** |
| `OP05-040` | `["NULL"]` | **Donquixote Pirates** |
| `OP10-064` | `["The Vinsmoke Family Kingdom of GERMA"]` | **Kingdom of GERMA** only |
| `OP07-004`, `OP07-009`, `OP13-009`, `OP13-013` | `["Mountain Bandits Mountain Bandits"]` | duplicated |

Rotated but worth noting for the pattern: `OP01-018` stores the non-existent
trait `New Giant Pirate Crew` (correct: `New Giant Pirates`); `OP03-036`/`OP03-038`
store `["NULL"]`; **all 13 ST01 cards have `traits: []`** — the deck the
throughput benchmark and the harness validation runs use.

### 4. Ten `[Trigger]` abilities do not exist in the engine — 7 Standard-legal

The printed Trigger box is absent from both the text field and the `effects:`
encoding, so nothing fires when the card is taken as Life damage.

`EB04-028`, `OP06-056`, `OP06-102`, `OP06-103`, `OP08-076`, `OP12-101`,
`OP13-059` (Standard) · `OP01-029`, `OP03-039`, `OP03-110` (rotated).

Spot-verified on Limitless: `OP12-101` Bonney and `OP06-102` Kamakiri both
print the Trigger the engine lacks.

### 5. Printed text — 96.4% agreement across OP01–OP14

With markup normalised away (circled-digit DON!! costs, `&lt;Slash&gt;` vs
`(Slash)`, `[Trait]` vs `"Trait"`, the errata footnote), **1606 of 1666 cards
agree**. Of the 60 divergences: 29 are the engine harmlessly repeating its
Trigger text inside `effect`; 31 are semantic; 17 of those are Standard-legal
and all 17 were adjudicated — **8 engine defects, 4 dataset defects, 5 cosmetic**.

### 6. 70 Standard-legal encodings that no test even mentions

Counting a bare ID mention as coverage — a generous upper bound — leaves
`OP11` 12, `OP12` 22, `OP13` 2, `OP14` 8, **`OP15` 14, `OP16` 12**, `ST01` 4.
The OP15/OP16 entries are ours, and `data/parked-clauses.json` explains only
some of them.

## What is absent from the catalog

**445 of the official list's cards have no definition in the engine; 242 are
Standard-legal.** Nothing is in the engine that is not in the official list
(engine-only count: 0), so this is purely a coverage gap.

| Group | Missing | Note |
|---|---|---|
| **EB04** | **31 of 61** | Block 4, the newest Extra Booster — half absent |
| **ST10–ST36** | **199** | `ST22`, `ST29`, `ST30`, `ST23–ST28`, `ST31–ST36` entirely absent |
| OP01–OP14 | 10 | `OP08-006`, `OP08-119`, `OP10-110`, `OP12-016`–`019`, `OP12-055`, `OP13-079`, `OP13-082` |
| EB01, EB02 | 1 each | `EB01-003`, `EB02-035` |
| P promos | 86 of 105 | legality varies by promo |
| ST01–ST09 | 117 | rotated, no action needed |

Two structural facts about how the engine stores non-OP sets, both of which
mislead a naive directory listing:

- **There is no `ST02`–`ST36` directory.** The ST cards the engine does have
  live inside `PRB01`/`PRB02` as premium-booster reprints, carrying their
  original `id` (`ST13-019`) with `setId: "PRB02"`. So ST coverage is incidental,
  not deliberate.
- **`OP14` and `EB04` share one directory** (`OP14EB04`), and `PRB01`/`PRB02`
  pack many card definitions per file — which is why encoding presence must be
  detected per object literal, not per file.

The 10 missing OP cards are not a modelled-type limitation: `OP12-017` is an
ordinary red Event, `OP08-119` an ordinary Character (albeit with the dual
`Strike/Special` attribute). They are simply absent.

## Recommended order of work

1. **Fix the 11 Standard-legal numeric stats** — smallest change, direct effect
   on combat math, and `EB03-009`/`EB03-050` currently have no power at all.
2. **Fix trait matching as one two-part change** — split the 838 joined values
   *and* collapse the `targeting.ts` branches to array membership. Neither half
   works alone (see above); together they need no filter rewrite beyond the 21
   deliberate `CP`/`GERMA` prefix filters. Leaving it keeps 175 Standard-legal
   false matches, one class of which flatters the Ace deck.
3. **Add the 7 Standard-legal missing Triggers.**
4. **Fix `OP06-054` and its test together** — the test asserts the defect.
5. **`EB04`'s 31 missing cards** are the largest single competitive gap, and
   `EB04-028`'s Trigger is already on the list above.

`ST10`–`ST36` matter far less than their count suggests: starter-deck cards are
mostly reprints or off-meta, and no current sim deck draws on them.
