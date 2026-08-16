import type { CharacterCard } from "@tcg/op-types";
import { op15HeavenlyWarriors068I18n } from "./068-heavenly-warriors.i18n.ts";

export const op15HeavenlyWarriors068: CharacterCard = {
  id: "OP15-068",
  canonicalId: "OP15-068",
  slug: "heavenly-warriors/op15-068",
  name: "Heavenly Warriors",
  printings: [
    {
      id: "OP15-068",
      artId: "OP15-068",
      setCode: "OP15",
      collectorNumber: "068",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-068.png",
    },
  ],
  cardType: "character",
  color: ["purple"],
  rarity: "C",
  setId: "OP15",
  cost: 1,
  power: 1000,
  counter: 1000,
  traits: ["Sky Island"],
  attribute: "slash",
  effect:
    "If you have 6 or less DON!! cards on your field, this Character gains [Blocker].\n(After your opponent declares an attack, you may rest this card to make it the new target of the attack.)",
  i18n: op15HeavenlyWarriors068I18n,
};
