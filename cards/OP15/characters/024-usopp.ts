import type { CharacterCard } from "@tcg/op-types";
import { op15Usopp024I18n } from "./024-usopp.i18n.ts";

export const op15Usopp024: CharacterCard = {
  id: "OP15-024",
  canonicalId: "OP15-024",
  slug: "usopp/op15-024",
  name: "Usopp",
  printings: [
    {
      id: "OP15-024",
      artId: "OP15-024",
      setCode: "OP15",
      collectorNumber: "024",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-024.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "R",
  setId: "OP15",
  cost: 4,
  power: 5000,
  counter: 1000,
  traits: ["Straw Hat Crew"],
  attribute: "ranged",
  effect:
    "[Opponent's Turn] This Character cannot be rested by your opponent's Leader and Character effects and gains [Blocker].\n[On K.O.] Rest up to 1 of your opponent's Leader or Character cards with a cost of 7 or less.",
  // PARKED -- half of the first sentence. "[Opponent's Turn] This Character cannot be rested by
  // your opponent's LEADER AND CHARACTER effects" is NOT encoded; only the "and gains [Blocker]"
  // half is. `cannotBeRested` (types/effect/action.ts) carries `byPlayer?: "self" | "opponent"`
  // and nothing else, and `isRestPreventedByPermanentEffect` (effects/permanent.ts) checks only
  // the resting effect's CONTROLLER -- there is no test of the resting card's own type. So
  // `byPlayer: "opponent"` would encode the strictly broader "cannot be rested by your opponent's
  // effects" that OP12/characters/021-ipponmatsu.ts actually prints, and would wrongly switch off
  // an opponent Event or Stage that rests (OP05-038 Charlestone's [Trigger] and OP04-038 both do
  // exactly that). Missing primitive: a source-card-type restriction on `cannotBeRested`, i.e. a
  // `bySourceCardType?: OPCardType[]` alongside the existing `byPlayer`. Not in
  // data/parked-clauses.json yet -- no earlier batch hit it.
  effects: {
    permanentEffects: [
      {
        // The [Opponent's Turn] [Blocker] grant. Shape from OP15/characters/011-pearl.ts, which
        // prints the same "[Opponent's Turn] ... this Character gains [Blocker]" static grant;
        // `self: true` is mandatory rather than stylistic (see that card's own note).
        conditions: [{ condition: "turn", value: "opponent" }],
        actions: [
          {
            action: "grantKeyword",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            keyword: "blocker",
            duration: "permanent",
          },
        ],
      },
    ],
    effects: [
      {
        trigger: "onKo",
        actions: [
          {
            action: "rest",
            // "Leader or Character cards" -- both zones, and the cost filter is not vacuous on the
            // Leader: `baseCost()` (shared.ts) returns 0 for a leader, so a Leader always passes
            // "cost of 7 or less" while a cost-8+ Character does not. Same target shape as
            // OP05/events/038-charlestone.ts's [Trigger] ("rest up to 1 of your opponent's Leader
            // or Character cards with a cost of 3 or less"). No `state` filter: the printed text
            // does not restrict to active cards, and the engine's own rest pool drops
            // already-rested candidates upstream.
            target: {
              player: "opponent",
              zones: ["leader", "character"],
              count: { amount: 1, upTo: true },
              filters: [{ filter: "cost", comparison: "lte", value: 7 }],
            },
          },
        ],
      },
    ],
  },
  i18n: op15Usopp024I18n,
};
