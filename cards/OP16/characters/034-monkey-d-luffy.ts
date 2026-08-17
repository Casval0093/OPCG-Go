import type { CharacterCard } from "@tcg/op-types";
import { op16MonkeyDLuffy034I18n } from "./034-monkey-d-luffy.i18n.ts";

export const op16MonkeyDLuffy034: CharacterCard = {
  id: "OP16-034",
  canonicalId: "OP16-034",
  slug: "monkey-d-luffy/op16-034",
  name: "Monkey.D.Luffy",
  printings: [
    {
      id: "OP16-034",
      artId: "OP16-034",
      setCode: "OP16",
      collectorNumber: "034",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-034.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "R",
  setId: "OP16",
  cost: 1,
  power: 0,
  counter: 1000,
  traits: ["Impel Down", "Straw Hat Crew"],
  attribute: "strike",
  effect:
    "[DON!! x1] [Your Turn] This Character gains +1000 power for each of your Characters with a different card name.\n[On Play] Look at 3 cards from the top of your deck; reveal up to 1 [Impel Down] type card and add it to your hand. Then, place the rest at the bottom of your deck in any order.",
  // PARKED -- the "[DON!! x1] [Your Turn] This Character gains +1000 power for each of your
  // Characters with a different card name" clause is NOT encoded below. `modifyPower` can scale
  // by a card count (`valuePerCardGroup`), but that operator floors a raw candidate count by a
  // group size (effects/permanent.ts) and has no notion of distinct card NAMES; `differentNames`
  // exists only on the play/playGrouped Actions. This is the same absence already parked as
  // `distinctNameCountCondition` for OP16-038, at a different DSL site. Rulings #982/#983/#984
  // make the distinction load-bearing rather than academic: with this Luffy plus two copies of
  // EB04-038 (a card whose own effect gives it two names) the answer is +2000, not +3000 --
  // identical cards never count as differently named, however many names they are granted --
  // while Luffy + OP13-031 Trafalgar Law + one EB04-038 is +3000. A `valuePerCardGroup` with
  // `size: 1` gets both of those wrong. Ruling #981 additionally pins that the card counts
  // itself, so the count is never zero while it is on the field.
  effects: {
    effects: [
      {
        trigger: "onPlay",
        // "[Impel Down] type" is the trait 《因佩尔地狱》. Same search shape as
        // OP02/stages/092-impel-down.ts, which prints this clause verbatim.
        actions: [
          {
            action: "search",
            lookCount: 3,
            source: { player: "self", zone: "deck" },
            revealCount: { amount: 1, upTo: true },
            revealFilters: [{ filter: "trait", value: "Impel Down", match: "includes" }],
            revealDestination: "hand",
            remainderPosition: "bottom",
          },
        ],
      },
    ],
  },
  i18n: op16MonkeyDLuffy034I18n,
};
