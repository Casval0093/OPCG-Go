import type { CharacterCard } from "@tcg/op-types";
import { op15MonkeyDLuffy092I18n } from "./092-monkey-d-luffy.i18n.ts";

export const op15MonkeyDLuffy092: CharacterCard = {
  id: "OP15-092",
  canonicalId: "OP15-092",
  slug: "monkey-d-luffy/op15-092",
  name: "Monkey.D.Luffy",
  printings: [
    {
      id: "OP15-092",
      artId: "OP15-092",
      setCode: "OP15",
      collectorNumber: "092",
      rarity: "R",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-092.png",
    },
  ],
  cardType: "character",
  color: ["black"],
  rarity: "R",
  setId: "OP15",
  cost: 7,
  power: 7000,
  counter: 1000,
  traits: ["Straw Hat Crew"],
  attribute: "special",
  effect:
    "Apply each of the following effects based on the number of cards in your trash:\n• If there are 10 or more cards, this Character's base power becomes 9000 and it gains +10 cost.\n• If you have 20 or more cards, during your opponent's turn, your Leader's base power becomes 7000.\n• If you have 30 or more cards, this Character gains +1000 power.",
  // PARKED -- two of the three printed bullets set a LITERAL base power and are NOT encoded, on
  // the already-registered `setBasePowerLiteral` gap (data/parked-clauses.json; it also blocks
  // OP16-058, OP16-106, OP16-015). Re-confirmed against this card and ruling #927:
  //   * bullet 1, "this Character's base power becomes 9000"
  //   * bullet 2, "during your opponent's turn, your Leader's base power becomes 7000"
  // `setPower` is the only literal power setter and it is a TOTAL-power set: it computes
  // `value - getCardPower(target)` at resolution (effects/actions.ts) and adds that as a delta.
  // Ruling #927 makes the difference observable rather than theoretical -- at 30 cards in the
  // trash ALL THREE bullets apply at once (三条效果全部适用), so bullet 1 and bullet 3 must
  // STACK to 10000, whereas `setPower` measured after bullet 3 would clamp the total back to
  // 9000. It is also unusable here for a second, independent reason: `getCardPower` consults
  // `getPermanentModifierTotal` and `getPermanentSetCost`'s power twin does not exist, so a
  // `setPower` inside `permanentEffects` is never read at all. `setBasePowerFrom` has the right
  // arithmetic but needs a source CARD on the field to copy from; `copyPower` only ever
  // retargets the effect's own card. Bullet 2 additionally needs the Leader as the target.
  // What IS encoded below: bullet 1's "+10 cost" half, and bullet 3's "+1000 power".
  effects: {
    permanentEffects: [
      {
        conditions: [
          { condition: "zoneCount", player: "self", zone: "trash", comparison: "gte", value: 10 },
        ],
        actions: [
          {
            action: "modifyCost",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            value: 10,
          },
        ],
      },
      {
        // A separate block, not a second action on the first: ruling #927 says the bullets are
        // independent thresholds that all apply once passed, not exclusive tiers.
        conditions: [
          { condition: "zoneCount", player: "self", zone: "trash", comparison: "gte", value: 30 },
        ],
        actions: [
          {
            action: "modifyPower",
            target: { player: "self", zones: ["character"], count: { amount: 1 }, self: true },
            value: 1000,
            duration: "permanent",
          },
        ],
      },
    ],
  },
  i18n: op15MonkeyDLuffy092I18n,
};
