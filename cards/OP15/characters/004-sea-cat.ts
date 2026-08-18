import type { CharacterCard } from "@tcg/op-types";
import { op15SeaCat004I18n } from "./004-sea-cat.i18n.ts";

export const op15SeaCat004: CharacterCard = {
  id: "OP15-004",
  canonicalId: "OP15-004",
  slug: "sea-cat/op15-004",
  name: "Sea Cat",
  printings: [
    {
      id: "OP15-004",
      artId: "OP15-004",
      setCode: "OP15",
      collectorNumber: "004",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-004.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "C",
  setId: "OP15",
  cost: 1,
  power: 0,
  counter: 1000,
  traits: ["Animal", "Alabasta"],
  attribute: "wisdom",
  effect:
    "[On Play] If your Leader has 0 power or less, give up to 1 of your opponent's Characters -3000 power during this turn.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        // A LEADING "If ..." gates the whole block, so the check sits in `conditions` rather than
        // on the action (the Task 4 lesson, rulings #899/#944). GENERAL ruling #4 is what makes it
        // a live condition rather than a dead letter: a card whose power drops to 0 or below STAYS
        // on the field, so a Leader really can sit at 0-or-less power and still be your Leader.
        // Shape from OP05/characters/009-toh-toh.ts, which prints this identical clause -- a
        // `hasCard` over `zone: "leader"` carrying a power filter, because no Condition reads the
        // Leader's power directly (`cardState` only ever addresses "this").
        conditions: [
          {
            condition: "hasCard",
            player: "self",
            zone: "leader",
            // 力量 -- current power, not 原本的力量. The clause only ever fires on a Leader that has
            // been debuffed below zero, so reading printed power here would make it dead.
            filters: [{ filter: "power", comparison: "lte", value: 0 }],
          },
        ],
        actions: [
          {
            action: "modifyPower",
            target: {
              player: "opponent",
              zones: ["character"],
              count: { amount: 1, upTo: true },
            },
            value: -3000,
            duration: "thisTurn",
          },
        ],
      },
    ],
  },
  i18n: op15SeaCat004I18n,
};
