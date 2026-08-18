import type { CharacterCard } from "@tcg/op-types";
import { op15BobbyFunk050I18n } from "./050-bobby-funk.i18n.ts";

export const op15BobbyFunk050: CharacterCard = {
  id: "OP15-050",
  canonicalId: "OP15-050",
  slug: "bobby-funk/op15-050",
  name: "Bobby Funk",
  printings: [
    {
      id: "OP15-050",
      artId: "OP15-050",
      setCode: "OP15",
      collectorNumber: "050",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-050.png",
    },
  ],
  cardType: "character",
  color: ["blue"],
  rarity: "C",
  setId: "OP15",
  cost: 3,
  power: 3000,
  counter: 1000,
  traits: ["Dressrosa", "Mogaro Kingdom"],
  attribute: "strike",
  effect: "If you have [Kelly Funk], this Character gains +3000 power.",
  effects: {
    permanentEffects: [
      {
        // "If you have [Kelly Funk]" scans the whole FIELD, Leader included -- rulings #977/#979
        // (Bunkov/Antlerkov) are the worked cases, and seven pre-existing engine cards spell it
        // this way (OP02-111 Fullbody etc.). `zone: "character"` would structurally exclude a
        // Leader that carries the name, which is the bug those rulings expose.
        conditions: [
          {
            condition: "hasCard",
            player: "self",
            zone: "field",
            filters: [{ filter: "name", value: "Kelly Funk" }],
          },
        ],
        actions: [
          {
            // A permanent modifyPower is silently dropped unless its target is `self: true` or
            // `count.amount: "all"` (`getPermanentModifierTotal`, effects/permanent.ts).
            action: "modifyPower",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            value: 3000,
            duration: "permanent",
          },
        ],
      },
    ],
  },
  i18n: op15BobbyFunk050I18n,
};
