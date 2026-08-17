import type { CharacterCard } from "@tcg/op-types";
import { op16Kuzan063I18n } from "./063-kuzan.i18n.ts";

export const op16Kuzan063: CharacterCard = {
  id: "OP16-063",
  canonicalId: "OP16-063",
  slug: "kuzan/op16-063",
  name: "Kuzan",
  printings: [
    {
      id: "OP16-063",
      artId: "OP16-063",
      setCode: "OP16",
      collectorNumber: "063",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-063.png",
    },
  ],
  cardType: "character",
  color: ["purple"],
  rarity: "R",
  setId: "OP16",
  cost: 7,
  power: 8000,
  traits: ["Admiral", "Navy"],
  attribute: "special",
  effect:
    "[On Play] Add up to 2 DON!! cards from your DON!! deck and rest them.\n[Activate: Main] [Once Per Turn] DON!! -1: Up to 1 of your opponent's Characters cannot activate [Blocker] during this turn.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        actions: [{ action: "addDon", count: { amount: 2, upTo: true }, state: "rested" }],
      },
      {
        // "DON!! -1:" is `cost: "returnDon"` (OP06-062 Vinsmoke Judge, same trigger, same cost).
        // Ruling #996 forbids a `hasKeyword: "blocker"` filter or `requiresKeyword: true` here:
        // an opponent Character WITHOUT [Blocker] is an explicitly legal target (可以), and the
        // suppression still binds if that Character gains [Blocker] later in the same turn.
        trigger: "activateMain",
        costs: [{ cost: "returnDon", amount: 1 }],
        actions: [
          {
            action: "cannotActivate",
            target: {
              player: "opponent",
              zones: ["character"],
              count: { amount: 1, upTo: true },
            },
            keyword: "blocker",
            duration: "thisTurn",
          },
        ],
        oncePerTurn: true,
      },
    ],
  },
  i18n: op16Kuzan063I18n,
};
