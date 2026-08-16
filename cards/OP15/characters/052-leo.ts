import type { CharacterCard } from "@tcg/op-types";
import { op15Leo052I18n } from "./052-leo.i18n.ts";

export const op15Leo052: CharacterCard = {
  id: "OP15-052",
  canonicalId: "OP15-052",
  slug: "leo/op15-052",
  name: "Leo",
  printings: [
    {
      id: "OP15-052",
      artId: "OP15-052",
      setCode: "OP15",
      collectorNumber: "052",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-052.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "UC",
  setId: "OP15",
  cost: 1,
  power: 2000,
  counter: 2000,
  traits: ["The Tontattas", "Dressrosa"],
  attribute: "strike",
  effect:
    "If your Character with 7000 base power or less would be removed from the field by your opponent's effect, you may place 1 of your Characters at the bottom of the owner's deck instead.",
  i18n: op15Leo052I18n,
};
