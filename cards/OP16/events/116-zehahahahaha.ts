import type { EventCard } from "@tcg/op-types";
import { op16Zehahahahaha116I18n } from "./116-zehahahahaha.i18n.ts";

export const op16Zehahahahaha116: EventCard = {
  id: "OP16-116",
  canonicalId: "OP16-116",
  slug: "zehahahahaha/op16-116",
  name: "Zehahahahaha!",
  printings: [
    {
      id: "OP16-116",
      artId: "OP16-116",
      setCode: "OP16",
      collectorNumber: "116",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-116.png",
    },
  ],
  cardType: "event",
  color: ["yellow"],
  rarity: "R",
  setId: "OP16",
  cost: 8,
  trigger: "Draw 2 cards and trash 1 card from your hand.",
  traits: ["The Seven Warlords of the Sea", "Blackbeard Pirates"],
  effect:
    "[Main] If you have 10 DON!! cards on your field, play up to 1 [Marshall.D.Teach] from your hand. Then, add up to 1 card from the top of your opponent's Life cards to the owner's hand.",
  i18n: op16Zehahahahaha116I18n,
};
