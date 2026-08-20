# Encoding OP15/OP16 cards — worked examples and reference

This is the reference for encoding effects onto the mechanical card definitions
`tools/gen_card_defs.py` already generated. It exists because five cards were hand-encoded
in Task 2 specifically to be copied: read this before encoding card #6.

**The rule of thumb this file exists to teach:** *"if you have [Name]" scans the whole
field, Leader included; only "your Characters" scopes to the character zone.* Getting this
backwards (`zone: "character"` instead of `zone: "field"`) was Task 2's own review-round-1
defect, on both cards that use the pattern (Antlerkov, Our Savior) — see those two sections
below for the full story, including the rulings that make it checkable without any engine
change. `OP16-025` Bunkov carries the mirror-image ruling (#977, identical shape to
Antlerkov's #979) and is waiting in a later batch; this is what stops the same bug landing
there too, and in however many of the other "if you have [Name]" cards come up after it.

## How to read this file

It is long because every section was paid for by a defect. If you are encoding a batch, read in this
order and skim the rest:

1. **Before encoding any card** — the mandatory rulings step. Non-negotiable.
2. **The five worked examples** — the reference encodings, and the shapes most cards copy.
3. **Test-harness facts worth not rediscovering** — the prompt-intent table alone saves a test run per
   guess, and *"Writing tests that survive `mutation_check.py`"* inside it is the section that decides
   whether your batch needs a fix-up round. **Read rule 0 there before you write a single assertion.**
4. **Parked (DSL gaps)** — check whether the effect you cannot express is already a known gap before
   you re-derive it. Machine-readable twin: `data/parked-clauses.json`.
5. The per-batch lesson sections (Task 3, Task 4, and the three OP16 batches) — reference material,
   organised by the batch that found each lesson rather than chronologically. Grep them for the shape
   you are encoding.

**The two mistakes this file exists to prevent, above all others.** An encoding can be *wrong and
green*: the rulings step is the only defence, because the English print is sometimes ambiguous
(`OP16-001`) and sometimes flatly wrong about the player (`OP16-081`). And a test can be *green and
powerless*: the mutation gate is the only defence, and it has blind spots of its own that you must
cover by hand.

## Before encoding any card

1. **Read the printed `effect` field** in the generated `.ts` file (or `data/cards-OP15-en.json`
   / `cards-OP16-en.json`) — never an aggregator summary. If it looks wrong, check
   `onepiece.limitlesstcg.com/cards/<ID>`.
2. **Check the rulings, and read past the Q&A to the quoted card text.** This is mandatory,
   not advisory (`docs/plans/encode-op15-op16.md`, Global Constraint #3):
   ```bash
   ./.venv/bin/python tools/parse_rulings.py --card OP16-001
   ```
   Each entry `parse_rulings.py` prints has **two parts**: the card's own printed
   Simplified Chinese text, quoted verbatim, *then* a Q&A question and answer about one
   specific edge case of it. The Q&A is what most people read first, and it's easy to stop
   there — but the Q&A only has to be as broad as the specific scenario someone asked about.
   The **quoted SC text is the actual specification**, and it is often unambiguous in ways
   the English translation (or a narrowly-scoped Q&A about it) is not. Ace (`OP16-001`,
   ruling #961) is the worked case for this below — the Q&A alone would have justified a
   narrower fix than the one actually needed, and the quoted SC text is what settles it.
   This applies to all 112 of the 238 OP15/OP16 cards that carry at least one ruling. Also
   skim `./.venv/bin/python tools/parse_rulings.py --card GENERAL` once — those are
   core-rules answers (e.g. a Character whose power drops to 0 or less stays on the field)
   that apply everywhere, not just to one card.
3. **Decide test depth per the settled decision**: assert the printed behaviour, and — only
   where a ruling *constrains the encoding* — assert the ruling too. Do not write a test for
   a ruling that is about timing/interaction the engine already resolves generically. Be
   careful with this distinction, though: it is easy to over-apply it to a ruling that
   *looks* like a generic-interaction question but is actually exposing a bug in how a
   *zone* or *filter* is scoped on this specific card. Antlerkov and Our Savior below are the
   cautionary example — rulings #979/#993 were first read as "generic, no grantName action,
   defer" and that was half right and half a mistake; see those sections for exactly where
   the line actually falls.
4. **Find the closest existing card** with the same trigger family and action shape before
   writing anything by hand. `grep -rl 'trigger: "onKo"' vendor/.../packages/cards/src/cards`
   (etc.) across the whole vendored engine, not just OP14 — the closest analogue is often in
   an older set. Every example below names the file it was modeled on.
5. **Never invent a DSL verb.** The full vocabulary is
   `vendor/tcg-engines/submodules/one-piece/packages/types/src/effect/{action,condition,cost,target,primitives}.ts`.
   If an effect doesn't fit, park it (record the card ID and the missing primitive) and move
   on — do not approximate and do not extend the DSL from a single card.

## Workflow

Card definitions live in `cards/OP15|OP16/` in **this** repo (the single source of truth,
`docs/plans/encode-op15-op16.md` Global Constraint #1); tests live in `cards/tests/OP15|OP16/`
in this repo, the same way. Neither is ever hand-edited under `vendor/` — that copy is
disposable and gets overwritten.

1. Add/edit the `effects:` block in `cards/OP16/<type>/<NNN>-<slug>.ts`. Add/edit the test in
   `cards/tests/OP16/<NNN>-<slug>.test.ts`.
2. Graft both into the vendored engine:
   ```bash
   ./.venv/bin/python tools/graft_cards.py
   ```
   This mirrors `cards/OP15|OP16` onto
   `vendor/.../packages/cards/src/cards/OP15|OP16` and `cards/tests/OP15|OP16` onto
   `vendor/.../packages/engine/tests/cards/OP15|OP16`, and appends any missing `cards/index.ts`
   export lines. Re-running is always a safe no-op check — `0 copied, 0 deleted` means the
   repo and the vendored copy already agree.
3. Run the tests, from the vendored engine package:
   ```bash
   cd vendor/tcg-engines/submodules/one-piece/packages/engine
   ./node_modules/.bin/vp test run tests/cards/OP16/       # just the new/changed ones first
   ./node_modules/.bin/vp test run                          # then the whole suite, no regressions
   ```
   Tests are written against `OnePieceTestEngine`
   (`packages/engine/src/testing/test-engine.ts`): `.create(playerOneFixture,
   playerTwoFixture, options)` (player one is always seat `"south"`), `.playCard`,
   `.declareAttack`, `.activateEffect`, `.attachDon`, `.pendingDecision(intent, seat)` /
   `.resolveDecision(intent, resolution, seat)` to step through prompts, `.getView(seat)` for
   projected state, `.getState()` for raw state, `.findCardInZone(seat, zone, cardId)` to
   resolve a fixture card to its instance id. `getLegalCommands(state, seat)` (imported
   alongside it from `../../../src/index.ts`) is how you assert something is *not* offered
   (e.g. a used-up `oncePerTurn` activation — see the Ace section).
4. When a test needs a card that doesn't exist (a bare "return this character to hand"
   trigger to exercise a replacement effect, a Leader with a specific name to stand in for a
   hypothetical ruling scenario), define one inline and call `registerCards([...])`
   (`packages/cards/src/runtime-catalog.ts`) before the `describe` block. Spread a real card
   of the right type for all the fields you don't care about, override `id`/`canonicalId` to
   something obviously synthetic (`TEST-...`), and override whatever the test actually needs.
   This is used throughout the reference tests — see the Marco and Antlerkov/Our Savior
   sections below for three different reasons to reach for it.

   **If you override `name` to make a card match a `name` filter, you must also override
   `i18n.en.name`, or the filter will silently keep matching the spread-from card's original
   name.** `cardName()` (`shared.ts`) resolves a card's name from `card.i18n.en.name`, not
   the top-level `name` field the rest of this file's mapping table talks about — the two
   normally agree by construction in `gen_card_defs.py`'s output, but a hand-spread synthetic
   card has to be told to agree on purpose:
   ```ts
   const bunkovNamedLeader: LeaderCard = {
     ...op16PortgasDAce001,
     id: "TEST-...",
     canonicalId: "TEST-...",
     name: "Bunkov",
     i18n: { en: { ...op16PortgasDAce001.i18n.en, name: "Bunkov" } },  // <- easy to forget
   };
   ```
   Forgetting the `i18n` override doesn't error — it just makes the condition evaluate to
   `false` with no indication why, which looks identical to "the encoding is still broken"
   until you isolate it. This cost real time building the Antlerkov/Our Savior ruling tests
   below; it will cost the same time again for whoever forgets it next unless they read this
   first.
5. Typecheck and format:
   ```bash
   ./node_modules/.bin/vp check src tests   # from packages/engine
   ./node_modules/.bin/vp check src         # and again from packages/cards
   ./node_modules/.bin/vp check --fix <file>  # if it reports formatting issues
   ```
   **Scope it to `src tests`, not bare `vp check`.** If `./scripts/arena.sh` has ever been run,
   `packages/engine/arena/` holds a copy of this repo's `arena/` (the script `rm -rf`s and re-copies
   it), and that copy carries pre-existing formatting issues in 4 files plus one `no-unused-vars`
   warning. A bare `vp check` reports them and exits non-zero, which reads as "my change broke
   something" and is not. Note the type check ALSO runs under `--no-fmt`, so `vp check --no-fmt src`
   is the way to see type errors past a formatting failure.
   **`vp check` alone does not full-typecheck the workspace** — for that use
   `./node_modules/.bin/tsgo --noEmit -p tsconfig.json`, from `packages/engine` and again from
   `packages/cards` (borrowing engine's binary). Two errors in the sibling `agnostic-simulator`
   package are pre-existing and unrelated; filter them out.
   **Round-trip hazard:** `vp check --fix` rewrites files in place wherever you ran it —
   which, run from `packages/engine`, is the **grafted copy under `vendor/`**, not the
   source of truth in `cards/tests/`. If you fix-and-forget there, the fix is invisible to
   git (vendor/ is gitignored) and the *next* `graft_cards.py` run silently overwrites the
   grafted copy back to its unformatted state from `cards/tests/`, un-fixing it. Always diff
   the two after `--fix` and copy the vendor version back:
   ```bash
   diff cards/tests/OP16/<file>.test.ts vendor/.../packages/engine/tests/cards/OP16/<file>.test.ts
   cp vendor/.../packages/engine/tests/cards/OP16/<file>.test.ts cards/tests/OP16/<file>.test.ts
   ```
   Then re-run `graft_cards.py` once more and confirm it reports the tests tree unchanged.
6. Confirm the generator still leaves hand-authored files alone:
   ```bash
   ./.venv/bin/python tools/gen_card_defs.py
   ```
   should report your cards under `skipped (N) -- existing effects: block` with
   `files written/updated: 0` for everything else.

## JSON → engine field mapping

| JSON | engine | note |
|---|---|---|
| `colors` | `color` | renamed, stays an array |
| `attribute: "Special"` | `attribute: "special"` | lowercased; `""` → omit the field |
| `counter: null` / `cost: null` | omit the key | leaders have no cost |
| `effect` | `effect` **and** `i18n.en.effect` | duplicated by design |
| `imageUrl` | `printings[0].imageUrl` **and** `i18n.en.imageUrl` | |
| — | `canonicalId` | equals `id` (no variants in OP15/OP16) |
| — | `slug` | `<kebab-name>/<lowercase-id>` |
| — | `setId` | `"OP15"` / `"OP16"` |
| — | `effects` | **hand-authored only** — never emitted by `gen_card_defs.py` |

Export symbol: lowercased set + PascalCase name + collector number, e.g. `OP16-001` Portgas.D.Ace
→ `op16PortgasDAce001`. Multi-word names tokenize on non-alphanumerics (`Monkey.D.Luffy` →
`MonkeyDLuffy`).

## The five worked examples

### OP16-001 Portgas.D.Ace (leader, `activateMain`)

> [Activate: Main] [Once Per Turn] Up to 1 of your [Monkey.D.Luffy] Characters or up to 1 of
> your Characters with a type including "Whitebeard Pirates", with 8000 power or more, gains
> [Rush] during this turn.

**Ruling #961** (mandatory reading): "8000 power or more" binds to **both** the
`[Monkey.D.Luffy]` clause and the Whitebeard Pirates clause — not just the second, as the
English sentence's surface grammar suggests. A 7000-power Whitebeard Character does not
gain Rush, and neither does a sub-8000-power Luffy.

What actually settles the "binds to both" reading is **not** the Q&A question by itself —
that question only interrogates the Whitebeard-clause boundary ("a Character with power not
exceeding 7000 whose traits include Whitebeard Pirates") and, read alone, would be equally
consistent with a narrower fix that left the Luffy clause unqualified. What settles it is the
**quoted Simplified Chinese card text at the head of the ruling entry**, which
`parse_rulings.py` prints before the Q&A: "我方最多1张**力量为8000或更高的**"蒙奇·D·路飞"或**力量为
8000或更高**且拥有的特征中包含〈白胡子海盗团〉的角色获得【速攻】" — the power qualifier is written
out twice, once before each disjunct, in the card's own printed text. The English
translation collapses this into one clause reading like it might only bind to the second;
the SC print never was ambiguous. This is the general technique: read the quoted printed
text before the Q&A, not instead of it — the Q&A is what pins a specific boundary value
(here, that 7000 specifically fails), the quoted text is what tells you the *shape* of the
condition in the first place.

**Encoding.** One `grantKeyword` action targeting up to 1 own Character, filtered by
`anyOf`/`groups` — each group ANDs a name-or-trait check with its **own** copy of the power
filter, so the power requirement is structurally duplicated rather than applied once outside
the `anyOf`. That is what makes the wrong reading (power gating only the second group)
inexpressible by accident:
```ts
filters: [
  {
    filter: "anyOf",
    groups: [
      [
        { filter: "name", value: "Monkey.D.Luffy" },
        { filter: "power", comparison: "gte", value: 8000 },
      ],
      [
        { filter: "trait", value: "Whitebeard Pirates", match: "includes" },
        { filter: "power", comparison: "gte", value: 8000 },
      ],
    ],
  },
],
```
Modeled on `PRB01/leaders/001-sanji-prb01-001.ts` (`activateMain` + `oncePerTurn` +
`grantKeyword` shape) and `OP03/leaders/001-portgas-d-ace.ts` (`anyOf`/`groups` precedent in
this codebase, for an unrelated event-or-stage check).

**Primitives used:** `trigger: "activateMain"`, `oncePerTurn`, action `grantKeyword`
(`keyword: "rush"`, `duration: "thisTurn"`), target filters `anyOf` (`groups` form), `name`,
`trait` (`match: "includes"`), `power` (`comparison: "gte"`).

**Tests** (`cards/tests/OP16/001-portgas-d-ace.test.ts`): the literal ruling boundary
(Whitebeard Character at 2000 power excluded, at 8000 included), and — the test that would
actually fail under the wrong reading — a named Luffy Character at 7000 power excluded while
one at 9000 is included, played fresh so the granted Rush is proven functionally by a
same-turn attack, not just a candidate-list check. A third test activates the ability, then
asserts (via `getLegalCommands`) that a second `activateEffect` on the same Leader is no
longer offered that turn — `oncePerTurn: true` had no assertion at all before this and could
be deleted with every other test staying green.

### OP16-002 Izo (character, `onPlay` + optional cost)

> [On Play] You may reveal 1 Character card with 8000 power from your hand: Draw 1 card.

**Ruling #962:** "a Character card with 8000 power" is exactly 8000 (`eq`), not "8000 or
more" (`gte`). Confirmed neither ≤7000 nor ≥9000 qualifies.

**Encoding.** An `onPlay` effect block with an optional `revealFromHand` cost carrying both
filters, and a plain `draw` action:
```ts
costs: [
  {
    cost: "revealFromHand",
    amount: 1,
    filters: [
      { filter: "cardCategory", value: "character" },
      { filter: "power", comparison: "eq", value: 8000 },
    ],
  },
],
actions: [{ action: "draw", player: "self", amount: 1 }],
optional: true,
```
Modeled on `OP12/characters/009-jinbe.ts` (`onPlay` + optional `revealFromHand` cost, same
shape minus the power filter) and `OP08/characters/040-atmos.ts` (test-side: the
`effectOptional` → `effectCostRevealFromHand` prompt sequence).

**Primitives used:** `trigger: "onPlay"`, `optional`, cost `revealFromHand` with filters
`cardCategory` and `power` (`comparison: "eq"`), action `draw`.

**Tests** (`cards/tests/OP16/002-izo.test.ts`): both boundaries per the task's explicit
instruction for this ruling — a 7000-power and a 9000-power Character both excluded from the
cost-payment candidates, only two exactly-8000 Characters included; and a decline test
(`optionId: "no"`) with a payable candidate still in hand, proving "may" is a real choice.
The same boundary test also includes a synthetic **Leader** card, spread from a real one with
`power: 8000` and placed directly into the hand fixture (something that never happens in
real play, but nothing stops a test fixture from doing it) — proving `cardCategory:
"character"` is load-bearing, not redundant. It has to be a Leader specifically: `basePower()`
(`shared.ts`) only ever reads `.power` for `cardType` `"leader"` or `"character"` and hard-zeroes
it for `"event"`/`"stage"`, so no Event or Stage, real or synthetic, could ever accidentally
satisfy `power eq 8000` regardless of what filters are or aren't applied — only a
misplaced Leader can actually exercise this filter.

*Gotcha for anyone copying this shape:* the engine only creates a selection prompt for a cost
when `candidates.length > amount`. With `amount: 1` and only **one** truly-eligible card in
hand, the payment auto-resolves with no prompt at all — you cannot observe the excluded
boundary cards that way. Put two eligible cards in the test hand (as done here, Jozu +
Vista, both exactly 8000) so a real prompt appears and the excluded candidates are actually
assertable. This applies to every cost/target selection in the DSL, not just `revealFromHand`.

### OP16-014 Marco (character, replacement effect + `onKo`)

> If one of your Characters would be removed from the field by your opponent's effect, you
> may K.O. this Character instead.
> [On K.O.] You may trash 1 Character card with 8000 power from your hand: Play this
> Character card from your trash.

**Ruling #970:** same "exactly 8000" (`eq`) reading as Izo's #962, for the on-K.O. discard
cost.

**Ruling #971:** if Marco and another own Character would leave the field simultaneously by
the same opponent's effect, the replacement can be applied to save the *other* Character
while Marco's own removal proceeds unreplaced. `effects/replacements.ts`
(`findRemovalReplacement`) shows a plausible mechanism for this: it searches *every* own
card's `replacementEffects` per removed instance, one at a time. That is **reviewed, not
verified** — reading the function shows a per-instance search, but says nothing one way or
the other about the *ordering* of multiple simultaneous removals, which is the actual crux
of what the ruling is asking. No dedicated test for #971 for that reason (a real
simultaneous-double-removal scenario would need a second, purpose-built synthetic effect
and is deferred, not skipped out of confidence); the "protects an ally" test below already
exercises the non-`targetSelf` shape the ruling depends on, which is as far as this task's
five cards can take it.

**Encoding.** Two independent effects on one card — a `replacementEffects` entry and a
regular `effects` block:
```ts
effects: [
  {
    trigger: "onKo",
    costs: [{
      cost: "trashFromHand",
      amount: 1,
      filters: [
        { filter: "cardCategory", value: "character" },
        { filter: "power", comparison: "eq", value: 8000 },
      ],
    }],
    actions: [{
      action: "play",
      source: { player: "self", zone: "trash" },
      count: { amount: 1 },
      self: true,
    }],
    optional: true,
  },
],
replacementEffects: [
  {
    replacedEvent: "removeFromField",
    target: { player: "self", zones: ["character"], count: { amount: 1 } },  // no filter: ANY own Character, not just Marco
    source: "opponentEffect",
    replacementAction: {
      action: "ko",
      target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },  // always Marco
    },
  },
],
```
The `target` on the replacement (which characters' removal this protects) is intentionally
unfiltered and *not* `targetSelf` — that is the whole point of the card, and is what
distinguishes it from the self-only shape most other Whitebeard "protector" cards use.
Modeled on `OP13/characters/047-fossa.ts` (protects *other* trait-matching Characters, same
"unfiltered `target`, fixed self `replacementAction`" shape, just with a trait filter this
card doesn't have) for the replacement half, and `OP03/characters/013-marco.ts` (an earlier
Marco printing: `onKo` + `trashFromHand` cost + `play` from trash, `self: true`) for the
on-K.O. half.

**Primitives used:** replacement `replacedEvent: "removeFromField"`, `source:
"opponentEffect"`, `target` (unfiltered, self-inclusive), replacement action `ko` with
`target.self`; trigger `onKo`, cost `trashFromHand` (`cardCategory` + `power eq`), action
`play` (`source.zone: "trash"`, `self: true`).

**Tests** (`cards/tests/OP16/014-marco.test.ts`): the replacement protecting an *ally*
(Namule, not Marco) from a synthetic on-play "return to hand" effect (same technique as
`packages/engine/tests/cards/characters/op07-042-gecko-moria.test.ts`), **chained through**
into Marco's own `[On K.O.]` revival in the same test — the replacement's `ko` action is a
real K.O., which fires Marco's own `onKo` trigger exactly as a battle K.O. would, and that
chain (protect an ally, then get Marco back) is the card's actual play pattern, not two
abilities that happen to share a card. A second test covers the eq-8000 boundary for the
revival cost in isolation (2000/8000/8000/10000-power hand Characters, only the two
exactly-8000 ones eligible, triggered by a real battle K.O. this time) and includes the same
synthetic-Leader-in-hand technique Izo's test uses to prove `cardCategory: "character"`
matters here too.

### OP16-029 Antlerkov (character, `whenAttacking`, condition on a named card)

> [When Attacking] If you have [Bunkov], play up to 1 Character card with a cost of 2 or
> less from your hand.

**Ruling #979:** a Leader whose own effect is written as "has every card's name, trait, and
attribute" satisfies "if you have [Bunkov]" **by itself**, with zero Bunkov Characters
anywhere on the field — the Leader counts. This was first read (review round 0) as "a
hypothetical Leader that grants names, no such Leader exists among the five reference
cards, defer" and filed as untested. That conflated two genuinely different things:

- *How a Leader's own effect grants names to itself/other cards at runtime* — the engine has
  no `grantName` action, so a **real** card printed with that ability cannot be encoded yet.
  Fair to defer; still true; still not this task's problem.
- ***Which zones* "if you have [Name]" scans in the first place** — this is Antlerkov's own
  encoding, and it was simply wrong: `zone: "character"` structurally excludes the Leader
  from the candidate pool. That is true regardless of whether any Leader ever grants names —
  a Leader printed with its own literal name matching would be excluded too, which is the
  bug, and it doesn't need a `grantName` action to demonstrate: a synthetic Leader whose
  static `name` field is set to `"Bunkov"` reproduces exactly what a name grant would look
  like to `cardNames()` (`shared.ts`), with zero new engine machinery. Ruling #979's answer
  ("yes, the Leader counts") is only *encodable at all* once the zone scan includes the
  Leader — so this ruling was always encoding-relevant, not a generic-interaction
  side-question.

Seven pre-existing "if you have [Name]" encodings in the vendored engine already get this
right (eight counting this card itself), including `OP02/characters/111-fullbody.ts` — this
card's own model, cited below, that this encoding then diverged from on exactly the field
that matters. `OP16-025` Bunkov carries the identical ruling (#977) for the symmetric "if
you have [Antlerkov]" case, in a later batch.

**Encoding.** `hasCard` condition (not `existsOnField` — both resolve identically via
`candidatesForTarget`, but `hasCard` is the far more common spelling for "if you have
[Name]" in this codebase, e.g. `OP02/characters/111-fullbody.ts`'s "if you have [Jango]"),
scanning the **field**, gating a `play` action:
```ts
conditions: [
  { condition: "hasCard", player: "self", zone: "field", filters: [{ filter: "name", value: "Bunkov" }] },
],
actions: [
  {
    action: "play",
    source: { player: "self", zone: "hand" },
    count: { amount: 1, upTo: true },
    filters: [
      { filter: "cost", comparison: "lte", value: 2 },
      { filter: "cardCategory", value: "character" },
    ],
  },
],
```
`zone: "field"` (`effects/targeting.ts`, `candidatePoolForTarget`) builds
`[leaderInstanceId, ...characterArea, ...stageArea]`. `hasCard` reaches it the same way
everything else does — it builds a `Target` and calls `candidatesForTarget`
(`effects/conditions.ts`), which is a thin wrapper around `candidatePoolForTarget` — so
there is exactly one place "field" is assembled, not two. (`zoneCount` is the one condition
that inlines the same `[leader, ...characters, stage]` triple directly instead of going
through `candidatePoolForTarget`, for its own reasons — see `effects/conditions.ts`'s
`zoneCount` case. The Leader is still first either way; the two paths just aren't the same
function.) `zone: "character"` (the 36 other
uses of this filter pattern in the vendored engine) is the right choice for the *different*
printed pattern "a Character with…", which explicitly excludes the Leader by its own
wording — the two zones are not interchangeable stand-ins for each other, they encode two
different printed phrasings.

Modeled on `OP02/characters/111-fullbody.ts` (`whenAttacking` + `hasCard` condition, the
closest existing "if you have [Name]" attack trigger) and `OP03/characters/014-monkey-d-garp.ts`
/ `OP01/characters/049-bepo.ts` (the `play`-from-hand action shape with a cost filter).

**Primitives used:** `trigger: "whenAttacking"`, condition `hasCard` (`zone: "field"`,
filter `name`), action `play` (`source.zone: "hand"`, filters `cost` `lte` + `cardCategory`).

**Tests** (`cards/tests/OP16/029-antlerkov.test.ts`): with Bunkov (OP16-025) on field, the
play offer appears and correctly excludes a too-expensive hand card; without Bunkov, the
whole effect never fires (no prompt at all, not just an empty one); ruling #979 itself, with
a synthetic Leader statically named `"Bunkov"` and **zero** Bunkov Characters anywhere —
this test fails under the pre-fix `zone: "character"` encoding (no prompt appears at all,
`pendingDecision` throws) and passes under `zone: "field"`; and a cheap real **Stage** card
(`OP16-021` Moby Dick, cost 1, within "cost of 2 or less") in hand to prove `cardCategory:
"character"` actually excludes something.

*Gotcha for anyone copying this shape:* it has to be a Stage, not an Event, or the test is
vacuous and will pass whether or not the `cardCategory` filter is even there.
`candidatesForPlayAction` (`effects/actions.ts`) hard-filters every `play` action's
candidate pool to `card.cardType === "stage" || card.cardType === "character"` **before**
any `cardCategory` filter on the action is ever consulted — an Event card is unreachable
through a `play` action's candidate pool regardless of what `cardCategory` says, so a
cheap-Event fixture "passes" for a reason that has nothing to do with the filter it's meant
to be testing. `cardCategory: "character"` on a `play` action's own filters is therefore
only ever doing one job: narrowing that already-`stage`-or-`character` pool down to exclude
Stages. Proven both directions while building this: with the Event fixture, deleting the
`cardCategory` filter entirely still left this test green (4/4 passing, including the
now-broken one); switching to the Stage fixture and re-deleting the filter reliably turns
red (`expected [ 'card-000021', 'card-000022' ] to deeply equal [ 'card-000021' ]`), then
green again on restore.

### OP16-057 Captain Buggy's Our Savior!! (event, conditional `counter`)

> [Counter] If you have 2 or more [Prisoner of Impel Down] cards, up to 1 of your Leader or
> Character cards gains +4000 power during this battle.
> [Trigger] Draw 2 cards and trash 1 card from your hand.

No numbered ruling directly on this card's `counter` block changes its *reading*, but
**ruling #993** is the same shape as Antlerkov's #979 above, and arithmetically decisive
about it: a Leader whose own effect grants it every card's name, with exactly **1** real
Prisoner of Impel Down Character on field — does "2 or more" hold? Yes: the 1 real
Character plus the Leader (counted by name) is 2. As with Antlerkov, this was first filed as
"generic name-granting concern, defer" and that was the same half-right, half-wrong call —
see the Antlerkov section above for the general distinction (what's genuinely deferrable vs.
what's this card's own zone-scoping bug). `zone: "character"` on the `zoneCount` condition
excludes the Leader from the count exactly as it excluded it from Antlerkov's existence
check, and for the identical reason: fixed to `zone: "field"`.

The other thing worth getting right on this card, independent of the zone bug, is *which*
string is a name and which is a trait: `"[Prisoner of Impel Down]"` is the bracketed
**name** of OP16-042 (itself printed "you may have any number of this card in your deck" —
i.e. a goon/mob card meant to appear in multiples), not the broader `"Impel Down"` **trait**
this event and OP16-042 both also carry. Filtering on the trait instead would make the
condition trivially satisfiable by any 2 Impel-Down-arc characters, including Bunkov,
Antlerkov, Buggy, or Buggy's own other printing (OP16-048) — wrong, and the kind of mistake
that stays invisible unless a test specifically includes a same-trait-different-name card
(see Tests below).

**Encoding.** `zoneCount` condition (not `hasCard`, since this needs a count comparison, not
existence), scanning the **field**, gating a `modifyPower` action with the two-zone target
this event's own "Leader or Character" pool needs:
```ts
conditions: [
  {
    condition: "zoneCount",
    player: "self",
    zone: "field",
    comparison: "gte",
    value: 2,
    filters: [{ filter: "name", value: "Prisoner of Impel Down" }],
  },
],
actions: [
  {
    action: "modifyPower",
    target: { player: "self", zones: ["leader", "character"], count: { amount: 1, upTo: true } },
    value: 4000,
    duration: "thisBattle",
  },
],
```
Modeled on `OP04/events/095-barrier.ts` and `OP07/events/095-iron-body.ts` — both
`counter` + `modifyPower` targeting `["leader", "character"]` with `thisBattle` duration,
plus the identical `[Trigger] Draw 2, trash 1` block (copied verbatim from Barrier's shape).
This is the reference set's only event and its only `counter` example.

**Primitives used:** `trigger: "counter"`, condition `zoneCount` (`zone: "field"`,
`comparison: "gte"`, filter `name`), action `modifyPower` (`zones: ["leader", "character"]`,
`duration: "thisBattle"`); second block `trigger: "trigger"`, actions `draw` + `trashFromHand`.

**Tests** (`cards/tests/OP16/057-captain-buggy-s-our-savior.test.ts`): condition met (2
copies of OP16-042) vs. not met (1 copy **plus** OP16-048 Buggy, who carries the "Impel
Down" trait but not the "Prisoner of Impel Down" name — this is what actually exercises the
name-vs-trait distinction above; a trait-filtered encoding would wrongly count 2 and this
test would go red), made mechanically observable rather than inspecting a transient
modifier (see the gotcha below); ruling #993 itself, with a synthetic Leader statically
named `"Prisoner of Impel Down"` plus 1 real Character — fails under the pre-fix `zone:
"character"` encoding (only 1 counted, "gte 2" fails, no prompt) and passes under `zone:
"field"`; plus the `[Trigger]` draw-2/trash-1.

*Gotcha for anyone copying this shape:* don't target the **Leader being attacked** to prove a
`thisBattle` power boost applied, and don't assert on `leader.power` right after resolving
the target-selection prompt. Attacking a Leader **is** still a power comparison — `battle.ts`
(`finalizeBattle`) gates all damage, Leader or Character alike, on `attackPower >=
defensePower` before branching on which zone the target is in — so this is not about damage
being unconditional. It's about *when* the modifier is observable: resolving the
target-selection prompt completes the entire battle resolution, including the modifier's
expiry, atomically within that one call. By the time control returns to the test, a
`thisBattle` modifier on the Leader has already come and gone — `state.modifiers` will be
empty and `leader.power` will show the unmodified value even though the action executed
correctly and (if the Leader's power actually mattered to the outcome) had already done so.
`packages/engine/tests/cards/events/op04-095-barrier.test.ts` never asserts `leader.power`
for exactly this reason. Make the boost observable through a durable outcome instead: target
a Character whose survival (or K.O.) in the battle depends on it.

*Second gotcha, unrelated to the above:* only the Leader and **rested** Characters are legal
attack targets; an active Character "cannot be attacked."

## Task 3 — OP15 leaders (6 cards, 5 with encodings)

The five sections above stay the canonical worked examples; this section records only what
Task 3 added that they do not already teach. Leaders turned out to be the *worst* card type
for DSL coverage — 5 of 11 printed clauses across these 6 cards are parked, because Leaders
are where rules-bending text lives (deck-out grace periods, DON!! deck resizing). Expect a
much lower park rate on Characters and Events.

**`OP15-001` Krieg — "if the only Characters on your field are [X] type" is NOT vacuous.**
Ruling #852: with **zero** Characters on your field the effect does not apply (不会). English
reads the other way — an empty character area trivially satisfies "the only Characters … are
[East Blue]" — and the shape already in the engine for this exact phrasing,
`EB02/leaders/010-monkey-d-luffy.ts`, is a lone `zoneCount … eq 0` over *non*-matching traits,
which therefore **fires on an empty field and gets the ruling backwards**. This affects
`OP16-022` Monkey.D.Luffy too ("only [Impel Down] type Characters"), and `OP05-084` /
`OP05-092` upstream. The correct pair is an unfiltered `zoneCount … gte 1` **and** the
`eq 0` negate check. Keep the `gte 1` **unfiltered**: given "no Character lacks the type",
"≥1 of the type" and "≥1 Character at all" are the same predicate, so a trait filter there is
dead weight — `mutation_check.py` flagged it as a survivor when it was present, correctly.

**`OP15-098` Monkey.D.Luffy — `replacedEvent: "leaveField"`, not `"removeFromField"`, whenever
a battle K.O. must be replaceable.** This is the single most load-bearing thing Task 3 learned.
`findKoReplacement` (`effects/replacements.ts`) searches `["ko", "leaveField"]` when the cause is
a **battle** and `["ko", "removeFromField", "leaveField"]` when the cause is an **effect**. So a
`removeFromField` replacement silently does nothing on a battle K.O. — no prompt, the Character
just dies — while still passing every effect-removal test you write. `leaveField` is the one
value in both sets. Printed text is the tell: "would be removed from the field **by your
opponent**" (SC 因对方) is cause-agnostic and ruling #957 confirms battle K.O. counts, whereas "by
your opponent's **effect**" is not. Pair it with `eventFilter: { causedBy: "opponent" }` to
supply the "by your opponent" half, or the replacement also intercepts your own removals.

**Do not add a condition the availability check already enforces.** Ruling #933 (Luffy cannot use
the replacement at 0 Life) needs no `lifeCount` condition: `replacementActionIsAvailable` already
rejects a `removeFromLife` of 1 against an empty Life area, so the effect is never offered. A
redundant condition would be an unkillable mutant. Test the structural behaviour instead — see
`cards/tests/OP15/098-monkey-d-luffy.test.ts`.

**`[On Your Opponent's Attack]` takes no `targetSelf`, and upstream is inconsistent about it.**
The modern bracketed keyword fires for the defending seat on **any** declared attack
(`enqueueInPlayEffectsForTrigger(state, "onOpponentAttack", …)`, `battle.ts`) — target
irrelevant. Match `OP11/leaders/041-nami.ts` (same keyword, same "This Leader gains +N power"
payload, no `targetSelf`), not `OP13/leaders/002-portgas-d-ace.ts` (same keyword, *with*
`targetSelf`). `targetSelf` belongs only on the older wording "when this Leader … **is
attacked**", e.g. `OP03/leaders/001-portgas-d-ace.ts`. GENERAL ruling #8 confirms a power boost
may be applied to a card that is not the one being attacked.

**Targeting is permissive — do not invent a `state: "rested"` filter.** Brook's "set up to 1 of
your Characters as active" offers already-**active** Characters as candidates, and that is
correct: GENERAL ruling #27 allows choosing a target for which the effect does nothing. An
initial test asserting active Characters were filtered out was simply wrong about the game. Prove
the target's *ownership* scoping with an opponent body instead.

**"a cost of N" / "power N" is `eq`.** Confirmed again on Rebecca (费用为3). Same reading as
rulings #962/#963. A bare number in card text is an equality unless a comparison word is printed.

## OP15 black Characters (15 cards) — lessons

**A condition that counts a zone THE COST ITSELF changes must live on the ACTION, not the block.** This
is a hard engine fact, not a reading of the printed comma. `OP15-083` and `OP15-093` both print "You may
trash this Character: If you have 15 or more cards in your trash, …", and rulings **#923/#928** both
answer 可以 at **14** — the cost is the 15th. `block.conditions` are evaluated **twice, both times
before `payCosts`**: once in `engine/commands.ts` (which rejects the activation outright with "The
activation conditions are not met.") and again at the head of `processQueuedEffectBlock`. Only an
*action's* own `condition` runs in `processQueuedEffectAction`, after payment. The test that proves you
got it right is **the negative one**: at 13 cards, assert the cost is still paid and the payload simply
does not happen — under a block-level condition `exec` throws instead.

**A ruling answering 不会 is not always a ruling against the clause you are reading.** `OP15-080`'s #921
asks whether a Leader with "every card's name" at 10000 power switches on "If you have [Gecko Moria]
with 10000 power or more and there are no other [Oars]". The answer is no — which read quickly looks
like #979/#993 reversed. It is the opposite: the Leader *does* satisfy the Moria half exactly as those
rulings require, then **fails** the second, because a Leader with every name is also an Oars. It
confirms `zone: "field"` on both conditions rather than undermining either.

**`card.alternateNames` builds a real "every card name" Leader.** `cardNames()` is
`[cardName(card), ...card.alternateNames]`, so a synthetic Leader with `alternateNames: ["Other"]` is
indistinguishable to every name filter from a granted-names Leader — a step beyond the single-static-name
trick in the Antlerkov section, and it tests #921-shaped rulings verbatim with no `grantName` action.

**There is no "trash N cards from the top of your deck" COST** — print it as a `trashFromDeck` action
with `thenActions`, and the semantics come out exactly right, because `thenActions` runs only when the
**full** requested amount moved. A short deck mills nothing and buys nothing, which is what an unpayable
cost should do. Do NOT sequence the two as siblings (the `OP16-099` shape); that is for a payload which
is genuinely ungated.

**A "your own effect is not replaced" test can pass vacuously** — the ruling-#933 trap in fixture form.
On `OP15-090`, playing the one-card source emptied the hand, so `replacementActionIsAvailable` rejected
the `trashFromHand` and the absent prompt said nothing about the `source` gate. Two spare hand cards
fixed it. That is why a structurally identical test on `OP15-094` killed the same mutant while Perona's
did not.

**Fixture additions.** `op14eb04Oars101` is a real vanilla Character **named "Oars"** (8/10000), which
makes `OP15-080`'s "no other [Oars]" testable with no synthetic. `op06GeckoMoria086` (8/9000) is the only
real Gecko Moria one power step under 10000, so it pins that threshold — and one attached DON!! on your
own turn takes it to exactly 10000, a real-card way to prove a filter reads `power` rather than
`basePower`. `op11TonyTonyChopper053` is a real vanilla Character named "Tony Tony.Chopper", making an
`excludeName` killable without a synthetic. Vanilla [Thriller Bark Pirates]: `op06Lola094` (4/6000),
`op02GeckoMoria054` (4/6000).

## OP15 blue Characters (13 cards) — lessons

**`replacedEvent` and `source: "opponentEffect"` are load-bearing JOINTLY, and `replacedEvent` alone is
UNKILLABLE.** On the 因对方的效果 shape (`OP15-105` Bonney, `OP15-052` Leo, `OP12-102` Shirahoshi),
swapping `removeFromField` for `leaveField` changes nothing observable — measured by hand mutation, not
inferred — because `structuredSourceMatches` already requires `koCause === "effect"` whenever `source`
is `"opponentEffect"`, closing the battle path before `replacedEvent` is consulted. **Do not chase that
survivor with a new fixture, and do not "simplify" the pair**: `replacedEvent` is required and must hold
some value, `removeFromField` is what 离开场上 says, and `source` is what 因对方的效果 says. Assert the
*pair* instead — deleting `source` alone goes red (your own effects start being replaced), and swapping
both at once goes red (the battle path opens). This is **not** the redundant-filter case from Task 3,
where the fix was to delete the redundancy; here there is nothing to delete.

**A "no `excludeSelf`" ruling on a COST needs a cost-payment test, not a target test.** The
`effectCostReturnCharacterToDeck` prompt is `kind: "payCost"` and does list the source card among its
candidates — but only when `candidateIds.length > amount`, so the board needs a second Character or the
payment auto-resolves and the ruling goes unasserted.

**`[Rush]` proved by "the attack was legal" is a weak assertion — pitch the attacker to CONNECT.** A
4000 body cannot beat a 5000 Leader, so `lifeCount` never moves and a working grant reads as a failure.
Size the fixture `activeDon: cost + 1` and `attachDon` the spare to the attacker, so 4000 + 1000 meets
5000 and the Life drop is the durable witness. Pair with a control that declines the activation and
asserts `expectFailure(declareAttack).reason`.

**Fixture additions, all pre-OP15.** Vanilla [Dressrosa] ladder: `op01Bellamy076` (2/4000),
`op10BlueGilly054` (3/5000), `eb03Viola030` (5/6000), `op04TrafalgarLaw087` (5/7000),
`op10NicoRobin089` (6/8000), `op10Hajrudin050` (7/9000), `op12Issho082` (8/10000). [Dressrosa] Events
with an observable `[Main]`: `op10GumGumRhinoSchneider097` (cost 1), `op04GumGumKingKongGun093`
(cost 3); one with **no** `[Main]` at all: `op04Barrier095`. Inert [Dressrosa] Leaders differing only in
name — ideal for a `leaderName` boundary: `op04Rebecca039` and `eb01Kyros040`.

## OP15 green Characters (13 cards) — lessons

**`baseCost()` returns 0 for a Leader, which makes a cost filter on a `["leader","character"]` target
the cheapest killer of the `lte`→`gte` mutant.** The Leader always passes at cost 0, so asserting it IS
a candidate while an over-the-line Character is not kills the comparison flip and the filter deletion in
one list — free, where the equivalent for a power filter needs a synthetic. The over-the-line fixture
must not be the attacker: a `rest` pool drops already-rested cards before its own filters, so the
attacker would be excluded for the wrong reason.

**A `modifyCost` in `permanentEffects` is the `baseCost`-vs-`cost` discriminator** — the exact mirror of
the `modifyPower` trick for `basePower`. No mutation operator rewrites one to the other, and on a
vanilla board both readings agree. Spread a body, override `cost` one over the line, and give it a
`self: true` permanent `modifyCost` pulling it back under: printed 9 / current 7 is ineligible under
`baseCost lte 8` and eligible under `cost lte 8`. Assert the projected `cost` too, or a discriminator
that silently failed to apply is just another fixture.

**"Your opponent's rested cards", unqualified, is four zones** — `["leader","character","stage",
"costArea"]`, the pool `OP13-033` and `OP14EB04-024` use, wider than `OP07-026`'s narrower printed
"rested Character or DON!! cards". There is no fixture field for a rested Leader, so the `leader` zone
is only observable by having that seat attack with its Leader. Note `freezeActionCandidateIds` draws its
DON!! half from `restedDon` while `restActionCandidateIds` draws from `activeDon` — freezing wants
already-rested DON!!, resting wants active ones, and the id prefixes differ (`rested-don:` /
`active-don:`).

**`[Your Turn] [On Play]` IS testable, via one synthetic card.** You cannot normally play a Character on
the opponent's turn, but a synthetic own Character with `trigger: "onOpponentAttack"` and a `play`
action from hand gets you there — the opponent attacks, your synthetic fires for the defending seat, and
the card enters with `turn: "your"` false. Assert the played card actually reached the character zone,
or "no boost" just means the fixture never fired.

**`[Opponent's Turn]` on a `[Blocker]` GRANT is unfalsifiable in this engine** — a blocker step only
opens for the seat being attacked, which is by construction the seat whose opponent's turn it is, so
both readings are green on every reachable board and there is no projected keyword field to read. Say so
in the test rather than implying coverage.

**Fixture warning:** `op11Shirahoshi022`'s traits are `["Merfolk Fish-Man Island"]`, which under
substring semantics MATCHES a `"Fish-Man"` trait filter despite not having that trait — a bad negative
fixture. And the default filler `OP13-013` Higuma has no `[Trigger]`, so a Leader taking damage in a
fixture-built match publishes no `lifeTrigger` prompt.

## OP15 purple Characters (15 cards) — lessons

**A `returnDon` COST auto-pays only while one KIND of DON!! is held — and playing the card itself
breaks that.** The gate is `options.length > amount && sourceKeys.size > 1`, so an all-active fixture
auto-pays; but paying a card's own play cost *rests* those DON!!, so by the time an `[On Play] DON!! -N`
resolves the player holds both kinds and a real `effectCostReturnDon` prompt appears. Resolve it with
`{ selectedIds: ["active-don:0"] }`. **The `returnDon` ACTION has a looser gate** — it prompts whenever
`options.length > amount`, with no `sourceKeys` check — so an all-active board that auto-pays a *cost*
still publishes a choice for an *action* or a replacement.

**`position: "topOrBottom"` is one destination for the whole group, and that IS the rule.** Ruling #906
asks whether two looked-at cards may be split top and bottom: 不可以. Splitting is structurally
inexpressible in that verb, which is why it is right rather than merely convenient.

**A card gated on N `hasCard` conditions needs N negative fixtures AND N ruling fixtures — four boards
for two names.** The tool deletes each `{ filter: "name" }` independently *and* narrows each
`zone: "field"` independently. And **a single synthetic Leader cannot carry both names**: `cardNames()`
is `[cardName(card), ...alternateNames]`, and a hand-spread Leader has no `alternateNames`.

**A permanent `grantKeyword` over cards other than the source needs `count: { amount: "all" }`** —
`permanentKeywordsFor` skips any target that is neither `"all"` nor `self: true`, the same guard
`getPermanentModifierTotal` applies. So "all of your [X] cards **and this Character**" is always **two**
actions; there is no filter meaning "is the source card" to OR into the first.

**Keyword-grant tests need a control on the same fixture.** `[Unblockable]`: attack into an **active**
`[Blocker]` and assert `battleBlocker` never opened, paired with a non-matching body that *does* open
it. `[Double Attack]`: assert 2 Life lost — which requires the attacker to actually beat the defending
Leader, so a 4000-power body needs an attached DON!! to reach 5000 or the test reads 0 either way.

**Pre-OP15 fixtures with exactly the names OP15's Sky Island package keys on**, all `[On Play]`- or
`[Trigger]`-only and therefore inert when placed directly on the field: `op05Ohm101`, `op05Satori105`,
`op05Kotori103`, `op05Hotori111`, `op05Shura106`, `op05Holly110`. No synthetics needed for any of the
name conditions. **Two inert sub-3000 K.O. targets**, filling the gap the red batch flagged:
`op03Spandam086` (cost 1, power 2000) and `op03Corgy083` (cost 1, power 0) — between them they kill all
three mutants on a `power lte 2000` filter.

## OP15 red Characters (15 cards) — lessons

**`giveDon` is controller-sourced, full stop, and it parks a whole sub-theme.** The *target* may be an
opponent's card, but the DON!! can only ever be **yours** — `giveDon` reads
`getPlayer(state, controller)` and `GiveDonAction` has no source-player field. Six of these fifteen
cards print the opposite. **Do not reach for `player: "any"`**: rulings #856/#864/#868/#874 all answer
不能 to cross-side giving while #854/#862/#865/#872 allow both same-side directions, so `"any"` encodes
a card that does not exist rather than approximating one. Registered as `giveDonSourcePlayer`, now the
most-blocked primitive in `data/parked-clauses.json`.

**A "wrong X" fixture must be right about everything EXCEPT X.** This batch's only mutation survivor
(`OP15-014`, `delete filter:cardCategory`) came from a fixture that was wrong-category *and*
wrong-trait: the trait filter excluded it either way, so `cardCategory` was never consulted and
deleting it changed nothing. The general shape of a false-negative fixture, and worth checking whenever
a filter mutant survives on a card whose test "obviously" covers it.

**A `power lte N` filter matches Events and Stages — the mirror of the OP16 note.** `basePower()`
hard-zeroes non-Character/Leader cards, and 0 satisfies `lte`. So "`cardCategory: "character"` next to
a `power` filter is redundant except against a Leader" holds only for `eq` and `gte`; under **`lte`** it
is load-bearing against Events too, and an Event in hand is the right fixture — no synthetic Leader
needed.

**`activateEvent`'s candidate pool is NOT pre-narrowed by card type**, unlike `play`. It scans the whole
hand and rejects a non-Event at *execution* time with a bare `return false`, so a mis-scoped pool is a
silent no-op rather than an error — and its `cardCategory` filter therefore needs a **Character**
fixture, the opposite of the "use a Stage, never an Event" rule for `play`.

**"If your Leader has 0 power or less" is reachable, and no Condition reads a Leader's power.**
GENERAL ruling #4 keeps a 0-or-less card on the field, so the state is real; `cardState` only ever
addresses `"this"`, so the check goes through `hasCard` over `zone: "leader"` carrying a `power` filter
(precedent `OP05-009` Toh-Toh). `value: 0` generates no numeric mutant, but `comparison: "lte" -> "gte"`
does — and one negative fixture (the same real Leader at its printed 5000) kills that *and*
`delete filter:power` together.

**A hand card's projected `cost` is the DISCOUNTED cost**, which is how to pin a "give this card in your
hand −N cost" magnitude that is doubly invisible to the mutation tool (negative and single-digit).
Back it with the till: paying rests the DON!!, so a discounted cost-2 body played from `activeDon: 2`
must leave `activeDon: 0` / `restedDon: 2`. A −1 discount makes the play illegal and a −3 leaves 1
active, so the pair pins the number from both sides.

**"No card was drawn" must be asserted on `deckCount`, not hand length** — a Leader taking damage moves
a Life card into its controller's hand, so a negative control for an `[On K.O.] Draw 1` looks like a
draw if you count the hand.

## OP15 yellow Characters (16 cards) — lessons

**`data/rulings-sc.json` has one confirmed MISATTRIBUTED ruling — read the quoted card text, not the
ID you asked for.** Ruling seq **939** is filed under `card_id: "OP15-106"` (Octoballoon) but quotes
杰丽·邦妮 and asks a Bonney question; it belongs to **`OP15-105`**. So Octoballoon has *no* genuine
ruling and Bonney has two, one of them findable only under the wrong card. A central audit — consecutive
`seq` numbers sharing an SC card-name prefix but filed under different card IDs, minus the pairs that
are genuinely two printings of one character — finds **exactly one** such case in all 1,358 rulings, so
this is rare rather than systemic. The mitigation is already the standing rule at the top of this file:
the quoted SC text at the head of each entry is the specification, and checking it is free.

**"Removed by your opponent" and "removed by your opponent's EFFECT" are different encodings, and the
English barely separates them.** `OP15-098` Luffy is 因对方 — cause-agnostic → `replacedEvent:
"leaveField"` + `eventFilter: { causedBy: "opponent" }`, and ruling #957 confirms a battle K.O. counts.
`OP15-105` Bonney is 因对方的**效果** → `replacedEvent: "removeFromField"` + `source: "opponentEffect"`,
which `findRemovalReplacement` gates on `koCause === "effect"`, so a battle K.O. correctly finds
nothing. One set apart, near-identical English, opposite encodings — **test the battle direction
explicitly**, because it is a silent pass under the wrong choice.

**A `turnLifeFaceUp` cost enforces its own "you may not" rulings in both directions.** `canPayCosts`
rejects it when `life.length < count` *and* when the top cards are already in the requested state. That
single check is the whole of rulings #934 (`faceUp: false`, unusable when already face-down) and #942
(`faceUp: true`, unusable when already face-up), plus the 0-Life half of both. **Never add a
`faceUpLife` or `lifeCount` condition beside one** — unkillable mutant, the trap #933 set on OP15-098.
Fixture Life cards default to face-**down**, so a `faceUp: false` cost needs
`life: [{ card: X, faceUp: true }, …]` to be exercisable at all.

**`dynamicCost` is the primitive for "a cost equal to or less than your opponent's Life."** It reads
`baseCost(card)` against a live count, so both sides move. To prove the source is `opponentLifeCount`
rather than `selfLifeCount`, set the two Life totals apart **and crossing** — south 2, north 5 makes a
cost-4 body legal under one reading and produces no prompt at all under the other.

**A bracketed proper noun in an "A or B" filter is not always the same kind of check on both sides.**
`OP15-101` Kalgara reveals "[Mont Blanc Noland] or [Shandian Warrior] type cards": the first is a
**name** (no card carries a Mont Blanc Noland *trait*), the second a **trait**. Neither disjunct
subsumes the other, which is what makes both killable.

**A cheaper `power`-vs-`basePower` discriminator than the synthetic body:** a real 6000-base
`[Sky Island]` card (`op12Seto103`) plus one `attachDon` **on your own turn** reads 7000 current / 6000
base. (Note the projected field is `players.<seat>.characters`, plural — `character` is the *fixture*
key, and confusing them yields "Cannot read properties of undefined".)

**`getLegalCommands` returns descriptors whose card field is `sourceId`, not `sourceInstanceId`** — the
command you *send* uses one name, the descriptor you *filter* uses the other. And `engine.exec` THROWS
on a rejected command, so a negative assertion must use `engine.expectFailure` to read a `reason`.

**Fixture additions.** Vanilla `[Sky Island]`: `op06Genbo105` (3/5000), `op12Seto103` (5/6000),
`op12Wyper114` (6/7000) — all concatenated traits, so `match: "includes"` is mandatory. `[Sky Island]`
Stages, cost 1: `op05UpperYard117`, `op06TheArkMaxim117` — the fixtures that make a `cardCategory:
"character"` filter on a `play` action killable. `[Shandian Warrior]` Leader: `op08Kalgara098` only,
which doubles as a real Leader *named* Kalgara for a `zones: ["leader","character"]` name target.

## OP16 red Characters (14 cards) — lessons

**`OP16-008` Squard is the one card printing BOTH power filters, and they differ on purpose.** Its
trash cost is 原本的力量 (`basePower`, exactly 10000); its own K.O. target is plain 力量
(`power lte 8000`). Ruling #966. When a card uses both, read each clause's own Chinese.

**A power filter cannot tell `basePower` from `power` on a plain fixture, and the mutation tool never
swaps them** — it deletes filters and flips comparisons, but has no operator rewriting one to the
other. Both readings are green on any board where nothing is modified, i.e. every board built from
vanilla fixtures. The discriminator is a synthetic body with a *self-targeting* permanent
`modifyPower` (`{ …, count: { amount: 1 }, self: true }`, which passes the `"all"`-or-`self` guard) so
its base and current power differ. Aim it the way the text demands: for 原本的力量 give it a buff (low
base, high current, must still be hit); for plain 力量 give it a debuff. **Attached DON!! is not a
substitute** — it contributes only while its controller is the active seat, which is never the case for
an opponent's body during your own `[On Play]`.

**A `trashFromHand` battle-K.O. replacement is ONE prompt, not a confirm then a payment.** `battle.ts`
branches on the replacement action's shape: anything *other than* `trashFromHand` builds a `confirm`
with `yes`/`no`, but a `trashFromHand` builds a `selectCards` prompt whose options are already the
filter-matched hand. **Both carry intent `battleKoReplacement`**, which is what makes this easy to get
wrong. So the candidate list — the only place the replacement's filters are observable — hangs off
`battleKoReplacement` itself, and declining is `{ selectedIds: [] }`, not `{ optionId: "no" }`.
`EB03-001` Vivi shows this branch; `OP05-001` and `OP15-098` show the other.

**A Leader with its own `onOpponentAttack` ability queues AHEAD of the blocker step.** `op09Shanks001`
fires on every declared attack, so a `battleBlocker` test using it as the defending Leader must resolve
that `effectOptional` first or the blocker prompt is not there yet. Prefer an inert fixture Leader
(`op16PortgasDAce001`, whose only ability is an `[Activate: Main]`) unless the Leader's own text is
what is under test.

**`donFieldCount` counts DON!! wherever they sit** — active + rested + every attachment — so paying a
card's own cost never changes it, and a "10 DON!! on your field" gate holds across the play that
triggers it. `value: 10` is two digits, so the numeric operator generates nothing: pin 9, 10 and 11 by
hand, and `activeDon: 11` remains the only way to kill the `eq`→`gte` mutant.

**Fixture ceilings.** The vanilla pool has no cost-8 [Whitebeard Pirates] Character and nothing above
10000 base power (tops out at cost 7 `op02LittleoarsJr020`; 10000 `eb02DonAccino004`, `op12Shiki005`,
`op12Issho082`, `op14eb04Oars101`). Below 3000 there is no *vanilla* Character at all, but two inert
ones serve as K.O. targets: `op03Fossa010` (cost 2, [Blocker] only) and `op03Thatch005` (cost 1,
`[Activate: Main]` only).

## OP16 green Characters (12 cards) — lessons

**Ruling #977 (Bunkov) closes the loop opened by #979 (Antlerkov).** The two cards name each other, and
both need `zone: "field"` — the Leader counts. The SC text pins a second thing the English does not
(我方场上): `player: "self"`, so an *opponent's* Antlerkov does not satisfy it.

**`replacedEvent: "ko"` is the right value for "if this Character would be K.O.'d", and covers both
battle and effect.** `findKoReplacement` searches `["ko","leaveField"]` on a battle cause and
`["ko","removeFromField","leaveField"]` on an effect cause — `"ko"` is in both. This is the positive
counterpart to `OP15-098`'s lesson: there the printed text was "removed from the field" and needed
`leaveField`; here it is "K.O.'d" and `ko` is simply correct. Match the printed verb.

**"Rest N of YOUR cards" and "rest N of your OPPONENT'S cards" use different zone pools, deliberately.**
Your own is Leader + Character + Stage — the pool the engine's own `restCards` **cost** uses
(`candidatesForRestCardsCost`), which exists for exactly that printed phrasing. The opponent-facing one
additionally includes `costArea`, consistently across five existing cards (`OP13-033`, `OP14EB04-024`,
`OP14EB04-029`, `EB03-032`, `OP13-006`). Copying the wrong half lets a card rest its own DON!!, or
stops it touching the opponent's.

**A `rest` target spanning field zones *and* `costArea` publishes `effectMixedRestSelection`, and its
step kind is `payCost`** — not `effectTargetSelection`/`selectEntity`. Getting the intent wrong yields
"Could not find a pending …", which reads like the encoding never fired.

**Pin a small `amount: N` by making the candidates FEWER than N, not by what you select.** Single-digit
amounts are invisible to the mutation tool. For Morley's "rest 2", make only one card restable: the
replacement is then suppressed entirely by `replacementActionIsAvailable` and the card dies — an
assertion that goes red instantly at `amount: 1`. The same fixture proves already-rested cards are out
of the pool.

**`setBasePowerFrom` copies the source's PRINTED base power**, so attaching DON!! or adding modifiers to
the source changes nothing. To prove `player: "opponent"` you need the two Leaders to differ in printed
power — and only four real Leaders are not 5000: `op02EdwardNewgate001` (6000),
`op11MonkeyDLuffy040` (6000), `op13PortgasDAce002` (6000), `op13GolDRoger003` (7000).

**`leaderTrait`'s `match: "includes"` is behavioural, not decoration.** Older Leaders store traits as
one concatenated string — `op02EmporioIvankov049` is `["Revolutionary Army Impel Down"]` — so
`match: "exact"` never finds `"Impel Down"`. Use that card as the fixture Leader and `includes` is
genuinely exercised. GENERAL ruling #39 confirms the substring semantics from the rules side.

**When asserting a prompt did NOT appear, filter `status === "pending"`.** `state.promptQueue` retains
*resolved* prompts, so a test that opens a blocker step in a control attack and resolves it will still
see `battleBlocker` in the queue afterwards — a false red on an unblockable assertion. (`view.prompts`
already filters pending, which is why it stays the safe accessor.) Also do not use
`view.prompts.toHaveLength(0)` here: a Leader taking damage legitimately publishes `lifeTrigger`.

**`expectFailure` returns `ApplyCommandResult` — the fields are `accepted` and `reason`, not `ok`.**
And `ProjectedCard.power` is `number | null`, so a test helper needs
`if (!card || card.power === null)` or `vp check` fails with TS2322.

## OP16 blue Characters (14 cards) — lessons

**Sometimes the correct encoding is the ABSENCE of a filter, and only a ruling can tell you.**
`OP16-045` Crocodile and `OP16-050` Miss Olive both print "return 1 of your Characters with a cost of 2
or more". Rulings **#989** and **#992** both say you may return **this Character itself**. The obvious
model, `OP08-047` Jozu, prints *"other than this Character"* and carries `excludeSelf` — copy it and
you silently break both rulings, and no reading of the printed text catches it. Test it by paying the
cost with the card itself and asserting the effect still resolves.

**A permanent `modifyPower`/`modifyCost`/`modifyCounter` is SILENTLY IGNORED unless its target is
`self: true` or `count: { amount: "all" }`.** `getPermanentModifierTotal` (`effects/permanent.ts`) has
`if (action.target.count.amount !== "all" && !action.target.self) continue;`. A `permanentEffects`
entry written with `count: { amount: 1 }` over another zone compiles, type-checks, raises no capability
issue, and never applies. Watch for it on anything printed "your Leader gains +N power".

**`copyPower` vs `setBasePowerFrom` vs `setBasePower` vs `setPower` is decided by one phrase of printed
text, and there are four verbs, not two.** `copyPower` reads `getCardPower(source)` (current, with
modifiers) and always applies to the card bearing the effect; `setBasePowerFrom` reads
`basePower(source)` (printed) and takes an explicit target; `setBasePower` takes a LITERAL and an
explicit target; `setPower` takes a literal too but sets TOTAL power. Tell:
*"the power of X"* → `copyPower` (`OP04-069`, `OP16-055`, `OP16-104`); *"the same as X's base power"* →
`setBasePowerFrom` (`OP06-009`, `OP14-053`); *"base power becomes N"* → `setBasePower` (`OP15-070`,
`OP15-071`, `OP15-092`, `OP16-015`, `OP16-058`, `OP16-106`); *"set the power of X to N"* → `setPower`,
which in the whole 2,537-card catalog is `OP07-002` Ain alone. See the `setBasePower` section below —
picking `setPower` for a "base power becomes" clause is wrong in a way a green test will not show you.

**Attached DON!! gives its +1000 only while its controller is the ACTIVE seat** —
`getCardPower` is `basePower + (state.activeSeat === instance.controller ? attachedDon * 1000 : 0)`.
ENCODING already notes attached DON!! physically survives the opponent's turn; the power does not. So a
`[DON!! xN] [Opponent's Turn]` assertion must not expect the DON!!'s own +1000, and DON!! on the
opponent's board cannot be used to make its power differ from base during your turn.

**An `anyOf` group with zero filters matches everything** (`groupMatches` starts `true` and ANDs). That
is what lets `mutation_check.py` kill filters nested inside an `anyOf`: deleting one empties its group
and the whole `anyOf` goes vacuous. One fixture that makes the *unfiltered* pool payable kills every
such mutant at once.

**An `optional` block whose costs cannot be paid publishes no `effectOptional` confirm at all**
(`canPayCosts` runs before the prompt is created). So "the cost filter is load-bearing" is testable
with no candidate list: build a fixture where nothing can pay and assert `view.prompts` is empty —
every way of breaking the filter makes something payable and turns it red.

**`order: "any"` on `returnToDeck` is only consulted when `position` is also `"any"`.** On a card
printed "at the **bottom** … in any order" the field is inert; ordering happens instead because
`selectionAlreadyProvidesOwnerOrder` treats selection order as placement order when all targets come
from one player's hand and that player chooses. The `effectReturnToDeckOwnerOrder` prompt appears only
for targets from the *trash* — copying `OP11-072`'s prompt sequence onto a hand-zone card fails.

**Two projection traps.** `battleBlocker` candidates include a synthetic `"skip"` entry, so an exact
`toEqual([id])` fails — filter it first. And a projected *opponent* hand has `instanceId: null` on every
card, so asserting a bounced Character reached their hand must read
`getState().players.<seat>.hand`.

## OP16 purple Characters (13 cards) — lessons

**A WHOLE COLOUR can be invisible to `mutation_check.py`.** Seven of the thirteen purple Characters
generate **zero** mutants and still print `ok`. Purple's decision surface is `state: "active" |
"rested"`, single-digit DON!! counts and `leaderTrait` conditions — the numeric operator needs an
unsigned 3–6 digit `value:`, and **there is no operator for `conditions`, for `state`, or for an
action's `amount` at all.** So rule 0 is much broader than "negative numbers": for DON!! cards the
mutation report certifies *nothing*, and every boundary must be hand-written. The purple batch wrote
**56 hand mutants** to cover swapped DON!! states, off-by-one counts, `restDon`↔`returnDon`, dropped
and relocated Leader gates, dropped `optional`, and dropped blocks.

**Killing `mutation_check.py` by pattern does not kill it, and the failure mode lies.** The python's
command line is repo-relative (`python3 tools/mutation_check.py --engine vendor/…`); the worktree path
appears only in the *wrapper shell's* line. So `pkill -f "<worktree>.*mutation_check"` kills the
wrapper and **orphans the tool**, which keeps rewriting vendored cards. Symptoms: a test fails on a
card you never touched, and `graft_cards.py` reports `1 copied` on every run because the file changes
back between invocations. Match on cwd instead —
`for p in $(pgrep -f mutation_check.py); do lsof -a -p $p -d cwd -Fn | grep '^n'; done` — and since a
signal skips the tool's `finally` restore, follow any kill with `graft_cards.py` **twice**, requiring
the second to report `0 copied`. This is the exact mirror of the concurrent-graft hazard: a stray
`graft` manufactures phantom *survivors*, a stray `mutation_check` manufactures phantom *failures*.

**Concurrency has a hard ceiling.** Four sibling batches on one machine take a single `vp test run`
from ~7 s to ~90 s, which puts a full `--set` sweep in the multi-hour range. The affordable per-batch
gate is `--card <ID>` over the batch's own cards, **each with its own exit code** (a loop's last status
hides earlier failures). Sweep the whole set **once, centrally, after merge** — and check first that no
other test imports the batch's cards, which is what makes the split legitimate rather than a shortcut.

**Where "If your Leader has the [X] type" sits is load-bearing, and both placements are printed.**
After the cost colon it gates only the payload — the cost is payable with the wrong Leader and buys
nothing (`OP16-065`, `OP16-070`; precedent `OP04-060` Crocodile). Leading the clause, it gates the
whole block including the "Then," half (`OP16-066`, `OP16-074`, `OP16-075`) — ruling #944's shape.

**`DON!! -N` is `cost: "returnDon"`** (takes DON!! off the field, to the DON!! deck); **"rest N of your
DON!! cards" is `cost: "restDon"`** (leaves it in the cost area). Assert `donDeckCount` as well as
`activeDon`/`restedDon` or the two are indistinguishable. **Neither prompts when the payer holds only
one KIND of DON!! source** — the gate is `options.length > amount && sourceKeys.size > 1`, kinds being
active / rested / attached-per-card — so an all-active fixture auto-pays silently. Same gate governs
`opponentReturnDon`: give the opponent **both** active and rested DON!! or ruling #999 goes unasserted.

**`addDon` with `count.upTo` publishes `effectAddDon`**, capped at `min(amount, donDeckCount)` — so set
`donDeckCount` in the fixture *above* the printed cap, or `["0","1"]` proves an exhausted deck rather
than "up to 1". For the "up to 1 active **and** up to 1 additional rested" shape the two actions
publish two consecutive prompts: resolve the first and assert between them, or swapping the two
actions is undetectable.

**A `payCost` step exposes `candidates`, not `options`** — even when the underlying options are DON!!
slot ids. Reading `.options` yields `undefined` and fails as `Target cannot be null or undefined`.
`chooseOption` steps *do* expose `options`.

**`cannotActivate` has a `requiresKeyword` flag, and ruling #996 forbids it on `OP16-063`**: an
opponent Character with **no** [Blocker] is an explicitly legal target, and the lock still binds if it
gains one later that turn. The obvious encoding is wrong and the English does not say so. Note also its
special case — `keyword: "blocker"` with `count.amount: "all"`, a single `character` zone and no
filters becomes a player-scoped modifier on the **Leader**.

**`whenDonReturned` is enqueued only for the seat whose DON!! moved**, so making the opponent return
DON!! cannot wake your own Leader's trigger. An `[On K.O.]` `addDon` prompts the K.O.'d card's own
controller, not the attacker.

**Fixture additions.** Vanilla [Navy]: `op02Komille097` (1/3000), `op02Doberman107` (2/4000). Vanilla
[Impel Down]: `op11Saldeath064` (6/8000), `op02Blugori084` (concatenated traits — needs
`match: "includes"`). Printed-[Blocker]-only body: `op04Ideo077` (2/2000). Inert Leaders by trait:
`op02Smoker093` [Navy], `eb01Hannyabal021` [Impel Down], `op10Sugar003` [Donquixote Pirates]. **There is
no vanilla Character named "Koby"** — OP11-001 is a Leader — so an `excludeName: "Koby"` test needs a
synthetic with both `name` and `i18n.en.name` overridden.

## OP16 Leaders, Events and Stages (22 cards) — lessons

**A card gated on N separate conditions needs N negative fixtures, one per condition.**
`mutation_check.py` deletes each `{ filter: … }` object independently, so on `OP16-040` (two `hasCard`
conditions, one per printed name) every test that had *both* names present left the first filter
unkillable — the second condition carried the gate on its own and deleting the first changed nothing.
This is the general shape, not a quirk. Write one case per condition in which *that* condition is the
one that fails. This was the batch's only survivor and it was fixed and re-run to 8/8.

**`whenCharacterRemoved` is the cause-agnostic departure trigger** — `battle.ts` fires it on a battle
K.O. and `enqueueCharacterRemovalEffects` fires it for any Character an effect moved out of the
character zone, K.O.'d, trashed, bounced or decked. That breadth is what "removed from the field" /
离开场上 needs. Adding `causedBy: "opponent"` narrows it to the `OP10-042` Usopp wording ("by your
opponent's effect") and breaks ruling #988, which says `OP16-041` Buggy fires on **your own** effect
returning your Character to hand. Same-shaped cards, opposite filters — read the printed text.

**Setting an impossible DON!! count in a fixture is how you tell `eq N` from `gte N`.** "If you have 10
DON!! cards on your field" is `donFieldCount eq 10` by all five existing precedents, but since the DON!!
deck holds ten, `gte 10` is behaviourally identical in real play and the mutant is unkillable.
`activeDon: 11` in the fixture is uncapped (`test-fixtures.ts` assigns it directly) and kills it — the
same licence as the synthetic-Leader-in-hand trick.

**`cardCategory: "character"` next to a `power` filter is redundant — but only for Events and Stages.**
`basePower()` hard-zeroes those, so `power eq 8000` already excludes them. It does **not** exclude a
**Leader**, which is exactly why `OP16-002` Izo's `cardCategory` filter is load-bearing and needs the
synthetic-Leader-in-hand fixture. So: keep it where a Leader could sneak in, drop it where only
Events/Stages would be, and never add it next to a power filter expecting Events to prove it.

**New prompt intents.** `setActive` on `zones: ["costArea"]` with `count.upTo` publishes
`effectSetActiveDon` first (`chooseOption`, capped by the printed "up to N", not by the rested DON!!
available). `removeFromLife` with `count.upTo` publishes `effectRemoveFromLifeCount`. Both are easy to
miss because the prompt you are looking for is the one *after* them.

**`remainderPosition: "bottom"` prompts for an order only when 2+ cards remain** (a single remainder
auto-places), and the remainder lands *behind* whatever the search never looked at — so assert the whole
deck array, not a `slice(-N)`.

**`negateEffects` is provable through `expectFailure`.** Negate a Character with an `[Activate: Main]`,
then `expectFailure({ type: "activateEffect", …, trigger: "activateMain" }).reason` is
`"This card does not have that activation timing."` (the shape `op10-098-liberation.test.ts` uses).

**Two harness traps.** State arrays are frozen — `state.players.south.hand.sort()` throws
`TypeError: Cannot assign to read only property '0'`; copy first. And `characterArea` carries `null` for
empty slots, so filter with `(entry): entry is string => entry !== null` before indexing.

**Fixture gaps in the vanilla pool.** There is **no** "Admiral"-trait card anywhere in OP01–OP14/EB/PRB/
ST01, and no vanilla Character named Monkey.D.Luffy or Mr.3(Galdino) — spread a vanilla body and
override `traits`/`name`/`i18n.en.name` (remembering both name fields). The vanilla pool tops out at
**cost 8**, so a "cost of 8 or less" boundary needs a synthetic cost-9 twin. Cards with a real
`[Trigger]` and nothing else, ideal inert `hasTrigger` fixtures: `op01Carrot009`, `op01Kawamatsu037`,
`op01Monet082`, `op01Speed104`, `op02Sentomaru104`.

**`differentNames` reads `card.name`; the `name` *filter* reads `i18n.en.name`.** Two different fields,
equal by construction in generated cards but not on a hand-spread synthetic.

## OP16 yellow Characters (13 cards) — lessons

**A `[Trigger]` resolves AFTER its own card has left the Life area, so a Life-count condition does not
count the card itself.** Ruling #1013 (`OP16-111`: 3 Life *including* this card satisfies "2 or less").
This is the exact twin of Task 4's trash finding — and the adjustment goes the **opposite** way, which
is why each zone has to be checked rather than reasoned from the other. Either way: encode the printed
number.

**"[Trigger] Activate this card's [On K.O.] effect" is `activateEffect` with
`effectTrigger: "onKo"`, and the target block's own `conditions` are re-checked on the second route for
free.** `activateEffect` *enqueues* an `effectBlock` resolution rather than executing the actions, and
`effects/resolution.ts` evaluates `block.conditions` when the queue reaches the item. So an
`[Opponent's Turn]` gate written once on the `onKo` block governs both the battle-K.O. path and the
`[Trigger]` path — which is exactly what ruling #1011 demands on `OP16-103` Van Augur (fire the Trigger
on your own turn and the `[On K.O.]` must not activate). Seven cards print this wording; the
pre-existing precedent is `OP09-102` Professor Clover, for `onPlay`.

**`0/0 mutants killed` prints as `ok`.** Combined with rule 0 above, a card whose entire decision
surface is a negative magnitude generates no mutants at all and still reports as a pass. Treat a `0/0`
line as "not probed", not "verified", and write the boundary test by hand. (Task 3/4's OP15 cards
happened to have zero `0/0` lines, but three of the OP16 black batch's did.)

**`expect(view.decisions).toHaveLength(0)` is NOT a way to assert "no prompt appeared."**
`projectDecisions` always includes an `actions:<seat>` entry for the active seat, so that assertion
passes only for the *non*-active seat — which makes it look like it works. **`view.prompts` is safe**:
`projectPrompts` filters the real queue for pending prompts belonging to the viewer and adds nothing.
Use `view.prompts`, or assert against `getState().promptQueue` and name the intent you expect absent.

**A `rest` action's candidate pool drops already-rested cards BEFORE the action's own filters.** So on
an `[On K.O.]` rest effect the attacker cannot double as the "excluded by the filter" fixture —
attacking rests it, and it is then excluded whether the filter exists or not. `mutation_check.py`
caught this on `OP16-110`, with the tell-tale signature of a fixture excluded for the wrong reason:
`delete filter:cost` survived while `lte→gte` died. The over-cost body must be **active**. Note this is
the opposite of `setActive`, which per GENERAL ruling #27 does offer already-active Characters.

**`negateEffects` has no projected field.** Prove it by suppressing a *specific* ability: negate a
Character that has an `[On K.O.]`, K.O. it, and assert its own trigger never published — paired with a
control that declines the negate and shows the prompt appearing.

**`battleCounter` is published only when the defending seat's hand is non-empty**
(`beginBattleCounterStep` returns early on no options), and the fixture default for `hand` is `[]`,
unlike `deck` and `life` which get filler. That is why a copied-in `resolveDecision("battleCounter", …)`
often fails with "Could not find a pending battleCounter prompt" — and why it *did* appear for the two
OP15 cards that needed it.

**The engine's only [Blackbeard Pirates] Leader negates its own controller's `[On Play]` effects.**
`op09MarshallDTeach081` prints exactly that, so a synthetic `onPlay` test card does nothing under it —
no prompt, no capability issue, no log, indistinguishable from a broken encoding. Drive such scenarios
with `activateMain` on a body already on the field instead.

**Vanilla fixture cost/power ladder** (all pre-OP15, no `effect` key): cost 1/3000 `eb01Doma005`,
2/4000 `op01Sai012`, 3/5000 `op03Namule007`, 4/6000 `op02Atmos003`, 5/7000 `op02Kingdew006`,
6/7000 `op11XDrake017`, 7/9000 `op02LittleoarsJr020`, 8/10000 `op05JohnGiant044`. Two at cost 7 matters
when one must attack while the other stays active. Older sets store traits as one concatenated string,
so a trait filter **must** carry `match: "includes"` or these fixtures silently fail to match.

## OP16 black Characters (17 cards) — lessons

**"If you have X" is not always your own field, and the English print can be flatly wrong.**
`OP16-081` Otama prints *"If **you** have a Character with a cost of 8 or more"* on Bandai's own list
and on Limitless. Ruling **#1003** contradicts it: the SC is 场上存在费用为8或更高的角色的场合 — "there is a
Character with a cost of 8 or more **on the field**", no owner — and the Q&A asks the exact case (my
field has none, my opponent's does) and answers 是的，可以. This is a step past the Antlerkov lesson:
there the English was *ambiguous* about whether the Leader counted; here it names the wrong **player**.
**`existsOnField` is the only condition that can scan both fields** — its `player` is optional and
defaults to `"any"`, whereas `hasCard`'s is mandatory. Precedent: `OP02-102` Smoker. Read the SC text
for the *owner* as well as the zone.

**Which card type exercises a `cardCategory` filter depends on the action.** The `play`-needs-a-Stage
note above is specific to `play`, whose candidate pool is pre-filtered to character-or-stage. Two other
shapes have no type pre-filter, so an **Event** is a genuine false positive there and is the right
fixture: a `trashFromHand` **cost** (scans the whole hand — `OP16-083`, `OP16-092`), and a
`returnToHand` **target** over `zones: ["trash"]` (`OP16-097`).

**Two printed-keyword firsts.** `[Rush: Character]` is its own `Keyword` value, `rushCharacter`,
distinct from `rush` — it permits attacking Characters on the turn played but still not the Leader
(`OP16-089` Mihawk). `[Unblockable]` had never appeared in a printed `keywords` array before
`OP16-096` Yamato; every prior use was granted. Neither has a projected field, so prove them
functionally: for unblockable, attack into an **active** `[Blocker]` and assert the blocker step never
opened, *paired with a control on the same fixture without the keyword* — otherwise "no prompt" is
indistinguishable from a broken fixture.

**A condition-gated `activateMain` is rejected at the command with a quotable reason.**
`expectFailure({ type: "activateEffect", … }).reason` is `"The activation conditions are not met."`
(or `"The activation costs cannot be paid."`). Tighter than probing `getLegalCommands`, and it kills
threshold mutants directly. Keep `getLegalCommands` for `oncePerTurn`, where the first activation must
succeed.

**A defender with a non-empty hand opens a `battleCounter` step before damage resolves** — so any
`[On K.O.]` waits on it. Resolve `{ selectedIds: [] }` for the defending seat, or give that player no
hand. Most existing engine tests hide this by leaving the opponent's hand empty.

**`search` prompts list every looked-at card with a per-candidate `legal` flag**, unlike an action's
target selection. Assert exclusions via `candidates.find(c => c.ref.id === x)?.legal`, because
`not.toContain` on the ids passes vacuously. Also assert how many cards reached the trash — that is the
only thing pinning `lookCount`, which the mutation checker never perturbs.

**`giveDon` with `donState: "rested"` reads `player.restedDon`**, not `activeDon`, so seed it
separately. And paying a card's own cost *rests* that DON!! — after playing a cost-3 body with
`activeDon: 3, restedDon: 2`, `restedDon` is 5. Read it back after the play rather than asserting the
fixture value.

## Task 4 — OP15 events + stage (20 cards)

**An Event is already in its own trash when its `[Main]` resolves — so a "cards in your trash"
condition counts the card itself.** `engine/commands.ts` calls `enqueueEffectsForTrigger(…, "main")`
and *then* `moveCard(… "trash")`; the effect resolves off the queue afterwards. Rulings #930
(`OP15-095`, 15+ cards) and #931 (`OP15-097`, 10+ cards) both turn on this: 14 and 9 pre-existing
cards are respectively enough. **Encode the printed number, never printed-minus-one.**

**…but a `[Trigger]`-activated Event does NOT self-count.** A Life card with a Trigger moves to the
`resolution` zone, not the trash (`battle.ts`). `OP15-097` is the same card both ways and ruling #931
answers both: from hand at 9 cards in trash it fires; via its own `[Trigger]` at 9 cards it does
nothing. Test both directions on any card that counts its own trash.

**Where a Leader check goes is per-card, and the rulings disagree on purpose.** A *leading* "If your
Leader is [X], …" gates the whole block (`conditions`); a check written into a later sentence's
target — "your [Lucy] Leader gains …" — gates only that action. Ruling #899 (`OP15-056`: a non-Lucy
Leader still draws 2) and ruling #944 (`OP15-116`: without the type, the "Then" half does not happen
either) are the two worked cases. **Read the ruling per card; do not generalise from a sibling.**

**Siblings are not a pattern.** `OP15-074/075/076` all gate their `[Main]` on an `[Enel]` Leader;
`OP15-077/078` print no such condition and must not get one by analogy. Check the SC text quoted in
each card's own ruling.

**`[Main] / [Counter]` is two blocks with duplicated actions** — there is no combined trigger. Model
on `OP03/events/017-cross-fire.ts`. The two halves frequently differ (`OP15-095`'s `[Main]` is
trait-filtered and DON!!-gated while its `[Counter]` is neither), so copy deliberately, not blindly.

**`baseCost` vs `cost`, `basePower` vs `power`.** "a base cost of 5 or less" (原本的费用) is
`baseCost`; a discounted cost-6 body must not qualify. Same split as `basePower` on `OP15-098`.

## The `setBasePower` primitive (built 2026-08-20)

Six clauses across OP15/OP16 print *"base power becomes N"* and were parked on
`setBasePowerLiteral` until this primitive existed. It is now DSL vocabulary like any other verb, so
**do not re-park a "base power becomes" clause** — and do not reach for `setPower` instead.

```ts
{ action: "setBasePower", target: <Target>, value: 7000, duration: "thisTurn" }
```

**Why `setPower` is the wrong answer, in two independent ways.** It computes
`action.value - getCardPower(target)` at resolution and stores that as a `type: "power"` delta. So
(a) it absorbs modifiers the target already carries instead of letting them stack on the new base —
a 6000 Prisoner holding one attached DON!! must read 8000 under `OP16-058`, and `setPower` reads
7000; and (b) the permanent power path recognises only `modifyPower` and `setBasePowerFrom`, so a
`setPower` written inside `permanentEffects` **is never read at all**.

**What the engine actually does.** A `setBasePower` modifier stores the LITERAL in `value`, not a
delta, under its own `ModifierState["type"]`. `getCardPower` substitutes it for the printed base
before summing attached DON!! and the power modifiers, via `getEffectiveBasePower`
(`shared.ts`) — timed modifier first, then `getPermanentSetBasePower` (`effects/permanent.ts`, the
twin of `getPermanentSetCost`), then the printed base. Consequences worth knowing:

- **+power modifiers stack on top.** Ruling #927 makes that mandatory rather than tidy: at 30 cards
  in the trash all three of `OP15-092`'s bullets apply, so base-9000 and +1000 must reach 10000.
- **Applying the same literal twice is idempotent.** Two `OP15-070` Fuza in play both say 6000
  about one shared [Shura] body; a delta encoding would say 8000.
- **It can move a card DOWN.** `OP16-106` sets "up to 1 of your Leader or Character cards" to 7000,
  which on a 10000 body is a cut. No `modifyPower` value can express a clause that raises a 5000
  Leader and lowers a 10000 Character in the same breath — that is the shape to watch for.
- **Two DIFFERENT literals on one card** resolve to whichever source is scanned first, the same
  contract `getPermanentSetCost` already has. Nothing in OP15/OP16 can produce that: every
  permanent user names 6000 except `OP15-092`, whose two literals land on a Character and on a
  Leader.
- **Permanent-effect targets still need `count.amount: "all"` or `self: true`**, the same guard
  `getPermanentModifierTotal` applies. `getPermanentSetBasePower` enforces it deliberately, because
  a permanent effect cannot make a choice.

**Rulings #909 / #910 / #994 all answer 是的 to the same question and all three pin the same thing:
a Leader carrying "has every card's name" DOES reach the literal.** So a "all of your [Name] cards'
base power" clause takes `zones: ["leader", "character"]`, not `["character"]`. This is the C1/C2
Leader-exclusion trap (rulings #979/#993) in a third guise, and `zone: "character"` reads perfectly
naturally each time.

**But be honest about what that zone list buys today: on a NAME-gated arm it is inert, and no test
can cover it.** Names resolve through `cardNames()` = `name` + `alternateNames`; exactly 12 cards in
the 2,537-card catalog set `alternateNames`, none is a Leader, and no Leader carries "has every
card's name" text at all. So no Leader can currently match `filter: "name"`, and conforming to those
three rulings really needs a name-WILDCARD mechanism in `matchesTargetFilter`, which does not exist.
Keep the breadth — it is correct and forward-compatible, and `zones:` is not a mutation-operator
site so nothing will flag it — but do not claim it is exercised. Where the target is NOT name-gated
the primitive demonstrably does reach a Leader: `OP16-106`, `OP16-015` and `OP15-092` bullet 2 all
assert a Leader's power directly.

**Engine delivery.** The primitive is the nine `setBasePower` patches in `tools/patch_engine.py`
(positions 15–23 after Phase 1 took 10–14 — cite them by NAME, the list has been inserted into
twice), across `packages/types/src/effect/action.ts` (the action type and its union membership),
`engine/src/types.ts` (the modifier type), `engine/src/shared.ts`
(`getSetBasePowerModifier`, `getEffectiveBasePower`, `getCardPower`),
`engine/src/effects/permanent.ts` (`getPermanentSetBasePower`) and
`engine/src/effects/actions.ts` (the resolver case, plus the three older setters). One of those is
the first patch to reach outside `packages/engine`; `packages/types` is consumed from source, so
there is no build step.
The duration→expiry mapping is copied from **`modifyPower`**, the only complete one in the file —
**not** from `setPower`, which omits `untilEndOfYourNextTurn`, nor from `setBasePowerFrom`, which
also leaves `untilEndOfOpponentNextEndPhase` unmapped. An unmapped duration falls through to
`expiresAtTurn: null` and then never expires, and `untilEndOfOpponentNextEndPhase` is exactly the
duration `OP17-005` prints.

**Testing it.** Five assertions carry the semantics. The first three are per-card; the last two are
the ones a green suite will NOT ask you for, and both were missing on the first pass:

1. **the exact literal**, from a printed base that is not the literal — this is what kills
   `value: N -> N-1000`, and on a card whose printed base happens to equal `N-1000` (`OP16-015`
   Luffy at 6000, `OP16-058`'s Prisoner at 6000) the mutant otherwise reads as "nothing happened";
2. **a modifier stacking on top** — `OP15-071` uses `op05Ohm101`'s own "2 or less Life" +1000,
   `OP16-058` uses one attached DON!!, `OP15-092` uses ruling #927. All three would read the base
   literal, unchanged, under `setPower`;
3. **a non-matching body left alone**, which is the only thing that kills `delete filter:name` —
   and it has to cover the Leader as well as a Character, or half the zone list is unprotected.
4. **that the verb is not `setPower` in disguise.** This is the one to actually worry about. On a
   target carrying NO live power modifier the two verbs land on the same number, so a whole test file
   can pass with the wrong verb — which is what happened: `OP16-015` and `OP16-106` were both
   swappable to `setPower` and stayed green, the exact defect their sibling cards' PARKED notes
   existed to reject. The fix is a target with a live modifier. `op05Ohm101` is the cheapest one in
   the game: printed 5000, and it carries its own permanent *"2 or less Life cards: +1000 power"*,
   so at 2 Life it is a 6000 body whose extra 1000 is real. 7000 + 1000 = **8000** under
   `setBasePower`; `setPower` computes `7000 − 6000` and lands on 7000. **Verify by swapping the verb
   and watching for red** — `mutation_check.py` has no operator for it, so nothing else will.
5. **that the duration is real.** Nothing else in these six crosses a turn boundary, so
   `duration: "thisTurn"` is unfalsifiable without one `endTurn` and a re-read — `permanent` passes
   every other assertion. Template: `cards/tests/OP15/034-yorki.test.ts`.

And one thing to test that is not about the primitive at all: **that it composes with the three older
base-power setters.** `copyPower`, `setBasePowerFrom` and `swapBasePower` add a delta measured from a
base power, so a card carrying a literal AND one of those deltas is where replacement semantics
either hold or silently stop holding. `cards/tests/OP16/106-sanjuan-wolf.test.ts` pins it with
Sanjuan → Catarina Devon; that test caught a real 14000-instead-of-10000 defect.

Measured on the batch that built it: **26 mutants across the 6 cards, all killed**, inside
**542/542 across all 213 encoded OP15/OP16 cards**. Two mutants deserve naming because they were
close to unkillable. `value: 7000 -> 6000` on `OP16-015` and `OP16-058` lands on the target's OWN
printed base, so it reads as "the clause did nothing" and only an exact-number assertion sees it.
And `delete filter:cardCategory` on `OP16-015`'s cost is EQUIVALENT for every printed card —
`basePower()` returns 0 for anything that is not a Leader or Character, and Leaders are never in
hand — so it needed a synthetic Event that buffs ITSELF by 8000 while in hand, via
`getPermanentModifierTotal`'s `sourceIsSelfInHand` exception. That control is only worth having
because the test asserts `getCardPower(state, eventId) === 8000` directly: the projection reports
`power: null` for an Event whatever its modifiers, so a control reading 0 would have looked
identical to a control working.

## Parked (DSL gaps)

Recorded per the settled decision: *record the card and the missing primitive, move on; revisit
once the parked list is complete.* **A fully-parked card cannot document itself** —
`gen_card_defs.py` only preserves files that already have an `effects:` block, so a card with
nothing encoded gets its comments overwritten on the next generator run (this happened to
`OP15-058` Enel). For those cards **this list is the only record**. Partially-parked cards do
carry an inline `// PARKED` note, because they have an `effects` block to protect them.

**`setBasePowerLiteral` is no longer on this list — it was BUILT on 2026-08-20** and its 6 clauses
(`OP15-070`, `OP15-071`, `OP15-092`, `OP16-015`, `OP16-058`, `OP16-106`) are encoded and tested. See
the section above. That took the registry from 40 parked clauses over 35 cards to **34 over 30**, and
from 19 `missing_primitives` entries to **18** (the `parked` clauses reference 19 primitive ids --
`donDeckSizeRule` has no entry; that gap is pre-existing). `OP16-015` was the only one **of these
six** with BOTH clauses parked -- not the only card in the sets, since `OP15-015` and `OP15-058` are
too -- and it now has an `effects` block and so can carry its own inline `// PARKED` note for the
remaining `nameIncludesMatch` clause.

*Task 2 (the five reference cards): none — all expressed fully in the existing DSL.*

**Task 3 — 5 parked clauses over 4 cards:**

| Card | Parked clause | Missing primitive |
|---|---|---|
| `OP15-001` Krieg | `[Activate: Main]` Rest 1 opponent Character **that has 2+ DON!! given** | A `TargetFilter` over a candidate's attached DON!! count. `instance.attachedDon` exists in state but `matchesTargetFilter` has no case for it; `givenDonCount` is a Condition over a player's total, not per-candidate. **Also blocks `OP15-038`.** |
| `OP15-002` Lucy | `[Activate: Main]` draw if **you activated an Event with base cost 3+ this turn** | A condition over this turn's event-activation history. The engine fires `whenYouActivateEvent` but records nothing, so a later `activateMain` has nothing to test. Ruling #853 constrains it: a `[Trigger]` resolution is **not** an Event activation (发动【触发】效果和发动事件不同). |
| `OP15-022` Brook | The deck-out grace period (don't lose at 0 deck; lose at end of that turn) | A `loseGame` **action**. `replacedEvent: "loseGame"` exists (`OP03/leaders/040-nami.ts`) but its only replacement action is `winGame`, so there is nothing to schedule. Needs latch semantics too: rulings #878/#954 say the loss still happens even if the deck climbs back above 0 that turn. |
| `OP15-058` Enel | "your DON!! deck consists of 6 cards" | A DON!!-deck-size rule modifier. `deckBuildingRules` covers only `unlimitedCopies`/`cannotInclude`. Ruling #900 says negating the Leader does *not* restore 10, so it is fixed at setup, not a live modifier. |
| `OP15-058` Enel | `[Activate: Main]` "if it is your **second turn or later**" | A turn-**number** Condition. `condition: "turn"` only distinguishes your turn from the opponent's. `state.turnNumber` already exists and is read elsewhere in `effects/conditions.ts`, so this is a missing Condition variant only. Ruling #901 makes it load-bearing: activating on turn 1 is legal and does nothing. |

**Task 4 — 1 parked clause over 1 card:**

| Card | Parked clause | Missing primitive |
|---|---|---|
| `OP15-038` It's an Order! | `[Main]` freeze an opponent rested Character, cost ≤8, **that has 2+ DON!! given** | The same attached-DON!! `TargetFilter` that parks `OP15-001` Krieg. Ruling #892 additionally pins the semantics the primitive would need: the DON!! check happens at **selection** time only — a Character that later stops having 2+ DON!! given stays frozen. The card's `[Counter]` half IS encoded and tested. |

**The attached-DON!! filter is the most-wanted primitive so far** — it alone parks clauses on
`OP15-001` and `OP15-038`. `instance.attachedDon` already exists in engine state; what is missing is
a `TargetFilter` case in `matchesTargetFilter` (`effects/targeting.ts`) that reads it.

## Engine limitations found (not encoding choices, not DSL gaps)

- **A `thisBattle` modifier created OUTSIDE a battle never expires at all.**
  `expiresAtBattleId: state.battle?.id ?? null` records `null` in the main phase,
  `cleanupBattleModifiers` matches on battle id, and `expiresAtTurn` is only set for `thisTurn`. So a
  main-phase `thisBattle` debuff is effectively permanent — it survives later battles *and* turn end.
  Practical consequence for tests: `thisTurn` vs `thisBattle` on an `[Activate: Main]` modifier is only
  distinguishable by asserting the modifier is **gone after `endTurn`**; asserting that it survives a
  battle proves nothing.
- **`removeFromField` and `leaveField` become indistinguishable once `source: "opponentEffect"` is
  set**, because `structuredSourceMatches` requires `koCause === "effect"`, which independently closes
  the battle path that is the only place the two values differ. So the `OP15-098`-vs-`OP15-105`
  distinction is only observable when the `source` is absent.

- **Simultaneous removals charge one replacement payment EACH; ruling #938 says one payment covers the
  whole event.** Measured, not inferred: a synthetic `returnToHand` of `count: { amount: 2 }` against an
  `OP15-105` Bonney board at 4 Life published **two** `effectRemovalReplacement` prompts and charged
  **two** Life cards (4 → 3 → 2) to save both Characters. The SC answer is that you add **1** Life card
  and keep both. This is not a DSL gap — `ReplacementEffect` has no vocabulary for "one application
  covers a simultaneous event"; it is how `findRemovalReplacement`'s per-instance search is driven by
  its callers. Same family as Marco's #971, which this file previously recorded as *reviewed, not
  verified* — the divergence is now measured on a different card. No test enshrines the current
  behaviour. **Independently confirmed by a second batch on a different card**: ruling #861 says one
  `OP15-009` Koby Leader −2000 keeps BOTH simultaneously removed Characters and is all-or-nothing, and
  `promptForEffectRemovalReplacement` (`effects/actions.ts`) takes a single `targetId` plus a
  `remainingTargetIds` list and prompts per instance — so the engine offers the replacement twice,
  charges twice, and lets you save just one. Two agents, two cards, same mechanism.

- **`trashFromDeck` mills nothing when the deck is shorter than the requested amount.**
  `effects/actions.ts` computes `maximum = min(amount, deck.length)` and then returns early
  without trashing when `!upTo && maximum < amount`. On `OP15-022` Brook — the one Leader whose
  deck reaching 0 is its own clock — a 1–3 card deck therefore never empties and the `setActive`
  never fires, whereas ruling #879 says the activation is legal and mills the whole remainder.
  `upTo: true` is **not** the fix: it converts a mandatory mill into a 0..N player choice, and
  being able to decline the mill is a large behavioural change on exactly this card. The encoding
  is literal at `amount: 4` and the sub-4-card path is untested rather than wrong-and-green.
- **`EB02/leaders/010-monkey-d-luffy.ts` (and `OP05-084`, `OP05-092`) encode "only Characters on
  your field are [X] type" in the shape ruling #852 rules out** — see the Krieg section above.
  Upstream's cards, not this batch's to fix, but worth knowing before copying that shape.

## Test-harness facts worth not rediscovering

- **A cost selection projects as `kind: "payCost"`, not `"selectEntity"`** (`projection.ts`). It
  still carries `candidates`/`min`/`max`; only the kind differs from an action's target selection.
- **A cost with exactly one eligible candidate auto-pays and publishes no prompt.** Already noted
  for `OP16-002`; it applies to every cost, so a filter test needs **two** eligible candidates or
  it passes whether or not the filter exists. This is how `OP15-039`'s trait filter went untested.
- **The player going first cannot attack on their own first turn.** A south-Leader attack needs
  `{ firstPlayer: "north", activeSeat: "south" }`; `firstPlayer: "south"` fails with "The selected
  attacker cannot attack." (This is separate from `MatchConfig.firstPlayer` being discarded at
  match setup — inside `OnePieceTestEngine.create`'s options it does take effect.)
- **Attached DON!! survives the opponent's whole turn**, because `resetStartOfTurnState`
  (`state.ts`) returns it at the start of its *own* controller's turn. So to test a
  `[DON!! xN] [Opponent's Turn]` clause: `attachDon` on your turn, then `endTurn`. There is no
  fixture field for a Leader's attached DON!!.
- **A battle K.O. replacement prompt is intent `battleKoReplacement`** with `optionId` `"yes"` /
  `"no"`. The effect-driven ones are `effectKoReplacement`, `effectRemovalReplacement`,
  `effectRestReplacement` — four distinct intents, easy to pick wrong.
- **`match: "includes"` on a trait filter is substring matching per trait string**
  (`matchesTargetFilter`). That is what lets `"Sky Island"` match older engine cards whose traits
  are one concatenated string, e.g. `["Sky Island Shandian Warrior"]`. `negate: true` inverts to
  "no trait contains the substring".
- **Prefer pre-OP15 engine cards as fixtures.** An OP15/OP16 card with no `effects` block is
  *unencoded*, not vanilla — it will start behaving once its own batch lands and can break a test
  that leaned on its inertness. Verify a fixture is really vanilla: no `effect` key at all, or
  `effect: "NULL"` (the printed-blank marker).
- **Import `type PlayerFixture` from `../../../src/index.ts`** for fixture helper signatures.
  `Parameters<typeof OnePieceTestEngine.create>[0]["character"]` does not typecheck — the
  parameter is optional, so the type includes `undefined`.

### Writing tests that survive `mutation_check.py`

**While `mutation_check.py` is running, touch nothing in that engine clone — above all, do not run
`graft_cards.py`.** The tool works by rewriting a card's source in place, rerunning that card's tests,
and restoring. That has two consequences, and the second is the dangerous one:

- A concurrent `vp test run` fails on whichever card is momentarily perturbed, with a convincing
  assertion error that moves between files run to run. Merely annoying — it looks like a defect that
  isn't there.
- **A concurrent `graft_cards.py` re-copies `cards/` over `vendor/` and silently reverts the live
  mutation.** The test then passes against unmutated code and the tool reports a **surviving mutant**
  that is nothing of the kind. This is a *false accusation against a load-bearing test*, and it is
  worse than the first case because the natural response — rewriting a test that was already fine —
  produces churn and can talk you into weakening a good assertion.

This is not hypothetical: it manufactured 5 phantom survivors on Task 4, and the way it was caught was
hand-mutating one of the accused cards (`OP15-096`) and watching its test go red exactly as it should.
**When a survivor looks wrong, hand-mutate that one card and check, before rewriting the test.**

If concurrent work is unavoidable, give it its own `cp -Rc` clone — that is the whole reason each
parallel batch gets one.

**Do not pipe `mutation_check.py` through `tail` and then read `$?`** — you get `tail`'s exit status,
which is always 0, and the run looks like a pass while the survivor list scrolls past. The tool's own
contract is correct (exit 1 whenever a mutant survives); it is the pipeline that lies. Redirect to a
file and check the exit code, then read the file:

```bash
./.venv/bin/python tools/mutation_check.py --set OP16 --engine <path> > /tmp/mut.txt 2>&1
echo "EXIT=$?"    # 1 means at least one mutant survived
tail -30 /tmp/mut.txt
```

This cost a wrong "all mutants killed" claim once already. Quote the summary line, and check the code.


Task 4's first mutation run killed only **56 of 74** mutants across 20 cards. All 18 survivors were
the same four mistakes, and they are worth internalising before writing a single test — fixing them
afterwards cost more than writing them right would have.

0. **The tool is blind to small and negative numbers — those are entirely on you.** The numeric
   operator matches `value:\s*(\d{3,6})\b`, so it generates **no** mutant for a negative magnitude
   (`value: -4000`, `value: -2`), for a cost threshold (`value: 8`, `value: 20`), or for any two-digit
   number. On a card whose decisive numbers are debuffs or costs rather than power buffs, "every mutant
   killed" says *nothing* about those thresholds. Several OP15 events (`OP15-019` −4000, `OP15-020`
   −8000, `OP15-021` −3000, `OP15-076` −1000, `OP15-074` +2 cost) passed the gate with their magnitudes
   never probed. **Write the boundary fixture by hand there** — a body exactly on the line plus one
   clear of it — and treat a green mutation report as covering only the filters and comparisons.

1. **A candidate list does not pin a `value`.** Nine of the 18 survivors were `value N -> N-1000` on a
   power modifier, because every test asserted *who* got boosted and none asserted *how much*.
   For a `thisBattle` modifier you cannot read the number back off a projection — it is created and
   expired inside the same call that resolves the last prompt. **A `thisTurn` modifier is different and
   IS readable**: `ProjectedCard.power` / `.cost` are `getCardPower()` / `getCardCost()`
   (`projection.ts`), so a `thisTurn` value can be asserted as an exact number off `getView`, and
   asserted *gone* after `endTurn`. That is the stronger assertion — use it whenever the duration
   allows, and reserve the battle trick below for `thisBattle`. **Make the magnitude decide a battle.**
   Pitch the attacker at
   exactly `defenderPower + (the next-lower value)`; since `attackPower >= defensePower` is a hit, the
   real value holds and the mutated one connects:

   | Boost to pin | Defender | Attacker to use | Fixture |
   |---|---|---|---|
   | +1000 | 5000 Leader | 5000 | `op03Namule007` |
   | +2000 | 5000 Leader | 6000 | `op02Atmos003` |
   | +3000 | 5000 Leader | 7000 | `op02Kingdew006` |
   | +4000 | 5000 Leader | 8000 | `op02Thatch007` |

   Then assert `lifeCount` is unchanged. `[Counter]` blocks are where this bites hardest, because it is
   tempting to stop once the candidate list looks right.

2. **A threshold needs an eligible body EXACTLY ON the boundary.** `power lte 6000` with a 4000 body in
   the candidates survives a mutation to `lte 5000`. Put a 6000 body in and it dies. Below-the-line
   bodies prove the filter exists; only an on-the-line body proves the *number*.

3. **`gte` and `lte` are indistinguishable at the boundary.** `zoneCount gte 15` tested at exactly 15
   also satisfies `lte 15`. Add a case well clear of the line (20) so only one operator holds.

4. **Duplicated blocks have their own filters and need their own fixtures.** A `[Main]` and a
   `[Trigger]` that print the same action are two separate objects with two separate copies of every
   filter. `OP15-115`'s `[Trigger]` cost filter survived both deletion and inversion because that test
   had a single cost-4 Character on the field with nothing to exclude.

**A surviving mutant is not always a bad test — sometimes it is a redundant encoding.** Two of Task
3's survivors were filters that could not possibly matter: a `trait` filter on a `zoneCount gte 1` that
was already implied by a companion `eq 0` check, and a `lifeCount` condition the engine's own
availability check already enforced. There the right fix is to **delete the redundancy from the
encoding**, not to invent a test for it. Ask which it is before reaching for a new fixture.

### Prompt intents, and which shape produces which

Guessing these costs a test run each. The full list of real intent strings is
`grep -rhoE 'intent: "[a-zA-Z]+"' packages/engine/src`. The ones the batches so far needed:

| Shape in the encoding | Intent | Step kind | Option ids |
|---|---|---|---|
| action `target` selection | `effectTargetSelection` | `selectEntity` | — |
| block-level `optional: true` | `effectOptional` | `confirm` | `yes` / `no` |
| action `optional` | `effectActionOptional` | `confirm` | `yes` / `no` |
| action `choice` | `effectActionChoice` | `chooseOption` | `"0"`, `"1"`, … |
| action `play` | `effectPlaySelection` | `selectEntity` | — |
| action `search` | `effectSearchSelection`, then `effectSearchRemainderOrder` | `selectEntity` | — |
| action `trashFromHand` | `effectTrashFromHandSelection` | `selectEntity` | — |
| cost `trashFromHand` | `effectCostTrashFromHand` | **`payCost`** | — |
| cost `returnCharacter` | `effectCostReturnCharacter` | **`payCost`** | — |
| `giveDon` with `count.upTo` | `effectGiveDonCount` **first**, then the recipient | `chooseOption` | `"0"`, `"1"`, … |
| `addToLife` with `count.upTo` | `effectAddToLifeFromDeck` **first** | `chooseOption` | `"0"`, `"1"`, … |
| a Life card's `[Trigger]` | `lifeTrigger` | `confirm` | **`activate` / `skip`** |
| playing a `[Counter]` from hand | `battleCounter` | `selectEntity` | — |
| a battle-K.O. replacement | `battleKoReplacement` | `confirm` | `yes` / `no` |

- **`lifeTrigger` takes `activate`, not `yes` — and an unrecognised `optionId` resolves as a silent
  skip rather than an error.** A test written with `yes` passes the resolve call, does nothing, and
  then fails much later with a confusing "could not find a pending …" on the next step.
- **An `upTo` target with ZERO legal candidates publishes NO prompt at all** (GENERAL ruling #27:
  nothing happens). So a threshold cannot be pinned by asserting an *empty* candidate list — put an
  eligible body on the field and assert the list contains only it.
- **Granted keywords have no projected field to read.** Prove them functionally: `[Blocker]` by the
  granted Character appearing in the `battleBlocker` candidates on the opponent's turn (which pins the
  duration in the same test), `[Double Attack]` by a connecting Leader attack taking 2 Life.
- **Activating a `[Trigger]` consumes the card to the trash; it does not also join the hand.** Adding
  it to hand is the *alternative* to activating it (GENERAL ruling #21). So after `activate`, the hand
  holds only what the effect itself drew.

## Rulings reviewed, and what's genuinely still deferred

- **#979** (Antlerkov) and **#993** (Our Savior) are now both encoded and tested (see their
  sections above) — the zone-scoping bug they were exposing is fixed. What's still
  genuinely deferred, and correctly so, is narrower than the original filing: the engine has
  no `grantName` action, so a **real** card printed with "this card/your cards gain every
  name" cannot be encoded until one is added. That's a DSL gap for whoever encodes such a
  Leader, not a Task 2 finding — nothing about it required guessing, since #979/#993 are
  fully testable today via a *statically*-named synthetic card, without a `grantName` action
  existing at all.
- **#971** (Marco): reviewed, not verified — see the OP16-014 section above.
  `effects/replacements.ts` shows a plausible per-instance, sequential search that would
  produce the ruling's answer, but says nothing about the ordering of simultaneous removals,
  which is the actual question. Not tested here; the existing "protects an ally" test
  exercises the shape the ruling depends on (non-`targetSelf`) but not the simultaneous case
  itself.
