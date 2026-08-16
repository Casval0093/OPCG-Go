import type { CharacterCard } from "@tcg/op-types";
import { op16Buggy031I18n } from "./031-buggy.i18n.ts";

export const op16Buggy031: CharacterCard = {
  id: "OP16-031",
  canonicalId: "OP16-031",
  slug: "buggy/op16-031",
  name: "Buggy",
  printings: [
    {
      id: "OP16-031",
      artId: "OP16-031",
      setCode: "OP16",
      collectorNumber: "031",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-031.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "UC",
  setId: "OP16",
  cost: 4,
  power: 5000,
  counter: 1000,
  traits: ["Impel Down", "Buggy Pirates"],
  attribute: "slash",
  effect: "[On K.O.] Play up to 1 [Prisoner of Impel Down] card from your hand.",
  i18n: op16Buggy031I18n,
};
