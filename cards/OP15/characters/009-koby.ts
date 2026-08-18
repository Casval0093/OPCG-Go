import type { CharacterCard } from "@tcg/op-types";
import { op15Koby009I18n } from "./009-koby.i18n.ts";

export const op15Koby009: CharacterCard = {
  id: "OP15-009",
  canonicalId: "OP15-009",
  slug: "koby/op15-009",
  name: "Koby",
  printings: [
    {
      id: "OP15-009",
      artId: "OP15-009",
      setCode: "OP15",
      collectorNumber: "009",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-009.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "UC",
  setId: "OP15",
  cost: 1,
  power: 2000,
  counter: 2000,
  traits: ["East Blue", "Navy"],
  attribute: "strike",
  effect:
    "If your Character with 7000 base power or less would be removed from the field by your opponent's effect, you may give your Leader -2000 power during this turn instead.",
  effects: {
    replacementEffects: [
      {
        // SC: 我方原本的力量不高于7000的角色因对方的效果将要离开场上的场合. Two readings turn on that
        // sentence and both are load-bearing.
        //
        // 因对方的**效果** names the cause explicitly, so this is NOT the cause-agnostic wording
        // that forced `leaveField` on OP15-098 -- a battle K.O. must not be replaceable here.
        // `removeFromField` is searched by findKoReplacement only when koCause is "effect", and by
        // findRemoveFromFieldReplacement for non-K.O. departures (bounce, deck, trash), which is
        // exactly the span 离开场上 needs. Shape from OP16/characters/014-marco.ts.
        replacedEvent: "removeFromField",
        source: "opponentEffect",
        // 原本的力量不高于7000 -- `basePower`, not `power`. A 7000-base body pumped past 7000 still
        // qualifies, and a 9000-base body debuffed to 5000 still does not. `mutation_check.py` has
        // no operator that swaps the two filters, so this distinction is pinned by hand in the test.
        //
        // NO `excludeSelf` and no `targetSelf`: ruling #860 says Koby itself (2000 base) may be the
        // Character saved (可以), and the printed "your Character" is not restricted to others --
        // the same trap OP16-045/OP16-050 document from the opposite direction.
        target: {
          player: "self",
          zones: ["character"],
          count: { amount: 1 },
          filters: [{ filter: "basePower", comparison: "lte", value: 7000 }],
        },
        replacementAction: {
          action: "modifyPower",
          target: {
            player: "self",
            zones: ["leader"],
            count: { amount: 1 },
          },
          value: -2000,
          duration: "thisTurn",
        },
      },
    ],
  },
  i18n: op15Koby009I18n,
};
