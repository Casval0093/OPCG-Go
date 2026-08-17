import type { CharacterCard } from "@tcg/op-types";
import { op15Yama073I18n } from "./073-yama.i18n.ts";

export const op15Yama073: CharacterCard = {
  id: "OP15-073",
  canonicalId: "OP15-073",
  slug: "yama/op15-073",
  name: "Yama",
  printings: [
    {
      id: "OP15-073",
      artId: "OP15-073",
      setCode: "OP15",
      collectorNumber: "073",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-073.png",
    },
  ],
  cardType: "character",
  color: ["purple"],
  rarity: "C",
  setId: "OP15",
  cost: 3,
  power: 4000,
  counter: 1000,
  traits: ["Sky Island"],
  attribute: "slash",
  effect:
    "[Blocker] (After your opponent declares an attack, you may rest this card to make it the new target of the attack.)\n[On Play] Play up to 1 [Heavenly Warriors] with a cost of 1 or up to 1 [Vassals] type Character card with a cost of 1 from your hand.",
  i18n: op15Yama073I18n,
};
