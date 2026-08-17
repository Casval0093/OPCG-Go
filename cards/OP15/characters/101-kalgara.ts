import type { CharacterCard } from "@tcg/op-types";
import { op15Kalgara101I18n } from "./101-kalgara.i18n.ts";

export const op15Kalgara101: CharacterCard = {
  id: "OP15-101",
  canonicalId: "OP15-101",
  slug: "kalgara/op15-101",
  name: "Kalgara",
  printings: [
    {
      id: "OP15-101",
      artId: "OP15-101",
      setCode: "OP15",
      collectorNumber: "101",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-101.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "UC",
  setId: "OP15",
  cost: 3,
  power: 5000,
  traits: ["Jaya", "Sky Island", "Shandian Warrior"],
  attribute: "slash",
  effect:
    "[On Play] You may trash 1 card from your hand: Look at 5 cards from the top of your deck; reveal up to a total of 2 [Mont Blanc Noland] or [Shandian Warrior] type cards and add them to your hand. Then, place the rest at the bottom of your deck in any order.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        costs: [{ cost: "trashFromHand", amount: 1 }],
        actions: [
          {
            action: "search",
            lookCount: 5,
            source: { player: "self", zone: "deck" },
            revealCount: { amount: 2, upTo: true },
            // The two disjuncts are NOT the same kind of check. "[Mont Blanc Noland]" is a card
            // NAME -- no card anywhere in the pool carries a "Mont Blanc Noland" trait, and
            // OP08-109 Mont Blanc Noland's own traits are ["Jaya Botanist"], so a trait filter
            // would match nothing at all. "[Shandian Warrior] type" is a trait, and the older
            // engine printings concatenate their traits ("Sky Island Shandian Warrior"), so it
            // needs `match: "includes"`. Neither half subsumes the other: OP08-109 has the name
            // without the trait, and every Shandian Warrior has the trait without the name.
            revealFilters: [
              {
                filter: "anyOf",
                filters: [
                  { filter: "name", value: "Mont Blanc Noland" },
                  { filter: "trait", value: "Shandian Warrior", match: "includes" },
                ],
              },
            ],
            revealDestination: "hand",
            remainderPosition: "bottom",
          },
        ],
        optional: true,
      },
    ],
  },
  i18n: op15Kalgara101I18n,
};
