import type { CharacterCard } from "@tcg/op-types";
import { op16Crocodile045I18n } from "./045-crocodile.i18n.ts";

export const op16Crocodile045: CharacterCard = {
  id: "OP16-045",
  canonicalId: "OP16-045",
  slug: "crocodile/op16-045",
  name: "Crocodile",
  printings: [
    {
      id: "OP16-045",
      artId: "OP16-045",
      setCode: "OP16",
      collectorNumber: "045",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-045.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "UC",
  setId: "OP16",
  cost: 4,
  power: 6000,
  traits: ["Impel Down", "Former Baroque Works"],
  attribute: "special",
  effect:
    "[Blocker]\n[On Play] You may return 1 of your Characters with a cost of 2 or more to the owner's hand: Play up to 1 [Impel Down] type Character card with a cost of 2 or less from your hand.",
  effects: {
    keywords: ["blocker"],
    effects: [
      {
        trigger: "onPlay",
        costs: [
          {
            // Ruling #989: this Character may pay its OWN cost -- return Crocodile itself
            // (cost 4, so it clears "cost of 2 or more") and still play the cheap Impel Down
            // body. The printed text carries no "other than this Character" clause, and
            // candidatesForReturnCharacterCost scans the whole characterArea, so the correct
            // encoding is simply the ABSENCE of an `excludeSelf` filter. The tempting model
            // is OP08-047 Jozu, which *is* printed "other than this Character" and does
            // carry `excludeSelf`; copying it here would break the ruling.
            cost: "returnCharacter",
            amount: 1,
            filters: [{ filter: "cost", comparison: "gte", value: 2 }],
          },
        ],
        actions: [
          {
            action: "play",
            source: { player: "self", zone: "hand" },
            count: { amount: 1, upTo: true },
            filters: [
              { filter: "trait", value: "Impel Down", match: "includes" },
              { filter: "cost", comparison: "lte", value: 2 },
              // A `play` action's candidate pool is pre-filtered to stage-or-character
              // (candidatesForPlayAction), so this filter's only job is excluding a cheap
              // Impel Down STAGE -- OP02-092 Impel Down itself is cost 1 and would otherwise
              // qualify. An Event fixture proves nothing here (cards/ENCODING.md).
              { filter: "cardCategory", value: "character" },
            ],
          },
        ],
        optional: true,
      },
    ],
  },
  i18n: op16Crocodile045I18n,
};
