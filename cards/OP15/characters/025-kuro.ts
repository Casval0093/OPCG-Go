import type { CharacterCard } from "@tcg/op-types";
import { op15Kuro025I18n } from "./025-kuro.i18n.ts";

export const op15Kuro025: CharacterCard = {
  id: "OP15-025",
  canonicalId: "OP15-025",
  slug: "kuro/op15-025",
  name: "Kuro",
  printings: [
    {
      id: "OP15-025",
      artId: "OP15-025",
      setCode: "OP15",
      collectorNumber: "025",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-025.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "R",
  setId: "OP15",
  cost: 7,
  power: 7000,
  counter: 1000,
  traits: ["East Blue", "Black Cat Pirates"],
  attribute: "slash",
  effect:
    "[Blocker]\n[On Play] Give up to 2 DON!! cards from your opponent's cost area to 1 of your opponent's Characters. Then, at the end of this turn, up to 1 rested Character with 3 or more DON!! cards given will not become active in your opponent's next Refresh Phase.",
  // PARKED -- the whole [On Play] is NOT encoded; only the printed [Blocker] keyword is. Both of
  // its halves are blocked, by two DIFFERENT already-registered primitives:
  //
  //   1. "Give up to 2 DON!! cards from your OPPONENT'S cost area" -- `giveDonSourcePlayer`
  //      (data/parked-clauses.json). `giveDon` always draws from `getPlayer(state, controller)`;
  //      the fixed-opponent-source facet is exactly what OP15-008/OP15-015 already wait on.
  //      Ruling #885 pins that the player activating the effect picks which of the opponent's
  //      DON!! move, and #951 that active DON!! qualify as well as rested ones.
  //   2. "up to 1 rested Character with 3 OR MORE DON!! cards given" -- `attachedDonTargetFilter`
  //      (data/parked-clauses.json), the same missing per-candidate filter that parks OP15-001,
  //      OP15-015, OP15-018 and OP15-038. `scheduleAtEndOfTurn` + `freeze` would otherwise cover
  //      the rest of this half.
  //
  // Rulings #952 and #956 both bear on the second half specifically and would have to survive any
  // future encoding: giving ZERO DON!! in the first half still runs the second (可以), and the
  // second half still runs even if Kuro has left the field or been negated before end of turn
  // (可以) -- i.e. it is a scheduled effect, not a delayed one that re-reads its source.
  effects: {
    keywords: ["blocker"],
  },
  i18n: op15Kuro025I18n,
};
