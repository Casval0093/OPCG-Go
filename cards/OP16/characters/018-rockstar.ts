import type { CharacterCard } from "@tcg/op-types";
import { op16Rockstar018I18n } from "./018-rockstar.i18n.ts";

export const op16Rockstar018: CharacterCard = {
  id: "OP16-018",
  canonicalId: "OP16-018",
  slug: "rockstar/op16-018",
  name: "Rockstar",
  printings: [
    {
      id: "OP16-018",
      artId: "OP16-018",
      setCode: "OP16",
      collectorNumber: "018",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-018.png",
    },
  ],
  cardType: "character",
  color: ["red"],
  rarity: "C",
  setId: "OP16",
  cost: 1,
  power: 2000,
  counter: 2000,
  traits: ["Red-Haired Pirates"],
  attribute: "slash",
  effect:
    "[Once Per Turn] If your [Red-Haired Pirates] type Character would be K.O.'d, you may trash 1 Character card with 6000 power or more from your hand instead.",
  i18n: op16Rockstar018I18n,
};
