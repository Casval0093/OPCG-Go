import type { LeaderCard } from "@tcg/op-types";
import { op16Buggy041I18n } from "./041-buggy.i18n.ts";

export const op16Buggy041: LeaderCard = {
  id: "OP16-041",
  canonicalId: "OP16-041",
  slug: "buggy/op16-041",
  name: "Buggy",
  printings: [
    {
      id: "OP16-041",
      artId: "OP16-041",
      setCode: "OP16",
      collectorNumber: "041",
      rarity: "L",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-041.png",
    },
  ],
  cardType: "leader",
  color: ["blue"],
  rarity: "L",
  setId: "OP16",
  power: 5000,
  life: 5,
  traits: ["Impel Down", "Buggy Pirates"],
  attribute: "slash",
  effect:
    "[DON!! x1] [Once Per Turn] This effect can be activated when your [Impel Down] type Character card is removed from the field. Play up to 1 [Prisoner of Impel Down] card from your hand.",
  effects: {
    effects: [
      {
        // `whenCharacterRemoved` is the cause-agnostic departure trigger: battle.ts fires it on a
        // battle K.O., and `enqueueCharacterRemovalEffects` (effects/resolution.ts) fires it for
        // ANY character an effect moved out of the character zone -- K.O.'d, trashed, returned to
        // hand or to deck. That breadth is what ruling #988 requires: when your OWN effect (its
        // example is OP07-056) returns your Impel Down Character to hand, this may still be
        // activated (可以. 当因我方的效果...也可以发动此效果). So NO `causedBy: "opponent"` filter,
        // which is the one thing this diverges from its closest model, OP10-042 Usopp.
        //
        // Ruling #987 (a full 5-Character field means the play cannot happen) needs no encoding:
        // the printed text is silent about it and `candidatesForPlayAction` already enforces the
        // open-slot limit generically.
        trigger: "whenCharacterRemoved",
        eventFilter: {
          player: "self",
          filters: [{ filter: "trait", value: "Impel Down", match: "includes" }],
        },
        conditions: [{ condition: "donAttached", amount: 1 }],
        actions: [
          {
            action: "play",
            source: { player: "self", zone: "hand" },
            count: { amount: 1, upTo: true },
            filters: [{ filter: "name", value: "Prisoner of Impel Down" }],
          },
        ],
        optional: true,
        oncePerTurn: true,
      },
    ],
  },
  i18n: op16Buggy041I18n,
};
