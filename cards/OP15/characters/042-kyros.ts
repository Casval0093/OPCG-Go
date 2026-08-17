import type { CharacterCard } from "@tcg/op-types";
import { op15Kyros042I18n } from "./042-kyros.i18n.ts";

export const op15Kyros042: CharacterCard = {
  id: "OP15-042",
  canonicalId: "OP15-042",
  slug: "kyros/op15-042",
  name: "Kyros",
  printings: [
    {
      id: "OP15-042",
      artId: "OP15-042",
      setCode: "OP15",
      collectorNumber: "042",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-042.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "R",
  setId: "OP15",
  cost: 3,
  power: 5000,
  traits: ["Dressrosa"],
  attribute: "slash",
  effect:
    "[On Play] You may trash 1 card from your hand: If your Leader is [Rebecca], this Character gains [Rush] during this turn.\n[On K.O.] Add this Character card from your trash to your hand.",
  i18n: op15Kyros042I18n,
};
