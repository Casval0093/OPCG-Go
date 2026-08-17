import type { CharacterCard } from "@tcg/op-types";
import { op15Yorki034I18n } from "./034-yorki.i18n.ts";

export const op15Yorki034: CharacterCard = {
  id: "OP15-034",
  canonicalId: "OP15-034",
  slug: "yorki/op15-034",
  name: "Yorki",
  printings: [
    {
      id: "OP15-034",
      artId: "OP15-034",
      setCode: "OP15",
      collectorNumber: "034",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-034.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "C",
  setId: "OP15",
  cost: 1,
  power: 0,
  counter: 2000,
  traits: ["Rumbar Pirates"],
  attribute: "slash",
  effect: "[Your Turn] [On Play] Up to 1 of your [Brook] cards gains +2000 power during this turn.",
  i18n: op15Yorki034I18n,
};
