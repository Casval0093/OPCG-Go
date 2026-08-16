import type { CharacterCard } from "@tcg/op-types";
import { op15Gin007I18n } from "./007-gin.i18n.ts";

export const op15Gin007: CharacterCard = {
  id: "OP15-007",
  canonicalId: "OP15-007",
  slug: "gin/op15-007",
  name: "Gin",
  printings: [
    {
      id: "OP15-007",
      artId: "OP15-007",
      setCode: "OP15",
      collectorNumber: "007",
      rarity: "SR",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-007.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "SR",
  setId: "OP15",
  cost: 6,
  power: 7000,
  counter: 1000,
  traits: ["East Blue", "Krieg Pirates"],
  attribute: "strike",
  effect:
    "[On Play] If your Leader has the [East Blue] type, play up to 1 Character card with a cost of 5 or less from your hand.",
  i18n: op15Gin007I18n,
};
