import type { EventCard } from "@tcg/op-types";
import { op15JustWatchMeAce021I18n } from "./021-just-watch-me-ace.i18n.ts";

export const op15JustWatchMeAce021: EventCard = {
  id: "OP15-021",
  canonicalId: "OP15-021",
  slug: "just-watch-me-ace/op15-021",
  name: "Just Watch Me, Ace!!!",
  printings: [
    {
      id: "OP15-021",
      artId: "OP15-021",
      setCode: "OP15",
      collectorNumber: "021",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-021.png",
    },
  ],
  cardType: "event",
  color: ["red"],
  rarity: "UC",
  setId: "OP15",
  cost: 4,
  traits: ["Dressrosa", "Revolutionary Army"],
  effect:
    "If you have 4 or more Events in your trash, give this card in your hand -3 cost.\n[Main]/[Counter] Give up to 1 of your opponent's Characters -3000 power during this turn.",
  effects: {
    permanentEffects: [
      {
        // Ruling #877: 3 Events in the trash is NOT enough (不可以) -- `gte 4` exactly as printed.
        // Note this counts the trash while the card is still in HAND, so unlike OP15-095/OP15-097
        // the card itself is not part of the count.
        conditions: [
          {
            condition: "zoneCount",
            player: "self",
            zone: "trash",
            comparison: "gte",
            value: 4,
            filters: [{ filter: "cardCategory", value: "event" }],
          },
        ],
        actions: [
          {
            action: "modifyCost",
            target: { player: "self", zones: ["hand"], count: { amount: 1 }, self: true },
            value: -3,
            duration: "permanent",
          },
        ],
      },
    ],
    // [Main] / [Counter] is two blocks with identical actions -- there is no combined trigger.
    // Modeled on OP03/events/017-cross-fire.ts.
    effects: [
      {
        trigger: "main",
        actions: [
          {
            action: "modifyPower",
            target: { player: "opponent", zones: ["character"], count: { amount: 1, upTo: true } },
            value: -3000,
            duration: "thisTurn",
          },
        ],
      },
      {
        trigger: "counter",
        actions: [
          {
            action: "modifyPower",
            target: { player: "opponent", zones: ["character"], count: { amount: 1, upTo: true } },
            value: -3000,
            duration: "thisTurn",
          },
        ],
      },
    ],
  },
  i18n: op15JustWatchMeAce021I18n,
};
