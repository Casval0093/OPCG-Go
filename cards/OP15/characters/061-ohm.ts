import type { CharacterCard } from "@tcg/op-types";
import { op15Ohm061I18n } from "./061-ohm.i18n.ts";

export const op15Ohm061: CharacterCard = {
  id: "OP15-061",
  canonicalId: "OP15-061",
  slug: "ohm/op15-061",
  name: "Ohm",
  printings: [
    {
      id: "OP15-061",
      artId: "OP15-061",
      setCode: "OP15",
      collectorNumber: "061",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-061.png",
    },
  ],
  cardType: "character",
  color: ["purple"],
  rarity: "R",
  setId: "OP15",
  cost: 1,
  power: 2000,
  counter: 1000,
  traits: ["Sky Island", "Vassals"],
  attribute: "slash",
  effect:
    "[On Play] DON!! -1: Draw 1 card.\n[When Attacking] If you have 6 or less DON!! cards on your field, give up to 1 of your opponent's Characters -1000 power during this turn.",
  effects: {
    effects: [
      {
        // `optional: true` is load-bearing on a triggered block carrying a cost: costs on a
        // mandatory block are paid automatically (effects/resolution.ts), and GENERAL ruling #12
        // says an [On Play] with a cost may be declined by declining the payment.
        trigger: "onPlay",
        costs: [{ cost: "returnDon", amount: 1 }],
        actions: [{ action: "draw", player: "self", amount: 1 }],
        optional: true,
      },
      {
        // The "If you have 6 or less DON!!" LEADS the sentence, so it gates the whole block --
        // no prompt at all above the line. Contrast the post-colon placement on OP16-065/070.
        trigger: "whenAttacking",
        conditions: [{ condition: "donFieldCount", player: "self", comparison: "lte", value: 6 }],
        actions: [
          {
            action: "modifyPower",
            target: { player: "opponent", zones: ["character"], count: { amount: 1, upTo: true } },
            value: -1000,
            duration: "thisTurn",
          },
        ],
      },
    ],
  },
  i18n: op15Ohm061I18n,
};
