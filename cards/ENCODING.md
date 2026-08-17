# Encoding OP15/OP16 cards — worked examples and reference

This is the reference for encoding effects onto the mechanical card definitions
`tools/gen_card_defs.py` already generated. It exists because five cards were hand-encoded
in Task 2 specifically to be copied: read this before encoding card #6.

## Before encoding any card

1. **Read the printed `effect` field** in the generated `.ts` file (or `data/cards-OP15-en.json`
   / `cards-OP16-en.json`) — never an aggregator summary. If it looks wrong, check
   `onepiece.limitlesstcg.com/cards/<ID>`.
2. **Check the rulings.** This is mandatory, not advisory (`docs/plans/encode-op15-op16.md`,
   Global Constraint #3):
   ```bash
   ./.venv/bin/python tools/parse_rulings.py --card OP16-001
   ```
   112 of the 238 OP15/OP16 cards carry at least one ruling. Rulings are Simplified Chinese;
   they are the specification, not a translation exercise. Also skim
   `./.venv/bin/python tools/parse_rulings.py --card GENERAL` once — those are core-rules
   answers (e.g. a Character whose power drops to 0 or less stays on the field) that apply
   everywhere, not just to one card.
3. **Decide test depth per the settled decision**: assert the printed behaviour, and — only
   where a ruling *constrains the encoding* — assert the ruling too. Do not write a test for
   a ruling that is about timing/interaction the engine already resolves generically (see
   Antlerkov and Our Savior below for two concrete examples of that distinction).
4. **Find the closest existing card** with the same trigger family and action shape before
   writing anything by hand. `grep -rl 'trigger: "onKo"' vendor/.../packages/cards/src/cards`
   (etc.) across the whole vendored engine, not just OP14 — the closest analogue is often in
   an older set. Every example below names the file it was modeled on.
5. **Never invent a DSL verb.** The full vocabulary is
   `vendor/tcg-engines/submodules/one-piece/packages/types/src/effect/{action,condition,cost,target,primitives}.ts`.
   If an effect doesn't fit, park it (record the card ID and the missing primitive) and move
   on — do not approximate and do not extend the DSL from a single card.

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
same-turn attack, not just a candidate-list check.

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
while Marco's own removal proceeds unreplaced. Read `effects/replacements.ts`
(`findRemovalReplacement`) before assuming this needs special handling: it already searches
*every* own card's `replacementEffects` per removed instance, one at a time, sequentially —
so a per-event, per-source choice is the generic behaviour, not something this card's
encoding has to construct. No dedicated test for #971 for that reason; the "protects an
ally" test below already exercises the non-`targetSelf` shape the ruling depends on.

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
`packages/engine/tests/cards/characters/op07-042-gecko-moria.test.ts`); and the eq-8000
boundary for the revival cost (2000/8000/8000/10000 power hand Characters, only the two
exactly-8000 ones eligible), triggered by a real battle K.O.

### OP16-029 Antlerkov (character, `whenAttacking`, condition on a named card)

> [When Attacking] If you have [Bunkov], play up to 1 Character card with a cost of 2 or
> less from your hand.

**Ruling #979** describes a hypothetical Leader that grants every card all names, in which
case "if you have [Bunkov]" would be satisfiable without a literal Bunkov on field. That is a
property of how the generic `name` filter/condition resolves granted names
(`cardNames()` in `shared.ts`), not of Antlerkov's own encoding, and none of the five Task 2
reference cards grants names — so it is noted in the card's comments but not exercised by a
test here.

**Encoding.** `hasCard` condition (not `existsOnField` — both resolve identically via
`candidatesForTarget`, but `hasCard` is the far more common spelling for "if you have
[Name]" in this codebase, e.g. `OP02/characters/111-fullbody.ts`'s "if you have [Jango]"),
gating a `play` action:
```ts
conditions: [
  { condition: "hasCard", player: "self", zone: "character", filters: [{ filter: "name", value: "Bunkov" }] },
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
Modeled on `OP02/characters/111-fullbody.ts` (`whenAttacking` + `hasCard` condition, the
closest existing "if you have [Name]" attack trigger) and `OP03/characters/014-monkey-d-garp.ts`
/ `OP01/characters/049-bepo.ts` (the `play`-from-hand action shape with a cost filter).

**Primitives used:** `trigger: "whenAttacking"`, condition `hasCard` (`zone: "character"`,
filter `name`), action `play` (`source.zone: "hand"`, filters `cost` `lte` + `cardCategory`).

**Tests** (`cards/tests/OP16/029-antlerkov.test.ts`): with Bunkov (OP16-025) on field, the
play offer appears and correctly excludes a too-expensive hand card; without Bunkov, the
whole effect never fires (no prompt at all, not just an empty one) — this is the printed
condition, distinct from ruling #979's hypothetical.

### OP16-057 Captain Buggy's Our Savior!! (event, conditional `counter`)

> [Counter] If you have 2 or more [Prisoner of Impel Down] cards, up to 1 of your Leader or
> Character cards gains +4000 power during this battle.
> [Trigger] Draw 2 cards and trash 1 card from your hand.

No numbered ruling directly on this card's `counter` block changes its reading, but **ruling
#993** parallels #979 above (a hypothetical universal-name-granting Leader satisfying "2 or
more" with 1 real card) — same conclusion: generic `name`-resolution concern, not this card's
encoding, not tested here for the same reason. The one thing worth getting right on this
card is *which* string is a name and which is a trait: `"[Prisoner of Impel Down]"` is the
bracketed **name** of OP16-042 (itself printed "you may have any number of this card in your
deck" — i.e. a goon/mob card meant to appear in multiples), not the broader `"Impel Down"`
trait this event and OP16-042 both also carry. Filtering on the trait instead would make the
condition trivially satisfiable by any 2 Impel-Down-arc characters, including Bunkov,
Antlerkov, or Buggy himself — wrong.

**Encoding.** `zoneCount` condition (not `hasCard`, since this needs a count comparison, not
existence) gating a `modifyPower` action with the two-zone target this event's own
"Leader or Character" pool needs:
```ts
conditions: [
  {
    condition: "zoneCount",
    player: "self",
    zone: "character",
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

**Primitives used:** `trigger: "counter"`, condition `zoneCount` (`zone: "character"`,
`comparison: "gte"`, filter `name`), action `modifyPower` (`zones: ["leader", "character"]`,
`duration: "thisBattle"`); second block `trigger: "trigger"`, actions `draw` + `trashFromHand`.

**Tests** (`cards/tests/OP16/057-captain-buggy-s-our-savior.test.ts`): condition met (2
copies of OP16-042) vs. not met (1 copy), made mechanically observable rather than
inspecting a transient modifier — see the gotcha below — plus the `[Trigger]` draw-2/trash-1.

*Gotcha for anyone copying this shape:* don't target the **Leader being attacked** to prove a
`thisBattle` power boost applied, and don't assert on `leader.power` right after resolving
the target-selection prompt. Attacking a Leader deals Life damage regardless of power (no
power comparison happens), so by the time `resolveDecision` returns, the battle has already
concluded and the `thisBattle` modifier has already expired — `state.modifiers` will be
empty and `leader.power` will show the unmodified value even though the action executed
correctly. `packages/engine/tests/cards/events/op04-095-barrier.test.ts` never asserts
`leader.power` for exactly this reason. Make the boost observable through a real outcome
instead: target a Character whose survival (or death) in the battle depends on it.

*Second gotcha, unrelated to the above:* attacking a Leader is **still a power comparison**
against the Leader's own power stat (5000 base for most Leaders) — it is not unconditional
Life loss. An attacker with lower power than the Leader deals no damage at all. And only the
Leader and **rested** Characters are legal attack targets; an active Character "cannot be
attacked."

## Parked (DSL gaps found in this task)

None. All five reference cards expressed fully in the existing DSL — no primitive was
missing.

## Rulings reviewed but deliberately not turned into a test

- **#979** (Antlerkov) and **#993** (Our Savior): both describe the same generic mechanic —
  a hypothetical Leader that grants every card all names — interacting with a `name`-based
  condition. Neither is testable from this task's five cards alone (no such Leader is among
  them), and both are properties of how the engine's generic name resolution works, not of
  either card's own encoding. Flagged in-line in both cards' source comments for whoever
  encodes that Leader.
- **#971** (Marco): see the OP16-014 section above — the simultaneous-removal scenario is
  already the generic behaviour of `effects/replacements.ts`, verified by reading the
  resolution code rather than by a dedicated test.
