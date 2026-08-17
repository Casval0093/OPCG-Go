import type { LeaderCard } from "@tcg/op-types";
import { op15Rebecca039I18n } from "./039-rebecca.i18n.ts";

export const op15Rebecca039: LeaderCard = {
  id: "OP15-039",
  canonicalId: "OP15-039",
  slug: "rebecca/op15-039",
  name: "Rebecca",
  printings: [
    {
      id: "OP15-039",
      artId: "OP15-039",
      setCode: "OP15",
      collectorNumber: "039",
      rarity: "L",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-039.png",
    },
  ],
  cardType: "leader",
  color: ["blue"],
  rarity: "L",
  setId: "OP15",
  power: 5000,
  life: 5,
  traits: ["Dressrosa"],
  attribute: "wisdom",
  effect:
    "This Leader cannot attack.\n[Activate: Main] You may rest this Leader and return 1 of your [Dressrosa] type Characters to the owner's hand: Play up to 1 [Dressrosa] type Character card with a cost of 3 from your hand.",
  i18n: op15Rebecca039I18n,
};
