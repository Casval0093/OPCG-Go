import type { EventCard } from "@tcg/op-types";
import { op16TheThreeAdmirals076I18n } from "./076-the-three-admirals.i18n.ts";

export const op16TheThreeAdmirals076: EventCard = {
  id: "OP16-076",
  canonicalId: "OP16-076",
  slug: "the-three-admirals/op16-076",
  name: "The Three Admirals!!",
  printings: [
    {
      id: "OP16-076",
      artId: "OP16-076",
      setCode: "OP16",
      collectorNumber: "076",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-076.png",
    },
  ],
  cardType: "event",
  color: ["purple"],
  rarity: "UC",
  setId: "OP16",
  cost: 1,
  traits: ["Admiral", "Navy"],
  effect:
    "[Main] You may rest 3 of your DON!! cards: Up to 3 of your [Admiral] type Characters gain +2000 power during this turn.\n[Counter] If you have an [Admiral] type Character, up to 1 of your Leader or Character cards gains +4000 power during this battle.",
  i18n: op16TheThreeAdmirals076I18n,
};
