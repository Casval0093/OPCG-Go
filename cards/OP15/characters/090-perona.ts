import type { CharacterCard } from "@tcg/op-types";
import { op15Perona090I18n } from "./090-perona.i18n.ts";

export const op15Perona090: CharacterCard = {
  id: "OP15-090",
  canonicalId: "OP15-090",
  slug: "perona/op15-090",
  name: "Perona",
  printings: [
    {
      id: "OP15-090",
      artId: "OP15-090",
      setCode: "OP15",
      collectorNumber: "090",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-090.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "UC",
  setId: "OP15",
  cost: 1,
  power: 2000,
  counter: 2000,
  traits: ["Thriller Bark Pirates"],
  attribute: "special",
  effect:
    "If your Character with 7000 base power or less would be removed from the field by your opponent's effect, you may trash 1 card from your hand instead.",
  effects: {
    replacementEffects: [
      {
        // 因对方的**效果** -- the opponent's EFFECT specifically, so `removeFromField` +
        // `source: "opponentEffect"`, the OP15-105 Bonney half of the pair, NOT the
        // cause-agnostic 因对方 of OP15-098 Luffy that needs `leaveField`.
        // `findRemovalReplacement` gates this on `koCause === "effect"`, so a battle K.O.
        // correctly finds nothing here -- and that is silent under the wrong choice, hence the
        // explicit battle test.
        replacedEvent: "removeFromField",
        source: "opponentEffect",
        target: {
          player: "self",
          zones: ["character"],
          count: { amount: 1 },
          // 原本的力量 -- printed base power, so a 6000-base body buffed to 9000 is STILL
          // protected and an 8000-base body debuffed to 5000 is still not.
          // Ruling #925: no `excludeSelf` -- Perona (2000 base) may replace her own removal.
          filters: [{ filter: "basePower", comparison: "lte", value: 7000 }],
        },
        replacementAction: { action: "trashFromHand", player: "self", amount: 1 },
      },
    ],
  },
  i18n: op15Perona090I18n,
};
