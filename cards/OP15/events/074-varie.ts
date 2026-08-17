import type { EventCard } from "@tcg/op-types";
import { op15Varie074I18n } from "./074-varie.i18n.ts";

export const op15Varie074: EventCard = {
  id: "OP15-074",
  canonicalId: "OP15-074",
  slug: "varie/op15-074",
  name: "Varie",
  printings: [
    {
      id: "OP15-074",
      artId: "OP15-074",
      setCode: "OP15",
      collectorNumber: "074",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-074.png",
    },
  ],
  cardType: "event",
  color: ["purple"],
  rarity: "UC",
  setId: "OP15",
  cost: 0,
  traits: ["Sky Island"],
  effect:
    "[Main] DON!! -1: If your Leader is [Enel], draw 1 card. Then, up to 1 of your Characters gains +2 cost until the end of your opponent's next End Phase.\n[Counter] Up to 1 of your [Enel] cards gains +2000 power during this battle.",
  effects: {
    effects: [
      {
        trigger: "main",
        // "DON!! -1:" is a `returnDon` cost. The leading "If your Leader is [Enel]" gates the whole
        // block: rulings #913/#914/#915 all confirm you may pay the cost and take the FIRST part even
        // when the "Then" part has no legal target (0 Characters on either field), which is GENERAL
        // ruling #27 -- so the missing target must not abort the block, but a non-Enel Leader does.
        conditions: [{ condition: "leaderName", name: "Enel" }],
        costs: [{ cost: "returnDon", amount: 1 }],
        actions: [
          { action: "draw", player: "self", amount: 1 },
          {
            action: "modifyCost",
            target: { player: "self", zones: ["character"], count: { amount: 1, upTo: true } },
            value: 2,
            duration: "untilEndOfOpponentNextEndPhase",
          },
        ],
      },
      {
        trigger: "counter",
        actions: [
          {
            action: "modifyPower",
            target: {
              player: "self",
              zones: ["leader", "character"],
              count: { amount: 1, upTo: true },
              filters: [{ filter: "name", value: "Enel" }],
            },
            value: 2000,
            duration: "thisBattle",
          },
        ],
      },
    ],
  },
  i18n: op15Varie074I18n,
};
