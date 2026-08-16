import type { CharacterCard } from "@tcg/op-types";
import { op15Kotori064I18n } from "./064-kotori.i18n.ts";

export const op15Kotori064: CharacterCard = {
  id: "OP15-064",
  canonicalId: "OP15-064",
  slug: "kotori/op15-064",
  name: "Kotori",
  printings: [
    {
      id: "OP15-064",
      artId: "OP15-064",
      setCode: "OP15",
      collectorNumber: "064",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-064.png",
    },
  ],
  cardType: "character",
  color: ["purple"],
  rarity: "C",
  setId: "OP15",
  cost: 1,
  power: 2000,
  counter: 1000,
  traits: ["Sky Island"],
  attribute: "special",
  effect:
    "[Activate: Main] DON!! -2, You may rest this Character: If you have [Satori] and [Hotori], rest up to 1 of your opponent's Characters with 5000 power or less.",
  i18n: op15Kotori064I18n,
};
