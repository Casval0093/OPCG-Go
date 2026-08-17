import type { CharacterCard } from "@tcg/op-types";
import { op15Nezumi010I18n } from "./010-nezumi.i18n.ts";

export const op15Nezumi010: CharacterCard = {
  id: "OP15-010",
  canonicalId: "OP15-010",
  slug: "nezumi/op15-010",
  name: "Nezumi",
  printings: [
    {
      id: "OP15-010",
      artId: "OP15-010",
      setCode: "OP15",
      collectorNumber: "010",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-010.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "C",
  setId: "OP15",
  cost: 2,
  power: 2000,
  counter: 1000,
  traits: ["East Blue", "Navy"],
  attribute: "strike",
  effect:
    "[Activate: Main] [Once Per Turn] Give up to 1 rested DON!! card to its owner's Leader or 1 of their Characters.",
  i18n: op15Nezumi010I18n,
};
