import type { CharacterCard } from "@tcg/op-types";
import { op16EmporioIvankov026I18n } from "./026-emporio-ivankov.i18n.ts";

export const op16EmporioIvankov026: CharacterCard = {
  id: "OP16-026",
  canonicalId: "OP16-026",
  slug: "emporio-ivankov/op16-026",
  name: "Emporio.Ivankov",
  printings: [
    {
      id: "OP16-026",
      artId: "OP16-026",
      setCode: "OP16",
      collectorNumber: "026",
      rarity: "SR",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-026.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "SR",
  setId: "OP16",
  cost: 4,
  power: 4000,
  counter: 1000,
  traits: ["Impel Down", "Revolutionary Army"],
  attribute: "special",
  effect:
    "[On Play] Look at 3 cards from the top of your deck; reveal up to 1 [Impel Down] type card, add it to your hand and place the rest at the bottom of your deck in any order. Then, play up to 1 Character card with a cost of 2 or less from your hand.",
  i18n: op16EmporioIvankov026I18n,
};
