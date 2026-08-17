import type { EventCard } from "@tcg/op-types";
import { op15JustWatchMeAce021I18n } from "./021-just-watch-me-ace.i18n.ts";

export const op15JustWatchMeAce021: EventCard = {
  id: "OP15-021",
  canonicalId: "OP15-021",
  slug: "just-watch-me-ace/op15-021",
  name: "Just Watch Me, Ace!!!",
  printings: [
    {
      id: "OP15-021",
      artId: "OP15-021",
      setCode: "OP15",
      collectorNumber: "021",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-021.png",
    },
  ],
  cardType: "event",
  color: ["red"],
  rarity: "UC",
  setId: "OP15",
  cost: 4,
  traits: ["Dressrosa", "Revolutionary Army"],
  effect:
    "If you have 4 or more Events in your trash, give this card in your hand -3 cost.\n[Main]/[Counter] Give up to 1 of your opponent's Characters -3000 power during this turn.",
  i18n: op15JustWatchMeAce021I18n,
};
