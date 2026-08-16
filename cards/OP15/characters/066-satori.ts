import type { CharacterCard } from "@tcg/op-types";
import { op15Satori066I18n } from "./066-satori.i18n.ts";

export const op15Satori066: CharacterCard = {
  id: "OP15-066",
  canonicalId: "OP15-066",
  slug: "satori/op15-066",
  name: "Satori",
  printings: [
    {
      id: "OP15-066",
      artId: "OP15-066",
      setCode: "OP15",
      collectorNumber: "066",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-066.png",
    },
  ],
  cardType: "character",
  color: ["purple"],
  rarity: "R",
  setId: "OP15",
  cost: 1,
  power: 2000,
  counter: 1000,
  traits: ["Sky Island", "Vassals"],
  attribute: "strike",
  effect:
    "[On Play] DON!! -1: Draw 1 card.\n[When Attacking] If you have 6 or less DON!! cards on your field, look at 2 cards from the top of your deck and place them at the top or bottom of your deck in any order.",
  i18n: op15Satori066I18n,
};
