import type { EventCard } from "@tcg/op-types";
import { op16Mahoroba101I18n } from "./101-mahoroba.i18n.ts";

export const op16Mahoroba101: EventCard = {
  id: "OP16-101",
  canonicalId: "OP16-101",
  slug: "mahoroba/op16-101",
  name: "Mahoroba",
  printings: [
    {
      id: "OP16-101",
      artId: "OP16-101",
      setCode: "OP16",
      collectorNumber: "101",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-101.png",
    },
  ],
  cardType: "event",
  color: ["black"],
  rarity: "C",
  setId: "OP16",
  cost: 2,
  trigger: "Add up to 1 [Yamato] from your trash to your hand.",
  traits: ["Land of Wano"],
  effect:
    "[Main] Up to 1 of your Leader or Character cards gains +3000 power during this turn. Then, if you have 10 or more cards in your trash, K.O. up to 1 of your opponent's Characters with a cost of 2 or less.",
  effects: {
    effects: [
      {
        trigger: "main",
        actions: [
          {
            action: "modifyPower",
            target: {
              player: "self",
              zones: ["leader", "character"],
              count: { amount: 1, upTo: true },
            },
            value: 3000,
            duration: "thisTurn",
          },
          {
            action: "ko",
            target: {
              player: "opponent",
              zones: ["character"],
              count: { amount: 1, upTo: true },
              filters: [{ filter: "cost", comparison: "lte", value: 2 }],
            },
            // Ruling #1010: an Event is already in its own trash when its [Main] resolves
            // (engine/commands.ts trashes it before the queued effect runs), so this card counts
            // ITSELF -- at 9 cards in trash beforehand the check passes (可以). Encode the printed
            // number, never printed-minus-one (cards/ENCODING.md, Task 4).
            condition: {
              condition: "zoneCount",
              player: "self",
              zone: "trash",
              comparison: "gte",
              value: 10,
            },
          },
        ],
      },
      {
        trigger: "trigger",
        actions: [
          {
            action: "returnToHand",
            target: {
              player: "self",
              zones: ["trash"],
              count: { amount: 1, upTo: true },
              filters: [{ filter: "name", value: "Yamato" }],
            },
          },
        ],
      },
    ],
  },
  i18n: op16Mahoroba101I18n,
};
