import type { LeaderCard } from "@tcg/op-types";
import { op15MonkeyDLuffy098I18n } from "./098-monkey-d-luffy.i18n.ts";

export const op15MonkeyDLuffy098: LeaderCard = {
  id: "OP15-098",
  canonicalId: "OP15-098",
  slug: "monkey-d-luffy/op15-098",
  name: "Monkey.D.Luffy",
  printings: [
    {
      id: "OP15-098",
      artId: "OP15-098",
      setCode: "OP15",
      collectorNumber: "098",
      rarity: "L",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-098.png",
    },
  ],
  cardType: "leader",
  color: ["yellow"],
  rarity: "L",
  setId: "OP15",
  power: 5000,
  life: 5,
  traits: ["Sky Island", "Straw Hat Crew"],
  attribute: "strike",
  effect:
    "If your [Sky Island] type Character with 6000 base power or more would be removed from the field by your opponent, you may add 1 card from the top of your Life cards to your hand instead.",
  effects: {
    replacementEffects: [
      {
        // `leaveField`, NOT `removeFromField`, and this is the decisive choice on the card.
        // `findKoReplacement` (effects/replacements.ts) searches only ["ko", "leaveField"] when the
        // cause is a BATTLE, and ["ko", "removeFromField", "leaveField"] when the cause is an
        // effect. Ruling #957 says a Sky Island Character about to be K.O.'d by the opponent's
        // *battle* can be saved this way (可以), so a `removeFromField` encoding would silently do
        // nothing in exactly the most common case. `leaveField` is the one value in both sets, and
        // the printed SC wording is correspondingly cause-agnostic: 因对方而将要离开场上 -- "would
        // leave the field because of the opponent", not "by the opponent's effect".
        replacedEvent: "leaveField",
        // `causedBy: "opponent"` is what supplies the "by your opponent" half. Without it this would
        // also replace removals the controller inflicts on their own Characters.
        eventFilter: { causedBy: "opponent" },
        target: {
          player: "self",
          zones: ["character"],
          count: { amount: 1 },
          filters: [
            { filter: "trait", value: "Sky Island", match: "includes" },
            // `basePower`, not `power`: printed text is "6000 base power or more" (SC: 原本的力量),
            // so a 5000-base Character buffed to 6000 by DON!! must NOT qualify.
            { filter: "basePower", comparison: "gte", value: 6000 },
          ],
        },
        replacementAction: {
          action: "removeFromLife",
          player: "self",
          count: { amount: 1 },
          destination: "hand",
          position: "top",
        },
        // No explicit `lifeCount gte 1` condition, deliberately. Ruling #933 (with 0 Life cards the
        // replacement cannot be used) is already enforced structurally: `replacementActionIsAvailable`
        // rejects a `removeFromLife` whose count exceeds `life.length` when neither `upTo` nor "all"
        // is set, so the effect is never offered at 0 Life. Adding a redundant condition would create
        // a mutation-check survivor -- a filter whose removal changes nothing.
      },
    ],
  },
  i18n: op15MonkeyDLuffy098I18n,
};
