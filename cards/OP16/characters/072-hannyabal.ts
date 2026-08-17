import type { CharacterCard } from "@tcg/op-types";
import { op16Hannyabal072I18n } from "./072-hannyabal.i18n.ts";

export const op16Hannyabal072: CharacterCard = {
  id: "OP16-072",
  canonicalId: "OP16-072",
  slug: "hannyabal/op16-072",
  name: "Hannyabal",
  printings: [
    {
      id: "OP16-072",
      artId: "OP16-072",
      setCode: "OP16",
      collectorNumber: "072",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-072.png",
    },
  ],
  cardType: "character",
  color: ["purple"],
  rarity: "C",
  setId: "OP16",
  cost: 2,
  power: 3000,
  counter: 1000,
  traits: ["Impel Down"],
  attribute: "slash",
  effect:
    "[On Play] Look at 5 cards from the top of your deck; reveal up to 1 [Impel Down] type card and add it to your hand. Then, place the rest at the bottom of your deck in any order.",
  i18n: op16Hannyabal072I18n,
};
