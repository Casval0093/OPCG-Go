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
      {
        // "[Opponent's Turn] All of your [Shura] cards' base power and this Character's base power
        // become 6000." A separate block because it is gated on the turn and the keyword grant is
        // not; the two-action split is the same one the grant above needs, and for the same reason
        // (no filter expresses "is the source card", so `self: true` has to be its own target).
        //
        // `setBasePower`, not `setPower`: `setPower` sets TOTAL power by subtracting
        // `getCardPower` at resolution, so a [Shura] already holding a counter boost would be
        // clamped back to 6000 instead of reaching 6000+boost. It is also unreadable from a
        // permanent effect at all -- the permanent power path recognises only `modifyPower` and
        // the two base-power setters.
        //
        // 6000 is a floor AND a ceiling, which is why the literal has to replace the base rather
        // than add to it: every printed [Shura] body is 2000 base (OP15-067, OP05-106) and Fuza
        // itself is 4000, so the clause is a large increase here and would be a decrease on a
        // bigger body. A `modifyPower` of any fixed value cannot express either.
        conditions: [{ condition: "turn", value: "opponent" }],
        actions: [
          {
            // Ruling #909: a Leader whose own effect gives it every card name DOES reach base
            // power 6000 through this clause (是的). So the zone list spans leader + character,
            // matching the [Unblockable] grant above rather than narrowing to characters.
            action: "setBasePower",
            target: {
              player: "self",
              zones: ["leader", "character"],
              count: { amount: "all" },
              filters: [{ filter: "name", value: "Shura" }],
            },
            value: 6000,
            duration: "permanent",
          },
          {
            action: "setBasePower",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            value: 6000,
            duration: "permanent",
          },
        ],
      },
    ],
  },
  i18n: op15Fuza070I18n,
};
