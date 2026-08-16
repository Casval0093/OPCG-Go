import type { CharacterCard } from "@tcg/op-types";
import { op15Kalgara101I18n } from "./101-kalgara.i18n.ts";

export const op15Kalgara101: CharacterCard = {
  id: "OP15-101",
  canonicalId: "OP15-101",
  slug: "kalgara/op15-101",
  name: "Kalgara",
  printings: [
    {
      id: "OP15-101",
      artId: "OP15-101",
      setCode: "OP15",
      collectorNumber: "101",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-101.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "UC",
  setId: "OP15",
  cost: 3,
  power: 5000,
  traits: ["Jaya", "Sky Island", "Shandian Warrior"],
  attribute: "slash",
  effect:
    "[On Play] You may trash 1 card from your hand: Look at 5 cards from the top of your deck; reveal up to a total of 2 [Mont Blanc Noland] or [Shandian Warrior] type cards and add them to your hand. Then, place the rest at the bottom of your deck in any order.",
  i18n: op15Kalgara101I18n,
};
