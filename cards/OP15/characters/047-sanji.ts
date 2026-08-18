import type { CharacterCard } from "@tcg/op-types";
import { op15Sanji047I18n } from "./047-sanji.i18n.ts";

export const op15Sanji047: CharacterCard = {
  id: "OP15-047",
  canonicalId: "OP15-047",
  slug: "sanji/op15-047",
  name: "Sanji",
  printings: [
    {
      id: "OP15-047",
      artId: "OP15-047",
      setCode: "OP15",
      collectorNumber: "047",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-047.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "R",
  setId: "OP15",
  cost: 3,
  power: 4000,
  counter: 1000,
  traits: ["Dressrosa", "Straw Hat Crew"],
  attribute: "strike",
  effect:
    "[Blocker] (After your opponent declares an attack, you may rest this card to make it the new target of the attack.)\n[On Play] Up to 1 of your Characters gains [Unblockable] during this turn.\n(This card cannot be blocked.)",
  effects: {
    keywords: ["blocker"],
    effects: [
      {
        // "Up to 1 of your Characters" -- no filter at all, unlike OP16-095 Monkey.D.Luffy
        // (colour + trait) and OP14-024 Terracotta (trait), which are otherwise the same shape.
        trigger: "onPlay",
        actions: [
          {
            action: "grantKeyword",
            target: { player: "self", zones: ["character"], count: { amount: 1, upTo: true } },
            keyword: "unblockable",
            duration: "thisTurn",
          },
        ],
      },
    ],
  },
  i18n: op15Sanji047I18n,
};
