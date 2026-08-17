import type { CharacterCard } from "@tcg/op-types";
import { op16Yamato097I18n } from "./097-yamato.i18n.ts";

export const op16Yamato097: CharacterCard = {
  id: "OP16-097",
  canonicalId: "OP16-097",
  slug: "yamato/op16-097",
  name: "Yamato",
  printings: [
    {
      id: "OP16-097",
      artId: "OP16-097",
      setCode: "OP16",
      collectorNumber: "097",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-097.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "R",
  setId: "OP16",
  cost: 8,
  power: 8000,
  traits: ["Land of Wano"],
  attribute: "strike",
  effect:
    "[On Play] Add up to 1 [Land of Wano] type Character card with a cost of 6 or less from your trash to your hand. Then, play up to 1 Character card with a cost of 2 or less from your hand.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        // Ruling #1007: if the first half adds nothing from the trash, the "Then" half STILL
        // resolves (可以). So these are two independent sequential actions, not a `play` nested
        // in the first action's `thenActions`. OP05-091 Rebecca prints the same two-sentence
        // shape and is encoded the same way.
        actions: [
          {
            // "Add ... from your trash to your hand" is a `returnToHand` whose target zone is
            // the trash -- the established spelling (OP05-091 Rebecca, OP05-088 Mansherry).
            // Unlike a `play` action, its candidate pool is not pre-restricted by card type, so
            // `cardCategory` here has to exclude Events as well as Stages.
            action: "returnToHand",
            target: {
              player: "self",
              zones: ["trash"],
              count: { amount: 1, upTo: true },
              filters: [
                { filter: "cardCategory", value: "character" },
                { filter: "trait", value: "Land of Wano", match: "includes" },
                { filter: "cost", comparison: "lte", value: 6 },
              ],
            },
          },
          {
            action: "play",
            source: { player: "self", zone: "hand" },
            count: { amount: 1, upTo: true },
            filters: [
              { filter: "cardCategory", value: "character" },
              { filter: "cost", comparison: "lte", value: 2 },
            ],
          },
        ],
      },
    ],
  },
  i18n: op16Yamato097I18n,
};
