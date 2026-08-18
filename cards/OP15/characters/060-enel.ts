import type { CharacterCard } from "@tcg/op-types";
import { op15Enel060I18n } from "./060-enel.i18n.ts";

export const op15Enel060: CharacterCard = {
  id: "OP15-060",
  canonicalId: "OP15-060",
  slug: "enel/op15-060",
  name: "Enel",
  printings: [
    {
      id: "OP15-060",
      artId: "OP15-060",
      setCode: "OP15",
      collectorNumber: "060",
      rarity: "SR",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-060.png",
    },
  ],
  cardType: "character",
  color: ["purple"],
  rarity: "SR",
  setId: "OP15",
  cost: 6,
  power: 8000,
  traits: ["Sky Island"],
  attribute: "special",
  effect:
    "If you have 6 or less DON!! cards on your field, this Character cannot be removed from the field by your opponent's effects and gains +2000 power.\n[Activate: Main] DON!! -1: This Character gains [Blocker] until the end of your opponent's next End Phase. Then, trash 1 card from your hand.",
  effects: {
    effects: [
      {
        trigger: "activateMain",
        costs: [{ cost: "returnDon", amount: 1 }],
        actions: [
          {
            action: "grantKeyword",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            keyword: "blocker",
            duration: "untilEndOfOpponentNextEndPhase",
          },
          // Ruling #904: with an EMPTY hand this activation still grants [Blocker] (可以). So the
          // trash is an ACTION, not a cost -- a `trashFromHand` cost would make `canPayCosts` fail
          // and suppress the activation entirely. The action no-ops on an empty hand
          // (effects/actions.ts returns true at `maximum === 0`), which is exactly the ruling.
          { action: "trashFromHand", player: "self", amount: 1 },
        ],
      },
    ],
    permanentEffects: [
      {
        // `donFieldCount` counts DON!! wherever they sit -- active + rested + every attachment --
        // so paying this Character's own 6-cost does not change it: 6 DON!! on the field still
        // reads 6 after he is played.
        conditions: [{ condition: "donFieldCount", player: "self", comparison: "lte", value: 6 }],
        actions: [
          {
            action: "cannotBeRemoved",
            target: { player: "self", zones: ["field"], count: { amount: 1 }, self: true },
            duration: "permanent",
            bySource: "opponentEffect",
          },
          {
            // A permanent `modifyPower` is silently ignored unless its target is `self: true` or
            // `count.amount: "all"` (getPermanentModifierTotal, effects/permanent.ts).
            action: "modifyPower",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            value: 2000,
            duration: "permanent",
          },
        ],
      },
    ],
  },
  i18n: op15Enel060I18n,
};
