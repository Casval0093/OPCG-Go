import type { CharacterCard } from "@tcg/op-types";
import { op15Leo052I18n } from "./052-leo.i18n.ts";

export const op15Leo052: CharacterCard = {
  id: "OP15-052",
  canonicalId: "OP15-052",
  slug: "leo/op15-052",
  name: "Leo",
  printings: [
    {
      id: "OP15-052",
      artId: "OP15-052",
      setCode: "OP15",
      collectorNumber: "052",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-052.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "UC",
  setId: "OP15",
  cost: 1,
  power: 2000,
  counter: 2000,
  traits: ["The Tontattas", "Dressrosa"],
  attribute: "strike",
  effect:
    "If your Character with 7000 base power or less would be removed from the field by your opponent's effect, you may place 1 of your Characters at the bottom of the owner's deck instead.",
  effects: {
    replacementEffects: [
      {
        // SC: 因对方的**效果**将要离开场上 -- caused by the opponent's EFFECT, so
        // `removeFromField` + `source: "opponentEffect"`, exactly as OP15-105 Bonney and
        // OP12-102 Shirahoshi (whose printed clause is word-for-word this one with a different
        // threshold and a different replacement). NOT the `leaveField` shape OP15-098
        // Monkey.D.Luffy needs: `findKoReplacement` searches only ["ko","leaveField"] on a
        // battle cause, so a battle K.O. correctly finds nothing here.
        //
        // These two fields are load-bearing JOINTLY, not individually, and a hand mutation run
        // measured it: swapping `removeFromField` for `leaveField` on its own changes NOTHING
        // observable, because `structuredSourceMatches` (effects/replacements.ts) already requires
        // `koCause === "effect"` whenever `source` is "opponentEffect" -- so the battle path is
        // closed by `source` before `replacedEvent` is ever consulted. Deleting `source` alone
        // goes red (own-effect removals start being replaced), and swapping both at once goes red
        // (the battle path opens), so the PAIR is fully tested; the `replacedEvent` value on its
        // own simply is not observable on this card and no test can make it so. Do not "simplify"
        // by deleting either: `removeFromField` is what the printed 离开场上 says, `source` is
        // what 因对方的效果 says, and the same pair is on OP15-105 Bonney and OP12-102 Shirahoshi.
        replacedEvent: "removeFromField",
        source: "opponentEffect",
        target: {
          player: "self",
          zones: ["character"],
          count: { amount: 1 },
          // 原本的力量 -- `basePower`, not `power`: a body buffed past 7000 is still protected
          // and a body debuffed under it is still not. No `excludeSelf`: ruling #897 says Leo
          // may replace its OWN removal (可以), and at 2000 base power it passes its own filter.
          filters: [{ filter: "basePower", comparison: "lte", value: 7000 }],
        },
        replacementAction: {
          // "1 of your Characters" with no restriction -- a free choice, and NOT `self: true`.
          // Ruling #897 is specifically about placing ANOTHER Character at the bottom to save
          // this one, which the unfiltered target is what allows.
          action: "returnToDeck",
          target: { player: "self", zones: ["character"], count: { amount: 1 } },
          position: "bottom",
        },
      },
    ],
  },
  i18n: op15Leo052I18n,
};
