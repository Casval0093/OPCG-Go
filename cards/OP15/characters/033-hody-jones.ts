import type { CharacterCard } from "@tcg/op-types";
import { op15HodyJones033I18n } from "./033-hody-jones.i18n.ts";

export const op15HodyJones033: CharacterCard = {
  id: "OP15-033",
  canonicalId: "OP15-033",
  slug: "hody-jones/op15-033",
  name: "Hody Jones",
  printings: [
    {
      id: "OP15-033",
      artId: "OP15-033",
      setCode: "OP15",
      collectorNumber: "033",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-033.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "C",
  setId: "OP15",
  cost: 4,
  power: 5000,
  counter: 1000,
  traits: ["Fish-Man", "Fish-Man Island", "New Fish-Man Pirates"],
  attribute: "strike",
  effect:
    "[On Play] Set your [Fish-Man] type Leader as active. Then, add 1 card from the top of your Life cards to your hand.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        actions: [
          {
            action: "setActive",
            // "your [Fish-Man] TYPE Leader" -- a trait check on the Leader itself, expressed as a
            // filter on a `zones: ["leader"]` target rather than as a `leaderTrait` condition,
            // because a non-Fish-Man Leader must still leave the SECOND action running (see
            // below). `match: "includes"` is mandatory -- older Leaders concatenate their traits
            // into one string, e.g. OP06-035's "Fish-Man New Fish-Man Pirates". Shape from
            // OP09/characters/064-killer.ts ("Set up to 1 of your 'Kid Pirates' type Leader as
            // active"), minus its `upTo`: this card prints no "up to".
            target: {
              player: "self",
              zones: ["leader"],
              count: { amount: 1 },
              filters: [{ filter: "trait", value: "Fish-Man", match: "includes" }],
            },
          },
          {
            // Ruling #889: with ZERO Life cards the Leader is still set active (可以). Two
            // independent actions in one block, ordered as printed, is what delivers that -- the
            // Life half simply moves nothing. Do NOT fold this into a `thenActions`/`conditional`
            // shape, and do not add a `lifeCount` condition: either would make the first half
            // depend on the second. Same action shape as OP06/characters/035-hody-jones.ts, the
            // earlier printing of this character, which prints the same second sentence.
            action: "removeFromLife",
            player: "self",
            count: { amount: 1 },
            destination: "hand",
            position: "top",
          },
        ],
      },
    ],
  },
  i18n: op15HodyJones033I18n,
};
