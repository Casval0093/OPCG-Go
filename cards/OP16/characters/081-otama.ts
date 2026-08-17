import type { CharacterCard } from "@tcg/op-types";
import { op16Otama081I18n } from "./081-otama.i18n.ts";

export const op16Otama081: CharacterCard = {
  id: "OP16-081",
  canonicalId: "OP16-081",
  slug: "otama/op16-081",
  name: "Otama",
  printings: [
    {
      id: "OP16-081",
      artId: "OP16-081",
      setCode: "OP16",
      collectorNumber: "081",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-081.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "C",
  setId: "OP16",
  cost: 2,
  power: 0,
  counter: 2000,
  traits: ["Land of Wano"],
  attribute: "special",
  effect:
    "[Activate: Main] You may rest this Character: If you have a Character with a cost of 8 or more, give up to 1 of your opponent's Characters -2000 power during this turn.",
  effects: {
    effects: [
      {
        trigger: "activateMain",
        costs: [{ cost: "restThisCard" }],
        // Ruling #1003 REVERSES the English here. The printed EN reads "If YOU have a
        // Character with a cost of 8 or more", i.e. your own field. The quoted SC text is
        // "场上存在费用为8或更高的角色的场合" -- "there is a Character with a cost of 8 or more
        // ON THE FIELD", with no owner. The Q&A asks the question directly ("my field has no
        // cost-8-or-more Character, my opponent's field does") and answers 是的，可以.
        //
        // So this scans BOTH fields. `existsOnField` is the only condition that can say that:
        // its `player` is optional and defaults to "any" (effects/conditions.ts builds the
        // Target with `condition.player ?? "any"`, and candidatePoolForTarget walks both seats
        // for "any"). `hasCard` -- the usual spelling for this shape -- cannot, because its
        // `player` is mandatory.
        conditions: [
          {
            condition: "existsOnField",
            zone: "character",
            filters: [{ filter: "cost", comparison: "gte", value: 8 }],
          },
        ],
        actions: [
          {
            action: "modifyPower",
            target: {
              player: "opponent",
              zones: ["character"],
              count: { amount: 1, upTo: true },
            },
            value: -2000,
            duration: "thisTurn",
          },
        ],
        optional: true,
      },
    ],
  },
  i18n: op16Otama081I18n,
};
