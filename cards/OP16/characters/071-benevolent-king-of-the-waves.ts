import type { CharacterCard } from "@tcg/op-types";
import { op16BenevolentKingOfTheWaves071I18n } from "./071-benevolent-king-of-the-waves.i18n.ts";

export const op16BenevolentKingOfTheWaves071: CharacterCard = {
  id: "OP16-071",
  canonicalId: "OP16-071",
  slug: "benevolent-king-of-the-waves/op16-071",
  name: "Benevolent King of the Waves",
  printings: [
    {
      id: "OP16-071",
      artId: "OP16-071",
      setCode: "OP16",
      collectorNumber: "071",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-071.png",
    },
  ],
  cardType: "character",
  color: ["purple"],
  rarity: "C",
  setId: "OP16",
  cost: 3,
  power: 5000,
  traits: ["Navy"],
  attribute: "strike",
  effect:
    "[On Play] You may trash 1 card from your hand: Add up to 1 DON!! card from your DON!! deck and rest it.\n[On K.O.] Add up to 1 DON!! card from your DON!! deck and rest it.",
  i18n: op16BenevolentKingOfTheWaves071I18n,
};
