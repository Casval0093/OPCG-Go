import type { CharacterCard } from "@tcg/op-types";
import { op15Pincers013I18n } from "./013-pincers.i18n.ts";

export const op15Pincers013: CharacterCard = {
  id: "OP15-013",
  canonicalId: "OP15-013",
  slug: "pincers/op15-013",
  name: "Pincers",
  printings: [
    {
      id: "OP15-013",
      artId: "OP15-013",
      setCode: "OP15",
      collectorNumber: "013",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-013.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "C",
  setId: "OP15",
  cost: 4,
  power: 2000,
  counter: 2000,
  traits: ["Animal", "Alabasta"],
  attribute: "strike",
  effect:
    "If your Leader has 0 power or less, give this card in your hand -2 cost.\n[Blocker] (After your opponent declares an attack, you may rest this card to make it the new target of the attack.)",
  effects: {
    keywords: ["blocker"],
    permanentEffects: [
      {
        // Same Leader-power check as OP15-004 Sea Cat, and the same precedent
        // (OP05/characters/009-toh-toh.ts): no Condition reads the Leader's power, so it goes
        // through `hasCard` over `zone: "leader"` with a `power` filter. GENERAL ruling #4 is what
        // keeps a 0-or-less-power Leader on the field for this to be about.
        conditions: [
          {
            condition: "hasCard",
            player: "self",
            zone: "leader",
            filters: [{ filter: "power", comparison: "lte", value: 0 }],
          },
        ],
        actions: [
          {
            action: "modifyCost",
            // "this card in your HAND" -- the discount applies while the card is still in hand, so
            // the zone is `hand` and the target is `self`. Shape from
            // OP16/characters/005-thatch.ts.
            target: { player: "self", zones: ["hand"], count: { amount: 1 }, self: true },
            value: -2,
            duration: "permanent",
          },
        ],
      },
    ],
  },
  i18n: op15Pincers013I18n,
};
