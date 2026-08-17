import type { CharacterCard } from "@tcg/op-types";
import { op16MissOlive050I18n } from "./050-miss-olive.i18n.ts";

export const op16MissOlive050: CharacterCard = {
  id: "OP16-050",
  canonicalId: "OP16-050",
  slug: "miss-olive/op16-050",
  name: "Miss Olive",
  printings: [
    {
      id: "OP16-050",
      artId: "OP16-050",
      setCode: "OP16",
      collectorNumber: "050",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-050.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "UC",
  setId: "OP16",
  cost: 5,
  power: 6000,
  counter: 1000,
  traits: ["Impel Down"],
  attribute: "wisdom",
  effect:
    "[Blocker]\n[On Play] You may return 1 of your Characters with a cost of 2 or more to the owner's hand: Draw 2 cards and trash 1 card from your hand.",
  effects: {
    keywords: ["blocker"],
    effects: [
      {
        trigger: "onPlay",
        costs: [
          {
            // Ruling #992, the twin of #989 on OP16-045 Crocodile: Miss Olive may pay by
            // returning HERSELF (cost 5, so she clears "cost of 2 or more") and still draw
            // 2 / trash 1. No `excludeSelf` -- the printed text has no "other than this
            // Character" clause and the cost's candidate pool is the whole characterArea.
            cost: "returnCharacter",
            amount: 1,
            filters: [{ filter: "cost", comparison: "gte", value: 2 }],
          },
        ],
        actions: [
          { action: "draw", player: "self", amount: 2 },
          { action: "trashFromHand", player: "self", amount: 1 },
        ],
        optional: true,
      },
    ],
  },
  i18n: op16MissOlive050I18n,
};
