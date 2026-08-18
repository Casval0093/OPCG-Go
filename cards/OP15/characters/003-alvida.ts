import type { CharacterCard } from "@tcg/op-types";
import { op15Alvida003I18n } from "./003-alvida.i18n.ts";

export const op15Alvida003: CharacterCard = {
  id: "OP15-003",
  canonicalId: "OP15-003",
  slug: "alvida/op15-003",
  name: "Alvida",
  printings: [
    {
      id: "OP15-003",
      artId: "OP15-003",
      setCode: "OP15",
      collectorNumber: "003",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-003.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "R",
  setId: "OP15",
  cost: 5,
  power: 6000,
  counter: 1000,
  traits: ["East Blue", "Alvida Pirates"],
  attribute: "strike",
  effect:
    "If this Character would be K.O.'d, you may trash 1 Character card with a power of 6000 or less from your hand instead.\n[Activate: Main] [Once Per Turn] You may give 1 of your opponent's rested DON!! cards to 1 of your opponent's Characters: Give up to 1 rested DON!! card to its owner's Leader or 1 of their Characters.",
  // PARKED -- the whole [Activate: Main] clause (both its cost, "you may give 1 of your opponent's
  // rested DON!! cards to 1 of your opponent's Characters", and its payload, "give up to 1 rested
  // DON!! card to its owner's Leader or 1 of their Characters") is NOT encoded below. `giveDon`
  // (effects/actions.ts) always draws the DON!! from `getPlayer(state, controller)` -- the effect
  // controller's own cost area -- and `GiveDonAction` carries no source-player field; the `giveDon`
  // COST is hardwired further still, to "give N of your own ACTIVE DON!! to 1 of your own Leader or
  // Character" (effects/resolution.ts). Widening `target.player` to "any" would be wrong rather
  // than merely approximate: rulings #856/#864 say giving YOUR DON!! to an opponent's card, or
  // theirs to yours, is explicitly illegal (不能), while #854 says both same-side directions are
  // legal -- so the DON!! source must FOLLOW the chosen target's controller, which is strictly
  // stronger than any fixed player. Ruling #855 additionally pins that the ACTIVATING player picks
  // which of the opponent's rested DON!! moves, and #857 that with 0 opponent Characters or no
  // opponent rested DON!! the ability cannot be activated at all -- the cost is a real cost. The
  // same gap parks clauses on OP15-008, OP15-010, OP15-012, OP15-015 and OP15-017.
  effects: {
    replacementEffects: [
      {
        // 将要被KO names no cause, so it has to cover both. `replacedEvent: "ko"` is the one value
        // findKoReplacement (effects/replacements.ts) searches for BOTH a battle K.O. and an effect
        // K.O.; `removeFromField` would silently do nothing in battle (the OP15-098 lesson). Shape
        // from OP16/characters/018-rockstar.ts and OP16/characters/033-morley.ts.
        replacedEvent: "ko",
        eventFilter: { targetSelf: true },
        replacementAction: {
          action: "trashFromHand",
          player: "self",
          amount: 1,
          // 力量不高于6000 -- plain 力量, so `power` (current) rather than `basePower`.
          // `cardCategory` is load-bearing next to a power filter only because a LEADER card could
          // otherwise match: basePower() (shared.ts) already hard-zeroes Events and Stages.
          filters: [
            { filter: "cardCategory", value: "character" },
            { filter: "power", comparison: "lte", value: 6000 },
          ],
        },
      },
    ],
  },
  i18n: op15Alvida003I18n,
};
