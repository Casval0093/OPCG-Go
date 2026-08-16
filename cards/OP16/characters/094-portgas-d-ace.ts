import type { CharacterCard } from "@tcg/op-types";
import { op16PortgasDAce094I18n } from "./094-portgas-d-ace.i18n.ts";

export const op16PortgasDAce094: CharacterCard = {
  id: "OP16-094",
  canonicalId: "OP16-094",
  slug: "portgas-d-ace/op16-094",
  name: "Portgas.D.Ace",
  printings: [
    {
      id: "OP16-094",
      artId: "OP16-094",
      setCode: "OP16",
      collectorNumber: "094",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-094.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "UC",
  setId: "OP16",
  cost: 4,
  power: 5000,
  counter: 1000,
  traits: ["Land of Wano", "Spade Pirates"],
  attribute: "special",
  effect:
    "[On K.O.] Your opponent trashes 2 cards from their hand.\n[Activate: Main] [Once Per Turn] Give up to 1 rested DON!! card to 1 of your [Land of Wano] type Leader or Character cards.",
  i18n: op16PortgasDAce094I18n,
};
