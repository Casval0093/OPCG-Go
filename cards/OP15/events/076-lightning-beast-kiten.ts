import type { EventCard } from "@tcg/op-types";
import { op15LightningBeastKiten076I18n } from "./076-lightning-beast-kiten.i18n.ts";

export const op15LightningBeastKiten076: EventCard = {
  id: "OP15-076",
  canonicalId: "OP15-076",
  slug: "lightning-beast-kiten/op15-076",
  name: "Lightning Beast Kiten",
  printings: [
    {
      id: "OP15-076",
      artId: "OP15-076",
      setCode: "OP15",
      collectorNumber: "076",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-076.png",
    },
  ],
  cardType: "event",
  color: ["purple"],
  rarity: "UC",
  setId: "OP15",
  cost: 0,
  traits: ["Sky Island"],
  effect:
    "[Main] DON!! -1: If your Leader is [Enel], draw 1 card. Then, give up to 1 of your opponent's Characters -1000 power during this turn.\n[Counter] Up to 1 of your [Enel] cards gains +2000 power during this battle.",
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
            action: "modifyPower",
            target: { player: "opponent", zones: ["character"], count: { amount: 1, upTo: true } },
            value: -1000,
            duration: "thisTurn",
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
  i18n: op15LightningBeastKiten076I18n,
};
