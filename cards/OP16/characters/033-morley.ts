import type { CharacterCard } from "@tcg/op-types";
import { op16Morley033I18n } from "./033-morley.i18n.ts";

export const op16Morley033: CharacterCard = {
  id: "OP16-033",
  canonicalId: "OP16-033",
  slug: "morley/op16-033",
  name: "Morley",
  printings: [
    {
      id: "OP16-033",
      artId: "OP16-033",
      setCode: "OP16",
      collectorNumber: "033",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-033.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "C",
  setId: "OP16",
  cost: 4,
  power: 5000,
  counter: 1000,
  traits: ["Giant", "Revolutionary Army"],
  attribute: "special",
  effect:
    "If this Character would be K.O.'d, you may rest 2 of your cards instead.\n[Unblockable] (This card cannot be blocked.)",
  effects: {
    keywords: ["unblockable"],
    replacementEffects: [
      {
        // "would be K.O.'d" with no cause named, so it has to cover both. `replacedEvent: "ko"`
        // is the one value findKoReplacement (effects/replacements.ts) searches for BOTH a
        // battle K.O. and an effect K.O.; `removeFromField` would silently do nothing in
        // battle (the OP15-098 lesson). Shape from OP05/characters/032-pica.ts and
        // OP11/characters/110-fukaboshi.ts.
        replacedEvent: "ko",
        eventFilter: { targetSelf: true },
        replacementAction: {
          action: "rest",
          // Ruling #980: an ACTIVE Morley may be one of the two cards it rests (可以), so no
          // `excludeSelf` -- the candidate pool has to contain the card being saved. Zones are
          // Leader + Characters + Stage and NOT costArea: that is exactly the pool the engine's
          // own `restCards` cost uses for this printed phrase ("rest N of your cards"),
          // candidatesForRestCardsCost in effects/actions.ts.
          target: {
            player: "self",
            zones: ["leader", "character", "stage"],
            count: { amount: 2 },
          },
        },
      },
    ],
  },
  i18n: op16Morley033I18n,
};
