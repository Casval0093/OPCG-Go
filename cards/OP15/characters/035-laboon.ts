import type { CharacterCard } from "@tcg/op-types";
import { op15Laboon035I18n } from "./035-laboon.i18n.ts";

export const op15Laboon035: CharacterCard = {
  id: "OP15-035",
  canonicalId: "OP15-035",
  slug: "laboon/op15-035",
  name: "Laboon",
  printings: [
    {
      id: "OP15-035",
      artId: "OP15-035",
      setCode: "OP15",
      collectorNumber: "035",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-035.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "UC",
  setId: "OP15",
  cost: 1,
  power: 2000,
  counter: 2000,
  traits: ["Animal"],
  attribute: "strike",
  effect:
    "If your Character with 7000 base power or less would be removed from the field by your opponent's effect, you may rest 2 of your cards instead.",
  effects: {
    replacementEffects: [
      {
        // 因对方的效果将要离开场上 -- "by your opponent's EFFECT", so `removeFromField` +
        // `source: "opponentEffect"`, the OP15-105 Bonney / OP16-014 Marco shape and NOT the
        // `leaveField` shape OP15-098 needs. `findKoReplacement` searches ["ko","leaveField"] on a
        // battle cause, so this correctly never fires on a battle K.O.; `source: "opponentEffect"`
        // additionally requires `koCause === "effect"` and an opposing effect controller.
        replacedEvent: "removeFromField",
        source: "opponentEffect",
        target: {
          player: "self",
          zones: ["character"],
          count: { amount: 1 },
          // 原本的力量 -- `basePower`, so a 5000-base body buffed to 9000 is still protected and a
          // 8000-base body debuffed to 3000 is not. No `excludeSelf`: ruling #890 says Laboon may
          // replace its OWN removal (可以), and at 2000 base power it passes its own filter --
          // `findRemovalReplacement` searches the removed instance first, so the self-inclusion is
          // what makes that work. Same shape and same reasoning as OP15-105 Bonney.
          filters: [{ filter: "basePower", comparison: "lte", value: 7000 }],
        },
        replacementAction: {
          action: "rest",
          // "rest 2 of YOUR cards" -- Leader + Characters + Stage + cost-area DON!!, the pool
          // OP14EB04/characters/029-tashigi.ts uses for the same printed phrase in the same
          // replacement position. `restActionCandidateIds` (effects/replacements.ts) draws the
          // DON!! half from `activeDon` only, and `replacementActionIsAvailable` suppresses the
          // whole replacement when fewer than 2 restable cards exist, which is what makes
          // `amount: 2` observable.
          target: {
            player: "self",
            zones: ["leader", "character", "stage", "costArea"],
            count: { amount: 2 },
          },
        },
      },
    ],
  },
  i18n: op15Laboon035I18n,
};
