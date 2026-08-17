import type { CharacterCard } from "@tcg/op-types";
import { op15Sai045I18n } from "./045-sai.i18n.ts";

export const op15Sai045: CharacterCard = {
  id: "OP15-045",
  canonicalId: "OP15-045",
  slug: "sai/op15-045",
  name: "Sai",
  printings: [
    {
      id: "OP15-045",
      artId: "OP15-045",
      setCode: "OP15",
      collectorNumber: "045",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-045.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "UC",
  setId: "OP15",
  cost: 5,
  power: 6000,
  counter: 1000,
  traits: ["Dressrosa", "Happosui Army"],
  attribute: "slash",
  effect:
    "[Blocker] (After your opponent declares an attack, you may rest this card to make it the new target of the attack.)\n[On Play] You may trash 1 Event from your hand: Draw 2 cards.",
  i18n: op15Sai045I18n,
};
