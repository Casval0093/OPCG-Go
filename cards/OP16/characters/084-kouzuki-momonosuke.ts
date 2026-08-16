import type { CharacterCard } from "@tcg/op-types";
import { op16KouzukiMomonosuke084I18n } from "./084-kouzuki-momonosuke.i18n.ts";

export const op16KouzukiMomonosuke084: CharacterCard = {
  id: "OP16-084",
  canonicalId: "OP16-084",
  slug: "kouzuki-momonosuke/op16-084",
  name: "Kouzuki Momonosuke",
  printings: [
    {
      id: "OP16-084",
      artId: "OP16-084",
      setCode: "OP16",
      collectorNumber: "084",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-084.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "UC",
  setId: "OP16",
  cost: 5,
  power: 0,
  counter: 2000,
  traits: ["Land of Wano", "Kouzuki Clan"],
  attribute: "slash",
  effect:
    "[Activate: Main] You may trash this Character with a cost of 20 or more: If you have 9 or more DON!! cards on your field, play up to 1 [Kouzuki Momonosuke] with a cost of 9 from your trash.",
  i18n: op16KouzukiMomonosuke084I18n,
};
