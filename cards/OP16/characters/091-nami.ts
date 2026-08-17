import type { CharacterCard } from "@tcg/op-types";
import { op16Nami091I18n } from "./091-nami.i18n.ts";

export const op16Nami091: CharacterCard = {
  id: "OP16-091",
  canonicalId: "OP16-091",
  slug: "nami/op16-091",
  name: "Nami",
  printings: [
    {
      id: "OP16-091",
      artId: "OP16-091",
      setCode: "OP16",
      collectorNumber: "091",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-091.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "R",
  setId: "OP16",
  cost: 1,
  power: 2000,
  counter: 1000,
  traits: ["Land of Wano", "Straw Hat Crew"],
  attribute: "special",
  effect:
    "[On Play] If your Leader has the [Land of Wano] type, look at 4 cards from the top of your deck; reveal up to 1 [Land of Wano] type card other than [Nami] and add it to your hand. Then, trash the rest.",
  i18n: op16Nami091I18n,
};
