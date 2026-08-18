import type { CharacterCard } from "@tcg/op-types";
import { op15Enel118I18n } from "./118-enel.i18n.ts";

export const op15Enel118: CharacterCard = {
  id: "OP15-118",
  canonicalId: "OP15-118",
  slug: "enel/op15-118",
  name: "Enel",
  printings: [
    {
      id: "OP15-118",
      artId: "OP15-118",
      setCode: "OP15",
      collectorNumber: "118",
      rarity: "SEC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-118.png",
    },
  ],
  cardType: "character",
  color: ["purple"],
  rarity: "SEC",
  setId: "OP15",
  cost: 6,
  power: 8000,
  traits: ["Sky Island"],
  attribute: "special",
  effect:
    "If you have 6 or less DON!! cards on your field, this Character cannot be removed from the field by your opponent's effects and gains +2000 power.\n[On Play] DON!! -1: Look at 5 cards from the top of your deck and add up to 1 card to your hand. Then, place the rest at the bottom of your deck in any order, and trash 1 card from your hand.",
  effects: {
    effects: [
      {
        // See OP15-061 Ohm: `optional` is what makes the DON!! -1 declinable (GENERAL ruling #12).
        trigger: "onPlay",
        costs: [{ cost: "returnDon", amount: 1 }],
        actions: [
          {
            // "add up to 1 card" with no restriction, so no `revealFilters` -- OP16-021 Moby
            // Dick's shape, minus its Leader gate and at lookCount 5.
            action: "search",
            lookCount: 5,
            source: { player: "self", zone: "deck" },
            revealCount: { amount: 1, upTo: true },
            revealDestination: "hand",
            remainderPosition: "bottom",
          },
          // The trash is an action, not a cost: it follows "Then," and OP15-060 Enel's ruling
          // #904 settles the same wording on the other Enel printing -- an empty hand does not
          // block the ability, it just trashes nothing.
          { action: "trashFromHand", player: "self", amount: 1 },
        ],
        optional: true,
      },
    ],
    // Identical static clause to OP15-060 Enel; see that card for why donFieldCount is unmoved by
    // paying this Character's own cost and why the permanent modifyPower must be `self: true`.
    permanentEffects: [
      {
        conditions: [{ condition: "donFieldCount", player: "self", comparison: "lte", value: 6 }],
        actions: [
          {
            action: "cannotBeRemoved",
            target: { player: "self", zones: ["field"], count: { amount: 1 }, self: true },
            duration: "permanent",
            bySource: "opponentEffect",
          },
          {
            action: "modifyPower",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            value: 2000,
            duration: "permanent",
          },
        ],
      },
    ],
  },
  i18n: op15Enel118I18n,
};
