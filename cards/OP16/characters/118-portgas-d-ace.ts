import type { CharacterCard } from "@tcg/op-types";
import { op16PortgasDAce118I18n } from "./118-portgas-d-ace.i18n.ts";

export const op16PortgasDAce118: CharacterCard = {
  id: "OP16-118",
  canonicalId: "OP16-118",
  slug: "portgas-d-ace/op16-118",
  name: "Portgas.D.Ace",
  printings: [
    {
      id: "OP16-118",
      artId: "OP16-118",
      setCode: "OP16",
      collectorNumber: "118",
      rarity: "SEC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-118.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "SEC",
  setId: "OP16",
  cost: 5,
  power: 6000,
  counter: 1000,
  traits: ["Whitebeard Pirates"],
  attribute: "special",
  effect:
    'The counter of all of your Character cards with 8000 power in your hand becomes +2000.\n[On Play]/[On K.O.] Look at 5 cards from the top of your deck; reveal up to 1 [Monkey.D.Luffy] or up to 1 card with a type including "Whitebeard Pirates" and add it to your hand. Then, place the rest at the bottom of your deck in any order.',
  // PARKED -- the first printed clause, "The counter of all of your Character cards with 8000
  // power in your hand becomes +2000", is NOT encoded. `modifyCounter` is additive:
  // getCardCounter() (shared.ts) is `(card.counter ?? 0) + getPermanentModifierTotal(..., "counter")`.
  // Rulings #1016 and #1017 both require a SET, not an add -- a hand Character printed
  // "Counter +1000" must be usable as exactly +2000 (not 3000), and two copies of this card must
  // not stack to +4000. There is no set-counter action in the DSL (`setCost` is the only "becomes"
  // verb, and it has its own resolution path in getPermanentSetCost). Missing primitive:
  // `setCounterLiteral`. See data/parked-clauses.json.
  effects: {
    effects: [
      {
        trigger: "onPlay",
        actions: [
          {
            action: "search",
            lookCount: 5,
            source: { player: "self", zone: "deck" },
            revealCount: { amount: 1, upTo: true },
            // "[Monkey.D.Luffy] OR a type including Whitebeard Pirates" -- a disjunction, so
            // `revealFilterMode: "any"`. `[Monkey.D.Luffy]` is a bracketed NAME and the second
            // half says "1 card", so neither disjunct carries a card-type restriction.
            revealFilters: [
              { filter: "name", value: "Monkey.D.Luffy" },
              { filter: "trait", value: ["Whitebeard Pirates", "Former Whitebeard Pirates", "Whitebeard Pirates Allies"], match: "includes" },
            ],
            revealFilterMode: "any",
            revealDestination: "hand",
            remainderPosition: "bottom",
          },
        ],
      },
      {
        // [On Play]/[On K.O.] is two blocks with duplicated actions; there is no combined trigger.
        trigger: "onKo",
        actions: [
          {
            action: "search",
            lookCount: 5,
            source: { player: "self", zone: "deck" },
            revealCount: { amount: 1, upTo: true },
            revealFilters: [
              { filter: "name", value: "Monkey.D.Luffy" },
              { filter: "trait", value: ["Whitebeard Pirates", "Former Whitebeard Pirates", "Whitebeard Pirates Allies"], match: "includes" },
            ],
            revealFilterMode: "any",
            revealDestination: "hand",
            remainderPosition: "bottom",
          },
        ],
      },
    ],
  },
  i18n: op16PortgasDAce118I18n,
};
