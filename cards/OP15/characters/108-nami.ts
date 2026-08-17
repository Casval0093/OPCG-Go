import type { CharacterCard } from "@tcg/op-types";
import { op15Nami108I18n } from "./108-nami.i18n.ts";

export const op15Nami108: CharacterCard = {
  id: "OP15-108",
  canonicalId: "OP15-108",
  slug: "nami/op15-108",
  name: "Nami",
  printings: [
    {
      id: "OP15-108",
      artId: "OP15-108",
      setCode: "OP15",
      collectorNumber: "108",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-108.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "R",
  setId: "OP15",
  cost: 1,
  power: 2000,
  counter: 2000,
  traits: ["Sky Island", "Straw Hat Crew"],
  attribute: "special",
  effect:
    "[On Play] Look at 3 cards from the top of your deck; reveal up to 1 [Sky Island] type card and add it to your hand. Then, place the rest at the bottom of your deck in any order.",
  i18n: op15Nami108I18n,
};
