import type { CharacterCard } from "@tcg/op-types";
import { op15Brook032I18n } from "./032-brook.i18n.ts";

export const op15Brook032: CharacterCard = {
  id: "OP15-032",
  canonicalId: "OP15-032",
  slug: "brook/op15-032",
  name: "Brook",
  printings: [
    {
      id: "OP15-032",
      artId: "OP15-032",
      setCode: "OP15",
      collectorNumber: "032",
      rarity: "SR",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-032.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "SR",
  setId: "OP15",
  cost: 6,
  power: 6000,
  counter: 1000,
  traits: ["Straw Hat Crew"],
  attribute: "slash",
  effect:
    "[On Play] Rest up to 1 of your opponent's cards.\n[Activate: Main] You may trash this Character: If your Leader has the [Straw Hat Crew] type, set up to 1 of your Characters with a base cost of 8 or less as active.",
  i18n: op15Brook032I18n,
};
