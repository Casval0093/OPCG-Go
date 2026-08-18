import type { CharacterCard } from "@tcg/op-types";
import { op16RoronoaZoro035I18n } from "./035-roronoa-zoro.i18n.ts";

export const op16RoronoaZoro035: CharacterCard = {
  id: "OP16-035",
  canonicalId: "OP16-035",
  slug: "roronoa-zoro/op16-035",
  name: "Roronoa Zoro",
  printings: [
    {
      id: "OP16-035",
      artId: "OP16-035",
      setCode: "OP16",
      collectorNumber: "035",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-035.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "C",
  setId: "OP16",
  cost: 7,
  power: 9000,
  traits: ["Straw Hat Crew"],
  attribute: "slash",
  effect:
    "[On Play] Rest up to 1 of your opponent's cards. Then, you may trash 1 card from your hand. If you do, give up to 3 rested DON!! cards to your Leader.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        // "your opponent's cards", unqualified: Leader, Characters, Stage and DON!! alike. The
        // codebase is unanimous on this zone list for that exact printed phrase --
        // OP13/characters/033-franky.ts, OP14EB04/characters/024-kin-emon.ts,
        // OP14EB04/characters/029-tashigi.ts, EB03/characters/032-charlotte-flampe.ts.
        actions: [
          {
            action: "rest",
            target: {
              player: "opponent",
              zones: ["leader", "character", "stage", "costArea"],
              count: { amount: 1, upTo: true },
            },
          },
        ],
      },
      {
        // Ruling #985: resting nothing does NOT stop the "Then, you may trash..." half (可以),
        // so it is a second block rather than a `thenActions` hanging off the rest. Two blocks
        // on one trigger with a cost on the second is the OP05/events/038-charlestone.ts shape,
        // which prints the same "Then, you may trash 1 card from your hand. If you do, ..."
        // wording. The "if you do" is the cost, not a condition: no trash, no DON!!.
        trigger: "onPlay",
        costs: [{ cost: "trashFromHand", amount: 1 }],
        actions: [
          {
            action: "giveDon",
            target: { player: "self", zones: ["leader"], count: { amount: 1 } },
            count: { amount: 3, upTo: true },
            donState: "rested",
          },
        ],
        optional: true,
      },
    ],
  },
  i18n: op16RoronoaZoro035I18n,
};
