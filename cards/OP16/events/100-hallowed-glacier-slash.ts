import type { EventCard } from "@tcg/op-types";
import { op16HallowedGlacierSlash100I18n } from "./100-hallowed-glacier-slash.i18n.ts";

export const op16HallowedGlacierSlash100: EventCard = {
  id: "OP16-100",
  canonicalId: "OP16-100",
  slug: "hallowed-glacier-slash/op16-100",
  name: "Hallowed Glacier Slash",
  printings: [
    {
      id: "OP16-100",
      artId: "OP16-100",
      setCode: "OP16",
      collectorNumber: "100",
      rarity: "C",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP16-100.png",
    },
  ],
  cardType: "event",
  color: ["black"],
  rarity: "C",
  setId: "OP16",
  cost: 1,
  traits: ["Land of Wano"],
  effect:
    "[Main] You may rest 2 of your DON!! cards: If your opponent's Character has been K.O.'d during this turn, set your Leader [Yamato] as active.\n[Counter] Your Leader gains +3000 power during this battle.",
  // PARKED -- the [Main] clause ("You may rest 2 of your DON!! cards: If your opponent's Character
  // has been K.O.'d during this turn, set your Leader [Yamato] as active") is NOT encoded below.
  // The missing primitive is a Condition over this turn's K.O. history. `MatchState` records no
  // per-turn K.O. log at all: the only comparable per-instance field is
  // `battledOpponentCharacterOnTurn`, which records that a LEADER battled a Character, not that
  // any Character was K.O.'d, and it is set on the attacker rather than on the removed body (which
  // has left the field by then anyway). Ruling #1009 pins the semantics such a primitive would
  // need: the K.O. is cause-agnostic -- an opponent Character K.O.'d by the OPPONENT'S OWN effect
  // still satisfies it (可以) -- so it cannot be narrowed to your own effects or to battle.
  // The [Counter] half below is fully encoded and tested.
  effects: {
    effects: [
      {
        trigger: "counter",
        actions: [
          {
            action: "modifyPower",
            target: { player: "self", zones: ["leader"], count: { amount: 1 } },
            value: 3000,
            duration: "thisBattle",
          },
        ],
      },
    ],
  },
  i18n: op16HallowedGlacierSlash100I18n,
};
