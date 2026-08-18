import type { LeaderCard } from "@tcg/op-types";
import { op15Brook022I18n } from "./022-brook.i18n.ts";

export const op15Brook022: LeaderCard = {
  id: "OP15-022",
  canonicalId: "OP15-022",
  slug: "brook/op15-022",
  name: "Brook",
  printings: [
    {
      id: "OP15-022",
      artId: "OP15-022",
      setCode: "OP15",
      collectorNumber: "022",
      rarity: "L",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-022.png",
    },
  ],
  cardType: "leader",
  color: ["green", "black"],
  rarity: "L",
  setId: "OP15",
  power: 5000,
  life: 4,
  traits: ["Straw Hat Crew"],
  attribute: "slash",
  effect:
    "Under the rules of this game, you do not lose when your deck has 0 cards. You lose at the end of the turn in which your deck becomes 0 cards.\n[Activate: Main] [Once Per Turn] Trash 4 cards from the top of your deck. Then, if your deck has 0 cards, set up to 1 of your Characters as active.",
  // PARKED -- the first printed clause (the deck-out grace period: "you do not lose when your deck
  // has 0 cards. You lose at the end of the turn in which your deck becomes 0 cards") is NOT encoded
  // below. `replacedEvent: "loseGame"` exists and OP03/leaders/040-nami.ts uses it, but its only
  // available replacementAction is `winGame` -- there is no action that makes a player LOSE, so
  // "don't lose now, lose at end of this turn" has nothing to schedule. The missing primitive is a
  // `loseGame` action to pair with `scheduleAtEndOfTurn`, plus latch semantics: rulings #878 and
  // #954 both say the scheduled loss still happens even if the deck climbs back to 1+ cards during
  // that same turn, so the delayed loss must be armed by the 0-deck event and not re-checked at end
  // of turn. (#953 adds that negating this Leader while the deck is 0 loses immediately, and #955
  // that two Brook players deck out simultaneously rather than one surviving.)
  effects: {
    effects: [
      {
        trigger: "activateMain",
        actions: [
          // Encoded literally at the printed amount. NOTE a real engine limitation this exposes,
          // separate from the encoding: `trashFromDeck` (effects/actions.ts) computes
          // `maximum = min(amount, deck.length)` and then, when `!upTo && maximum < amount`,
          // returns having trashed NOTHING. So with 1-3 cards left this mills zero and the deck
          // never reaches 0 -- whereas ruling #879 says the activation is legal and trashes the
          // whole remaining deck, then sets a Character active. Switching to `upTo: true` is not the
          // fix and was rejected: it converts a mandatory mill into a 0..N player choice, and being
          // able to DECLINE the mill matters enormously on the one Leader whose deck hitting 0 is
          // its own clock. Reported as a finding; the sub-4-card path is not covered by the test.
          { action: "trashFromDeck", player: "self", amount: 4 },
          {
            action: "setActive",
            target: {
              player: "self",
              zones: ["character"],
              count: { amount: 1, upTo: true },
            },
            condition: {
              condition: "zoneCount",
              player: "self",
              zone: "deck",
              comparison: "eq",
              value: 0,
            },
          },
        ],
        oncePerTurn: true,
      },
    ],
  },
  i18n: op15Brook022I18n,
};
