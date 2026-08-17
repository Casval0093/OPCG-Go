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
   ./node_modules/.bin/vp check          # from packages/engine, and again from packages/cards
   ./node_modules/.bin/vp check --fix    # if it reports formatting issues
   ```
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

## Parked (DSL gaps)

Recorded per the settled decision: *record the card and the missing primitive, move on; revisit
once the parked list is complete.* **A fully-parked card cannot document itself** —
`gen_card_defs.py` only preserves files that already have an `effects:` block, so a card with
nothing encoded gets its comments overwritten on the next generator run (this happened to
`OP15-058` Enel). For those cards **this list is the only record**. Partially-parked cards do
carry an inline `// PARKED` note, because they have an `effects` block to protect them.

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
