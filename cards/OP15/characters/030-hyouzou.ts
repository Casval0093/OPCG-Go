import type { CharacterCard } from "@tcg/op-types";
import { op15Hyouzou030I18n } from "./030-hyouzou.i18n.ts";

export const op15Hyouzou030: CharacterCard = {
  id: "OP15-030",
  canonicalId: "OP15-030",
  slug: "hyouzou/op15-030",
  name: "Hyouzou",
  printings: [
    {
      id: "OP15-030",
      artId: "OP15-030",
      setCode: "OP15",
      collectorNumber: "030",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-030.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "UC",
  setId: "OP15",
  cost: 5,
  power: 6000,
  counter: 2000,
  traits: ["Merfolk", "Fish-Man Island"],
  attribute: "slash",
  i18n: op15Hyouzou030I18n,
};
