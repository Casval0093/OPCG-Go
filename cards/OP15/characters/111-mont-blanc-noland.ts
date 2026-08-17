import type { CharacterCard } from "@tcg/op-types";
import { op15MontBlancNoland111I18n } from "./111-mont-blanc-noland.i18n.ts";

export const op15MontBlancNoland111: CharacterCard = {
  id: "OP15-111",
  canonicalId: "OP15-111",
  slug: "mont-blanc-noland/op15-111",
  name: "Mont Blanc Noland",
  printings: [
    {
      id: "OP15-111",
      artId: "OP15-111",
      setCode: "OP15",
      collectorNumber: "111",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-111.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "C",
  setId: "OP15",
  cost: 4,
  power: 5000,
  counter: 2000,
  traits: ["Jaya", "Botanist"],
  attribute: "slash",
  effect:
    "[DON!! x1] [When Attacking] Up to 1 of your [Kalgara] cards gains [Rush] during this turn.\n(This card can attack on the turn in which it is played.)",
  i18n: op15MontBlancNoland111I18n,
};
