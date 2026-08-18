// Arena core types.
//
// The arena is the playtest ground: decks that survived the batch simulator get piloted here by
// Ping, by LLM councils, and by the engine's own heuristic, under tournament conditions.
//
// THE ONE INVARIANT THIS FILE EXISTS TO ENFORCE
//
// An `Agent` never receives `MatchState`. It receives a `PlayerView` from
// `projectStateForSeat(state, itsOwnSeat)` plus a list of pre-built legal `Choice`s, and answers
// with an index. Three consequences, all deliberate:
//
//   1. No agent can cheat. The projection hides the opponent's hand, both deck tops, and all Life
//      cards. Verified by `arena/integrity.test.ts` rather than assumed.
//   2. No agent can play illegally. It picks from a list the engine generated; it never builds an
//      `EngineCommand`. An LLM therefore needs zero knowledge of the rules' legality layer.
//   3. Human and LLM seats are the same interface. `agents/human.ts` renders the choices in a
//      browser; `agents/council.ts` renders them into a prompt. The driver cannot tell them apart.

import type {
  EngineCommand,
  MatchConfig,
  MatchSeat,
  PlayerView,
} from "../src/types.ts";

/** One concrete, legal, ready-to-apply action. Built by `enumerate.ts`, never by an agent. */
export interface Choice {
  /** Stable within a single decision; what an agent returns. */
  index: number;
  /** Applied verbatim if chosen. */
  command: EngineCommand;
  /** Human- and LLM-readable. Derived from the engine's own `label` where one exists. */
  label: string;
  /** `EngineCommand["type"]`, or the prompt's `choiceKind`. */
  kind: string;
  /** The card this choice is *about* — drives click-to-filter in the browser board. */
  cardId: string | null;
  instanceId: string | null;
  /** For attacks and targeted effects: what it points at. */
  targetCardId: string | null;
  targetInstanceId: string | null;
  /** Free-form annotation surfaced to the LLM, e.g. attack arithmetic. */
  note: string | null;
  /**
   * Numeric facts about this choice, already computed. Exists so that neither a heuristic nor an
   * LLM has to re-derive arithmetic by parsing `note` — the values are the same ones the browser
   * board renders. Keys depend on `kind`; `declareAttack` carries attackPower / targetPower /
   * targetIsLeader / margin.
   */
  numbers: Record<string, number | boolean> | null;
}

/** Everything an agent needs to answer once. */
export interface Decision {
  seat: MatchSeat;
  /** A prompt mid-effect-resolution, or a free choice of action in the main phase. */
  source: "command" | "prompt" | "judge";
  turnNumber: number;
  phase: string;
  /** Present when `source === "prompt"`. */
  prompt: {
    id: string;
    label: string;
    details: string;
    choiceKind: string;
    minSelections: number;
    maxSelections: number;
  } | null;
  choices: Choice[];
  /**
   * The full choice set was too large to enumerate (a big `selectCards`, or an `orderCards` whose
   * permutations explode). Reported, never silently dropped — a silent cap reads as "these were all
   * the options" when it was not.
   */
  truncated: boolean;
  /** Exactly one legal choice. The driver auto-plays these and never bills an agent for them. */
  forced: boolean;
}

/** What an agent sees. `view` is a projection; it is not the match state. */
export interface AgentContext {
  view: PlayerView;
  decision: Decision;
  /** Derived arithmetic the model should not be asked to do in its head. See `features.ts`. */
  features: Record<string, unknown>;
  /** Set when the agent's previous pick was rejected by the engine, with the engine's reason. */
  rejection: string | null;
}

/**
 * An agent's answer. A bare number is the choice index; the object form additionally carries the
 * reasoning that makes the decision log useful, and — for a council — which proposals lost.
 */
export interface AgentAnswer {
  index: number;
  reason?: string | null;
  /**
   * One entry per proposer that wanted a different move. Non-empty means the position was
   * genuinely contested, which is the sampling criterion for the decision bank.
   */
  disagreement?: string[] | null;
}

export interface Agent {
  readonly name: string;
  /** Returns the chosen `Choice`'s index. Out-of-range answers are re-prompted, then defaulted. */
  decide(context: AgentContext): Promise<number | AgentAnswer>;
  /** Called once when the match ends, so an agent can log or reflect. */
  finish?(view: PlayerView, outcome: MatchOutcome): Promise<void>;
}

export type Termination =
  | "rules-win"
  | "repeated-state"
  | "illegal-command"
  | "no-legal-choice"
  | "command-ceiling";

export interface MatchOutcome {
  winner: MatchSeat | null;
  termination: Termination;
  turns: number;
  commands: number;
}

/**
 * A complete game in a few KB. `replayMatch(config, commands)` reconstructs every intermediate
 * state exactly, which is what makes a stored decision verifiable instead of merely recorded.
 */
export interface GameRecord {
  config: MatchConfig;
  commands: EngineCommand[];
  outcome: MatchOutcome;
  seats: Record<MatchSeat, string>;
  /** One entry per non-forced decision: the position, the options, the pick, and why. */
  decisions: DecisionLog[];
}

export interface DecisionLog {
  commandIndex: number;
  seat: MatchSeat;
  agent: string;
  turnNumber: number;
  source: Decision["source"];
  /** `Choice.kind` of the option taken — the axis the branching-factor breakdown is grouped by. */
  kind: string;
  choiceCount: number;
  chosenIndex: number;
  chosenLabel: string;
  /** Free-text reason, when the agent supplies one. */
  reason: string | null;
  /**
   * Set when a council's proposers disagreed. Disagreement is the sampling criterion for the
   * decision bank: it marks the positions that are genuinely hard without needing a critic pass.
   */
  disagreement: string[] | null;
}
