import type { EventCard } from "@tcg/op-types";
import { op15Mamaragan078I18n } from "./078-mamaragan.i18n.ts";

export const op15Mamaragan078: EventCard = {
  id: "OP15-078",
  canonicalId: "OP15-078",
  slug: "mamaragan/op15-078",
  name: "Mamaragan",
  printings: [
    {
      id: "OP15-078",
      artId: "OP15-078",
      setCode: "OP15",
      collectorNumber: "078",
      rarity: "SR",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-078.png",
    },
  ],
  cardType: "event",
  color: ["purple"],
  rarity: "SR",
  setId: "OP15",
  cost: 0,
  traits: ["Sky Island"],
  effect:
    "[Main] DON!! -2: Draw 1 card. Then, rest up to 1 of your opponent's Characters with 5000 power or less.\n[Counter] Up to 1 of your Leader or Character cards gains +1000 power during this battle. Then, if you have 6 or less DON!! cards on your field, draw 1 card.",
  i18n: op15Mamaragan078I18n,
};
