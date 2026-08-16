import type { CharacterCard } from "@tcg/op-types";
import { op15CaptainSeamars062I18n } from "./062-captain-seamars.i18n.ts";

export const op15CaptainSeamars062: CharacterCard = {
  id: "OP15-062",
  canonicalId: "OP15-062",
  slug: "captain-seamars/op15-062",
  name: "Captain Seamars",
  printings: [
    {
      id: "OP15-062",
      artId: "OP15-062",
      setCode: "OP15",
      collectorNumber: "062",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-062.png",
    },
  ],
  cardType: "character",
  color: ["purple"],
  rarity: "UC",
  setId: "OP15",
  cost: 5,
  power: 6000,
  counter: 2000,
  traits: ["The Moon", "Space Pirates"],
  attribute: "slash",
  i18n: op15CaptainSeamars062I18n,
};
