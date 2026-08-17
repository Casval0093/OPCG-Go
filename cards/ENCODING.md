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

## Parked (DSL gaps found in this task)

None. All five reference cards expressed fully in the existing DSL — no primitive was
missing.

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
