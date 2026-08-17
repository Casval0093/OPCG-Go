import type { CharacterCard } from "@tcg/op-types";
import { op15Koby009I18n } from "./009-koby.i18n.ts";

export const op15Koby009: CharacterCard = {
  id: "OP15-009",
  canonicalId: "OP15-009",
  slug: "koby/op15-009",
  name: "Koby",
  printings: [
    {
      id: "OP15-009",
      artId: "OP15-009",
      setCode: "OP15",
      collectorNumber: "009",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-009.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "UC",
  setId: "OP15",
  cost: 1,
  power: 2000,
  counter: 2000,
  traits: ["East Blue", "Navy"],
  attribute: "strike",
  effect:
    "If your Character with 7000 base power or less would be removed from the field by your opponent's effect, you may give your Leader -2000 power during this turn instead.",
  i18n: op15Koby009I18n,
};
