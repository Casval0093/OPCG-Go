import type { CharacterCard } from "@tcg/op-types";
import { op15Holly071I18n } from "./071-holly.i18n.ts";

export const op15Holly071: CharacterCard = {
  id: "OP15-071",
  canonicalId: "OP15-071",
  slug: "holly/op15-071",
  name: "Holly",
  printings: [
    {
      id: "OP15-071",
      artId: "OP15-071",
      setCode: "OP15",
      collectorNumber: "071",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-071.png",
    },
  ],
  cardType: "character",
  color: ["purple"],
  rarity: "C",
  setId: "OP15",
  cost: 3,
  power: 4000,
  counter: 1000,
  traits: ["Animal", "Sky Island"],
  attribute: "strike",
  effect:
    "All of your [Ohm] cards and this Character gain [Double Attack].\n(This card deals 2 damage.)\n[Opponent's Turn] All of your [Ohm] cards' base power and this Character's base power become 6000.",
  effects: {
    permanentEffects: [
      {
        actions: [
          {
            // See OP15-070 Fuza for the two-action shape and why `count.amount: "all"` is
            // required on the non-self half.
            action: "grantKeyword",
            target: {
              player: "self",
              zones: ["leader", "character"],
              count: { amount: "all" },
              filters: [{ filter: "name", value: "Ohm" }],
            },
            keyword: "doubleAttack",
            duration: "permanent",
          },
          {
            action: "grantKeyword",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            keyword: "doubleAttack",
            duration: "permanent",
          },
        ],
      },
      {
        // The exact twin of OP15-070 Fuza's second block -- see that card for why the clause needs
        // `setBasePower` rather than `setPower`, and why it takes two actions. Ruling #910 is the
        // twin of #909: a Leader carrying every card name reaches base power 6000 through this, so
        // the first target spans the leader zone.
        conditions: [{ condition: "turn", value: "opponent" }],
        actions: [
          {
            action: "setBasePower",
            target: {
              player: "self",
              zones: ["leader", "character"],
              count: { amount: "all" },
              filters: [{ filter: "name", value: "Ohm" }],
            },
            value: 6000,
            duration: "permanent",
          },
          {
            action: "setBasePower",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            value: 6000,
            duration: "permanent",
          },
        ],
      },
    ],
  },
  i18n: op15Holly071I18n,
};
