import { describe, expect, test } from "vite-plus/test";
import type { LeaderCard } from "@tcg/op-types";
import {
  eb01Doma005,
  eb01MountainGod018,
  op01Sai012,
  op03Namule007,
  op16Antlerkov029,
  op16Bunkov025,
  op16MobyDick021,
  op16PortgasDAce001,
} from "@tcg/op-cards";

import { registerCards } from "../../../../cards/src/runtime-catalog.ts";
import { OnePieceTestEngine } from "../../../src/index.ts";

// Ruling #977's hypothetical -- a Leader whose own effect grants it every card's name -- is
// simulated statically: a synthetic Leader literally named "Antlerkov" is exactly what such a
// grant looks like to cardNames() (shared.ts), with no dependency on a grantName action the
// engine does not have. cardName() resolves from `i18n.en.name`, NOT the top-level `name`
// field, so both have to be overridden or the filter silently keeps matching the spread-from
// card's original name.
const antlerkovNamedLeader: LeaderCard = {
  ...op16PortgasDAce001,
  id: "TEST-OP16-025-ANTLERKOV-LEADER",
  canonicalId: "TEST-OP16-025-ANTLERKOV-LEADER",
  name: "Antlerkov",
  i18n: { en: { ...op16PortgasDAce001.i18n.en, name: "Antlerkov" } },
};

registerCards([antlerkovNamedLeader]);

describe("OP16-025 Bunkov", () => {
  test("with Antlerkov on field, plays only a cost-2-or-less Character from hand when attacking", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [{ card: op16Bunkov025, playedOnTurn: 0 }, op16Antlerkov029],
        // eb01Doma005 is cost 1 (eligible); eb01MountainGod018 is cost 5 (excluded).
        hand: [eb01Doma005, eb01MountainGod018],
      },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );
    const bunkovId = engine.findCardInZone("south", "character", op16Bunkov025);
    const eligibleId = engine.findCardInZone("south", "hand", eb01Doma005);
    const tooExpensiveId = engine.findCardInZone("south", "hand", eb01MountainGod018);

    engine.declareAttack(bunkovId, engine.leader("north"), "south");

    const play = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    expect(play?.kind).toBe("selectEntity");
    if (play?.kind !== "selectEntity") throw new Error("Expected Bunkov's hand-play choice.");
    expect(play.candidates.map((candidate) => candidate.ref.id)).toEqual([eligibleId]);
    expect(play.candidates.map((candidate) => candidate.ref.id)).not.toContain(tooExpensiveId);
    engine.resolveDecision("effectPlaySelection", { selectedIds: [eligibleId] }, "south");

    expect(engine.findCardInZone("south", "character", eb01Doma005)).toBe(eligibleId);
    expect(engine.getView("south").prompts).toHaveLength(0);
  });

  test("a cost-2 Character IS eligible and a cost-3 is not -- the boundary is exactly 2", () => {
    // The mutation checker never perturbs a single-digit `value` (cards/ENCODING.md, rule 0), so
    // the number 2 itself is pinned by hand: a body exactly on the line plus one clear of it.
    const engine = OnePieceTestEngine.create(
      {
        character: [{ card: op16Bunkov025, playedOnTurn: 0 }, op16Antlerkov029],
        hand: [op01Sai012, op03Namule007],
      },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );
    const bunkovId = engine.findCardInZone("south", "character", op16Bunkov025);
    const onTheLineId = engine.findCardInZone("south", "hand", op01Sai012);
    const overTheLineId = engine.findCardInZone("south", "hand", op03Namule007);

    engine.declareAttack(bunkovId, engine.leader("north"), "south");

    const play = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    expect(play?.kind).toBe("selectEntity");
    if (play?.kind !== "selectEntity") throw new Error("Expected Bunkov's hand-play choice.");
    expect(play.candidates.map((candidate) => candidate.ref.id)).toEqual([onTheLineId]);
    expect(play.candidates.map((candidate) => candidate.ref.id)).not.toContain(overTheLineId);
  });

  test("without Antlerkov on field, attacking does not offer the hand-play at all", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [{ card: op16Bunkov025, playedOnTurn: 0 }],
        hand: [eb01Doma005],
      },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );
    const bunkovId = engine.findCardInZone("south", "character", op16Bunkov025);

    engine.declareAttack(bunkovId, engine.leader("north"), "south");

    const view = engine.getView("south");
    expect(view.prompts).toHaveLength(0);
    expect(view.players.south.hand.map((card) => card.instanceId)).toContain(
      engine.findCardInZone("south", "hand", eb01Doma005),
    );
  });

  test("the OPPONENT having Antlerkov does not satisfy it -- the SC text says 我方场上 (our field)", () => {
    const engine = OnePieceTestEngine.create(
      { character: [{ card: op16Bunkov025, playedOnTurn: 0 }], hand: [eb01Doma005] },
      { character: [op16Antlerkov029] },
      { firstPlayer: "north", activeSeat: "south" },
    );
    const bunkovId = engine.findCardInZone("south", "character", op16Bunkov025);

    engine.declareAttack(bunkovId, engine.leader("north"), "south");

    expect(engine.getView("south").prompts).toHaveLength(0);
  });

  test('ruling #977: a Leader named "Antlerkov" alone satisfies "if you have [Antlerkov]", with zero Antlerkov Characters on field', () => {
    const engine = OnePieceTestEngine.create(
      {
        leaderCardId: antlerkovNamedLeader,
        character: [{ card: op16Bunkov025, playedOnTurn: 0 }],
        hand: [eb01Doma005],
      },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );
    const bunkovId = engine.findCardInZone("south", "character", op16Bunkov025);
    const eligibleId = engine.findCardInZone("south", "hand", eb01Doma005);

    engine.declareAttack(bunkovId, engine.leader("north"), "south");

    // Red under `zone: "character"`: that zone structurally excludes the Leader, so no prompt
    // would ever appear here even though the Leader is named Antlerkov.
    const play = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    expect(play?.kind).toBe("selectEntity");
    if (play?.kind !== "selectEntity") throw new Error("Expected Bunkov's hand-play choice.");
    expect(play.candidates.map((candidate) => candidate.ref.id)).toEqual([eligibleId]);
  });

  test("the hand-play is restricted to Character cards -- a cheap Stage does not qualify", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [{ card: op16Bunkov025, playedOnTurn: 0 }, op16Antlerkov029],
        // op16MobyDick021 is a Stage costing 1, i.e. inside "cost of 2 or less", so only
        // `cardCategory: "character"` keeps it out. It has to be a Stage and not an Event:
        // candidatesForPlayAction (effects/actions.ts) pre-filters every `play` pool to
        // character-or-stage before `cardCategory` is consulted, so an Event proves nothing.
        hand: [eb01Doma005, op16MobyDick021],
      },
      {},
      { firstPlayer: "north", activeSeat: "south" },
    );
    const bunkovId = engine.findCardInZone("south", "character", op16Bunkov025);
    const eligibleId = engine.findCardInZone("south", "hand", eb01Doma005);
    const stageId = engine.findCardInZone("south", "hand", op16MobyDick021);

    engine.declareAttack(bunkovId, engine.leader("north"), "south");

    const play = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    expect(play?.kind).toBe("selectEntity");
    if (play?.kind !== "selectEntity") throw new Error("Expected Bunkov's hand-play choice.");
    expect(play.candidates.map((candidate) => candidate.ref.id)).toEqual([eligibleId]);
    expect(play.candidates.map((candidate) => candidate.ref.id)).not.toContain(stageId);
  });
});
