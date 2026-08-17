import type { CharacterCard } from "@tcg/op-types";
import { op15JewelryBonney105I18n } from "./105-jewelry-bonney.i18n.ts";

export const op15JewelryBonney105: CharacterCard = {
  id: "OP15-105",
  canonicalId: "OP15-105",
  slug: "jewelry-bonney/op15-105",
  name: "Jewelry Bonney",
  printings: [
    {
      id: "OP15-105",
      artId: "OP15-105",
      setCode: "OP15",
      collectorNumber: "105",
      rarity: "UC",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-105.png",
    },
  ],
  cardType: "character",
  color: ["yellow"],
  rarity: "UC",
  setId: "OP15",
  cost: 1,
  power: 2000,
  counter: 2000,
  traits: ["Supernovas", "Bonney Pirates"],
  attribute: "special",
  effect:
    "If your Character with 7000 base power or less would be removed from the field by your opponent's effect, you may add 1 card from the top of your Life cards to your hand instead.",
  effects: {
    replacementEffects: [
      {
        // `removeFromField` + `source: "opponentEffect"`, NOT the `leaveField` shape OP15-098
        // needs. The two cards read almost identically in English but their SC differs on the one
        // word that decides it: OP15-098 is 因对方而将要离开场上 (cause-agnostic, so a battle K.O.
        // counts -- ruling #957), while this card is 因对方的效果将要离开场上 -- "because of the
        // opponent's EFFECT". `findKoReplacement` searches ["ko","leaveField"] on a battle cause,
        // so `removeFromField` correctly never fires in battle, and `source: "opponentEffect"`
        // additionally requires `koCause === "effect"`. Same encoding as OP16-014 Marco, whose
        // printed wording is the same "by your opponent's effect".
        replacedEvent: "removeFromField",
        source: "opponentEffect",
        target: {
          player: "self",
          zones: ["character"],
          count: { amount: 1 },
          // No `excludeSelf`: ruling #939 says this Character may replace its OWN removal (可以),
          // and at 2000 base power it passes its own filter. `findRemovalReplacement` searches
          // the removed instance itself first, so the unfiltered self-inclusion is what makes
          // that work -- the OP16-045/#989 lesson, in replacement form.
          filters: [{ filter: "basePower", comparison: "lte", value: 7000 }],
        },
        replacementAction: {
          action: "removeFromLife",
          player: "self",
          count: { amount: 1 },
          destination: "hand",
          position: "top",
        },
        // No `lifeCount` condition: `replacementActionIsAvailable` already rejects a
        // `removeFromLife` of 1 against an empty Life area, so the replacement is simply not
        // offered at 0 Life. Same reasoning as OP15-098 and ruling #933.
      },
    ],
  },
  i18n: op15JewelryBonney105I18n,
};
