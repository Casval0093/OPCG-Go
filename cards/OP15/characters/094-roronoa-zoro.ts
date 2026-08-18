import type { CharacterCard } from "@tcg/op-types";
import { op15RoronoaZoro094I18n } from "./094-roronoa-zoro.i18n.ts";

export const op15RoronoaZoro094: CharacterCard = {
  id: "OP15-094",
  canonicalId: "OP15-094",
  slug: "roronoa-zoro/op15-094",
  name: "Roronoa Zoro",
  printings: [
    {
      id: "OP15-094",
      artId: "OP15-094",
      setCode: "OP15",
      collectorNumber: "094",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-094.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "UC",
  setId: "OP15",
  cost: 2,
  power: 1000,
  counter: 1000,
  traits: ["Straw Hat Crew"],
  attribute: "slash",
  effect:
    "If your [Straw Hat Crew] type Character other than this Character would be removed from the field by your opponent's effect, you may trash this Character instead.\n[Blocker]",
  effects: {
    keywords: ["blocker"],
    replacementEffects: [
      {
        // 因对方的**效果**, so `removeFromField` + `source: "opponentEffect"` -- the OP15-105
        // Bonney half of the pair, not OP15-098 Luffy's cause-agnostic `leaveField`. A battle
        // K.O. correctly finds nothing.
        replacedEvent: "removeFromField",
        source: "opponentEffect",
        target: {
          player: "self",
          zones: ["character"],
          count: { amount: 1 },
          filters: [
            { filter: "trait", value: "Straw Hat Crew", match: "includes" },
            // 我方**此角色以外的** -- this Character cannot save itself. The exact opposite of
            // OP15-090 Perona in this same batch, whose ruling #925 says she CAN, and the
            // reason neither card's filter set can be copied onto the other.
            { filter: "excludeSelf" },
          ],
        },
        replacementAction: { action: "trashThisCard" },
      },
    ],
  },
  i18n: op15RoronoaZoro094I18n,
};
