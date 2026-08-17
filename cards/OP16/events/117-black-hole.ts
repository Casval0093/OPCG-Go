import type { EventCard } from "@tcg/op-types";
import { op16BlackHole117I18n } from "./117-black-hole.i18n.ts";

export const op16BlackHole117: EventCard = {
  id: "OP16-117",
  canonicalId: "OP16-117",
  slug: "black-hole/op16-117",
  name: "Black Hole",
  printings: [
    {
      id: "OP16-117",
      artId: "OP16-117",
      setCode: "OP16",
      collectorNumber: "117",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-117.png",
    },
  ],
  cardType: "event",
  color: ["yellow"],
  rarity: "C",
  setId: "OP16",
  cost: 2,
  trigger: "Add up to 1 [Blackbeard Pirates] type card from your trash to your hand.",
  traits: ["The Seven Warlords of the Sea", "Blackbeard Pirates"],
  effect:
    "[Main] You may trash 1 card with a [Trigger] from your hand: Negate the effects of up to 1 of your opponent's Characters with a cost of 8 or less during this turn.",
  i18n: op16BlackHole117I18n,
};
