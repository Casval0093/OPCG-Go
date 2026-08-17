import type { CharacterCard } from "@tcg/op-types";
import { op16KouzukiMomonosuke085I18n } from "./085-kouzuki-momonosuke.i18n.ts";

export const op16KouzukiMomonosuke085: CharacterCard = {
  id: "OP16-085",
  canonicalId: "OP16-085",
  slug: "kouzuki-momonosuke/op16-085",
  name: "Kouzuki Momonosuke",
  printings: [
    {
      id: "OP16-085",
      artId: "OP16-085",
      setCode: "OP16",
      collectorNumber: "085",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-085.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "R",
  setId: "OP16",
  cost: 9,
  power: 6000,
  counter: 1000,
  traits: ["Land of Wano", "Kouzuki Clan"],
  attribute: "special",
  effect:
    "[Blocker]\n[On Play] Play up to 1 [Land of Wano] type Character card with a cost of 6 or less other than [Kouzuki Momonosuke] from your trash.",
  effects: {
    keywords: ["blocker"],
    effects: [
      {
        trigger: "onPlay",
        actions: [
          {
            action: "play",
            source: { player: "self", zone: "trash" },
            count: { amount: 1, upTo: true },
            filters: [
              // A `play` action's pool is already restricted to character-or-stage upstream
              // (candidatesForPlayAction), so this filter's only job is to exclude Stages --
              // and OP02-048 Land of Wano is exactly such a Stage. An Event fixture would make
              // the test vacuous; see the OP16-029 note in cards/ENCODING.md.
              { filter: "cardCategory", value: "character" },
              { filter: "trait", value: "Land of Wano", match: "includes" },
              { filter: "cost", comparison: "lte", value: 6 },
              { filter: "excludeName", value: "Kouzuki Momonosuke" },
            ],
          },
        ],
      },
    ],
  },
  i18n: op16KouzukiMomonosuke085I18n,
};
