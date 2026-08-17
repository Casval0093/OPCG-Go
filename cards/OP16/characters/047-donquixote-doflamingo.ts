import type { CharacterCard } from "@tcg/op-types";
import { op16DonquixoteDoflamingo047I18n } from "./047-donquixote-doflamingo.i18n.ts";

export const op16DonquixoteDoflamingo047: CharacterCard = {
  id: "OP16-047",
  canonicalId: "OP16-047",
  slug: "donquixote-doflamingo/op16-047",
  name: "Donquixote Doflamingo",
  printings: [
    {
      id: "OP16-047",
      artId: "OP16-047",
      setCode: "OP16",
      collectorNumber: "047",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-047.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "C",
  setId: "OP16",
  cost: 3,
  power: 0,
  counter: 1000,
  traits: ["Impel Down", "Donquixote Pirates"],
  attribute: "special",
  effect:
    "[Activate: Main] You may rest this Character: If your opponent has 8 or more cards in their hand, they place 2 cards from their hand at the bottom of their deck in any order.",
  effects: {
    effects: [
      {
        trigger: "activateMain",
        costs: [{ cost: "restThisCard" }],
        conditions: [{ condition: "handCount", player: "opponent", comparison: "gte", value: 8 }],
        actions: [
          {
            // Ruling #990: the cards and their order are chosen by their OWNER (the
            // opponent), not by this card's controller -- 由放回卡组最下方的卡牌的持有者，
            // 将自己选择的卡牌按照选择的顺序放回自己卡组最下方. `chosenBy: "opponent"`
            // is what encodes that; without it the selection prompt goes to the wrong seat.
            // Model: OP08-046 Shakuyaku (same hand -> bottom-of-deck, opponent-chosen) and
            // OP11-072 Charlotte Mont-d'Or (the 2-card `order: "any"` form).
            action: "returnToDeck",
            target: {
              player: "opponent",
              zones: ["hand"],
              count: { amount: 2 },
              chosenBy: "opponent",
            },
            position: "bottom",
            order: "any",
          },
        ],
        optional: true,
      },
    ],
  },
  i18n: op16DonquixoteDoflamingo047I18n,
};
