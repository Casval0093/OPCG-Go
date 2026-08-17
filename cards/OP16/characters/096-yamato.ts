import type { CharacterCard } from "@tcg/op-types";
import { op16Yamato096I18n } from "./096-yamato.i18n.ts";

export const op16Yamato096: CharacterCard = {
  id: "OP16-096",
  canonicalId: "OP16-096",
  slug: "yamato/op16-096",
  name: "Yamato",
  printings: [
    {
      id: "OP16-096",
      artId: "OP16-096",
      setCode: "OP16",
      collectorNumber: "096",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-096.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "R",
  setId: "OP16",
  cost: 8,
  power: 8000,
  counter: 1000,
  traits: ["Land of Wano"],
  attribute: "special",
  effect:
    "[Unblockable] (This card cannot be blocked.)\n[On K.O.] Play up to 1 [Yamato] with a cost of 6 or less from your trash.",
  i18n: op16Yamato096I18n,
};
