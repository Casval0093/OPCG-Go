import type { EventCard } from "@tcg/op-types";
import { op15LightningDragon077I18n } from "./077-lightning-dragon.i18n.ts";

export const op15LightningDragon077: EventCard = {
  id: "OP15-077",
  canonicalId: "OP15-077",
  slug: "lightning-dragon/op15-077",
  name: "Lightning Dragon",
  printings: [
    {
      id: "OP15-077",
      artId: "OP15-077",
      setCode: "OP15",
      collectorNumber: "077",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-077.png",
    },
  ],
  cardType: "event",
  color: ["purple"],
  rarity: "R",
  setId: "OP15",
  cost: 0,
  traits: ["Sky Island"],
  effect:
    "[Main] DON!! -1: Draw 1 card. Then, up to 1 of your opponent's rested Characters with 6000 power or less will not become active in your opponent's next Refresh Phase.",
  i18n: op15LightningDragon077I18n,
};
