import type { CharacterCard } from "@tcg/op-types";
import { op16KouzukiMomonosuke084I18n } from "./084-kouzuki-momonosuke.i18n.ts";

export const op16KouzukiMomonosuke084: CharacterCard = {
  id: "OP16-084",
  canonicalId: "OP16-084",
  slug: "kouzuki-momonosuke/op16-084",
  name: "Kouzuki Momonosuke",
  printings: [
    {
      id: "OP16-084",
      artId: "OP16-084",
      setCode: "OP16",
      collectorNumber: "084",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-084.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "UC",
  setId: "OP16",
  cost: 5,
  power: 0,
  counter: 2000,
  traits: ["Land of Wano", "Kouzuki Clan"],
  attribute: "slash",
  effect:
    "[Activate: Main] You may trash this Character with a cost of 20 or more: If you have 9 or more DON!! cards on your field, play up to 1 [Kouzuki Momonosuke] with a cost of 9 from your trash.",
  effects: {
    effects: [
      {
        trigger: "activateMain",
        conditions: [
          // Ruling #1004: "费用为20或更高的此角色" qualifies WHICH card the cost may trash --
          // this Character, and only while its own current cost is 20 or more. At 19 or less
          // the cost cannot be paid at all (不能), and the play-from-trash therefore does not
          // happen either. `trashThisCard` takes no filters, so the qualifier has to live in a
          // `cardState` condition, which gates the whole block's availability -- exactly the
          // "cannot activate" the ruling describes.
          //
          // This is `cost`, not `baseCost`, and that is the entire point of the card: printed
          // cost is 5, so it only ever switches on after a cost buff such as OP16-087
          // Shinobu's +20 (5 + 20 = 25).
          { condition: "cardState", target: "this", property: "cost", comparison: "gte", value: 20 },
          // "9 or more DON!! cards on your field" -- donFieldCount counts the cost area plus
          // every DON!! given to the Leader and Characters (shared.ts donCardsOnField).
          { condition: "donFieldCount", player: "self", comparison: "gte", value: 9 },
        ],
        costs: [{ cost: "trashThisCard" }],
        actions: [
          {
            action: "play",
            source: { player: "self", zone: "trash" },
            count: { amount: 1, upTo: true },
            // "with a cost of 9" is exactly 9 (`eq`), per the same reading rulings #962/#963
            // settled and #1008 restates on OP16-098. The only such card is OP16-085.
            filters: [
              { filter: "name", value: "Kouzuki Momonosuke" },
              { filter: "cost", comparison: "eq", value: 9 },
            ],
          },
        ],
        optional: true,
      },
    ],
  },
  i18n: op16KouzukiMomonosuke084I18n,
};
