import type { CharacterCard } from "@tcg/op-types";
import { op16Mr2BonKureiBentham055I18n } from "./055-mr-2-bon-kurei-bentham.i18n.ts";

export const op16Mr2BonKureiBentham055: CharacterCard = {
  id: "OP16-055",
  canonicalId: "OP16-055",
  slug: "mr-2-bon-kurei-bentham/op16-055",
  name: "Mr.2.Bon.Kurei(Bentham)",
  printings: [
    {
      id: "OP16-055",
      artId: "OP16-055",
      setCode: "OP16",
      collectorNumber: "055",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-055.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "R",
  setId: "OP16",
  cost: 2,
  power: 1000,
  traits: ["Impel Down", "Former Baroque Works"],
  attribute: "strike",
  effect:
    "[On Play] Draw 1 card.\n[DON!! x1] [When Attacking] This Character's base power becomes the same as your opponent's Leader's power during this turn.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        actions: [{ action: "draw", player: "self", amount: 1 }],
      },
      {
        trigger: "whenAttacking",
        conditions: [{ condition: "donAttached", amount: 1 }],
        actions: [
          {
            // `copyPower`, not `setBasePowerFrom`. The two differ in exactly one place and
            // the printed text picks between them: copyPower reads getCardPower(source) --
            // the source's CURRENT power including modifiers -- while setBasePowerFrom
            // reads basePower(source), the printed number. This card says "your opponent's
            // Leader's POWER", the same "the power of X" phrasing OP04-069 (an earlier
            // printing of this very character) and OP16-104 Catarina Devon both encode with
            // copyPower; OP06-009 Shuraiya's "the same as your opponent's Leader" and
            // OP14-053 Vista's "your Leader's BASE power" are the setBasePowerFrom wording.
            // So an opponent Leader carrying +1000 from an attached DON!! is copied at the
            // boosted value.
            //
            // copyPower always applies to the card bearing the effect and adds
            // `copiedPower - basePower(self)`, i.e. it *replaces* the base power and leaves
            // this card's own modifiers (the attached DON!!'s +1000) stacked on top. Its
            // `target` is therefore the card being COPIED FROM, not the card being changed.
            action: "copyPower",
            target: { player: "opponent", zones: ["leader"], count: { amount: 1 } },
            duration: "thisTurn",
          },
        ],
      },
    ],
  },
  i18n: op16Mr2BonKureiBentham055I18n,
};
