import { describe, expect, test } from "vite-plus/test";
import type { LeaderCard } from "@tcg/op-types";
import {
  eb01Doma005,
  eb01MountainGod018,
  op16Antlerkov029,
  op16Bunkov025,
  op16CaptainBuggySOurSavior057,
  op16PortgasDAce001,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// Ruling #979's hypothetical -- a Leader whose own effect grants it every card's name -- is
// simulated directly at the static level: a synthetic Leader literally named "Bunkov"
// reproduces exactly what such a grant would look like to cardNames() (shared.ts), with no
// dependency on a grantName action the engine doesn't have. cardName() (shared.ts) resolves
// from `i18n.en.name`, not the top-level `name` field, so both have to be overridden or the
// filter matches against the spread-from card's original name instead.
const bunkovNamedLeader: LeaderCard = {
  ...op16PortgasDAce001,
  id: "TEST-OP16-029-BUNKOV-LEADER",
  canonicalId: "TEST-OP16-029-BUNKOV-LEADER",
  name: "Bunkov",
  i18n: { en: { ...op16PortgasDAce001.i18n.en, name: "Bunkov" } },
};

registerCards([bunkovNamedLeader]);

describe("OP16-029 Antlerkov", () => {
  test("with Bunkov on field, plays only a cost-2-or-less Character from hand when attacking", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [{ card: op16Antlerkov029, playedOnTurn: 0 }, op16Bunkov025],
        hand: [eb01Doma005, eb01MountainGod018],
      },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );
    const antlerkovId = engine.findCardInZone("south", "character", op16Antlerkov029);
    const eligibleId = engine.findCardInZone("south", "hand", eb01Doma005);
    const tooExpensiveId = engine.findCardInZone("south", "hand", eb01MountainGod018);

    engine.declareAttack(antlerkovId, engine.leader("north"), "south");

    const play = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    expect(play?.kind).toBe("selectEntity");
    if (play?.kind !== "selectEntity") throw new Error("Expected Antlerkov's hand-play choice.");
    expect(play.candidates.map((candidate) => candidate.ref.id)).toEqual([eligibleId]);
    expect(play.candidates.map((candidate) => candidate.ref.id)).not.toContain(tooExpensiveId);
    engine.resolveDecision("effectPlaySelection", { selectedIds: [eligibleId] }, "south");

    expect(engine.findCardInZone("south", "character", eb01Doma005)).toBe(eligibleId);
    expect(engine.getView("south").prompts).toHaveLength(0);
  });

  test("without Bunkov on field, attacking does not offer the hand-play at all", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [{ card: op16Antlerkov029, playedOnTurn: 0 }],
        hand: [eb01Doma005],
      },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );
    const antlerkovId = engine.findCardInZone("south", "character", op16Antlerkov029);

    engine.declareAttack(antlerkovId, engine.leader("north"), "south");

    const view = engine.getView("south");
    expect(view.prompts).toHaveLength(0);
    expect(view.players.south.hand.map((card) => card.instanceId)).toContain(
      engine.findCardInZone("south", "hand", eb01Doma005),
    );
  });

  test('ruling #979: a Leader named "Bunkov" alone satisfies "if you have [Bunkov]", with zero Bunkov Characters on field', () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: bunkovNamedLeader,
        character: [{ card: op16Antlerkov029, playedOnTurn: 0 }],
        hand: [eb01Doma005],
      },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );
    const antlerkovId = engine.findCardInZone("south", "character", op16Antlerkov029);
    const eligibleId = engine.findCardInZone("south", "hand", eb01Doma005);

    engine.declareAttack(antlerkovId, engine.leader("north"), "south");

    // Fails before the zone: "field" fix -- zone: "character" structurally excludes the
    // Leader, so this prompt would never appear even though the Leader is named Bunkov.
    const play = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    expect(play?.kind).toBe("selectEntity");
    if (play?.kind !== "selectEntity") throw new Error("Expected Antlerkov's hand-play choice.");
    expect(play.candidates.map((candidate) => candidate.ref.id)).toEqual([eligibleId]);
  });

  test("the hand-play is restricted to Character cards -- a cheap Event does not qualify", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [{ card: op16Antlerkov029, playedOnTurn: 0 }, op16Bunkov025],
        // op16CaptainBuggySOurSavior057 costs 1 -- within "cost of 2 or less" -- so only the
        // `cardCategory: "character"` filter keeps it out of the candidates.
        hand: [eb01Doma005, op16CaptainBuggySOurSavior057],
      },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );
    const antlerkovId = engine.findCardInZone("south", "character", op16Antlerkov029);
    const eligibleId = engine.findCardInZone("south", "hand", eb01Doma005);
    const eventId = engine.findCardInZone("south", "hand", op16CaptainBuggySOurSavior057);

    engine.declareAttack(antlerkovId, engine.leader("north"), "south");

    const play = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    expect(play?.kind).toBe("selectEntity");
    if (play?.kind !== "selectEntity") throw new Error("Expected Antlerkov's hand-play choice.");
    expect(play.candidates.map((candidate) => candidate.ref.id)).toEqual([eligibleId]);
    expect(play.candidates.map((candidate) => candidate.ref.id)).not.toContain(eventId);
  });
});
