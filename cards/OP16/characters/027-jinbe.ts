import type { CharacterCard } from "@tcg/op-types";
import { op16Jinbe027I18n } from "./027-jinbe.i18n.ts";

export const op16Jinbe027: CharacterCard = {
  id: "OP16-027",
  canonicalId: "OP16-027",
  slug: "jinbe/op16-027",
  name: "Jinbe",
  printings: [
    {
      id: "OP16-027",
      artId: "OP16-027",
      setCode: "OP16",
      collectorNumber: "027",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-027.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "R",
  setId: "OP16",
  cost: 2,
  power: 2000,
  counter: 2000,
  traits: ["Fish-Man", "Impel Down", "The Sun Pirates"],
  attribute: "strike",
  effect: "[DON!! x1] This Character gains +2000 power.",
  effects: {
    permanentEffects: [
      {
        // No [Your Turn] tag on the print, so the bonus is not turn-gated -- unlike OP16-034,
        // whose otherwise similar DON!! clause does carry one. Shape from
        // OP01/characters/032-ashura-doji.ts (donAttached + self modifyPower, permanent).
        conditions: [{ condition: "donAttached", amount: 1 }],
        actions: [
          {
            action: "modifyPower",
            target: {
              player: "self",
              zones: ["character"],
              count: { amount: 1 },
              self: true,
            },
            value: 2000,
            duration: "permanent",
          },
        ],
      },
    ],
  },
  i18n: op16Jinbe027I18n,
};
