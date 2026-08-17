import type { StageCard } from "@tcg/op-types";
import { op16MobyDick021I18n } from "./021-moby-dick.i18n.ts";

export const op16MobyDick021: StageCard = {
  id: "OP16-021",
  canonicalId: "OP16-021",
  slug: "moby-dick/op16-021",
  name: "Moby Dick",
  printings: [
    {
      id: "OP16-021",
      artId: "OP16-021",
      setCode: "OP16",
      collectorNumber: "021",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-021.png",
    },
  ],
  cardType: "stage",
  color: ["red"],
  rarity: "R",
  setId: "OP16",
  cost: 1,
  traits: ["Whitebeard Pirates"],
  effect:
    "[On Play] If your Leader has the [Whitebeard Pirates] type, look at 3 cards from the top of your deck and add up to 1 card to your hand. Then, place the rest at the bottom of your deck in any order.\n[Activate: Main] You may trash this Stage: Give up to 1 rested DON!! card to your Leader or 1 of your Characters.",
  i18n: op16MobyDick021I18n,
};
