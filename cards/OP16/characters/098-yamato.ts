import type { CharacterCard } from "@tcg/op-types";
import { op16Yamato098I18n } from "./098-yamato.i18n.ts";

export const op16Yamato098: CharacterCard = {
  id: "OP16-098",
  canonicalId: "OP16-098",
  slug: "yamato/op16-098",
  name: "Yamato",
  printings: [
    {
      id: "OP16-098",
      artId: "OP16-098",
      setCode: "OP16",
      collectorNumber: "098",
      rarity: "SR",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-098.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "SR",
  setId: "OP16",
  cost: 6,
  power: 5000,
  counter: 1000,
  traits: ["Land of Wano"],
  attribute: "strike",
  effect:
    "[On Play] Draw 1 card and trash 1 card from your hand.\n[Activate: Main] You may trash this Character: Play up to 1 black [Yamato] with a cost of 8 from your trash.",
  i18n: op16Yamato098I18n,
};
