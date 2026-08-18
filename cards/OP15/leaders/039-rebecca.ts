import type { LeaderCard } from "@tcg/op-types";
import { op15Rebecca039I18n } from "./039-rebecca.i18n.ts";

export const op15Rebecca039: LeaderCard = {
  id: "OP15-039",
  canonicalId: "OP15-039",
  slug: "rebecca/op15-039",
  name: "Rebecca",
  printings: [
    {
      id: "OP15-039",
      artId: "OP15-039",
      setCode: "OP15",
      collectorNumber: "039",
      rarity: "L",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-039.png",
    },
  ],
  cardType: "leader",
  color: ["blue"],
  rarity: "L",
  setId: "OP15",
  power: 5000,
  life: 5,
  traits: ["Dressrosa"],
  attribute: "wisdom",
  effect:
    "This Leader cannot attack.\n[Activate: Main] You may rest this Leader and return 1 of your [Dressrosa] type Characters to the owner's hand: Play up to 1 [Dressrosa] type Character card with a cost of 3 from your hand.",
  effects: {
    permanentEffects: [
      {
        actions: [
          {
            action: "cannotAttack",
            target: {
              player: "self",
              zones: ["leader"],
              count: { amount: 1 },
              self: true,
            },
            duration: "permanent",
          },
        ],
      },
    ],
    effects: [
      {
        trigger: "activateMain",
        costs: [
          { cost: "restThisCard" },
          {
            cost: "returnCharacter",
            amount: 1,
            filters: [{ filter: "trait", value: "Dressrosa", match: "includes" }],
          },
        ],
        actions: [
          {
            action: "play",
            source: { player: "self", zone: "hand" },
            count: { amount: 1, upTo: true },
            filters: [
              { filter: "cardCategory", value: "character" },
              { filter: "trait", value: "Dressrosa", match: "includes" },
              // "a cost of 3" is EXACTLY 3 (`eq`), not "3 or less". SC prints 费用为3, and this is
              // the same reading rulings #962/#963 pinned for "power N" -- a bare number in card
              // text is an equality unless a comparison word is printed. A cost-2 Dressrosa
              // Character is NOT a legal target of this play.
              { filter: "cost", comparison: "eq", value: 3 },
            ],
          },
        ],
      },
    ],
  },
  i18n: op15Rebecca039I18n,
};
