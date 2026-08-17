import type { CharacterCard } from "@tcg/op-types";
import { op16BennBeckman012I18n } from "./012-benn-beckman.i18n.ts";

export const op16BennBeckman012: CharacterCard = {
  id: "OP16-012",
  canonicalId: "OP16-012",
  slug: "benn-beckman/op16-012",
  name: "Benn.Beckman",
  printings: [
    {
      id: "OP16-012",
      artId: "OP16-012",
      setCode: "OP16",
      collectorNumber: "012",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-012.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "R",
  setId: "OP16",
  cost: 5,
  power: 6000,
  counter: 1000,
  traits: ["Red-Haired Pirates"],
  attribute: "ranged",
  effect:
    "[Blocker]\n[On Play] You may rest 1 of your DON!! cards: If your Leader has the [Red-Haired Pirates] type and you have 10 DON!! cards on your field, play up to 1 [Shanks] from your hand.",
  effects: {
    keywords: ["blocker"],
    effects: [
      {
        trigger: "onPlay",
        costs: [{ cost: "restDon", amount: 1 }],
        actions: [
          {
            action: "play",
            source: { player: "self", zone: "hand" },
            count: { amount: 1, upTo: true },
            filters: [{ filter: "name", value: "Shanks" }],
            // The checks are printed AFTER the cost colon, inside the effect body, so they gate
            // this action rather than the block: the DON!! is rested either way. Same shape as
            // OP08-040 Atmos. "10 DON!! cards on your field" is `eq`, per the five existing
            // donFieldCount precedents.
            condition: {
              condition: "compound",
              operator: "and",
              conditions: [
                { condition: "leaderTrait", trait: "Red-Haired Pirates", match: "includes" },
                { condition: "donFieldCount", player: "self", comparison: "eq", value: 10 },
              ],
            },
          },
        ],
        optional: true,
      },
    ],
  },
  i18n: op16BennBeckman012I18n,
};
