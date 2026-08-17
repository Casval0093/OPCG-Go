import type { CharacterCard } from "@tcg/op-types";
import { op16Otama081I18n } from "./081-otama.i18n.ts";

export const op16Otama081: CharacterCard = {
  id: "OP16-081",
  canonicalId: "OP16-081",
  slug: "otama/op16-081",
  name: "Otama",
  printings: [
    {
      id: "OP16-081",
      artId: "OP16-081",
      setCode: "OP16",
      collectorNumber: "081",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-081.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "C",
  setId: "OP16",
  cost: 2,
  power: 0,
  counter: 2000,
  traits: ["Land of Wano"],
  attribute: "special",
  effect:
    "[Activate: Main] You may rest this Character: If you have a Character with a cost of 8 or more, give up to 1 of your opponent's Characters -2000 power during this turn.",
  i18n: op16Otama081I18n,
};
