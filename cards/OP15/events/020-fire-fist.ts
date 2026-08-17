import type { EventCard } from "@tcg/op-types";
import { op15FireFist020I18n } from "./020-fire-fist.i18n.ts";

export const op15FireFist020: EventCard = {
  id: "OP15-020",
  canonicalId: "OP15-020",
  slug: "fire-fist/op15-020",
  name: "Fire Fist",
  printings: [
    {
      id: "OP15-020",
      artId: "OP15-020",
      setCode: "OP15",
      collectorNumber: "020",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-020.png",
    },
  ],
  cardType: "event",
  color: ["red"],
  rarity: "R",
  setId: "OP15",
  cost: 7,
  traits: ["Dressrosa", "Revolutionary Army"],
  effect:
    "[Main] Your Leader gains +3000 power during this turn and give up to 1 of your opponent's Characters -8000 power until the end of your opponent's next End Phase. Then, you may trash 2 cards from your hand. If you do, K.O. up to 1 of your opponent's Characters with 0 power or less.",
  effects: {
    effects: [
      {
        trigger: "main",
        actions: [
          {
            action: "modifyPower",
            target: { player: "self", zones: ["leader"], count: { amount: 1 } },
            value: 3000,
            duration: "thisTurn",
          },
          {
            action: "modifyPower",
            target: { player: "opponent", zones: ["character"], count: { amount: 1, upTo: true } },
            value: -8000,
            duration: "untilEndOfOpponentNextEndPhase",
          },
          {
            // "Then, you may trash 2 cards from your hand. If you do, K.O. ..." -- the trash and the
            // K.O. are wrapped together in one `optional`, so declining skips both. Ruling #876
            // describes the boundary case this encoding does NOT reproduce: with only 1 card in hand
            // you may still trash that 1 card, but the K.O. must not happen. See the test file.
            action: "optional",
            actions: [
              { action: "trashFromHand", player: "self", amount: 2 },
              {
                action: "ko",
                target: {
                  player: "opponent",
                  zones: ["character"],
                  count: { amount: 1, upTo: true },
                  // "0 power or less" -- GENERAL ruling #4 confirms a Character whose power drops to
                  // 0 or below STAYS on the field, which is the whole reason this clause exists: the
                  // -8000 above is what creates the target.
                  filters: [{ filter: "power", comparison: "lte", value: 0 }],
                },
              },
            ],
          },
        ],
      },
    ],
  },
  i18n: op15FireFist020I18n,
};
