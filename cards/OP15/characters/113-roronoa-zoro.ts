import type { CharacterCard } from "@tcg/op-types";
import { op15RoronoaZoro113I18n } from "./113-roronoa-zoro.i18n.ts";

export const op15RoronoaZoro113: CharacterCard = {
  id: "OP15-113",
  canonicalId: "OP15-113",
  slug: "roronoa-zoro/op15-113",
  name: "Roronoa Zoro",
  printings: [
    {
      id: "OP15-113",
      artId: "OP15-113",
      setCode: "OP15",
      collectorNumber: "113",
      rarity: "SR",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-113.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "SR",
  setId: "OP15",
  cost: 4,
  power: 6000,
  traits: ["Sky Island", "Straw Hat Crew"],
  attribute: "slash",
  effect:
    "[On Play] You may trash 1 card from your hand: Add up to 1 card from the top of your deck to the top of your Life cards.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        // Ruling #941: with an empty hand the effect cannot be used (不可以). `canPayCosts`
        // enforces that for `trashFromHand` already, so no `handCount` condition is written.
        costs: [{ cost: "trashFromHand", amount: 1 }],
        actions: [
          {
            action: "addToLife",
            target: { player: "self", zones: ["deck"], count: { amount: 1, upTo: true } },
            position: "top",
          },
        ],
        optional: true,
      },
    ],
  },
  i18n: op15RoronoaZoro113I18n,
};
