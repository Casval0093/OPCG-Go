import { describe, expect, test } from "vite-plus/test";
import {
  op02Atmos003,
  op02Blugori084,
  op02LittleoarsJr020,
  op02Magellan071,
  op03Namule007,
  op16Buggy048,
  op16PrisonerOfImpelDown042,
} from "@tcg/op-cards";

import { getLegalCommands, OnePieceTestEngine } from "../../../src/index.ts";

describe("OP16-048 Buggy", () => {
  test("[On Play] under an [Impel Down] Leader draws 1 and plays a [Prisoner of Impel Down] from hand", () => {
    const engine = OnePieceTestEngine.create(
      {
        // op02Magellan071 carries the [Impel Down] type. Its own ability is
        // [Your Turn] [Once Per Turn] on a DON!! return, so it cannot fire here.
        leaderCardId: op02Magellan071,
        hand: [
          op16Buggy048,
          op16PrisonerOfImpelDown042,
          // A vanilla Character that is playable in every respect EXCEPT its name -- without
          // the name filter it joins the candidate list and this assertion goes red.
          op03Namule007,
        ],
        deck: [op02Atmos003, op03Namule007, op02Blugori084, op02Atmos003, op03Namule007],
        activeDon: 5,
      },
      {},
    );
    const prisonerId = engine.findCardInZone("south", "hand", op16PrisonerOfImpelDown042);
    const drawnId = engine.findCardInZone("south", "deck", op02Atmos003);

    engine.playCard(op16Buggy048, "south");

    const play = engine.pendingDecision("effectPlaySelection", "south").steps[0];
    expect(play?.kind).toBe("selectEntity");
    if (play?.kind !== "selectEntity") throw new Error("Expected Buggy's Prisoner play selection.");
    expect(play.candidates.map((candidate) => candidate.ref.id)).toEqual([prisonerId]);
    engine.resolveDecision("effectPlaySelection", { selectedIds: [prisonerId] }, "south");

    const view = engine.getView("south");
    expect(view.players.south.hand.map((card) => card.instanceId)).toContain(drawnId);
    expect(view.players.south.characters.some((card) => card?.instanceId === prisonerId)).toBe(
      true,
    );
    expect(view.prompts).toHaveLength(0);
  });

  test("without an [Impel Down] Leader the whole [On Play] is skipped -- no draw, no play", () => {
    const engine = OnePieceTestEngine.create(
      {
        // Default Leader OP13-001 Monkey.D.Luffy: "Straw Hat Crew Supernovas".
        hand: [op16Buggy048, op16PrisonerOfImpelDown042],
        deck: [op02Atmos003, op03Namule007, op02Blugori084, op02Atmos003, op03Namule007],
        activeDon: 5,
      },
      {},
    );
    const prisonerId = engine.findCardInZone("south", "hand", op16PrisonerOfImpelDown042);
    const handBefore = engine.getState().players.south.hand.length;

    engine.playCard(op16Buggy048, "south");

    const view = engine.getView("south");
    // The Leader check is the LEADING clause, so it gates the draw as well as the play.
    expect(view.prompts).toHaveLength(0);
    expect(engine.getState().players.south.hand).toHaveLength(handBefore - 1);
    expect(engine.getState().players.south.hand).toContain(prisonerId);
  });

  test("[Once Per Turn] on the opponent's attack grants [Blocker] to a Prisoner, and only once", () => {
    const engine = OnePieceTestEngine.create(
      {
        character: [
          op16Buggy048,
          op16PrisonerOfImpelDown042,
          // op02Blugori084 has the "Impel Down" TRAIT but is named Blugori. A trait-filtered
          // encoding would offer it; the name filter must not.
          op02Blugori084,
        ],
      },
      {
        character: [
          { card: op02LittleoarsJr020, playedOnTurn: 0 },
          { card: op02Atmos003, playedOnTurn: 0 },
        ],
      },
      { firstPlayer: "south", activeSeat: "north" },
    );
    const prisonerId = engine.findCardInZone("south", "character", op16PrisonerOfImpelDown042);
    const firstAttackerId = engine.findCardInZone("north", "character", op02LittleoarsJr020);
    const secondAttackerId = engine.findCardInZone("north", "character", op02Atmos003);

    engine.declareAttack(firstAttackerId, engine.leader("south"), "north");
    engine.resolveDecision("effectOptional", { optionId: "yes" }, "south");

    const selection = engine.pendingDecision("effectTargetSelection", "south").steps[0];
    expect(selection?.kind).toBe("selectEntity");
    if (selection?.kind !== "selectEntity") throw new Error("Expected Buggy's Blocker recipient.");
    expect(selection.candidates.map((candidate) => candidate.ref.id)).toEqual([prisonerId]);
    engine.resolveDecision("effectTargetSelection", { selectedIds: [prisonerId] }, "south");

    // Ruling #991: the granted [Blocker] is usable against the very attack that triggered it.
    // A granted keyword has no projected field, so the blocker step IS the proof.
    const blocker = engine.pendingDecision("battleBlocker", "south").steps[0];
    expect(blocker?.kind).toBe("selectEntity");
    if (blocker?.kind !== "selectEntity") throw new Error("Expected the granted Blocker choice.");
    // The blocker step always carries a synthetic "skip" option alongside the real bodies.
    expect(
      blocker.candidates.map((candidate) => candidate.ref.id).filter((id) => id !== "skip"),
    ).toEqual([prisonerId]);
    engine.resolveDecision("battleBlocker", { selectedIds: [] }, "south");

    // Second attack, same turn. Two things must hold at once, and they pull in opposite
    // directions, which is what makes this pin both flags:
    //   - the once-per-turn guard means NO new effectOptional confirm is offered
    //   - the grant's `thisTurn` duration means the Prisoner is still a legal blocker
    engine.declareAttack(secondAttackerId, engine.leader("south"), "north");
    expect(
      engine
        .getState()
        .promptQueue.some(
          (prompt) =>
            prompt.status === "pending" && prompt.resolutionContext?.intent === "effectOptional",
        ),
    ).toBe(false);
    const secondBlocker = engine.pendingDecision("battleBlocker", "south").steps[0];
    expect(secondBlocker?.kind).toBe("selectEntity");
    if (secondBlocker?.kind !== "selectEntity") throw new Error("Expected the retained Blocker.");
    expect(
      secondBlocker.candidates.map((candidate) => candidate.ref.id).filter((id) => id !== "skip"),
    ).toEqual([prisonerId]);
    engine.resolveDecision("battleBlocker", { selectedIds: [] }, "south");
    // The first attack pushed a Life card into south's hand, so this second battle opens a
    // counter step that the first one did not (cards/ENCODING.md: battleCounter is published
    // only when the defending seat's hand is non-empty).
    engine.resolveDecision("battleCounter", { selectedIds: [] }, "south");
    expect(
      getLegalCommands(engine.getState(), "south").some(
        (command) => command.type === "resolvePrompt",
      ),
    ).toBe(false);
  });
});
