import type { CharacterCard } from "@tcg/op-types";
import { op15Yorki034I18n } from "./034-yorki.i18n.ts";

export const op15Yorki034: CharacterCard = {
  id: "OP15-034",
  canonicalId: "OP15-034",
  slug: "yorki/op15-034",
  name: "Yorki",
  printings: [
    {
      id: "OP15-034",
      artId: "OP15-034",
      setCode: "OP15",
      collectorNumber: "034",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-034.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "C",
  setId: "OP15",
  cost: 1,
  power: 0,
  counter: 2000,
  traits: ["Rumbar Pirates"],
  attribute: "slash",
  effect: "[Your Turn] [On Play] Up to 1 of your [Brook] cards gains +2000 power during this turn.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        // Verbatim the sentence EB03/characters/032-charlotte-flampe.ts prints (with a different
        // bracketed name), and the same encoding: [Your Turn] is a `turn` condition on the block,
        // not decoration. It is reachable and load-bearing -- an effect that plays a Character
        // during the opponent's turn fires this [On Play] with the condition false.
        conditions: [{ condition: "turn", value: "your" }],
        actions: [
          {
            action: "modifyPower",
            target: {
              player: "self",
              // "[Brook] CARDS", a bracketed card NAME, and OP15-022 Brook is a Leader while
              // OP15-032 Brook (and five older printings) are Characters -- so the pool has to be
              // Leader + Character, not just the character area. Same reasoning as this set's
              // OP15-038 for "[Krieg] cards". No Stage or Event is named Brook and a DON!! card
              // has no name, so the wider `["leader","character","stage","costArea"]` spelling
              // EB03-032 uses would be inert padding here.
              zones: ["leader", "character"],
              count: { amount: 1, upTo: true },
              filters: [{ filter: "name", value: "Brook" }],
            },
            value: 2000,
            duration: "thisTurn",
          },
        ],
      },
    ],
  },
  i18n: op15Yorki034I18n,
};
