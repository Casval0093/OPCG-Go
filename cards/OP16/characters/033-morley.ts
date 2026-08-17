import type { CharacterCard } from "@tcg/op-types";
import { op16Morley033I18n } from "./033-morley.i18n.ts";

export const op16Morley033: CharacterCard = {
  id: "OP16-033",
  canonicalId: "OP16-033",
  slug: "morley/op16-033",
  name: "Morley",
  printings: [
    {
      id: "OP16-033",
      artId: "OP16-033",
      setCode: "OP16",
      collectorNumber: "033",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-033.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "C",
  setId: "OP16",
  cost: 4,
  power: 5000,
  counter: 1000,
  traits: ["Giant", "Revolutionary Army"],
  attribute: "special",
  effect:
    "If this Character would be K.O.'d, you may rest 2 of your cards instead.\n[Unblockable] (This card cannot be blocked.)",
  i18n: op16Morley033I18n,
};
