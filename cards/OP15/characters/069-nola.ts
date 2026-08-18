import type { CharacterCard } from "@tcg/op-types";
import { op15Nola069I18n } from "./069-nola.i18n.ts";

export const op15Nola069: CharacterCard = {
  id: "OP15-069",
  canonicalId: "OP15-069",
  slug: "nola/op15-069",
  name: "Nola",
  printings: [
    {
      id: "OP15-069",
      artId: "OP15-069",
      setCode: "OP15",
      collectorNumber: "069",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-069.png",
    },
  ],
  cardType: "character",
  color: ["purple"],
  rarity: "UC",
  setId: "OP15",
  cost: 1,
  power: 2000,
  counter: 2000,
  traits: ["Animal", "Sky Island"],
  attribute: "strike",
  effect:
    "If your Character with 7000 base power or less would be removed from the field by your opponent's effect, you may return 1 DON!! card from your field to your DON!! deck instead.",
  effects: {
    replacementEffects: [
      {
        // "by your opponent's EFFECT" (因对方的效果), not the cause-agnostic "by your opponent" --
        // so `removeFromField` is correct and `leaveField` would over-reach onto battle K.O.s
        // (findKoReplacement searches ["ko","leaveField"] on a battle cause; OP15-098's lesson
        // in reverse). Same pairing as OP12-070 Sanji, which is this card's model.
        replacedEvent: "removeFromField",
        source: "opponentEffect",
        // Sanji is self-only (`eventFilter: { targetSelf: true }`); this card protects ANY own
        // Character under the base-power line, so the protected set is a structured `target`
        // instead -- the OP16-014 Marco shape. Ruling #907: Nola may spend the DON!! to save
        // ITSELF (可以), so there is deliberately no `excludeSelf` here; Nola's own 2000 base
        // power is inside the filter and it is a candidate for its own replacement.
        target: {
          player: "self",
          zones: ["character"],
          count: { amount: 1 },
          // 原本的力量 -- printed base power, so a Character buffed past 7000 still qualifies and
          // a 8000-base body debuffed under 7000 does not. `basePower`, never `power`.
          filters: [{ filter: "basePower", comparison: "lte", value: 7000 }],
        },
        replacementAction: { action: "returnDon", player: "self", amount: 1 },
      },
    ],
  },
  i18n: op15Nola069I18n,
};
