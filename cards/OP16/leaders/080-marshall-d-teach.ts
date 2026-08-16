import type { LeaderCard } from "@tcg/op-types";
import { op16MarshallDTeach080I18n } from "./080-marshall-d-teach.i18n.ts";

export const op16MarshallDTeach080: LeaderCard = {
  id: "OP16-080",
  canonicalId: "OP16-080",
  slug: "marshall-d-teach/op16-080",
  name: "Marshall.D.Teach",
  printings: [
    {
      id: "OP16-080",
      artId: "OP16-080",
      setCode: "OP16",
      collectorNumber: "080",
      rarity: "L",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-080.png",
    },
  ],
  cardType: "leader",
  color: ["black", "yellow"],
  rarity: "L",
  setId: "OP16",
  power: 5000,
  life: 4,
  traits: ["The Seven Warlords of the Sea", "Blackbeard Pirates"],
  attribute: "special",
  effect:
    "[Opponent's Turn] All of your Characters gain +1 cost.\n[On Your Opponent's Attack] [Once Per Turn] You may trash 1 card with a [Trigger] from your hand: Change the target of that attack to this Leader or to one of your [Blackbeard Pirates] type Character cards.",
  i18n: op16MarshallDTeach080I18n,
};
