import type { CharacterCard } from "@tcg/op-types";
import { op15RoronoaZoro094I18n } from "./094-roronoa-zoro.i18n.ts";

export const op15RoronoaZoro094: CharacterCard = {
  id: "OP15-094",
  canonicalId: "OP15-094",
  slug: "roronoa-zoro/op15-094",
  name: "Roronoa Zoro",
  printings: [
    {
      id: "OP15-094",
      artId: "OP15-094",
      setCode: "OP15",
      collectorNumber: "094",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-094.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "UC",
  setId: "OP15",
  cost: 2,
  power: 1000,
  counter: 1000,
  traits: ["Straw Hat Crew"],
  attribute: "slash",
  effect:
    "If your [Straw Hat Crew] type Character other than this Character would be removed from the field by your opponent's effect, you may trash this Character instead.\n[Blocker]",
  i18n: op15RoronoaZoro094I18n,
};
