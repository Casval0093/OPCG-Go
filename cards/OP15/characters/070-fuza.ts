import type { CharacterCard } from "@tcg/op-types";
import { op15Fuza070I18n } from "./070-fuza.i18n.ts";

export const op15Fuza070: CharacterCard = {
  id: "OP15-070",
  canonicalId: "OP15-070",
  slug: "fuza/op15-070",
  name: "Fuza",
  printings: [
    {
      id: "OP15-070",
      artId: "OP15-070",
      setCode: "OP15",
      collectorNumber: "070",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-070.png",
    },
  ],
  cardType: "character",
  color: ["purple"],
  rarity: "C",
  setId: "OP15",
  cost: 3,
  power: 4000,
  counter: 1000,
  traits: ["Animal", "Sky Island"],
  attribute: "special",
  effect:
    "All of your [Shura] cards and this Character gain [Unblockable].\n(This card cannot be blocked.)\n[Opponent's Turn] All of your [Shura] cards' base power and this Character's base power become 6000.",
  // PARKED -- "[Opponent's Turn] All of your [Shura] cards' base power and this Character's base
  // power become 6000" is NOT encoded. It needs the same missing primitive as OP16-106/OP16-015/
  // OP16-058/OP15-092 (`setBasePowerLiteral` in data/parked-clauses.json): no DSL verb sets a
  // card's BASE power to a literal. `setPower` applies `value - getCardPower(target)`, a TOTAL
  // power set measured at resolution, so it absorbs modifiers already on the target instead of
  // letting them stack on 6000 -- and on this card that is the difference between a Shura holding
  // a counter boost sitting at 6000 and at 6000+boost. `setBasePowerFrom` has the right arithmetic
  // but copies another card on the field rather than a literal. Ruling #909 additionally pins
  // where the clause has to reach: a Leader that has every card's name DOES get base power 6000
  // (是的), so the primitive's target must span the Leader, not just the character zone -- the
  // same breadth the [Unblockable] grant below already carries. The keyword half IS encoded.
  effects: {
    permanentEffects: [
      {
        actions: [
          {
            // "All of your [Shura] CARDS", not Characters -- and ruling #909 confirms a Leader
            // that has every card's name gains [Unblockable] from this. So the zone list spans
            // leader + character, the same breadth OP15-074/075/076 use for "your [Enel] cards".
            // A permanent grant over cards other than this one needs `count.amount: "all"`:
            // permanentKeywordsFor (effects/permanent.ts) skips any target that is neither
            // `"all"` nor `self: true`.
            action: "grantKeyword",
            target: {
              player: "self",
              zones: ["leader", "character"],
              count: { amount: "all" },
              filters: [{ filter: "name", value: "Shura" }],
            },
            keyword: "unblockable",
            duration: "permanent",
          },
          {
            // "and this Character" -- a second action, because there is no filter for "is the
            // source card" that could be ORed into the name filter above.
            action: "grantKeyword",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            keyword: "unblockable",
            duration: "permanent",
          },
        ],
      },
    ],
  },
  i18n: op15Fuza070I18n,
};
