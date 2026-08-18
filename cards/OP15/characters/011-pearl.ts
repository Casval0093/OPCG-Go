import type { CharacterCard } from "@tcg/op-types";
import { op15Pearl011I18n } from "./011-pearl.i18n.ts";

export const op15Pearl011: CharacterCard = {
  id: "OP15-011",
  canonicalId: "OP15-011",
  slug: "pearl/op15-011",
  name: "Pearl",
  printings: [
    {
      id: "OP15-011",
      artId: "OP15-011",
      setCode: "OP15",
      collectorNumber: "011",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-011.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "R",
  setId: "OP15",
  cost: 4,
  power: 4000,
  counter: 1000,
  traits: ["East Blue", "Krieg Pirates"],
  attribute: "strike",
  effect:
    "[Opponent's Turn] If your Leader has the [East Blue] type, this Character gains [Blocker] and +2000 power.\n[On K.O.] If your Leader has the [East Blue] type, K.O. up to 1 of your opponent's Characters with 6000 base power or less.",
  effects: {
    permanentEffects: [
      {
        // [Opponent's Turn] static grant. Shape copied wholesale from
        // OP12/characters/053-borsalino.ts, which prints the same "[Opponent's Turn] If your Leader
        // has the [X] type, this Character gains [Blocker] and +N power" sentence.
        conditions: [
          { condition: "turn", value: "opponent" },
          { condition: "leaderTrait", trait: "East Blue", match: "includes" },
        ],
        actions: [
          {
            action: "grantKeyword",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            keyword: "blocker",
            duration: "permanent",
          },
          {
            action: "modifyPower",
            // `self: true` is required, not stylistic: getPermanentModifierTotal
            // (effects/permanent.ts) drops any permanent modifier that is neither `self` nor
            // `count.amount: "all"`, silently and without a capability issue.
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            value: 2000,
            duration: "permanent",
          },
        ],
      },
    ],
    effects: [
      {
        trigger: "onKo",
        // The Leader check LEADS this sentence too, so it gates the whole block -- with a non-East
        // Blue Leader nothing is offered at all, rather than an empty selection.
        conditions: [{ condition: "leaderTrait", trait: "East Blue", match: "includes" }],
        actions: [
          {
            action: "ko",
            target: {
              player: "opponent",
              zones: ["character"],
              count: { amount: 1, upTo: true },
              // 6000 **base** power, printed explicitly -- `basePower`, so a 5000-base body pumped
              // to 8000 is still a legal target and a 7000-base body debuffed to 4000 is not.
              filters: [{ filter: "basePower", comparison: "lte", value: 6000 }],
            },
          },
        ],
      },
    ],
  },
  i18n: op15Pearl011I18n,
};
