import type { CharacterCard } from "@tcg/op-types";
import { op15Krieg008I18n } from "./008-krieg.i18n.ts";

export const op15Krieg008: CharacterCard = {
  id: "OP15-008",
  canonicalId: "OP15-008",
  slug: "krieg/op15-008",
  name: "Krieg",
  printings: [
    {
      id: "OP15-008",
      artId: "OP15-008",
      setCode: "OP15",
      collectorNumber: "008",
      rarity: "SR",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-008.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "SR",
  setId: "OP15",
  cost: 8,
  power: 9000,
  traits: ["East Blue", "Krieg Pirates"],
  attribute: "slash",
  effect:
    "[On Play] Give up to 3 of your opponent's rested DON!! cards to 1 of your opponent's Characters. Then, this Character gains [Rush] during this turn.\n[Activate: Main] [Once Per Turn] If this Character was played on this turn, give all of your opponent's Characters -1000 power during this turn for every DON!! card given to that Character.",
  // PARKED -- TWO clauses are absent below.
  //
  // 1. The [On Play]'s first half, "Give up to 3 of your opponent's rested DON!! cards to 1 of your
  //    opponent's Characters". `giveDon` (effects/actions.ts) always draws the DON!! from
  //    `getPlayer(state, controller)` -- the effect controller's own cost area -- and
  //    `GiveDonAction` carries no source-player field, so an opponent-sourced give is inexpressible.
  //    The same gap parks clauses on OP15-003, OP15-010, OP15-012, OP15-015 and OP15-017. The
  //    "Then," half IS encoded, and that is not a liberty: ruling #858 says this Character gains
  //    [Rush] even when the [On Play] gave NO DON!! at all (可以), so the grant does not depend on
  //    the parked half having done anything. Ruling #859 pins that the ACTIVATING player chooses
  //    which of the opponent's rested DON!! moves.
  //
  // 2. The whole [Activate: Main]: "give all of your opponent's Characters -1000 power during this
  //    turn for every DON!! card given to THAT Character". Every scaling hook on `modifyPower`
  //    computes ONE value and applies it uniformly to every target -- `valuePerCardGroup` divides a
  //    global candidate count by `size` and `restedDonGroupSize` reads the controller's own rested
  //    DON!! pool (effects/actions.ts, effects/permanent.ts) -- and `distributedValues` needs the
  //    magnitudes known at authoring time. What is missing is a PER-TARGET modifier scaled by that
  //    target's own `instance.attachedDon`. This is a second, distinct facet of the attached-DON!!
  //    gap: `attachedDonTargetFilter` (data/parked-clauses.json) would let a filter READ the count,
  //    but not let a value be COMPUTED from it per candidate.
  effects: {
    effects: [
      {
        trigger: "onPlay",
        actions: [
          {
            action: "grantKeyword",
            target: {
              player: "self",
              zones: ["character"],
              count: { amount: 1 },
              self: true,
            },
            keyword: "rush",
            duration: "thisTurn",
          },
        ],
      },
    ],
  },
  i18n: op15Krieg008I18n,
};
