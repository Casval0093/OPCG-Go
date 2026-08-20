import type { CharacterCard } from "@tcg/op-types";
import { op15MonkeyDLuffy092I18n } from "./092-monkey-d-luffy.i18n.ts";

export const op15MonkeyDLuffy092: CharacterCard = {
  id: "OP15-092",
  canonicalId: "OP15-092",
  slug: "monkey-d-luffy/op15-092",
  name: "Monkey.D.Luffy",
  printings: [
    {
      id: "OP15-092",
      artId: "OP15-092",
      setCode: "OP15",
      collectorNumber: "092",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-092.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "R",
  setId: "OP15",
  cost: 7,
  power: 7000,
  counter: 1000,
  traits: ["Straw Hat Crew"],
  attribute: "special",
  effect:
    "Apply each of the following effects based on the number of cards in your trash:\n• If there are 10 or more cards, this Character's base power becomes 9000 and it gains +10 cost.\n• If you have 20 or more cards, during your opponent's turn, your Leader's base power becomes 7000.\n• If you have 30 or more cards, this Character gains +1000 power.",
  // Three independent thresholds, all three cumulative. Ruling #927 is the specification and it is
  // the reason the base-power bullets need `setBasePower` rather than `setPower`: at 30 cards in
  // the trash ALL THREE bullets apply at once (三条效果全部适用), so bullet 1's base 9000 and
  // bullet 3's +1000 must STACK to 10000. `setPower` sets TOTAL power -- it computes
  // `value - getCardPower(target)` at resolution -- so it would clamp the sum back to 9000.
  // `setPower` is doubly unusable here: the permanent power path reads only `modifyPower` and the
  // two base-power setters, so a `setPower` written inside `permanentEffects` is never read at all.
  effects: {
    permanentEffects: [
      {
        conditions: [
          { condition: "zoneCount", player: "self", zone: "trash", comparison: "gte", value: 10 },
        ],
        actions: [
          {
            // Bullet 1, first half: "this Character's base power becomes 9000".
            action: "setBasePower",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            value: 9000,
            duration: "permanent",
          },
          {
            action: "modifyCost",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            value: 10,
          },
        ],
      },
      {
        // Bullet 2: "If you have 20 or more cards, during your opponent's turn, your Leader's base
        // power becomes 7000." Two conditions, both required -- the trash threshold and the turn.
        // The target is the LEADER, so it cannot be `self`, and a permanent effect over a card
        // other than the source needs `count.amount: "all"` (getPermanentSetBasePower applies the
        // same guard getPermanentModifierTotal does). There is only ever one Leader, so "all" and
        // "1" describe the same card here.
        conditions: [
          { condition: "zoneCount", player: "self", zone: "trash", comparison: "gte", value: 20 },
          { condition: "turn", value: "opponent" },
        ],
        actions: [
          {
            action: "setBasePower",
            target: { player: "self", zones: ["leader"], count: { amount: "all" } },
            value: 7000,
            duration: "permanent",
          },
        ],
      },
      {
        // A separate block, not a second action on the first: ruling #927 says the bullets are
        // independent thresholds that all apply once passed, not exclusive tiers.
        conditions: [
          { condition: "zoneCount", player: "self", zone: "trash", comparison: "gte", value: 30 },
        ],
        actions: [
          {
            action: "modifyPower",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            value: 1000,
            duration: "permanent",
          },
        ],
      },
    ],
  },
  i18n: op15MonkeyDLuffy092I18n,
};
