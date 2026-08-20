// `replayMatch` — reconstruct a recorded game exactly, from `(config, commands)`.
//
// WHY THIS FILE EXISTS AT ALL
//
// It was cited as if it already did. `docs/arena.md`, `arena/types.ts` and `arena/driver.ts` all
// named `replayMatch(config, commands)` as the property that makes a stored decision *verifiable
// rather than merely recorded* — and no such function was anywhere in the tree. That mattered more
// than a stale comment usually does, because it was the stated justification for `DecisionLog` being
// a thin summary with no position in it: the position was said to be recoverable. It was not.
//
// So two things changed together. `log.ts` now stores the position inline, and this file makes the
// claim true. They are complements, not alternatives:
//
//   - the inline position is what a corpus consumer reads (cheap, projection-only, leak-safe);
//   - replay is what AUDITS it (expensive, needs the engine, sees everything).
//
// The test that matters is `replay(record) == record.outcome`. If a log's command list does not
// reproduce its own outcome, then either the driver logged a command it did not apply or the engine
// is not deterministic under a fixed seed — and both are things you want to hear about loudly rather
// than discover after building a policy on the corpus.

import { applyCommand, createMatch } from "../src/core.ts";
import type { EngineCommand, MatchConfig, MatchState } from "../src/types.ts";
import type { GameRecord, MatchOutcome } from "./types.ts";

export interface ReplayResult {
  final: MatchState;
  /** How many commands the engine accepted before it stopped. */
  applied: number;
  /**
   * Index of the first command the engine REFUSED, or null if every one was accepted. A recorded
   * game contains only accepted commands, so any value here is a defect, never a replay artefact.
   */
  divergedAt: number | null;
  reason: string | null;
}

/**
 * Fold the recorded commands back over a fresh match. `onStep` sees every intermediate state — this
 * is the one place in the arena that legitimately hands out `MatchState`, because a replay is an
 * audit and no agent is playing. Do not route a live agent through it.
 */
export function replayMatch(
  config: MatchConfig,
  commands: EngineCommand[],
  onStep?: (state: MatchState, index: number) => void,
): ReplayResult {
  let state = createMatch(config);
  onStep?.(state, -1);

  for (let i = 0; i < commands.length; i++) {
    const result = applyCommand(state, commands[i]!);
    if (!result.accepted) {
      return {
        final: state,
        applied: i,
        divergedAt: i,
        reason: String(result.reason ?? "command rejected on replay"),
      };
    }
    state = result.state;
    onStep?.(state, i);
  }

  return { final: state, applied: commands.length, divergedAt: null, reason: null };
}

export interface ReplayVerdict {
  ok: boolean;
  /** Human-readable, one line per field that did not match. Empty when `ok`. */
  mismatches: string[];
  replayed: MatchOutcome;
}

/**
 * Replay a record and compare the outcome field by field.
 *
 * `termination` is deliberately NOT compared. It is the DRIVER's verdict on why the loop stopped
 * (`command-ceiling`, `repeated-state`) and not a property of the state, so a replay cannot derive it
 * without re-running the driver's own guards. What a replay can check is everything the rules own:
 * the winner, the turn count, and that every recorded command was legal in sequence.
 */
export function verifyReplay(record: GameRecord): ReplayVerdict {
  const result = replayMatch(record.config, record.commands);
  const replayed: MatchOutcome = {
    winner: result.final.winner,
    termination: record.outcome.termination,
    turns: result.final.turnNumber,
    commands: result.applied,
  };
  const mismatches: string[] = [];

  if (result.divergedAt !== null) {
    mismatches.push(
      `command ${result.divergedAt} of ${record.commands.length} was refused on replay: ${result.reason}`,
    );
  }
  if (replayed.winner !== record.outcome.winner) {
    mismatches.push(`winner ${String(record.outcome.winner)} recorded, ${String(replayed.winner)} replayed`);
  }
  if (replayed.turns !== record.outcome.turns) {
    mismatches.push(`turns ${record.outcome.turns} recorded, ${replayed.turns} replayed`);
  }
  if (replayed.commands !== record.outcome.commands) {
    mismatches.push(`commands ${record.outcome.commands} recorded, ${replayed.commands} replayed`);
  }

  return { ok: mismatches.length === 0, mismatches, replayed };
}
