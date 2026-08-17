import type { EventCard } from "@tcg/op-types";
import { op15LightningBeastKiten076I18n } from "./076-lightning-beast-kiten.i18n.ts";

export const op15LightningBeastKiten076: EventCard = {
  id: "OP15-076",
  canonicalId: "OP15-076",
  slug: "lightning-beast-kiten/op15-076",
  name: "Lightning Beast Kiten",
  printings: [
    {
      id: "OP15-076",
      artId: "OP15-076",
      setCode: "OP15",
      collectorNumber: "076",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-076.png",
    },
  ],
  cardType: "event",
  color: ["purple"],
  rarity: "UC",
  setId: "OP15",
  cost: 0,
  traits: ["Sky Island"],
  effect:
    "[Main] DON!! -1: If your Leader is [Enel], draw 1 card. Then, give up to 1 of your opponent's Characters -1000 power during this turn.\n[Counter] Up to 1 of your [Enel] cards gains +2000 power during this battle.",
  i18n: op15LightningBeastKiten076I18n,
};
