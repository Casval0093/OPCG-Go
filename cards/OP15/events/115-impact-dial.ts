import type { EventCard } from "@tcg/op-types";
import { op15ImpactDial115I18n } from "./115-impact-dial.i18n.ts";

export const op15ImpactDial115: EventCard = {
  id: "OP15-115",
  canonicalId: "OP15-115",
  slug: "impact-dial/op15-115",
  name: "Impact Dial",
  printings: [
    {
      id: "OP15-115",
      artId: "OP15-115",
      setCode: "OP15",
      collectorNumber: "115",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-115.png",
    },
  ],
  cardType: "event",
  color: ["yellow"],
  rarity: "C",
  setId: "OP15",
  cost: 2,
  trigger: "K.O. up to 1 of your opponent's Characters with a cost of 4 or less.",
  traits: ["Sky Island", "Straw Hat Crew"],
  effect:
    "[Main] K.O. up to 1 of your opponent's Characters with a cost of 4 or less. Then, add 1 card from the top of your Life cards to your hand.",
  i18n: op15ImpactDial115I18n,
};
