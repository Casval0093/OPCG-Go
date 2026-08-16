import type { CharacterCard } from "@tcg/op-types";
import { op16RoronoaZoro035I18n } from "./035-roronoa-zoro.i18n.ts";

export const op16RoronoaZoro035: CharacterCard = {
  id: "OP16-035",
  canonicalId: "OP16-035",
  slug: "roronoa-zoro/op16-035",
  name: "Roronoa Zoro",
  printings: [
    {
      id: "OP16-035",
      artId: "OP16-035",
      setCode: "OP16",
      collectorNumber: "035",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-035.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "C",
  setId: "OP16",
  cost: 7,
  power: 9000,
  traits: ["Straw Hat Crew"],
  attribute: "slash",
  effect:
    "[On Play] Rest up to 1 of your opponent's cards. Then, you may trash 1 card from your hand. If you do, give up to 3 rested DON!! cards to your Leader.",
  i18n: op16RoronoaZoro035I18n,
};
