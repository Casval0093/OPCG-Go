import type { CharacterCard } from "@tcg/op-types";
import { op16Sakazuki065I18n } from "./065-sakazuki.i18n.ts";

export const op16Sakazuki065: CharacterCard = {
  id: "OP16-065",
  canonicalId: "OP16-065",
  slug: "sakazuki/op16-065",
  name: "Sakazuki",
  printings: [
    {
      id: "OP16-065",
      artId: "OP16-065",
      setCode: "OP16",
      collectorNumber: "065",
      rarity: "SR",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-065.png",
    },
  ],
  cardType: "character",
  color: ["purple"],
  rarity: "SR",
  setId: "OP16",
  cost: 7,
  power: 8000,
  traits: ["Admiral", "Navy"],
  attribute: "special",
  effect:
    "[On Play] DON!! -1: Give up to 1 of your opponent's Characters -6000 power until the end of your opponent's next End Phase.\n[Activate: Main] [Once Per Turn] You may rest 1 of your DON!! cards: If your Leader has the [Navy] type, add up to 2 DON!! cards from your DON!! deck and set them as active.",
  effects: {
    effects: [
      {
        // `optional: true` is load-bearing on a triggered block with a cost: costs on a mandatory
        // block are paid automatically (effects/resolution.ts), and GENERAL ruling #12 says an
        // [On Play] with a cost may be declined by declining the payment.
        trigger: "onPlay",
        costs: [{ cost: "returnDon", amount: 1 }],
        actions: [
          {
            action: "modifyPower",
            target: {
              player: "opponent",
              zones: ["character"],
              count: { amount: 1, upTo: true },
            },
            value: -6000,
            duration: "untilEndOfOpponentNextEndPhase",
          },
        ],
        optional: true,
      },
      {
        // The [Navy] check sits AFTER the cost colon, so it gates the payload, not the activation
        // — the cost may be paid with a non-Navy Leader and nothing happens. Same placement as
        // OP04-060 Crocodile, whose "DON!! -2: If your Leader's type includes ..." puts the
        // leaderTrait check on the action. Contrast a LEADING "If your Leader ..." (OP16-066,
        // OP16-075), which gates the whole block.
        trigger: "activateMain",
        costs: [{ cost: "restDon", amount: 1 }],
        actions: [
          {
            action: "addDon",
            count: { amount: 2, upTo: true },
            state: "active",
            condition: { condition: "leaderTrait", trait: "Navy", match: "includes" },
          },
        ],
        oncePerTurn: true,
      },
    ],
  },
  i18n: op16Sakazuki065I18n,
};
