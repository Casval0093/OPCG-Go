import type { CharacterCard } from "@tcg/op-types";
import { op16KouzukiMomonosuke085I18n } from "./085-kouzuki-momonosuke.i18n.ts";

export const op16KouzukiMomonosuke085: CharacterCard = {
  id: "OP16-085",
  canonicalId: "OP16-085",
  slug: "kouzuki-momonosuke/op16-085",
  name: "Kouzuki Momonosuke",
  printings: [
    {
      id: "OP16-085",
      artId: "OP16-085",
      setCode: "OP16",
      collectorNumber: "085",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-085.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "R",
  setId: "OP16",
  cost: 9,
  power: 6000,
  counter: 1000,
  traits: ["Land of Wano", "Kouzuki Clan"],
  attribute: "special",
  effect:
    "[Blocker]\n[On Play] Play up to 1 [Land of Wano] type Character card with a cost of 6 or less other than [Kouzuki Momonosuke] from your trash.",
  i18n: op16KouzukiMomonosuke085I18n,
};
