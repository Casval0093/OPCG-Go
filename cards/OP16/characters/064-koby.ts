import type { CharacterCard } from "@tcg/op-types";
import { op16Koby064I18n } from "./064-koby.i18n.ts";

export const op16Koby064: CharacterCard = {
  id: "OP16-064",
  canonicalId: "OP16-064",
  slug: "koby/op16-064",
  name: "Koby",
  printings: [
    {
      id: "OP16-064",
      artId: "OP16-064",
      setCode: "OP16",
      collectorNumber: "064",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-064.png",
    },
  ],
  cardType: "character",
  color: ["purple"],
  rarity: "R",
  setId: "OP16",
  cost: 1,
  power: 2000,
  counter: 1000,
  traits: ["Navy"],
  attribute: "strike",
  effect:
    "[On Play] Look at 5 cards from the top of your deck; reveal up to 1 [Navy] type card other than [Koby] and add it to your hand. Then, place the rest at the bottom of your deck in any order.",
  i18n: op16Koby064I18n,
};
