import type { CharacterCard } from "@tcg/op-types";
import { op15Arlong023I18n } from "./023-arlong.i18n.ts";

export const op15Arlong023: CharacterCard = {
  id: "OP15-023",
  canonicalId: "OP15-023",
  slug: "arlong/op15-023",
  name: "Arlong",
  printings: [
    {
      id: "OP15-023",
      artId: "OP15-023",
      setCode: "OP15",
      collectorNumber: "023",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-023.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "R",
  setId: "OP15",
  cost: 4,
  power: 5000,
  counter: 1000,
  traits: ["Fish-Man", "East Blue", "Arlong Pirates"],
  attribute: "slash",
  effect:
    "[On K.O.] Up to 2 of your opponent's rested cards will not become active in your opponent's next Refresh Phase.\n[Activate: Main] [Once Per Turn] You may give 1 of your opponent's rested DON!! cards to 1 of your opponent's Characters: Give up to 1 DON!! card from its owner's cost area to its owner's Leader or 1 of their Characters.",
  // PARKED -- the [Activate: Main] clause is NOT encoded below. BOTH halves of it need a
  // source-player for `giveDon`, the primitive registered as `giveDonSourcePlayer` in
  // data/parked-clauses.json (already the most-blocked primitive, parking six OP15 red cards).
  // `giveDon` (effects/actions.ts) always draws from `getPlayer(state, controller)` and
  // `GiveDonAction` has no source-player field, so "give 1 of your OPPONENT's rested DON!! cards"
  // (the cost) and "give ... from ITS OWNER's cost area" (the payload) are both inexpressible.
  // The payload half is the owner-BOUND facet specifically: the DON!! must come from whichever
  // player owns the Leader/Character chosen as recipient. Rulings #880 and #883 make that exact,
  // and rule out `player: "any"` as an approximation -- #880 answers 可以 to giving your own
  // Leader/Character your own DON!!, or the opponent's Leader/Character the opponent's DON!!,
  // while #883 answers 不可以 to either cross-side direction. #881 adds that the payload may move
  // an ACTIVE DON!! (only the cost is restricted to rested ones), #882 that the player activating
  // the effect chooses which of the opponent's DON!! moves, and #884 that with no opponent
  // Character or no rested opponent DON!! the cost cannot be paid, so the whole ability is off.
  effects: {
    effects: [
      {
        trigger: "onKo",
        // "your opponent's rested CARDS", unqualified -- so the pool is every card of theirs that
        // can be rested: Leader, Characters, Stage and the DON!! in their cost area. Same reading
        // as OP13/characters/033-franky.ts and OP14EB04/characters/024-kin-emon.ts, which both
        // print "rest up to N of your opponent's cards"; OP07/characters/026-jewelry-bonney.ts is
        // the `freeze` precedent for the narrower printed "Character or DON!! cards" wording.
        // `freeze` is the "will not become active in the next Refresh Phase" verb (OP11-028,
        // OP16-030), NOT `rest` -- these cards are already rested.
        actions: [
          {
            action: "freeze",
            target: {
              player: "opponent",
              zones: ["leader", "character", "stage", "costArea"],
              count: { amount: 2, upTo: true },
              filters: [{ filter: "state", value: "rested" }],
            },
          },
        ],
      },
    ],
  },
  i18n: op15Arlong023I18n,
};
