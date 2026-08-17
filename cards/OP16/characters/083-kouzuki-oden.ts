import type { CharacterCard } from "@tcg/op-types";
import { op16KouzukiOden083I18n } from "./083-kouzuki-oden.i18n.ts";

export const op16KouzukiOden083: CharacterCard = {
  id: "OP16-083",
  canonicalId: "OP16-083",
  slug: "kouzuki-oden/op16-083",
  name: "Kouzuki Oden",
  printings: [
    {
      id: "OP16-083",
      artId: "OP16-083",
      setCode: "OP16",
      collectorNumber: "083",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-083.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "C",
  setId: "OP16",
  cost: 5,
  power: 6000,
  counter: 1000,
  traits: ["Land of Wano", "Kouzuki Clan"],
  attribute: "slash",
  effect:
    "[Blocker] (After your opponent declares an attack, you may rest this card to make it the new target of the attack.)\n[On Play] You may trash 1 Character card with a cost of 8 or more from your hand: Draw 2 cards.",
  i18n: op16KouzukiOden083I18n,
};
