import type { LeaderCard } from "@tcg/op-types";
import { op16PortgasDAce001I18n } from "./001-portgas-d-ace.i18n.ts";

export const op16PortgasDAce001: LeaderCard = {
  id: "OP16-001",
  canonicalId: "OP16-001",
  slug: "portgas-d-ace/op16-001",
  name: "Portgas.D.Ace",
  printings: [
    {
      id: "OP16-001",
      artId: "OP16-001",
      setCode: "OP16",
      collectorNumber: "001",
      rarity: "L",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-001.png",
    },
  ],
  cardType: "leader",
  color: ["red"],
  rarity: "L",
  setId: "OP16",
  power: 5000,
  life: 5,
  traits: ["Whitebeard Pirates"],
  attribute: "special",
  effect:
    '[Activate: Main] [Once Per Turn] Up to 1 of your [Monkey.D.Luffy] Characters or up to 1 of your Characters with a type including "Whitebeard Pirates", with 8000 power or more, gains [Rush] during this turn.',
  i18n: op16PortgasDAce001I18n,
};
