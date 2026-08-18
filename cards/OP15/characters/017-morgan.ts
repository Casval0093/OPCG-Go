import type { CharacterCard } from "@tcg/op-types";
import { op15Morgan017I18n } from "./017-morgan.i18n.ts";

export const op15Morgan017: CharacterCard = {
  id: "OP15-017",
  canonicalId: "OP15-017",
  slug: "morgan/op15-017",
  name: "Morgan",
  printings: [
    {
      id: "OP15-017",
      artId: "OP15-017",
      setCode: "OP15",
      collectorNumber: "017",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-017.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "C",
  setId: "OP15",
  cost: 5,
  power: 6000,
  counter: 1000,
  traits: ["East Blue", "Navy"],
  attribute: "slash",
  effect:
    "[Blocker]\n[Activate: Main] [Once Per Turn] You may give 1 of your opponent's rested DON!! cards to 1 of your opponent's Characters: Give up to 1 rested DON!! card to its owner's Leader or 1 of their Characters.",
  // PARKED -- the whole [Activate: Main] clause (its cost, "you may give 1 of your opponent's
  // rested DON!! cards to 1 of your opponent's Characters", and its payload, "give up to 1 rested
  // DON!! card to its owner's Leader or 1 of their Characters") is NOT encoded below; only the
  // printed [Blocker] keyword is. `giveDon` (effects/actions.ts) always draws the DON!! from
  // `getPlayer(state, controller)` -- the effect controller's own cost area -- and `GiveDonAction`
  // carries no source-player field; the `giveDon` COST is hardwired further still, to "give N of
  // your own ACTIVE DON!! to 1 of your own Leader or Character" (effects/resolution.ts). Rulings
  // #872 and #874 make the required behaviour explicit: both same-side directions are legal and
  // both cross-side ones are illegal (不可以), so the DON!! source has to FOLLOW the chosen target's
  // controller. #873 pins that the activating player picks which of the opponent's rested DON!!
  // moves, and #875 that with 0 opponent Characters, or no rested opponent DON!!, the ability
  // cannot be activated at all -- the cost is a real cost, not flavour. This is the same gap that
  // parks clauses on OP15-003, OP15-008, OP15-010, OP15-012 and OP15-015.
  effects: {
    keywords: ["blocker"],
  },
  i18n: op15Morgan017I18n,
};
