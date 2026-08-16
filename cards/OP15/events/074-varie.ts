import type { EventCard } from "@tcg/op-types";
import { op15Varie074I18n } from "./074-varie.i18n.ts";

export const op15Varie074: EventCard = {
  id: "OP15-074",
  canonicalId: "OP15-074",
  slug: "varie/op15-074",
  name: "Varie",
  printings: [
    {
      id: "OP15-074",
      artId: "OP15-074",
      setCode: "OP15",
      collectorNumber: "074",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-074.png",
    },
  ],
  cardType: "event",
  color: ["purple"],
  rarity: "UC",
  setId: "OP15",
  cost: 0,
  traits: ["Sky Island"],
  effect:
    "[Main] DON!! -1: If your Leader is [Enel], draw 1 card. Then, up to 1 of your Characters gains +2 cost until the end of your opponent's next End Phase.\n[Counter] Up to 1 of your [Enel] cards gains +2000 power during this battle.",
  i18n: op15Varie074I18n,
};
