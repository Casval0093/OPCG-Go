import type { CharacterCard } from "@tcg/op-types";
import { op16Mr2BonKureiBentham036I18n } from "./036-mr-2-bon-kurei-bentham.i18n.ts";

export const op16Mr2BonKureiBentham036: CharacterCard = {
  id: "OP16-036",
  canonicalId: "OP16-036",
  slug: "mr-2-bon-kurei-bentham/op16-036",
  name: "Mr.2.Bon.Kurei(Bentham)",
  printings: [
    {
      id: "OP16-036",
      artId: "OP16-036",
      setCode: "OP16",
      collectorNumber: "036",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-036.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "C",
  setId: "OP16",
  cost: 4,
  power: 1000,
  counter: 1000,
  traits: ["Impel Down", "Former Baroque Works"],
  attribute: "strike",
  effect:
    "[On Play] Rest up to 1 of your opponent's Characters with a cost of 4 or less.\n[When Attacking] This Character's base power becomes the same as your opponent's Leader during this turn.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        actions: [
          {
            action: "rest",
            target: {
              player: "opponent",
              zones: ["character"],
              count: { amount: 1, upTo: true },
              filters: [{ filter: "cost", comparison: "lte", value: 4 }],
            },
          },
        ],
      },
      {
        trigger: "whenAttacking",
        // "base power becomes the same as" is `setBasePowerFrom`, not `setPower`: it copies the
        // source's EFFECTIVE base power as a replacement, so modifiers already on this card
        // stack on top instead of being absorbed (which is what parks OP16-058/OP16-106 on the
        // missing setBasePowerLiteral primitive). Modeled on OP06/characters/009-shuraiya.ts,
        // which prints this clause verbatim with a different duration.
        actions: [
          {
            action: "setBasePowerFrom",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            source: { player: "opponent", zones: ["leader"], count: { amount: 1 } },
            duration: "thisTurn",
          },
        ],
      },
    ],
  },
  i18n: op16Mr2BonKureiBentham036I18n,
};
