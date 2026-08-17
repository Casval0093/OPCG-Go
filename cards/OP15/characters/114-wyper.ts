import type { CharacterCard } from "@tcg/op-types";
import { op15Wyper114I18n } from "./114-wyper.i18n.ts";

export const op15Wyper114: CharacterCard = {
  id: "OP15-114",
  canonicalId: "OP15-114",
  slug: "wyper/op15-114",
  name: "Wyper",
  printings: [
    {
      id: "OP15-114",
      artId: "OP15-114",
      setCode: "OP15",
      collectorNumber: "114",
      rarity: "SR",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-114.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "SR",
  setId: "OP15",
  cost: 5,
  power: 6000,
  counter: 1000,
  traits: ["Sky Island", "Shandian Warrior"],
  attribute: "ranged",
  effect:
    "[On Play] You may turn 1 card from the top of your Life cards face-up: Give all of your opponent's Characters -2000 power during this turn. Then, K.O. all of your opponent's Characters with 0 power or less.\n[Activate: Main] [Once Per Turn] Give up to 1 rested DON!! card to 1 of your [Sky Island] type Leader or Character cards.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        // The mirror image of OP15-099 Urouge's cost: `faceUp: true` turns the top Life card
        // face-UP, so ruling #942's two failure cases (top Life card ALREADY face-up, or 0 Life
        // cards -> 不可以) are the two branches `canPayCosts` already rejects. No condition.
        costs: [{ cost: "turnLifeFaceUp", count: 1, faceUp: true }],
        actions: [
          {
            action: "modifyPower",
            target: { player: "opponent", zones: ["character"], count: { amount: "all" } },
            value: -2000,
            duration: "thisTurn",
          },
          {
            action: "ko",
            target: {
              player: "opponent",
              zones: ["character"],
              count: { amount: "all" },
              // GENERAL ruling #4: a Character reduced to 0 or less power stays on the field on
              // its own, so this K.O. is a separate printed action rather than a consequence of
              // the debuff -- and `lte 0` includes exactly-0, which is what a 2000-power body
              // becomes.
              filters: [{ filter: "power", comparison: "lte", value: 0 }],
            },
          },
        ],
        optional: true,
      },
      {
        // No "may" and no cost: the [Once Per Turn] is the only limit. Same target shape as
        // OP15-117 Heso's identical printed sentence.
        trigger: "activateMain",
        actions: [
          {
            action: "giveDon",
            target: {
              player: "self",
              zones: ["leader", "character"],
              count: { amount: 1 },
              filters: [{ filter: "trait", value: "Sky Island", match: "includes" }],
            },
            count: { amount: 1, upTo: true },
            donState: "rested",
          },
        ],
        oncePerTurn: true,
      },
    ],
  },
  i18n: op15Wyper114I18n,
};
