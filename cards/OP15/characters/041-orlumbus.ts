import type { CharacterCard } from "@tcg/op-types";
import { op15Orlumbus041I18n } from "./041-orlumbus.i18n.ts";

export const op15Orlumbus041: CharacterCard = {
  id: "OP15-041",
  canonicalId: "OP15-041",
  slug: "orlumbus/op15-041",
  name: "Orlumbus",
  printings: [
    {
      id: "OP15-041",
      artId: "OP15-041",
      setCode: "OP15",
      collectorNumber: "041",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-041.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "UC",
  setId: "OP15",
  cost: 3,
  power: 4000,
  counter: 1000,
  traits: ["Dressrosa", "Yonta Maria Fleet"],
  attribute: "strike",
  effect:
    "[On K.O.] Draw 1 card.\n[Activate: Main] [Once Per Turn] You may place 1 of your Characters at the bottom of the owner's deck: This Character gains [Rush] during this turn.",
  i18n: op15Orlumbus041I18n,
};
