import type { CharacterCard } from "@tcg/op-types";
import { op15Buggy012I18n } from "./012-buggy.i18n.ts";

export const op15Buggy012: CharacterCard = {
  id: "OP15-012",
  canonicalId: "OP15-012",
  slug: "buggy/op15-012",
  name: "Buggy",
  printings: [
    {
      id: "OP15-012",
      artId: "OP15-012",
      setCode: "OP15",
      collectorNumber: "012",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-012.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "C",
  setId: "OP15",
  cost: 3,
  power: 4000,
  counter: 1000,
  traits: ["East Blue", "Buggy Pirates"],
  attribute: "slash",
  effect:
    "[When Attacking] Give up to 1 rested DON!! card to its owner's Leader or 1 of their Characters.\n[On K.O.] Draw 1 card.",
  i18n: op15Buggy012I18n,
};
