import type { CharacterCard } from "@tcg/op-types";
import { op15Buggy012I18n } from "./012-buggy.i18n.ts";

export const op15Buggy012: CharacterCard = {
  id: "OP15-012",
  canonicalId: "OP15-012",
  slug: "buggy/op15-012",
  name: "Buggy",
  printings: [
    {
      id: "OP15-012",
      artId: "OP15-012",
      setCode: "OP15",
      collectorNumber: "012",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-012.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "C",
  setId: "OP15",
  cost: 3,
  power: 4000,
  counter: 1000,
  traits: ["East Blue", "Buggy Pirates"],
  attribute: "slash",
  effect:
    "[When Attacking] Give up to 1 rested DON!! card to its owner's Leader or 1 of their Characters.\n[On K.O.] Draw 1 card.",
  // PARKED -- the [When Attacking] clause ("Give up to 1 rested DON!! card to its owner's Leader or
  // 1 of their Characters") is NOT encoded below. `giveDon` (effects/actions.ts) always draws the
  // DON!! from `getPlayer(state, controller)` -- the effect controller's own cost area -- and
  // `GiveDonAction` carries no source-player field. "its owner's" needs the DON!! source BOUND to
  // whichever side's Leader/Character was chosen, which is strictly stronger than any fixed player:
  // ruling #865 says both same-side directions are legal and #868 says both cross-side ones are
  // illegal (不可以), so neither `player: "self"` (a narrowing) nor `player: "any"` (which would
  // hand the opponent's Character your DON!!) is a faithful encoding. Ruling #867 also pins that
  // the ACTIVATING player chooses which of the opponent's rested DON!! moves. Same gap parks
  // clauses on OP15-003, OP15-008, OP15-010, OP15-015 and OP15-017.
  effects: {
    effects: [
      {
        trigger: "onKo",
        actions: [{ action: "draw", player: "self", amount: 1 }],
      },
    ],
  },
  i18n: op15Buggy012I18n,
};
