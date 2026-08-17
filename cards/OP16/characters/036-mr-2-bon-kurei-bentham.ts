import type { CharacterCard } from "@tcg/op-types";
import { op16Mr2BonKureiBentham036I18n } from "./036-mr-2-bon-kurei-bentham.i18n.ts";

export const op16Mr2BonKureiBentham036: CharacterCard = {
  id: "OP16-036",
  canonicalId: "OP16-036",
  slug: "mr-2-bon-kurei-bentham/op16-036",
  name: "Mr.2.Bon.Kurei(Bentham)",
  printings: [
    {
      id: "OP16-036",
      artId: "OP16-036",
      setCode: "OP16",
      collectorNumber: "036",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-036.png",
    },
  ],
  cardType: "character",
  color: ["green"],
  rarity: "C",
  setId: "OP16",
  cost: 4,
  power: 1000,
  counter: 1000,
  traits: ["Impel Down", "Former Baroque Works"],
  attribute: "strike",
  effect:
    "[On Play] Rest up to 1 of your opponent's Characters with a cost of 4 or less.\n[When Attacking] This Character's base power becomes the same as your opponent's Leader during this turn.",
  i18n: op16Mr2BonKureiBentham036I18n,
};
