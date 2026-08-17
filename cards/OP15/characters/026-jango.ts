import type { CharacterCard } from "@tcg/op-types";
import { op15Jango026I18n } from "./026-jango.i18n.ts";

export const op15Jango026: CharacterCard = {
  id: "OP15-026",
  canonicalId: "OP15-026",
  slug: "jango/op15-026",
  name: "Jango",
  printings: [
    {
      id: "OP15-026",
      artId: "OP15-026",
      setCode: "OP15",
      collectorNumber: "026",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-026.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "UC",
  setId: "OP15",
  cost: 1,
  power: 2000,
  counter: 1000,
  traits: ["East Blue", "Black Cat Pirates"],
  attribute: "slash",
  effect:
    "[On Play] Look at 3 cards from the top of your deck; reveal up to 1 [East Blue] type card and add it to your hand. Then, place the rest at the bottom of your deck in any order.\n[Activate: Main] You may trash this Character: Give up to 1 of your opponent's rested DON!! cards to 1 of your opponent's Characters.",
  i18n: op15Jango026I18n,
};
