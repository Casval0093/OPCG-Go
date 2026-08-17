import type { CharacterCard } from "@tcg/op-types";
import { op16Inazuma024I18n } from "./024-inazuma.i18n.ts";

export const op16Inazuma024: CharacterCard = {
  id: "OP16-024",
  canonicalId: "OP16-024",
  slug: "inazuma/op16-024",
  name: "Inazuma",
  printings: [
    {
      id: "OP16-024",
      artId: "OP16-024",
      setCode: "OP16",
      collectorNumber: "024",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-024.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "UC",
  setId: "OP16",
  cost: 2,
  power: 1000,
  counter: 1000,
  traits: ["Impel Down", "Revolutionary Army"],
  attribute: "slash",
  effect:
    "When this Character is K.O.'d by your opponent's effect, rest up to 1 of your opponent's Characters.\n[Blocker] (After your opponent declares an attack, you may rest this card to make it the new target of the attack.)",
  effects: {
    keywords: ["blocker"],
    effects: [
      {
        trigger: "onKo",
        // "by your opponent's effect" is two gates in one word: `source: "opponentEffect"`
        // requires effectController !== controller AND koCause !== "battle"
        // (effects/resolution.ts), so a battle K.O. must not fire this. Modeled on
        // EB01/characters/057-shirahoshi.ts -- the same keywords + onKo/opponentEffect shape.
        source: "opponentEffect",
        actions: [
          {
            action: "rest",
            target: {
              player: "opponent",
              zones: ["character"],
              count: { amount: 1, upTo: true },
            },
          },
        ],
      },
    ],
  },
  i18n: op16Inazuma024I18n,
};
