import { describe, expect, test } from "vite-plus/test";
import {
  op01Sai012,
  op02Kingdew006,
  op05ElThor114,
  op05Enel098,
  op06Genbo105,
  op15Nami108,
} from "@tcg/op-cards";

import { OnePieceTestEngine, type PlayerFixture } from "../../../src/index.ts";

const SOUTH_ACTS = { firstPlayer: "north", activeSeat: "south" } as const;

function namiOnPlay(deck: PlayerFixture["deck"]) {
  return OnePieceTestEngine.create(
    { leaderCardId: op05Enel098, hand: [op15Nami108], deck, activeDon: 1 },
    {},
    SOUTH_ACTS,
  );
}

describe("OP15-108 Nami", () => {
  test("[On Play] looks at 3, takes the [Sky Island] card and bottoms the rest", () => {
    const engine = namiOnPlay([
      op06Genbo105,
      op01Sai012,
      op02Kingdew006,
      // Never looked at -- the remainder is placed behind this tail.
      op01Sai012,
      op01Sai012,
    ]);
    const deckBefore = [...engine.getState().players.south.deck];
    const [genboId, saiId, kingdewId, ...untouchedTail] = deckBefore;

    engine.playCard(op15Nami108, "south");

    const search = engine.pendingDecision("effectSearchSelection", "south").steps[0];
    if (search?.kind !== "selectEntity") throw new Error("Expected a search selection.");
    // `lookCount: 3` is single-digit and invisible to the mutation checker; pin it by hand.
    expect(search.candidates).toHaveLength(3);
    expect(
      search.candidates.filter((candidate) => candidate.legal).map((candidate) => candidate.ref.id),
    ).toEqual([genboId]);

    engine.resolveDecision("effectSearchSelection", { selectedIds: [genboId ?? ""] }, "south");
    engine.resolveDecision(
      "effectSearchRemainderOrder",
      { selectedIds: [saiId ?? "", kingdewId ?? ""] },
      "south",
    );

    const state = engine.getState();
    expect(state.cards[genboId ?? ""]?.zone).toBe("hand");
    expect(state.players.south.deck).toEqual([...untouchedTail, saiId, kingdewId]);
  });

  test('a [Sky Island] EVENT qualifies -- the card prints "card", not "Character"', () => {
    // op05ElThor114 is a cost-1 [Sky Island] Event. A `cardCategory: "character"` filter here
    // would be wrong, and this is what would catch it.
    const engine = namiOnPlay([op05ElThor114, op01Sai012, op01Sai012, op01Sai012]);
    const elThorId = engine.getState().players.south.deck[0];

    engine.playCard(op15Nami108, "south");

    const search = engine.pendingDecision("effectSearchSelection", "south").steps[0];
    if (search?.kind !== "selectEntity") throw new Error("Expected a search selection.");
    expect(
      search.candidates.filter((candidate) => candidate.legal).map((candidate) => candidate.ref.id),
    ).toEqual([elThorId]);
  });

  test("with no [Sky Island] card among the three, the top 3 still go to the bottom", () => {
    const engine = namiOnPlay([op01Sai012, op01Sai012, op02Kingdew006, op01Sai012, op01Sai012]);
    const deckBefore = [...engine.getState().players.south.deck];
    const lookedAt = deckBefore.slice(0, 3);
    const untouchedTail = deckBefore.slice(3);

    engine.playCard(op15Nami108, "south");

    const search = engine.pendingDecision("effectSearchSelection", "south").steps[0];
    if (search?.kind !== "selectEntity") throw new Error("Expected a search selection.");
    expect(search.candidates.filter((candidate) => candidate.legal)).toHaveLength(0);

    engine.resolveDecision("effectSearchSelection", { selectedIds: [] }, "south");
    engine.resolveDecision(
      "effectSearchRemainderOrder",
      { selectedIds: lookedAt.filter((id): id is string => id !== undefined) },
      "south",
    );

    expect(engine.getState().players.south.deck).toEqual([...untouchedTail, ...lookedAt]);
    expect(engine.getState().players.south.hand).toHaveLength(0);
  });
});
