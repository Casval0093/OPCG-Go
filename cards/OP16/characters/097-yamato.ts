import type { CharacterCard } from "@tcg/op-types";
import { op16Yamato097I18n } from "./097-yamato.i18n.ts";

export const op16Yamato097: CharacterCard = {
  id: "OP16-097",
  canonicalId: "OP16-097",
  slug: "yamato/op16-097",
  name: "Yamato",
  printings: [
    {
      id: "OP16-097",
      artId: "OP16-097",
      setCode: "OP16",
      collectorNumber: "097",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-097.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "R",
  setId: "OP16",
  cost: 8,
  power: 8000,
  traits: ["Land of Wano"],
  attribute: "strike",
  effect:
    "[On Play] Add up to 1 [Land of Wano] type Character card with a cost of 6 or less from your trash to your hand. Then, play up to 1 Character card with a cost of 2 or less from your hand.",
  i18n: op16Yamato097I18n,
};
