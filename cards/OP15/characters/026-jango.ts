import type { CharacterCard } from "@tcg/op-types";
import { op15Jango026I18n } from "./026-jango.i18n.ts";

export const op15Jango026: CharacterCard = {
  id: "OP15-026",
  canonicalId: "OP15-026",
  slug: "jango/op15-026",
  name: "Jango",
  printings: [
    {
      id: "OP15-026",
      artId: "OP15-026",
      setCode: "OP15",
      collectorNumber: "026",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-026.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "UC",
  setId: "OP15",
  cost: 1,
  power: 2000,
  counter: 1000,
  traits: ["East Blue", "Black Cat Pirates"],
  attribute: "slash",
  effect:
    "[On Play] Look at 3 cards from the top of your deck; reveal up to 1 [East Blue] type card and add it to your hand. Then, place the rest at the bottom of your deck in any order.\n[Activate: Main] You may trash this Character: Give up to 1 of your opponent's rested DON!! cards to 1 of your opponent's Characters.",
  // PARKED -- the [Activate: Main] clause is NOT encoded below. "Give up to 1 of your OPPONENT'S
  // rested DON!! cards to 1 of your opponent's Characters" needs the fixed-opponent-source facet
  // of `giveDonSourcePlayer` (data/parked-clauses.json): `giveDon` (effects/actions.ts) always
  // draws from `getPlayer(state, controller)` and `GiveDonAction` has no source-player field.
  // Ruling #886 pins what the primitive must do -- the player activating the effect chooses which
  // of the OPPONENT'S rested cost-area DON!! moves, so it is not merely "the opponent gives
  // themselves DON!!". The `trashThisCard` cost half is expressible; the payload is not, and a
  // cost with no payload is not the printed card.
  effects: {
    effects: [
      {
        trigger: "onPlay",
        actions: [
          {
            // Verbatim the shape of OP04/characters/041-apis.ts (same "look at N; reveal up to 1
            // [East Blue] type card and add it to your hand; place the rest at the bottom in any
            // order" sentence, at lookCount 5) and of this set's own OP15-037. "[East Blue] TYPE"
            // is a trait, and `match: "includes"` is mandatory: older sets store traits as one
            // concatenated string (e.g. OP11-028's "East Blue Neptunian"), which `exact` misses.
            action: "search",
            lookCount: 3,
            source: { player: "self", zone: "deck" },
            revealCount: { amount: 1, upTo: true },
            revealFilters: [{ filter: "trait", value: "East Blue", match: "includes" }],
            revealDestination: "hand",
            remainderPosition: "bottom",
          },
        ],
      },
    ],
  },
  i18n: op15Jango026I18n,
};
