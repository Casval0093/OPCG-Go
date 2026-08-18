import type { CharacterCard } from "@tcg/op-types";
import { op15BartholomewKuma029I18n } from "./029-bartholomew-kuma.i18n.ts";

export const op15BartholomewKuma029: CharacterCard = {
  id: "OP15-029",
  canonicalId: "OP15-029",
  slug: "bartholomew-kuma/op15-029",
  name: "Bartholomew Kuma",
  printings: [
    {
      id: "OP15-029",
      artId: "OP15-029",
      setCode: "OP15",
      collectorNumber: "029",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-029.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "C",
  setId: "OP15",
  cost: 4,
  power: 5000,
  counter: 1000,
  traits: ["The Seven Warlords of the Sea", "Revolutionary Army"],
  attribute: "strike",
  effect:
    "[On Play] Up to 1 of your opponent's Characters with a cost of 5 or less cannot be rested until the end of your opponent's next End Phase.",
  effects: {
    effects: [
      {
        trigger: "onPlay",
        // Verbatim the sentence OP13/characters/032-nico-robin.ts prints, at cost 8 rather than 5,
        // and the same encoding. Note this is the ACTION-side `cannotBeRested` (a targeted, timed
        // modifier), not the static permanent-effect form OP12/characters/021-ipponmatsu.ts uses,
        // and it needs no `byPlayer`: the printed clause blocks every rest, including the
        // opponent's own effects resting their own Character.
        actions: [
          {
            action: "cannotBeRested",
            target: {
              player: "opponent",
              zones: ["character"],
              count: { amount: 1, upTo: true },
              filters: [{ filter: "cost", comparison: "lte", value: 5 }],
            },
            duration: "untilEndOfOpponentNextEndPhase",
          },
        ],
      },
    ],
  },
  i18n: op15BartholomewKuma029I18n,
};
