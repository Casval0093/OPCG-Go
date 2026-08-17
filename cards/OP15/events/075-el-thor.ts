import type { EventCard } from "@tcg/op-types";
import { op15ElThor075I18n } from "./075-el-thor.i18n.ts";

export const op15ElThor075: EventCard = {
  id: "OP15-075",
  canonicalId: "OP15-075",
  slug: "el-thor/op15-075",
  name: "El Thor",
  printings: [
    {
      id: "OP15-075",
      artId: "OP15-075",
      setCode: "OP15",
      collectorNumber: "075",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-075.png",
    },
  ],
  cardType: "event",
  color: ["purple"],
  rarity: "UC",
  setId: "OP15",
  cost: 0,
  traits: ["Sky Island"],
  effect:
    "[Main] DON!! -1: If your Leader is [Enel], up to 1 of your Leader or Character cards gains +1000 power during this turn. Then, K.O. up to 1 of your opponent's Characters with 3000 power or less.\n[Counter] Up to 1 of your [Enel] cards gains +2000 power during this battle.",
  i18n: op15ElThor075I18n,
};
