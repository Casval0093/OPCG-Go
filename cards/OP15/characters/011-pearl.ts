import type { CharacterCard } from "@tcg/op-types";
import { op15Pearl011I18n } from "./011-pearl.i18n.ts";

export const op15Pearl011: CharacterCard = {
  id: "OP15-011",
  canonicalId: "OP15-011",
  slug: "pearl/op15-011",
  name: "Pearl",
  printings: [
    {
      id: "OP15-011",
      artId: "OP15-011",
      setCode: "OP15",
      collectorNumber: "011",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-011.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "R",
  setId: "OP15",
  cost: 4,
  power: 4000,
  counter: 1000,
  traits: ["East Blue", "Krieg Pirates"],
  attribute: "strike",
  effect:
    "[Opponent's Turn] If your Leader has the [East Blue] type, this Character gains [Blocker] and +2000 power.\n[On K.O.] If your Leader has the [East Blue] type, K.O. up to 1 of your opponent's Characters with 6000 base power or less.",
  i18n: op15Pearl011I18n,
};
