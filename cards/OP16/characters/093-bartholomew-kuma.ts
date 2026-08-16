import type { CharacterCard } from "@tcg/op-types";
import { op16BartholomewKuma093I18n } from "./093-bartholomew-kuma.i18n.ts";

export const op16BartholomewKuma093: CharacterCard = {
  id: "OP16-093",
  canonicalId: "OP16-093",
  slug: "bartholomew-kuma/op16-093",
  name: "Bartholomew Kuma",
  printings: [
    {
      id: "OP16-093",
      artId: "OP16-093",
      setCode: "OP16",
      collectorNumber: "093",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-093.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "C",
  setId: "OP16",
  cost: 3,
  power: 4000,
  counter: 1000,
  traits: ["The Seven Warlords of the Sea", "Revolutionary Army"],
  attribute: "strike",
  effect:
    "[On Play] Draw 2 cards and trash 2 cards from your hand. Then, give up to 1 rested DON!! card to your Leader or 1 of your Characters.",
  i18n: op16BartholomewKuma093I18n,
};
