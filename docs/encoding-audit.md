# Encoding audit — OP01–OP14 correctness, and what is missing from the catalog

Run date **2026-08-19**. Engine: vendored `TheCardGoat/tcg-engines`, patched by
`tools/patch_engine.py` (all 7 patches applied). Reference: the official Bandai
list via `one-piece-card-game-json@0.2.53`. Adjudicator for every disputed card:
`onepiece.limitlesstcg.com/cards/<ID>`.

Re-run with:

```bash
python3 tools/audit_encodings.py --json data/encoding-audit.json
```

## Status — 48 corrections applied 2026-08-19

Everything in §1 and §3 is **fixed**. The corrections live in `data/card-corrections.json` as a
reviewable table and are applied to the disposable `vendor/` tree by `tools/correct_cards.py`, the
card-data sibling of `tools/patch_engine.py`; `scripts/bootstrap.sh` runs it so they survive a
re-clone. Every `to` value was adjudicated against Limitless by `tools/verify_limitless.py`, which
automates the per-card check this document previously did by hand.

| | before | after |
|---|---|---|
| numeric field disagreements | 13 (11 Standard) | **0** |
| trait value disagreements | 29 (9 Standard) | **0** |
| trait filter **missed** matches | 21 cards | **0** |
| trait filter **false** matches | 250 cards (175 Standard) | **0 — trait matching collapsed to whole-trait equality 2026-08-21 (§2 done: the two `... match whole traits, never substrings` engine patches, joined storage split, "type including" sites enumerated per CR 2-4-3-1; suite 6079 → 6079 pass)** |
| printed-text agreement, OP01–14 | 1607/1666 | **1609/1666 (96.6%)** |
| engine test suite | 6078 pass / 0 fail | **6079 pass / 0 fail** |

48 corrections: 13 numeric, 29 traits, 5 printed-text, 1 encoding. 26 Standard-legal. Sets touched
include the non-`OP` packs — `EB01`, `EB03`, `EB04`, `ST01`, and `ST17` (which lives inside `PRB02`
as a reprint).

**Every correction was then second-sourced against the official Bandai EN list**
(`en.onepiece-cardgame.com/cardlist/`, `POST freewords=<ID>&search=true`), independently of the
Limitless scraper that produced the values — a scraper bug would otherwise have skewed all 48 in the
same direction undetected. Result: **48/48 confirmed, 0 contradicted, 0 unverifiable.** The numeric
and trait rows also agree field-for-field between two different official access paths (per-card
`freewords` POST and per-set `?series=` GET), and perturbing each value flips it away from `to`
(42/42), so the unanimous result is a finding and not a check that cannot fail.

Two things learned at the official source and worth keeping:

- **`EB04` has no series id of its own.** Its cards sit under `?series=569114`, labelled
  `[OP14-EB04]` — the same shared arrangement the engine uses with its `OP14EB04` directory. A
  guessed `569204` returns an empty page.
- **The official EN site prints counter bare (`2000`), not `+2000`.** The `+` is a Limitless/JP
  convention. It also confirms Bandai's `-` overload at the primary source: across 1,872 card blocks
  the literal string `0` never appears for cost/power/counter, so `-` is its only rendering of a real
  0 — and ~90 base printings are Characters with `-` power. `CLAUDE.md`'s standing warning holds:
  never give any tool here a blanket `- → 0`, because a Character's counter is genuinely optional.

**One thing deliberately NOT done, for the reason recorded below:** the ten missing `[Trigger]`
abilities in §4 (text alone would make them worse, not better — see the code reading there).
The §2 trait-matching change this line used to defer is DONE (2026-08-21): both halves landed —
the 838 joined trait strings are split and both substring sites (`targeting.ts` filters and
`conditions.ts` `leaderTrait`) are collapsed to whole-trait equality. One premise correction
worth recording: the old note claimed the substring behaviour was "more generous than the card"
on `OP16-001` Ace per ruling #961 — wrong on two counts. Ruling #961 is about the **power
threshold** binding both clauses of Ace's text, and Ace's trait reference is the
including-form ("a type including \"Whitebeard Pirates\""), which Comprehensive Rules 2-4-3-1
and the GENERAL 包含 ruling make cover Former/Allies *by rule*. The fix therefore *preserves*
Ace's coverage by enumeration; the real narrowing lands on brace-form references (`{Animal}`,
`{Navy}`, `{Baroque Works}`, …), which 2-4-3 makes exact.

### The correction pass found two more defects of its own

- **The audit overstated §3 by 13 cards.** `ST01` does not inline its traits — `ST01/index.ts`
  declares `const strawHat = ["Straw Hat Crew"];` and cards say `traits: strawHat`. The parser could
  not follow the reference and read it as `[]`, so all 13 ST01 cards were reported as defective.
  **12 of them were already correct, and correctly split.** Exactly one is real: `ST01-014`
  references `strawHat` where Limitless prints *Animal/Straw Hat Crew*. This also inflated the
  missed-match table by 17 cards. Fixed in `str_list`, which now follows a `const` reference and
  returns `None` — not `[]` — for a reference it cannot resolve, so "absent" and "empty" stay
  distinct.
- **`balanced` silently mis-scoped 68 definitions.** Our own OP15/OP16 encodings carry `//` comments
  containing apostrophes (`K.O.'d`, `the card's own effect`); the scanner read the apostrophe as a
  string opening and ran to end of file, and `balanced` returned `source[start:]` rather than
  failing. Fields were still found — they precede the overshoot — which is why the audit's numbers
  held up, but in a multi-card file like `PRB01`/`PRB02` it would have read a neighbour's fields.
  Now skips comments as well as strings. **Verified harmless: the audit's JSON output is
  byte-identical before and after the fix**, so it changed no conclusion in this document.

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

**It did resist, exactly as predicted, and that is now the evidence rather than the worry.**
Correcting the threshold to 5 turned this case red — 3 failures in 6078 tests, and nothing else. The
fix (patch 6 in `tools/patch_engine.py`) asserts **both** sides of the corrected boundary, 5 gains
and 6 does not, because a one-sided threshold test is what let the defect hide in the first place.

**A second case surfaced during the correction pass, and it is the same failure mode reached from the
other direction.** `tests/cards/characters/eb03-008-hibari.test.ts` used `OP11-012` Franky as its
SWORD-trait body across two tests. `OP11-012` is a **Straw Hat Crew** card; the engine had stored
`["Navy SWORD"]`. The card data and the test shared one wrong trait, so both tests passed while
asserting something the card cannot do. Correcting the trait turned them red; the `tests: EB03-008 Hibari used a non-SWORD card as its SWORD body`
patch substitutes
`OP11-092` Helmeppo, which is genuinely Navy/SWORD (checked on Limitless) and at 7000 power still
beats the 3000-power Doma both tests attack. **The lesson generalises past card text: a fixture that
picks the wrong card is as invisible to a green suite as an encoding that reads the wrong text.**

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

### 1. Wrong numeric stats — 13 cards, 11 Standard-legal — **FIXED**

Counter and cost feed combat math directly, so these change game outcomes.
All verified against Limitless; **the engine is wrong in every case** — this is the one section where
the adjudication was unanimous, and Limitless agreed with the npm dataset on all 13.

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

### 2. Trait matching is structurally unsound — 170 Standard-legal false matches

> **RESOLVED 2026-08-21.** Both halves below landed: the 838 joined strings are split
> (`tools/split_traits.py` regenerates the 840 generated rows of `data/card-corrections.json`),
> and the matcher collapsed to whole-trait equality at **both** substring sites —
> `targeting.ts` trait filters (the `targeting: trait filters match whole traits, never substrings`
> patch) and `conditions.ts` `leaderTrait`, where substring was the default on all 292 conditions
> (the `conditions: leaderTrait matches whole traits, never substrings` patch). Printed "type including" sites enumerate their
> closure per CR 2-4-3-1 (26 CP/GERMA rows + 64 Whitebeard/Baroque/Roger rows + the 5 OP16
> source cards). Suite 6079 → 6079 pass / 0 fail; false matches 170 → 0. **One claim in the
> analysis below is corrected: the Ace paragraph overstated the case** — see the note at the
> end of this section. The rest stands as the diagnostic record.

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

The reverse also occurred — missed matches, where the card has the trait and the engine denies it:
`OP05-096` (no `traits:` key, and its own effect keys on `{Celestial Dragons}`), `OP05-040`
(`["NULL"]`), `OP11-012`, and the `Film`/`FILM` case mismatch on 15 rotated cards. **All of these
were wrong *values*, so §3's corrections closed the whole class: missed matches are now 0.** That is
the clean split this audit did not originally draw — a missed match was always a data defect, while a
false match is a matcher defect.

The false-match numbers below are post-correction: **13 filter values, 246 cards, 170 Standard-legal**
(from 15/250/175 — fixing `OP11-012` and `OP10-064` removed the `SWORD` and `The Vinsmoke Family`
rows outright).

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

This was an engine behaviour change, not a data correction, so it landed on its own
footing with a before/after run of the full 6079-test suite: **6079 → 6079 pass / 0 fail**.

> **Correction to the Ace paragraph above (2026-08-21).** Ruling #961 is about the **power
> threshold** ("8000 power or more") binding both clauses of `OP16-001`'s text — it does not
> narrow the trait. And Ace's trait reference is the including-form: "a type including
> \"Whitebeard Pirates\"", which CR 2-4-3-1 plus the GENERAL 包含 ruling ("拥有的特征中包含'○○'"
> does include 《原○○》/《○○旗下》) make cover `Former Whitebeard Pirates` and
> `Whitebeard Pirates Allies` *by rule*. So on Ace specifically the old substring behaviour
> happened to be right, and the fix *preserves* that coverage by enumerating the closure. The
> genuine over-matching was on the brace-form references — `{Animal}` reaching all 84
> `Animal Kingdom Pirates`, `{Navy}` reaching `Former Navy`/`Neo Navy`, `{Baroque Works}`
> reaching `Former Baroque Works`, and the `leaderTrait` conditions reaching Former/Neo
> leaders — which CR 2-4-3 makes exact. `projection.ts`'s `operator: "includes"` remains
> display metadata, as noted above.

### 3. Wrong or missing trait values — 29 cards, 9 Standard-legal — **FIXED**

Every one adjudicated on Limitless, which agreed with the npm dataset in all 29.

| Card | Engine | Correct |
|---|---|---|
| `OP11-012` Franky | `["Navy SWORD"]` | **Straw Hat Crew** |
| `EB03-034` Linlin | `["Big Mom Pirates"]` | **Rocks Pirates** |
| `OP05-096` | *no `traits:` key at all* | **Celestial Dragons** |
| `OP05-040` | `["NULL"]` | **Donquixote Pirates** |
| `OP10-064` | `["The Vinsmoke Family Kingdom of GERMA"]` | **Kingdom of GERMA** only |
| `OP07-004`, `OP07-009`, `OP13-009`, `OP13-013` | `["Mountain Bandits Mountain Bandits"]` | duplicated |

`OP11-012` is the consequential one: it is the SWORD-trait body `EB03-008` Hibari's test was built
on, and it is not a SWORD card. See the second proof case below.

Rotated but worth noting for the pattern: `OP01-018` stores the non-existent trait
`New Giant Pirate Crew` (correct: `New Giant Pirates`); `OP03-036`/`OP03-038` store `["NULL"]`; 15
cards store `Film` against the 15 filters looking for `FILM`.

**An earlier version of this section claimed "all 13 ST01 cards have `traits: []`". That was a
parser artifact and is withdrawn** — ST01 stores its traits in shared `const` arrays and 12 of the
13 were already correct. Only `ST01-014` was wrong (missing `Animal`). Details in the Status block
above.

### 4. Ten `[Trigger]` abilities do not exist in the engine — 7 Standard-legal

The printed Trigger box is absent from both the text field and the `effects:`
encoding, so nothing fires when the card is taken as Life damage.

`EB04-028`, `OP06-056`, `OP06-102`, `OP06-103`, `OP08-076`, `OP12-101`,
`OP13-059` (Standard) · `OP01-029`, `OP03-039`, `OP03-110` (rotated).

**All ten are now confirmed on Limitless, not spot-checked** — every one prints the Trigger the
engine lacks, and nine of the ten match the npm dataset's text verbatim (`OP12-101` differs only in
`{Supernovas}` vs `[Supernovas]` markup).

#### Why the text field alone is not a cheap partial fix — it is a regression

The obvious small step is to fill in the `trigger:` text and leave the encoding for later. **Do not.**
Every place the engine reads the card-level `trigger` string, it reads it as an OR with the encoded
block — `battle.ts:337`, `battle.ts:603`, `effects/targeting.ts:122`, `effects/actions.ts:1355`:

```ts
const hasTrigger = hasPrintedTrigger || effectBlocksFor(lifeCard, "trigger").length > 0;
moveCard(state, lifeCardId, targetSeat, hasTrigger ? "resolution" : "hand", ...)
```

For these ten cards both sides are currently false, so the Life card goes to `hand` and the Trigger
never gets a chance to fire — the real defect. Adding only the text flips `hasPrintedTrigger` true,
which routes the card into the **`resolution`** zone with no encoded block for the resolver to run.
That trades a silently-skipped ability for a card sent somewhere nothing will act on it. **Text and
encoding have to land together**, which is why this section is deferred to an encoding batch with
per-card tests rather than folded into the data corrections.

#### The related-looking 243-card class is NOT this bug, and was deliberately left alone

**243 cards carry the literal `[Trigger]` marker inside their `effect` string**, with the Trigger box
glued on — the engine-side twin of the importer's `split_trigger` bug recorded in `CLAUDE.md`. It
looks alarming and mostly is not: those cards **do** encode their Trigger, so by the OR above the
ability fires normally and an empty `trigger:` field changes nothing that happens in a game. Only two
of the 243 were corrected here, and only because they held a wrong *value* rather than a wrong
*shape*: `EB01-039` misspelled `"Ad"` for `"Add"`, and `OP06-116`'s `trigger` field read
`"Draw 1 cards."`. Restructuring the other 241 would be a 241-file diff with no effect on play.

### 5. Printed text — 96.6% agreement across OP01–OP14 — partially fixed

With markup normalised away (circled-digit DON!! costs, `&lt;Slash&gt;` vs
`(Slash)`, `[Trait]` vs `"Trait"`, the errata footnote), **1609 of 1666 cards agree** (was
1607/1666 before the corrections). Of the 62 divergences: 31 are the engine harmlessly repeating its
Trigger text inside `effect`; 31 are semantic; **16 of those are Standard-legal**, down from 20.

Five printed-text corrections were applied — only the ones where the engine **misrepresents what the
card does**, not where the strings merely differ:

| Card | Defect | Correction |
|---|---|---|
| `OP06-054` | threshold one card too low | "4 or less" → **"5 or less"**, plus the encoding |
| `EB04-025` | **wrong player's hand** — "places 1 card from your hand" | → **"from their hand"** |
| `EB01-039` | glued Trigger text misspelled | `"Ad up to 1 DON!!"` → **`"Add"`** |
| `OP06-116` | `trigger` field | `"Draw 1 cards."` → **`"Draw 1 card."`** |
| `OP06-116` | line break moved a clause out of its bullet | joined into the second bullet |

**The rest were deliberately not touched, and the reason is a rule worth keeping:** most printed-text
divergence is markup, and the `effects:` encoding — not the string — is what plays. Correcting
`[Sky Island]` to `{Sky Island}`, `[DON!!×1]` to `[DON!! x1]`, `-1` to `−1`, or "Look at the top 5
cards" to "Look at 5 cards from the top" is churn that changes nothing and buries the real diffs.
`OP05-032` and `OP13-077` are already canon-equal and were never defects.

**One Standard-legal text defect is knowingly left open: `OP13-084`.** Limitless prints
*"[Your Turn] If you have 10 or more cards in your trash, set the base power of all of your
{Five Elders} type Characters to 7000"*; the engine encodes a completely different `[On Play]` deck
search. That is not a text fix — it needs a literal base-power setter.
**That primitive now EXISTS — `setBasePower`, built 2026-08-20 (the `setBasePower` patches in
`tools/patch_engine.py`), so this card is UNBLOCKED and still unfixed.** It is a bigger job than
the 48 corrections were, because both halves are wrong: the printed `effect` string has to be
corrected via `data/card-corrections.json` *and* the fabricated `[On Play]` encoding replaced, in
the vendored tree, together — per §4's rule, landing one without the other is a regression rather
than a partial fix. It also wants its own tests, since `docs/mutation-triage.md` records it as the
one card where fixing the existing test would be wasted work.

### 6. Untested encodings — **the "70 Standard-legal" figure was wrong; the real number is 0**

An earlier version of this section reported *"70 Standard-legal encodings that no test even
mentions"* and blamed OP11/OP12/OP14 plus 26 of our own OP15/OP16 cards. **That was three different
things added together, and only one of them is a finding.** Splitting the 74 unmentioned ids by
whether there is anything a test could asserted:

| | count | Standard | is it a finding? |
|---|---|---|---|
| vanilla — no printed effect text *and* no `effects:` block | 62 | 58 | **no.** Nothing to assert |
| printed text but **no encoding** | 9 | 9 | an *encoding* gap, not a test gap — and all are already in `data/parked-clauses.json` |
| **has an `effects:` encoding and no test** | **0** | **0** | this was the claim, and it is empty |

So **every card in the engine that carries an encoding is referenced by at least one test.** The 9
are `OP15-010/015/018/027/028/031/058/059` and `OP16-079`, all of them in
`data/parked-clauses.json`, so the old "explains only some of them" is withdrawn too.

**Re-measured 2026-08-20** — the table above was 63 / 11 / 0 with `OP16-015/060/079` in the list.
Two things moved. `OP16-015` gained an `effects:` block and a test when the `setBasePower` primitive
was built, so it leaves this section entirely. And `OP16-060` is now *mentioned* by a test while
still having no encoding, which is why this bucket reads **9** where
`tools/coverage_report.py --exclude-promos` reports **10** encoding gaps: the two count different
things, and both are right. This section counts ids **no test mentions**; the coverage report counts
cards **with no encoding**. `OP16-060` is the one card in the difference.

`section_tests` in `audit_encodings.py` now reports the three buckets separately so the aggregate
cannot be quoted as a coverage gap again. This also drops the audit's Standard-legal finding count
from 506 to **436**.

**What this does *not* say:** that the encodings are correct. A test existing is not a test that can
fail — `tools/mutation_check.py` exists precisely because this project's most frequent defect is an
assertion with no power to detect the thing it names. See the honest-coverage note below.

## What this audit checks, and what it does not — read this before quoting it

`CLAUDE.md` points here for the question *"is the encoding RIGHT"*. **This document does not answer
that question, and it is worth being blunt about it.** What it compares is:

- **data to data** — cost, power, counter, life, traits, against Bandai's list; and
- **text to text** — the engine's `effect`/`trigger` strings against the printed card.

It never reads the `effects:` DSL body against the printed text. The only two things it inspects
about an encoding are `hasEffects` — a boolean, *is there one* — and `encodesTrigger`, a regex for
`trigger: "trigger"`. So the sections above close the **card-data** question across every set. They
leave the **encoding-semantics** question essentially untouched.

The scale of what is unchecked:

| | count |
|---|---|
| card definitions in the engine (base ids) | 2201 |
| carrying an `effects:` encoding | **1975** |
| …Standard-legal | 1522 |
| …pre-OP15 | **1763** |
| encodings whose DSL was actually read against the printed card during this work | **1** (`OP06-054`) |

And `OP06-054` was not found by reading its encoding — it was found because its *text* diverged, and
the encoding was inspected only afterwards. **A defect whose text and encoding are wrong in the same
direction is invisible to every check in this document.**

The two mechanisms that could catch that are both narrower than they look:

1. **Per-card tests.** This audit's own headline is that they cannot be trusted for this purpose: a
   test asserts the encoding matches *the text the encoder read* (`OP06-054`), or picks a fixture card
   that does not have the property under test (`EB03-008`). Both passed while asserting the opposite
   of the card.
2. **`tools/mutation_check.py`**, which proves a card's tests *can fail*. It resolves cards from
   `<repo>/cards/<set>/`, which holds **only OP15 and OP16**. Upstream's OP01–OP14/EB/ST/PRB
   encodings and tests live in `vendor/` and are **out of its reach entirely**. So all 1763 pre-OP15
   encodings have never had a can-this-test-fail check run against them.

**The honest summary: card data for OP01–OP14 and the non-`OP` packs is now verified and corrected
against two independent sources; the effect encodings for those same cards are unverified.** The
first is closed, the second has not been started, and the green 6079-test suite is not evidence for
it — that is this document's founding observation, applied to itself.

### The scoped next step, if that gap is to be closed

Point `mutation_check.py` at the vendored tree: resolve cards from
`vendor/…/packages/cards/src/cards/<SET>/` and tests from `vendor/…/packages/engine/tests/cards/`,
rather than `<repo>/cards/`. That turns an unbounded "re-read 1763 encodings" job into a measurable
one — run it per set, and every surviving mutant is a named card whose test cannot fail. Do that
before anything that reasons from simulated win rates at card granularity, because a wrong encoding
biases a tech-slot measurement rather than merely adding noise to it.

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

## Remaining order of work

1. ~~Fix the 11 Standard-legal numeric stats~~ — **DONE 2026-08-19**, all 13 including the rotated
   pair. `data/card-corrections.json`.
2. ~~Fix `OP06-054` and its test together~~ — **DONE 2026-08-19.** The test asserted the defect, as
   predicted; both sides of the boundary are asserted now.
3. **Fix trait matching as one two-part change** — split the 838 joined values *and* collapse the
   `targeting.ts` branches to array membership. Neither half works alone (see §2); together they need
   no filter rewrite beyond the 21 deliberate `CP`/`GERMA` prefix filters. Leaving it keeps 170
   Standard-legal false matches, one class of which flatters the Ace deck. **Now the only trait work
   left** — the missed-match half of §2 was pure data and closed with §3, so this is cleanly a
   behaviour change, on its own branch, with a before/after 6079-test run.
4. **Add the 7 Standard-legal missing Triggers — text *and* encoding in one batch.** §4 explains why
   the text alone is a regression rather than a partial fix. Needs per-card tests and
   `tools/mutation_check.py`, since a Trigger test that cannot fail is this project's most frequent
   defect.
5. **`EB04`'s 31 missing cards** are the largest single competitive gap, and `EB04-028`'s Trigger is
   already on the list above.
6. **`OP13-084`'s wrong ability** — no longer blocked. The `setBasePower` primitive landed
   2026-08-20, so §5's precondition is met; the work itself (correction + encoding + tests, in one
   batch) has not been done. Do not attempt it as a text fix.

`ST10`–`ST36` matter far less than their count suggests: starter-deck cards are
mostly reprints or off-meta, and no current sim deck draws on them.
