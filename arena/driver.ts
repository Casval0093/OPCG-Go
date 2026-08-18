// The async match loop. `runBotMatch` cannot host a human or an LLM for two reasons, both measured:
//
//   1. `OnePieceBotStrategy` is SYNCHRONOUS — `(state, seat, legal, ctx) => EngineCommand | null`.
//      A network call cannot be awaited inside it.
//   2. It hardcodes prompt resolution. `drainPendingPrompts` calls `resolveBotPromptCommand`
//      directly, so there is no seam to inject prompt answers — and prompts are 252 of ~890
//      resolutions per 20 games. A strategy wrapper cannot reach them.
//
// So this is a sibling of `runBotMatch`, not a replacement: batch keeps using that one, at speed.
// Semantics are deliberately mirrored where they are load-bearing (setup actor selection, the
// semantic cycle detector, the command ceiling), and deliberately improved where `runBotMatch`'s
// behaviour is wrong for an interactive game:
//
//   - A rejected command ABORTS the match in `runBotMatch`. Here the engine's own reason is fed
//     back to the agent and it chooses again, up to `maxRetries`. A human misclick must not end a
//     tournament game.
//   - Forced decisions (exactly one legal choice) are auto-played and never billed to an agent.
//     Most of the ~120 commands per game are forced; this is what keeps an LLM's call count and a
//     human's click count survivable.

import { applyCommand, createMatch, getLegalCommands } from "../src/core.ts";
import { projectStateForSeat } from "../src/projection.ts";
import { createCycleDetector, semanticState, stableFingerprint } from "./cycle.ts";
import type {
  EngineCommand,
  MatchConfig,
  MatchSeat,
  MatchState,
  PlayerView,
  PromptState,
} from "../src/types.ts";
import { buildDecision } from "./enumerate.ts";
import { deriveFeatures } from "./features.ts";
import type {
  Agent,
  AgentAnswer,
  Decision,
  DecisionLog,
  GameRecord,
  MatchOutcome,
  Termination,
} from "./types.ts";

export interface DriverOptions {
  /** Our own ceiling, not a rules outcome. Hitting it is `command-ceiling`, never a loss. */
  maxCommands?: number;
  /** Guards against a policy looping forever. Mirrors `runBotMatch`. */
  cycleDetection?: boolean;
  /** How many times an agent may re-answer after the engine rejects its pick. */
  maxRetries?: number;
  /** Board refresh hook. Receives per-seat PROJECTIONS, never the match state. */
  onUpdate?: (views: Record<MatchSeat, PlayerView>, state: PublicProgress) => void;
  /** Fires before an agent is consulted, so a UI can show whose turn it is. */
  onDecision?: (decision: Decision, view: PlayerView) => void;
  /**
   * AUDITOR ONLY. Receives the full `MatchState` at every step so `integrity.ts` can compare what a
   * seat can see against what is actually there. Never wire an agent, a UI, or a logger to this — the
   * whole point of the projection boundary is that nothing which makes decisions holds this object.
   */
  audit?: (state: MatchState) => void;
}

/** Progress data that is safe for any viewer. */
export interface PublicProgress {
  status: string;
  phase: string;
  turnNumber: number;
  activeSeat: MatchSeat;
  commands: number;
  winner: MatchSeat | null;
}

const OTHER: Record<MatchSeat, MatchSeat> = { south: "north", north: "south" };

function normalize(answer: number | AgentAnswer): AgentAnswer {
  return typeof answer === "number" ? { index: answer } : answer;
}

function progress(state: MatchState, commands: number): PublicProgress {
  return {
    status: state.status,
    phase: state.phase,
    turnNumber: state.turnNumber,
    activeSeat: state.activeSeat,
    commands,
    winner: state.winner,
  };
}

/**
 * Which seat acts next.
 *
 * During setup both seats can hold legal commands at once (both must throw 猜拳), so the actor is
 * read from the descriptor list rather than from `activeSeat` — the same rule `runBotMatch` uses.
 * Note this is also where the arena diverges from the batch harness in a way worth knowing:
 * CLAUDE.md records that `MatchConfig.firstPlayer` is discarded and that north led all 120 batch
 * games. That determinism came from `commandFromDescriptor` computing the 猜拳 throw from the round
 * number. Here the throw and `chooseFirstPlayer` are real choices made by real agents, so turn
 * order genuinely varies and the seat-assignment workaround is not needed.
 */
function resolveActor(state: MatchState): { seat: MatchSeat; descriptors: ReturnType<typeof getLegalCommands> } {
  if (state.status === "setup") {
    const south = getLegalCommands(state, "south");
    if (south.some((d) => d.seat === "south")) return { seat: "south", descriptors: south };
    const north = getLegalCommands(state, "north");
    return { seat: "north", descriptors: north };
  }
  const seat = state.activeSeat;
  return { seat, descriptors: getLegalCommands(state).filter((d) => d.seat === seat) };
}

function firstPendingPrompt(state: MatchState): PromptState | null {
  return state.promptQueue.find((p) => p.status === "pending") ?? null;
}

export async function runArenaMatch(
  config: MatchConfig,
  agents: Record<MatchSeat, Agent>,
  options: DriverOptions = {},
): Promise<GameRecord> {
  const maxCommands = options.maxCommands ?? 800;
  const maxRetries = options.maxRetries ?? 3;
  const cycleDetection = options.cycleDetection ?? true;

  let state = createMatch(config);
  const commands: EngineCommand[] = [];
  const decisions: DecisionLog[] = [];
  const detector = createCycleDetector();
  let termination: Termination = "command-ceiling";
  /** Populated only on an illegal-command abort: names the decision the enumerator got wrong. */
  let illegalDetail = "";

  const views = (): Record<MatchSeat, PlayerView> => ({
    south: projectStateForSeat(state, "south"),
    north: projectStateForSeat(state, "north"),
  });

  options.onUpdate?.(views(), progress(state, commands.length));
  options.audit?.(state);

  while (commands.length < maxCommands) {
    if (state.status === "finished") {
      termination = "rules-win";
      break;
    }

    if (cycleDetection) {
      const fingerprint = stableFingerprint(semanticState(state));
      if (detector.observe(fingerprint).repeated) {
        termination = "repeated-state";
        break;
      }
    }

    const prompt = firstPendingPrompt(state);
    let seat: MatchSeat;
    let decision: Decision;

    if (prompt) {
      // A judge prompt has no seat of its own; the active player's agent acknowledges it.
      seat = prompt.kind === "judge" ? state.activeSeat : (prompt.seat as MatchSeat);
      decision = buildDecision(state, seat, prompt, []);
    } else {
      const actor = resolveActor(state);
      seat = actor.seat;
      decision = buildDecision(state, seat, null, actor.descriptors);
    }

    if (decision.choices.length === 0) {
      termination = "no-legal-choice";
      break;
    }

    const agent = agents[seat];
    const view = projectStateForSeat(state, seat);
    let answer: AgentAnswer;

    if (decision.forced) {
      // Auto-played. Not billed, not logged as a decision — there was nothing to decide.
      answer = { index: 0, reason: null };
    } else {
      options.onDecision?.(decision, view);
      answer = normalize(
        await agent.decide({
          view,
          decision,
          features: deriveFeatures(view, seat),
          rejection: null,
        }),
      );
    }

    let attempt = 0;
    let applied = false;
    // Retrying without narrowing the menu is useless against a deterministic agent: the same state
    // produces the same answer, so the same illegal command is submitted `maxRetries + 1` times and
    // the game dies. Measured on the Ace deck: 1 game in 10 aborted this way, all four attempts
    // submitting a byte-identical `resolvePrompt`. So a rejected choice is REMOVED from the menu
    // before re-asking, which turns a guaranteed failure into an actual recovery.
    const rejected = new Set<number>();
    let lastReason = "";
    // Because each rejection REMOVES a choice, the loop is bounded by the menu size and cannot spin.
    // So the cap is the menu, not a fixed 3: if any legal option exists we will reach it.
    //
    // This is defense in depth, NOT a workaround for a live bug. The case that motivated it —
    // `OP16-118` Portgas.D.Ace offering five [Whitebeard Pirates] bodies and refusing four — was an
    // ENGINE defect, not an encoding gap: `effectSearchSelection` gated a reveal-to-HAND on open
    // CHARACTER slots, so a full board rejected every option the prompt had just marked eligible.
    // Fixed in tools/patch_engine.py (patch 2). Keep the cap anyway: an engine that offers an option
    // it then refuses should cost one retry, not a whole game.
    const retryCap = decision.source === "command" ? maxRetries : decision.choices.length;

    while (attempt <= retryCap) {
      const choice = decision.choices[answer.index] ?? decision.choices[0]!;
      const result = applyCommand(state, choice.command);

      if (result.accepted) {
        // Only accepted commands enter the record. `replayMatch(config, commands)` must reproduce the
        // game exactly, and a rejected command in that list is noise at best.
        commands.push(choice.command);
        if (!decision.forced) {
          decisions.push({
            commandIndex: commands.length - 1,
            seat,
            agent: agent.name,
            turnNumber: decision.turnNumber,
            source: decision.source,
            kind: choice.kind,
            choiceCount: decision.choices.length,
            chosenIndex: answer.index,
            chosenLabel: choice.label,
            reason: answer.reason ?? null,
            disagreement: answer.disagreement ?? null,
          });
        }
        state = result.state;
        applied = true;
        break;
      }

      // Rejected. Drop this choice, hand the engine's own reason back, and let the agent choose from
      // what is left. `runBotMatch` would end the game here; for a tournament with a human in it,
      // that is not acceptable.
      attempt++;
      rejected.add(answer.index);
      lastReason = String(result.reason ?? "Command rejected.");
      const remaining = decision.choices.filter((c) => !rejected.has(c.index));
      if (attempt > retryCap || remaining.length === 0) break;

      answer = normalize(
        await agent.decide({
          view,
          // The narrowed menu is what the agent answers against, so a re-asked agent cannot repeat
          // itself. Indices stay stable because `Choice.index` is assigned once, at enumeration.
          decision: { ...decision, choices: remaining, forced: remaining.length === 1 },
          features: deriveFeatures(view, seat),
          rejection: lastReason,
        }),
      );
    }

    if (!applied) {
      termination = "illegal-command";
      illegalDetail =
        `${decision.source}/${decision.choices[0]?.kind ?? "?"} on turn ${decision.turnNumber}: ` +
        `${rejected.size} of ${decision.choices.length} choice(s) rejected — last reason: ${lastReason}` +
        (decision.prompt
          ? `\n      prompt "${decision.prompt.label}" (${decision.prompt.choiceKind}) ` +
            `select ${decision.prompt.minSelections}..${decision.prompt.maxSelections}` +
            `\n      details: ${decision.prompt.details}` +
            `\n      offered: ${decision.choices.map((c) => `[${c.index}] ${c.label}`).join(" | ")}`
          : "");
      break;
    }

    options.onUpdate?.(views(), progress(state, commands.length));
    options.audit?.(state);
  }

  if (illegalDetail) {
    console.log(`  *** illegal-command abort — ${illegalDetail} ***`);
  }

  const outcome: MatchOutcome = {
    winner: state.winner,
    termination,
    turns: state.turnNumber,
    commands: commands.length,
  };

  await Promise.all([
    agents.south.finish?.(projectStateForSeat(state, "south"), outcome),
    agents.north.finish?.(projectStateForSeat(state, "north"), outcome),
  ]);

  options.onUpdate?.(views(), progress(state, commands.length));

  return {
    config,
    commands,
    outcome,
    seats: { south: agents.south.name, north: agents.north.name },
    decisions,
  };
}
