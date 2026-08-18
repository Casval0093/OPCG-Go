import type { CharacterCard } from "@tcg/op-types";
import { op15Brook032I18n } from "./032-brook.i18n.ts";

export const op15Brook032: CharacterCard = {
  id: "OP15-032",
  canonicalId: "OP15-032",
  slug: "brook/op15-032",
  name: "Brook",
  printings: [
    {
      id: "OP15-032",
      artId: "OP15-032",
      setCode: "OP15",
      collectorNumber: "032",
      rarity: "SR",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-032.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "SR",
  setId: "OP15",
  cost: 6,
  power: 6000,
  counter: 1000,
  traits: ["Straw Hat Crew"],
  attribute: "slash",
  effect:
    "[On Play] Rest up to 1 of your opponent's cards.\n[Activate: Main] You may trash this Character: If your Leader has the [Straw Hat Crew] type, set up to 1 of your Characters with a base cost of 8 or less as active.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        actions: [
          {
            action: "rest",
            // "your opponent's CARDS", unqualified -- Leader + Characters + Stage + cost-area
            // DON!!, the pool OP13/characters/033-franky.ts and OP14EB04/characters/024-kin-emon.ts
            // both use for that exact printed phrasing. (An own-side "rest N of your cards" COST
            // is narrower: `candidatesForRestCardsCost` omits the cost area.)
            target: {
              player: "opponent",
              zones: ["leader", "character", "stage", "costArea"],
              count: { amount: 1, upTo: true },
            },
          },
        ],
      },
      {
        trigger: "activateMain",
        costs: [{ cost: "trashThisCard" }],
        actions: [
          {
            action: "setActive",
            target: {
              player: "self",
              zones: ["character"],
              // "a BASE cost of 8 or less" -- `baseCost`, not `cost`, so a cost-9 body discounted
              // to 8 stays ineligible and a cost-8 body taxed to 10 stays eligible. Same split as
              // OP15-098's basePower and Task 4's OP15 events.
              count: { amount: 1, upTo: true },
              filters: [{ filter: "baseCost", comparison: "lte", value: 8 }],
            },
            // The Leader check sits AFTER the cost colon, so it gates only the payload: you may
            // trash Brook with a non-[Straw Hat Crew] Leader and get nothing. Placement copied
            // from OP16-065 Sakazuki / OP04-060 Crocodile. Contrast a LEADING "If your Leader ...",
            // which belongs in `conditions` and gates the whole block (OP15-116, ruling #944).
            condition: { condition: "leaderTrait", trait: "Straw Hat Crew", match: "includes" },
          },
        ],
        // "You may trash this Character" -- the cost is declinable, so the block is optional.
        optional: true,
      },
    ],
  },
  i18n: op15Brook032I18n,
};
