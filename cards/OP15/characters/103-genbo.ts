import type { CharacterCard } from "@tcg/op-types";
import { op15Genbo103I18n } from "./103-genbo.i18n.ts";

export const op15Genbo103: CharacterCard = {
  id: "OP15-103",
  canonicalId: "OP15-103",
  slug: "genbo/op15-103",
  name: "Genbo",
  printings: [
    {
      id: "OP15-103",
      artId: "OP15-103",
      setCode: "OP15",
      collectorNumber: "103",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-103.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "C",
  setId: "OP15",
  cost: 3,
  power: 4000,
  counter: 1000,
  trigger: "Draw 1 card. Then, if you have 2 or less Life cards, play this card.",
  traits: ["Sky Island", "Shandian Warrior"],
  attribute: "ranged",
  effects: {
    effects: [
      {
        trigger: "trigger",
        actions: [
          { action: "draw", player: "self", amount: 1 },
          {
            action: "playThisCard",
            // Ruling #937: at 3 Life cards *including this one*, the play happens (可以). A
            // [Trigger] resolves after its own card has already left the Life area, so the count
            // the condition sees is 2 -- the printed number, not printed-plus-one. Encode the
            // printed number. Same shape as OP08-114 S-Hawk's [Trigger].
            condition: { condition: "lifeCount", player: "self", comparison: "lte", value: 2 },
          },
        ],
      },
    ],
  },
  i18n: op15Genbo103I18n,
};
