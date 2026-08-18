import type { CharacterCard } from "@tcg/op-types";
import { op16SanjuanWolf106I18n } from "./106-sanjuan-wolf.i18n.ts";

export const op16SanjuanWolf106: CharacterCard = {
  id: "OP16-106",
  canonicalId: "OP16-106",
  slug: "sanjuan-wolf/op16-106",
  name: "Sanjuan.Wolf",
  printings: [
    {
      id: "OP16-106",
      artId: "OP16-106",
      setCode: "OP16",
      collectorNumber: "106",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-106.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "R",
  setId: "OP16",
  cost: 4,
  power: 5000,
  counter: 1000,
  trigger: "Activate this card's [On K.O.] effect.",
  traits: ["Giant", "Impel Down", "Blackbeard Pirates"],
  attribute: "strike",
  effect:
    "[On K.O.] If your Leader has the [Blackbeard Pirates] type, draw 1 card, then up to 1 of your Leader or Character cards' base power becomes 7000 during this turn.",
  // PARKED -- "then up to 1 of your Leader or Character cards' base power becomes 7000 during this
  // turn" is NOT encoded. No DSL verb sets a card's BASE power to a literal. `setPower`
  // (effects/actions.ts) adds a modifier of `value - getCardPower(target)`, i.e. it sets TOTAL
  // power measured from the target's power AT RESOLUTION, so any modifier already on the target
  // (attached DON!! on your Leader, a counter boost) is absorbed instead of stacking on top of
  // 7000 -- a different card. `setBasePowerFrom` has the right arithmetic
  // (`value - basePower(card)`) but requires another card on the field to copy from, and
  // `copyPower` only ever retargets the effect's own card. Missing primitive: a literal
  // base-power setter -- a `setBasePower` action, or a flag on `setPower` that makes it compute
  // its delta from `basePower(card)`. The same wording parks clauses on OP16-015, OP16-058 and
  // OP15-092, so it is wanted by four cards in these two sets. The draw and the Leader-type gate
  // below ARE encoded.
  effects: {
    effects: [
      {
        trigger: "onKo",
        conditions: [
          {
            condition: "leaderTrait",
            trait: "Blackbeard Pirates",
            match: "includes",
          },
        ],
        actions: [
          {
            action: "draw",
            player: "self",
            amount: 1,
          },
        ],
      },
      {
        trigger: "trigger",
        actions: [
          {
            action: "activateEffect",
            effectTrigger: "onKo",
          },
        ],
      },
    ],
  },
  i18n: op16SanjuanWolf106I18n,
};
