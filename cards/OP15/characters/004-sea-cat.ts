import type { CharacterCard } from "@tcg/op-types";
import { op15SeaCat004I18n } from "./004-sea-cat.i18n.ts";

export const op15SeaCat004: CharacterCard = {
  id: "OP15-004",
  canonicalId: "OP15-004",
  slug: "sea-cat/op15-004",
  name: "Sea Cat",
  printings: [
    {
      id: "OP15-004",
      artId: "OP15-004",
      setCode: "OP15",
      collectorNumber: "004",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-004.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "C",
  setId: "OP15",
  cost: 1,
  power: 0,
  counter: 1000,
  traits: ["Animal", "Alabasta"],
  attribute: "wisdom",
  effect:
    "[On Play] If your Leader has 0 power or less, give up to 1 of your opponent's Characters -3000 power during this turn.",
  i18n: op15SeaCat004I18n,
};
