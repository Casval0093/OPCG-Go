import type { CharacterCard } from "@tcg/op-types";
import { op15Fuza070I18n } from "./070-fuza.i18n.ts";

export const op15Fuza070: CharacterCard = {
  id: "OP15-070",
  canonicalId: "OP15-070",
  slug: "fuza/op15-070",
  name: "Fuza",
  printings: [
    {
      id: "OP15-070",
      artId: "OP15-070",
      setCode: "OP15",
      collectorNumber: "070",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-070.png",
    },
  ],
  cardType: "character",
  color: ["purple"],
  rarity: "C",
  setId: "OP15",
  cost: 3,
  power: 4000,
  counter: 1000,
  traits: ["Animal", "Sky Island"],
  attribute: "special",
  effect:
    "All of your [Shura] cards and this Character gain [Unblockable].\n(This card cannot be blocked.)\n[Opponent's Turn] All of your [Shura] cards' base power and this Character's base power become 6000.",
  i18n: op15Fuza070I18n,
};
