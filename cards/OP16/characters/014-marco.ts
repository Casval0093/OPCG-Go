import type { CharacterCard } from "@tcg/op-types";
import { op16Marco014I18n } from "./014-marco.i18n.ts";

export const op16Marco014: CharacterCard = {
  id: "OP16-014",
  canonicalId: "OP16-014",
  slug: "marco/op16-014",
  name: "Marco",
  printings: [
    {
      id: "OP16-014",
      artId: "OP16-014",
      setCode: "OP16",
      collectorNumber: "014",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-014.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "R",
  setId: "OP16",
  cost: 6,
  power: 8000,
  traits: ["Whitebeard Pirates"],
  attribute: "special",
  effect:
    "If one of your Characters would be removed from the field by your opponent's effect, you may K.O. this Character instead.\n[On K.O.] You may trash 1 Character card with 8000 power from your hand: Play this Character card from your trash.",
  effects: {
    effects: [
      {
        trigger: "onKo",
        costs: [
          {
            // Ruling #970: same "exactly 8000" (`eq`, not `gte`) reading as ruling #962 on
            // Izo (OP16-002). See cards/tests/OP16/014-marco.test.ts.
            cost: "trashFromHand",
            amount: 1,
            filters: [
              { filter: "cardCategory", value: "character" },
              { filter: "power", comparison: "eq", value: 8000 },
            ],
          },
        ],
        actions: [
          {
            action: "play",
            source: {
              player: "self",
              zone: "trash",
            },
            count: {
              amount: 1,
            },
            self: true,
          },
        ],
        optional: true,
      },
    ],
    replacementEffects: [
      {
        // Protects ANY one of the controller's Characters (not just Marco itself, unlike
        // the `targetSelf: true` shape other Whitebeard cards use) at the cost of K.O.ing
        // Marco. Ruling #971 confirms that when Marco and another own Character would leave
        // the field simultaneously, this can be applied to save the OTHER card while Marco's
        // own removal proceeds unreplaced -- effects/replacements.ts already resolves that
        // per-event, per-source-card (see the report), so no card-specific logic is added
        // here for the simultaneous case.
        replacedEvent: "removeFromField",
        target: {
          player: "self",
          zones: ["character"],
          count: {
            amount: 1,
          },
        },
        source: "opponentEffect",
        replacementAction: {
          action: "ko",
          target: {
            player: "self",
            zones: ["character"],
            count: {
              amount: 1,
            },
            self: true,
          },
        },
      },
    ],
  },
  i18n: op16Marco014I18n,
};
