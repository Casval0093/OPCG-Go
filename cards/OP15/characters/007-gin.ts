import type { CharacterCard } from "@tcg/op-types";
import { op15Gin007I18n } from "./007-gin.i18n.ts";

export const op15Gin007: CharacterCard = {
  id: "OP15-007",
  canonicalId: "OP15-007",
  slug: "gin/op15-007",
  name: "Gin",
  printings: [
    {
      id: "OP15-007",
      artId: "OP15-007",
      setCode: "OP15",
      collectorNumber: "007",
      rarity: "SR",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-007.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "SR",
  setId: "OP15",
  cost: 6,
  power: 7000,
  counter: 1000,
  traits: ["East Blue", "Krieg Pirates"],
  attribute: "strike",
  effect:
    "[On Play] If your Leader has the [East Blue] type, play up to 1 Character card with a cost of 5 or less from your hand.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        // Leading "If your Leader has the [X] type" gates the whole block (ruling #944's shape),
        // as opposed to the post-colon placement that gates only the payload (OP16-065/OP16-070).
        // `match: "includes"` is behavioural, not decoration: older engine cards store their
        // traits as one concatenated string, so `"exact"` silently fails to find "East Blue" in
        // e.g. OP15-001's sibling printings and in every pre-OP15 fixture.
        conditions: [{ condition: "leaderTrait", trait: "East Blue", match: "includes" }],
        actions: [
          {
            action: "play",
            source: { player: "self", zone: "hand" },
            count: { amount: 1, upTo: true },
            // "a cost of 5 or less" is a comparison word, so `lte` -- unlike a bare "a cost of 5",
            // which would be `eq`. `cardCategory` on a `play` action does exactly one job:
            // candidatesForPlayAction (effects/actions.ts) has already narrowed the pool to
            // stage-or-character before any filter is consulted, so this excludes STAGES.
            filters: [
              { filter: "cardCategory", value: "character" },
              { filter: "cost", comparison: "lte", value: 5 },
            ],
          },
        ],
      },
    ],
  },
  i18n: op15Gin007I18n,
};
