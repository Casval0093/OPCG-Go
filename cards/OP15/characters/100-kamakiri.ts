import type { CharacterCard } from "@tcg/op-types";
import { op15Kamakiri100I18n } from "./100-kamakiri.i18n.ts";

export const op15Kamakiri100: CharacterCard = {
  id: "OP15-100",
  canonicalId: "OP15-100",
  slug: "kamakiri/op15-100",
  name: "Kamakiri",
  printings: [
    {
      id: "OP15-100",
      artId: "OP15-100",
      setCode: "OP15",
      collectorNumber: "100",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-100.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "C",
  setId: "OP15",
  cost: 5,
  power: 6000,
  counter: 1000,
  traits: ["Sky Island", "Shandian Warrior"],
  attribute: "slash",
  effect:
    "[On Play] You may trash this Character and add 1 card from the top of your Life cards to your hand: K.O. up to 1 of your opponent's Characters with a cost of 6 or less.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        // Two costs, both halves of one payment. Ruling #935: you may decline the whole thing
        // (可以), and declining means neither the Life card nor the K.O. happens -- that is what
        // `optional: true` buys. Ruling #936: at 0 Life cards the effect cannot be used (不可以);
        // `canPayCosts` already rejects `addLifeToHand` when `life.length < amount`, so no extra
        // condition is needed and adding one would be an unkillable mutant.
        costs: [{ cost: "trashThisCard" }, { cost: "addLifeToHand", amount: 1, position: "top" }],
        actions: [
          {
            action: "ko",
            target: {
              player: "opponent",
              zones: ["character"],
              count: { amount: 1, upTo: true },
              filters: [{ filter: "cost", comparison: "lte", value: 6 }],
            },
          },
        ],
        optional: true,
      },
    ],
  },
  i18n: op15Kamakiri100I18n,
};
