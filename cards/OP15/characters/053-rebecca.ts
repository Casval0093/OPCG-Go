import type { CharacterCard } from "@tcg/op-types";
import { op15Rebecca053I18n } from "./053-rebecca.i18n.ts";

export const op15Rebecca053: CharacterCard = {
  id: "OP15-053",
  canonicalId: "OP15-053",
  slug: "rebecca/op15-053",
  name: "Rebecca",
  printings: [
    {
      id: "OP15-053",
      artId: "OP15-053",
      setCode: "OP15",
      collectorNumber: "053",
      rarity: "SR",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-053.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "SR",
  setId: "OP15",
  cost: 1,
  power: 0,
  counter: 1000,
  traits: ["Dressrosa"],
  attribute: "wisdom",
  effect:
    "[DON!! x1] This Character gains [Blocker].\n[On Play] Look at 3 cards from the top of your deck; reveal up to 1 [Dressrosa] type card and add it to your hand. Then, place the rest at the bottom of your deck in any order.",
  i18n: op15Rebecca053I18n,
};
