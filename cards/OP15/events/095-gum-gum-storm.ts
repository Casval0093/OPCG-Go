import type { EventCard } from "@tcg/op-types";
import { op15GumGumStorm095I18n } from "./095-gum-gum-storm.i18n.ts";

export const op15GumGumStorm095: EventCard = {
  id: "OP15-095",
  canonicalId: "OP15-095",
  slug: "gum-gum-storm/op15-095",
  name: "Gum-Gum Storm",
  printings: [
    {
      id: "OP15-095",
      artId: "OP15-095",
      setCode: "OP15",
      collectorNumber: "095",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-095.png",
    },
  ],
  cardType: "event",
  color: ["black"],
  rarity: "UC",
  setId: "OP15",
  cost: 1,
  traits: ["Straw Hat Crew"],
  effect:
    "[Main] You may rest 1 of your DON!! cards: If you have 15 or more cards in your trash, up to 1 of your [Straw Hat Crew] type Leader or Character cards gains +3000 power during this turn.\n[Counter] If you have 15 or more cards in your trash, up to 1 of your Leader or Character cards gains +4000 power during this battle.",
  effects: {
    effects: [
      {
        trigger: "main",
        // Ruling #930 is the one to know here, and the engine reproduces it for free: with 14 cards
        // already in the trash this still works, because an Event is moved to the trash BEFORE its
        // enqueued [Main] resolves (engine/commands.ts calls enqueueEffectsForTrigger then moveCard,
        // and the effect resolves off the queue afterwards) -- so the card counts itself and the total
        // is 15. Do NOT "compensate" by encoding 14.
        costs: [{ cost: "restDon", amount: 1 }],
        optional: true,
        conditions: [
          { condition: "zoneCount", player: "self", zone: "trash", comparison: "gte", value: 15 },
        ],
        actions: [
          {
            action: "modifyPower",
            target: {
              player: "self",
              zones: ["leader", "character"],
              count: { amount: 1, upTo: true },
              filters: [{ filter: "trait", value: "Straw Hat Crew", match: "includes" }],
            },
            value: 3000,
            duration: "thisTurn",
          },
        ],
      },
      {
        trigger: "counter",
        // The [Counter] half has no trait filter and no DON!! cost -- any Leader or Character.
        conditions: [
          { condition: "zoneCount", player: "self", zone: "trash", comparison: "gte", value: 15 },
        ],
        actions: [
          {
            action: "modifyPower",
            target: {
              player: "self",
              zones: ["leader", "character"],
              count: { amount: 1, upTo: true },
            },
            value: 4000,
            duration: "thisBattle",
          },
        ],
      },
    ],
  },
  i18n: op15GumGumStorm095I18n,
};
