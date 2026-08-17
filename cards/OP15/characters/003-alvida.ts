import type { CharacterCard } from "@tcg/op-types";
import { op15Alvida003I18n } from "./003-alvida.i18n.ts";

export const op15Alvida003: CharacterCard = {
  id: "OP15-003",
  canonicalId: "OP15-003",
  slug: "alvida/op15-003",
  name: "Alvida",
  printings: [
    {
      id: "OP15-003",
      artId: "OP15-003",
      setCode: "OP15",
      collectorNumber: "003",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-003.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "R",
  setId: "OP15",
  cost: 5,
  power: 6000,
  counter: 1000,
  traits: ["East Blue", "Alvida Pirates"],
  attribute: "strike",
  effect:
    "If this Character would be K.O.'d, you may trash 1 Character card with a power of 6000 or less from your hand instead.\n[Activate: Main] [Once Per Turn] You may give 1 of your opponent's rested DON!! cards to 1 of your opponent's Characters: Give up to 1 rested DON!! card to its owner's Leader or 1 of their Characters.",
  i18n: op15Alvida003I18n,
};
