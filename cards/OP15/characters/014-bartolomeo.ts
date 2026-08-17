import type { CharacterCard } from "@tcg/op-types";
import { op15Bartolomeo014I18n } from "./014-bartolomeo.i18n.ts";

export const op15Bartolomeo014: CharacterCard = {
  id: "OP15-014",
  canonicalId: "OP15-014",
  slug: "bartolomeo/op15-014",
  name: "Bartolomeo",
  printings: [
    {
      id: "OP15-014",
      artId: "OP15-014",
      setCode: "OP15",
      collectorNumber: "014",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-014.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "R",
  setId: "OP15",
  cost: 4,
  power: 6000,
  traits: ["Dressrosa", "Barto Club"],
  attribute: "special",
  effect:
    "If this Character would be K.O.'d, you may trash 1 Event from your hand instead.\n[On Play] Activate up to 1 [Dressrosa] type Event with a base cost of 3 or less from your hand.",
  i18n: op15Bartolomeo014I18n,
};
