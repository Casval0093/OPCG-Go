import type { CharacterCard } from "@tcg/op-types";
import { op16MonkeyDLuffy015I18n } from "./015-monkey-d-luffy.i18n.ts";

export const op16MonkeyDLuffy015: CharacterCard = {
  id: "OP16-015",
  canonicalId: "OP16-015",
  slug: "monkey-d-luffy/op16-015",
  name: "Monkey.D.Luffy",
  printings: [
    {
      id: "OP16-015",
      artId: "OP16-015",
      setCode: "OP16",
      collectorNumber: "015",
      rarity: "SR",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-015.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "SR",
  setId: "OP16",
  cost: 4,
  power: 6000,
  traits: ["Impel Down", "Straw Hat Crew"],
  attribute: "strike",
  effect:
    "If your Leader's card name includes \"Ace\" and you have 6 or more DON!! cards on your field, give this card in your hand -2 cost.\n[On Your Opponent's Attack] You may trash 1 Character card with 8000 power from your hand: Your Leader and this Character's base power becomes 7000 during this turn.",
  // PARKED -- the cost-reduction clause ("If your Leader's card name includes \"Ace\" and you have
  // 6 or more DON!! cards on your field, give this card in your hand -2 cost") is NOT encoded. It
  // needs `nameIncludesMatch` (data/parked-clauses.json): `leaderName` is exact array membership
  // and the `name` TargetFilter is exact too, neither carrying the `match` option LeaderTraitCondition
  // has. The tempting narrowing is actively WRONG rather than merely imprecise -- `leaderName:
  // "Portgas.D.Ace"` would miss "Ace & Sabo & Luffy", a real card name that includes "Ace". The
  // [On Your Opponent's Attack] clause below IS encoded.
  effects: {
    effects: [
      {
        // Shape copied from OP12-008 Shanks, which prints the same
        // "[On Your Opponent's Attack] You may trash 1 card from your hand: ..." sentence. No
        // [Once Per Turn] here, unlike Shanks -- this card does not print one.
        trigger: "onOpponentAttack",
        costs: [
          {
            cost: "trashFromHand",
            amount: 1,
            filters: [
              { filter: "cardCategory", value: "character" },
              // Ruling #972: "a Character card with 8000 power" means EXACTLY 8000 -- neither
              // 7000-or-less nor 9000-or-more qualifies (不, 是指力量刚好为8000的角色卡牌). `eq`,
              // not `gte`, the same reading rulings #962/#963 pin on OP16-002/OP16-003.
              { filter: "power", comparison: "eq", value: 8000 },
            ],
          },
        ],
        actions: [
          {
            // "Your Leader and this Character's base power becomes 7000" -- two targets, so two
            // actions, because no filter expresses "is the source card" to OR into the first.
            // Both land on 7000 from different printed bases (this Character is 6000), which is
            // exactly what a literal base-power set is for and what no single `modifyPower` value
            // could express.
            action: "setBasePower",
            target: { player: "self", zones: ["leader"], count: { amount: 1 } },
            value: 7000,
            duration: "thisTurn",
          },
          {
            action: "setBasePower",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            value: 7000,
            duration: "thisTurn",
          },
        ],
        // "You may trash ...": the cost is declinable, so the whole ability is optional.
        optional: true,
      },
    ],
  },
  i18n: op16MonkeyDLuffy015I18n,
};
