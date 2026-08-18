import type { CharacterCard } from "@tcg/op-types";
import { op15Nami086I18n } from "./086-nami.i18n.ts";

export const op15Nami086: CharacterCard = {
  id: "OP15-086",
  canonicalId: "OP15-086",
  slug: "nami/op15-086",
  name: "Nami",
  printings: [
    {
      id: "OP15-086",
      artId: "OP15-086",
      setCode: "OP15",
      collectorNumber: "086",
      rarity: "SR",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-086.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "SR",
  setId: "OP15",
  cost: 8,
  power: 6000,
  traits: ["Straw Hat Crew"],
  attribute: "special",
  effect:
    "[On Play] If your Leader has the [Straw Hat Crew] type, play up to 1 [Straw Hat Crew] type Character with a cost of 7 or less from your trash. The Character played with this effect gains [Rush] during this turn.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        conditions: [{ condition: "leaderTrait", trait: "Straw Hat Crew", match: "includes" }],
        actions: [
          {
            action: "play",
            source: { player: "self", zone: "trash" },
            count: { amount: 1, upTo: true },
            filters: [
              // `candidatesForPlayAction` pre-narrows every `play` pool to stage-or-character,
              // so this filter's only job is excluding Stages -- and there are cheap
              // [Straw Hat Crew] Stages (eb02MerryGo041, cost 1) for it to exclude.
              { filter: "cardCategory", value: "character" },
              { filter: "trait", value: "Straw Hat Crew", match: "includes" },
              { filter: "cost", comparison: "lte", value: 7 },
            ],
          },
          {
            // "The Character played WITH THIS EFFECT" -- bound to the preceding action's target,
            // not re-chosen. `previousActionTargets` is the binding; without it this becomes a
            // free choice among all own Characters. Shape from OP12-058.
            action: "grantKeyword",
            target: { player: "self", zones: ["character"], count: { amount: 1 } },
            keyword: "rush",
            duration: "thisTurn",
            previousActionTargets: true,
          },
        ],
      },
    ],
  },
  i18n: op15Nami086I18n,
};
