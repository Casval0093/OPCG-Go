import type { CharacterCard } from "@tcg/op-types";
import { op15PiratesDockingSix088I18n } from "./088-pirates-docking-six.i18n.ts";

export const op15PiratesDockingSix088: CharacterCard = {
  id: "OP15-088",
  canonicalId: "OP15-088",
  slug: "pirates-docking-six/op15-088",
  name: "Pirates Docking Six",
  printings: [
    {
      id: "OP15-088",
      artId: "OP15-088",
      setCode: "OP15",
      collectorNumber: "088",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-088.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "R",
  setId: "OP15",
  cost: 5,
  power: 7000,
  traits: ["Straw Hat Crew"],
  attribute: "strike",
  effect:
    "This Character gains +6 cost.\n[On Play] You may trash 3 cards from the top of your deck: Play up to 1 [Straw Hat Crew] type Character card with a cost of 2 or less from your trash.",
  i18n: op15PiratesDockingSix088I18n,
};
