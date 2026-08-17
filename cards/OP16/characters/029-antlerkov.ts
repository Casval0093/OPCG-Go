import type { CharacterCard } from "@tcg/op-types";
import { op16Antlerkov029I18n } from "./029-antlerkov.i18n.ts";

export const op16Antlerkov029: CharacterCard = {
  id: "OP16-029",
  canonicalId: "OP16-029",
  slug: "antlerkov/op16-029",
  name: "Antlerkov",
  printings: [
    {
      id: "OP16-029",
      artId: "OP16-029",
      setCode: "OP16",
      collectorNumber: "029",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-029.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "UC",
  setId: "OP16",
  cost: 2,
  power: 3000,
  counter: 2000,
  traits: ["Impel Down"],
  attribute: "ranged",
  effect:
    "[When Attacking] If you have [Bunkov], play up to 1 Character card with a cost of 2 or less from your hand.",
  i18n: op16Antlerkov029I18n,
};
