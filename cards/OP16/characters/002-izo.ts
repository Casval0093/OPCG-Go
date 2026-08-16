import type { CharacterCard } from "@tcg/op-types";
import { op16Izo002I18n } from "./002-izo.i18n.ts";

export const op16Izo002: CharacterCard = {
  id: "OP16-002",
  canonicalId: "OP16-002",
  slug: "izo/op16-002",
  name: "Izo",
  printings: [
    {
      id: "OP16-002",
      artId: "OP16-002",
      setCode: "OP16",
      collectorNumber: "002",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-002.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "UC",
  setId: "OP16",
  cost: 1,
  power: 2000,
  counter: 1000,
  traits: ["Land of Wano", "Whitebeard Pirates"],
  attribute: "ranged",
  effect: "[On Play] You may reveal 1 Character card with 8000 power from your hand: Draw 1 card.",
  i18n: op16Izo002I18n,
};
