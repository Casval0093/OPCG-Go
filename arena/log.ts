// The decision log — the arena's durable output, and the thing `docs/policy-proposals.md` §A2 calls
// "a decision corpus: every `(state, legal moves, choice, reason)` tuple".
//
// WHAT WAS ALREADY THERE, AND WHAT WAS NOT
//
// `driver.ts` has always built a `DecisionLog[]` and `main.ts` has always written it — but to a single
// `arena/results/last-run.json`, **overwritten every run and written only after the last game
// finishes**. Three consequences, all fatal for the human seat specifically:
//
//   1. A `--serve` session abandoned mid-game left nothing at all. Ping's own games are the scarcest
//      data this project will ever hold (CLAUDE.md budgets 10-20 of them), and they were the ones at
//      risk, because a human game is the one a person walks away from.
//   2. Run N+1 destroyed run N. There was no corpus, only a most-recent snapshot.
//   3. The entry recorded the PICK but not the POSITION. That is `(choice, reason)`, not the tuple
//      above — and the comment claiming the position was recoverable pointed at `replayMatch`, which
//      did not exist in the tree at all. It does now (`replay.ts`), and this log no longer depends
//      on it: the position is stored inline.
//
// So the format is NDJSON, appended and flushed PER DECISION, one file per run:
//
//   - A killed process leaves a VALID file, short by at most one line. That is the whole reason for
//     newline-delimited JSON over a single top-level array, which is only parseable once closed.
//   - Runs accumulate instead of clobbering. `arena/logs/` is the bank.
//   - `readLog` tolerates a torn final line, because that is the expected state of the file for the
//     exact case this format exists to survive.
//
// THE POSITION SNAPSHOT IS THE FEATURE BLOCK, AND THAT IS A SECURITY DECISION
//
// `position` is `deriveFeatures(view, seat)` verbatim — the same object the agent was handed. Two
// reasons, and the second is the load-bearing one:
//
//   1. It is free. The driver already computes it for every non-forced decision.
//   2. `features.ts` is computed FROM THE PROJECTION, so it cannot contain hidden information, and
//      `integrity.ts` proves that rather than asserting it. A logger that snapshotted `MatchState`
//      would be a second, unaudited path out of the projection boundary — and `driver.ts`'s `audit`
//      hook says in as many words that a logger must never be wired to it. Recording only what the
//      decider could see also makes the corpus honest as training material: a distilled policy will
//      have exactly this and no more.
//
// `positionKey` follows from the same rule. It is a fingerprint of (position, menu labels) — the
// "engine fingerprint plus the legal-move set" key `docs/policy-proposals.md` names for CRN caching,
// but computed from the projection instead of the state, so it stays usable by something that will
// only ever hold a view. It is NOT `semanticState`'s hash and is not comparable with it.

import { closeSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { stableFingerprint } from "./cycle.ts";
import type { EngineCommand, MatchConfig, MatchSeat } from "../src/types.ts";
import type { Author, Choice, Decision, DecisionLog, MatchOutcome } from "./types.ts";

/** Bumped when a field's meaning changes, so an old corpus is never silently misread. */
export const LOG_FORMAT_VERSION = 1;

/** One legal option as the corpus keeps it: enough to re-rank, small enough to store 120 per game. */
export interface LoggedChoice {
  i: number;
  kind: string;
  label: string;
  note?: string;
  cardId?: string;
  targetCardId?: string;
  numbers?: Record<string, number | boolean>;
}

/** A pick the engine refused, and its reason. See `driver.ts`'s narrowing retry loop. */
export interface LoggedRejection {
  i: number;
  label: string;
  reason: string;
}

export interface RunEntry {
  type: "run";
  version: number;
  startedAt: string;
  /** Deck paths and agent specs, so a line is interpretable without the shell history. */
  setup: Record<string, unknown>;
}

export interface GameEntry {
  type: "game";
  game: number;
  seats: Record<MatchSeat, string>;
  /**
   * The match config, decks included. Stored so `replayMatch(config, commands)` can reconstruct this
   * game from the log ALONE — without it the corpus would depend on `arena/results/last-run.json`,
   * the file this log exists because it is overwritten. ~1 KB per game against ~120 decisions.
   */
  config: MatchConfig;
}

/**
 * A forced command: exactly one legal choice, auto-played, never billed to an agent. Kept because a
 * transcript with the forced steps missing is not a readable game, and dropped down to three fields
 * because there was nothing to decide. Filter these out to get the corpus; keep them to get the game.
 */
export interface AutoEntry {
  type: "auto";
  game: number;
  commandIndex: number;
  seat: MatchSeat;
  turn: number;
  kind: string;
  label: string;
  command: EngineCommand;
}

export interface DecisionEntry extends DecisionLog {
  type: "decision";
  game: number;
  phase: string;
  /** `deriveFeatures(view, seat)` — projection-derived, so leak-safe by construction. */
  position: Record<string, unknown>;
  menu: LoggedChoice[];
  /** Non-empty when the engine refused a pick and the agent was re-asked against a narrowed menu. */
  rejections: LoggedRejection[];
  /** The prompt this decision answered, when it was a mid-effect prompt rather than a free action. */
  prompt: Decision["prompt"];
  /** The enumerator capped the option list — so `menu` is not all the legal moves. Never dropped. */
  truncated: boolean;
  /** Fingerprint of (position, menu labels). Dedup / CRN key. Projection-derived; see the header. */
  positionKey: string;
  /** The command the engine accepted. `auto` + `decision` in order == the replayable command list. */
  command: EngineCommand;
}

/**
 * A decision that ended the game: every option the engine offered was refused. The rejections are
 * the diagnosis for an `illegal-command` abort — an enumerate/engine disagreement of the class
 * `docs/arena.md` documents on `OP16-118` — and before this they existed only as a console line, so
 * an unattended or killed run could not say why it stopped.
 */
export interface AbortEntry {
  type: "abort";
  game: number;
  /** Where the command WOULD have gone. No command was applied. */
  commandIndex: number;
  seat: MatchSeat;
  turn: number;
  source: Decision["source"];
  kind: string;
  position: Record<string, unknown>;
  menu: LoggedChoice[];
  rejections: LoggedRejection[];
  prompt: Decision["prompt"];
}

export interface OutcomeEntry extends MatchOutcome {
  type: "outcome";
  game: number;
  /** Non-forced decisions in this game — the figure `branching.ts` reports per seat. */
  decisions: number;
}

export type LogEntry = RunEntry | GameEntry | AutoEntry | DecisionEntry | AbortEntry | OutcomeEntry;

export interface DecisionLogWriter {
  readonly path: string;
  game(entry: Omit<GameEntry, "type">): void;
  auto(entry: Omit<AutoEntry, "type">): void;
  decision(entry: Omit<DecisionEntry, "type" | "positionKey">): void;
  abort(entry: Omit<AbortEntry, "type">): void;
  outcome(entry: Omit<OutcomeEntry, "type">): void;
  close(): void;
}

/** `2026-08-19T14-03-52` — sorts chronologically and is a legal filename on every platform. */
export function logStamp(now: Date): string {
  return now.toISOString().replace(/\.\d+Z$/, "").replace(/:/g, "-");
}

function compactChoice(choice: Choice): LoggedChoice {
  const out: LoggedChoice = { i: choice.index, kind: choice.kind, label: choice.label };
  if (choice.note) out.note = choice.note;
  if (choice.cardId) out.cardId = choice.cardId;
  if (choice.targetCardId) out.targetCardId = choice.targetCardId;
  if (choice.numbers) out.numbers = choice.numbers;
  return out;
}

/** The dedup key. Order of `menu` is the engine's emission order and is deterministic, so it is
 *  preserved rather than sorted — two positions offering the same moves in a different order are
 *  genuinely different decisions for a policy that scores by rank. */
export function positionKeyOf(position: Record<string, unknown>, menu: LoggedChoice[]): string {
  return stableFingerprint([position, menu.map((m) => m.label)]);
}

export function menuOf(choices: Choice[]): LoggedChoice[] {
  return choices.map(compactChoice);
}

/**
 * Open an append-only log. The file descriptor is held open and every record is written with a
 * single `writeSync`, so the record either reaches the OS whole or not at all — no half-line from a
 * Ctrl-C mid-record. Durability against a process kill is what is wanted here (the human seat walking
 * away), not durability against a machine crash, so this deliberately does not `fsync` per decision.
 */
export function openDecisionLog(path: string, setup: Record<string, unknown>, now = new Date()): DecisionLogWriter {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, "a");
  let open = true;

  const write = (entry: LogEntry) => {
    if (!open) throw new Error("decision log is closed");
    // `writeSync` returns the byte count and does NOT loop, so a short write on a large record (a
    // 33-option menu) would leave a half-line for the next record to append onto. Loop until the
    // record is out, so a line in this file is always a whole record or the very last one.
    const payload = Buffer.from(`${JSON.stringify(entry)}\n`, "utf8");
    let written = 0;
    while (written < payload.length) {
      written += writeSync(fd, payload, written, payload.length - written);
    }
  };

  write({
    type: "run",
    version: LOG_FORMAT_VERSION,
    startedAt: now.toISOString(),
    setup,
  });

  return {
    path,
    game: (entry) => write({ type: "game", ...entry }),
    auto: (entry) => write({ type: "auto", ...entry }),
    decision: (entry) =>
      write({
        type: "decision",
        ...entry,
        positionKey: positionKeyOf(entry.position, entry.menu),
      }),
    abort: (entry) => write({ type: "abort", ...entry }),
    outcome: (entry) => write({ type: "outcome", ...entry }),
    close: () => {
      if (!open) return;
      open = false;
      closeSync(fd);
    },
  };
}

export interface ReadResult {
  entries: LogEntry[];
  /**
   * The final line was incomplete — the process was killed mid-write. Reported, never silently
   * dropped: a corpus that quietly loses its last decision every time is a corpus you cannot count.
   */
  torn: boolean;
  /** Lines that parsed but carried no `type` we know, i.e. written by a newer format. */
  unknown: number;
  /**
   * Lines that were not valid JSON at all, excluding the final one (that is `torn`). Reported rather
   * than fatal: a single interleaved or short-written record must not deny access to the several
   * hundred intact decisions around it, which is the same promise `torn` makes for the tail. It was
   * only honoured for the tail before — one bad middle line threw and took the whole file with it.
   */
  corrupt: number;
}

export function readLog(path: string): ReadResult {
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");
  // A complete file ends with "\n", so the split leaves a trailing "". Anything else there is a
  // record that was being written when the process died.
  const tail = lines.pop() ?? "";
  const torn = tail.trim().length > 0;
  const entries: LogEntry[] = [];
  let unknown = 0;
  let corrupt = 0;
  const known = new Set(["run", "game", "auto", "decision", "abort", "outcome"]);
  for (const line of lines) {
    if (!line.trim()) continue;
    let parsed: LogEntry;
    try {
      parsed = JSON.parse(line) as LogEntry;
    } catch {
      corrupt++;
      continue;
    }
    if (!known.has(parsed.type)) {
      unknown++;
      continue;
    }
    entries.push(parsed);
  }
  return { entries, torn, unknown, corrupt };
}

/** Every decision, forced ones excluded — the corpus proper. */
export function decisions(entries: LogEntry[]): DecisionEntry[] {
  return entries.filter((e): e is DecisionEntry => e.type === "decision");
}

/**
 * The positions worth studying. Two signals, one per kind of author:
 *
 *   - a council's `disagreement` is non-empty exactly when its proposers wanted different moves,
 *     which `docs/policy-proposals.md` identifies as a FREE difficulty signal — no critic pass;
 *   - a human has no disagreement set, so the signal is a written reason: if Ping bothered to type
 *     one, the position was worth a note.
 *
 * A HEURISTIC's reason is neither. `scriptedAgent` emits one for every decision it makes ("rotating
 * throw Choose rock"), so counting those would mark 100% of a scripted game as contested and the
 * filter would mean nothing. That is why this reads `author` and not the presence of text — and why
 * `author` had to become a field rather than a guess from the agent's name.
 */
export function contested(entries: LogEntry[]): DecisionEntry[] {
  return decisions(entries).filter(
    (d) =>
      (d.disagreement && d.disagreement.length > 0) ||
      (d.author !== "heuristic" && (d.reason ?? "").trim().length > 0),
  );
}

function short(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, width - 1)}\u2026`;
}

/** `auto`/`abort` carry `turn`; `decision` inherits `turnNumber` from `DecisionLog`. One accessor
 *  rather than a duplicated field, so the two names cannot drift apart. */
function turnOf(entry: AutoEntry | DecisionEntry | AbortEntry): number {
  return entry.type === "decision" ? entry.turnNumber : entry.turn;
}

/**
 * A game as a person reads it. This is the other half of "record human decisions": a JSONL file is a
 * corpus, not a review tool, and the reason to review one's own game is to see the line one took next
 * to the lines one passed up. So a decision prints the pick, the menu size, and — where the agent gave
 * one — the reason; the alternatives are behind `verbose`, because 12 options x 120 decisions is not
 * something anyone reads by choice.
 */
export function renderTranscript(entries: LogEntry[], options: { verbose?: boolean } = {}): string {
  const out: string[] = [];
  let lastTurn = -1;

  for (const entry of entries) {
    if (entry.type === "run") {
      out.push(`RUN ${entry.startedAt}   format v${entry.version}`);
      for (const [key, value] of Object.entries(entry.setup)) {
        out.push(`  ${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
      }
      continue;
    }
    if (entry.type === "game") {
      out.push("");
      out.push("=".repeat(78));
      out.push(
        `GAME ${entry.game}  seed=${entry.config.seed}  ` +
          `south=${entry.seats.south}  north=${entry.seats.north}`,
      );
      out.push("=".repeat(78));
      lastTurn = -1;
      continue;
    }
    if (entry.type === "outcome") {
      out.push(
        `  -- ${entry.winner ?? "no winner"} / ${entry.termination} \u2014 ` +
          `${entry.turns} turns, ${entry.commands} commands, ${entry.decisions} decisions`,
      );
      continue;
    }

    const turn = turnOf(entry);
    if (turn !== lastTurn) {
      lastTurn = turn;
      out.push("");
      out.push(`  --- turn ${turn} ---`);
    }

    if (entry.type === "auto") {
      out.push(
        `  ${String(entry.commandIndex).padStart(4)} ${entry.seat.padEnd(5)} \u00b7 forced   ${entry.label}`,
      );
      continue;
    }

    if (entry.type === "abort") {
      out.push(
        `  ${String(entry.commandIndex).padStart(4)} ${entry.seat.padEnd(5)} ` +
          `*** ABORTED on ${entry.source}/${entry.kind}: all ${entry.menu.length} option(s) refused`,
      );
      if (entry.prompt) {
        out.push(
          `         prompt "${short(entry.prompt.label, 70)}" (${entry.prompt.choiceKind}) ` +
            `select ${entry.prompt.minSelections}..${entry.prompt.maxSelections}`,
        );
      }
      for (const rejection of entry.rejections) {
        out.push(`         REFUSED [${rejection.i}] ${short(rejection.label, 60)} \u2014 ${short(rejection.reason, 90)}`);
      }
      continue;
    }

    out.push(
      `  ${String(entry.commandIndex).padStart(4)} ${entry.seat.padEnd(5)} ` +
        `[${entry.agent}${entry.author === "heuristic" && entry.agent.startsWith("scripted") ? "" : `/${entry.author}`}] ` +
        `${entry.chosenLabel}` +
        `   (${entry.chosenIndex + 1}/${entry.choiceCount}${entry.truncated ? ", capped" : ""})`,
    );
    if (entry.prompt) out.push(`         prompt: ${short(entry.prompt.label, 90)}`);
    if (entry.requestedIndex !== null) {
      // The agent named an option that does not exist and the driver fell back to option 0. Surfaced
      // because it is a model-quality signal, and because it used to be written into `chosenIndex`
      // where it silently corrupted the row instead of being visible.
      out.push(
        `         OUT OF RANGE: agent asked for [${entry.requestedIndex}] of ${entry.choiceCount}` +
          ` — option 0 was played instead`,
      );
    }
    if (entry.reason) out.push(`         why: ${short(entry.reason, 200)}`);
    for (const dissent of entry.disagreement ?? []) {
      out.push(`         dissent: ${short(dissent, 160)}`);
    }
    for (const rejection of entry.rejections) {
      out.push(`         REFUSED [${rejection.i}] ${short(rejection.label, 60)} \u2014 ${short(rejection.reason, 90)}`);
    }
    if (options.verbose) {
      for (const option of entry.menu) {
        if (option.i === entry.chosenIndex) continue;
        out.push(
          `         \u00b7 [${option.i}] ${short(option.label, 70)}` +
            `${option.note ? `  ${short(option.note, 40)}` : ""}`,
        );
      }
    }
  }

  return out.join("\n");
}

/** Counts a run's shape, so `--replay` says what is in the file before printing 3,000 lines of it. */
export function summarise(entries: LogEntry[]): string {
  const all = decisions(entries);
  const games = entries.filter((e) => e.type === "game").length;
  const forced = entries.filter((e) => e.type === "auto").length;
  const aborts = entries.filter((e) => e.type === "abort").length;
  const byAgent = new Map<string, number>();
  for (const d of all) byAgent.set(d.agent, (byAgent.get(d.agent) ?? 0) + 1);
  const byAuthor = new Map<Author, number>();
  for (const d of all) byAuthor.set(d.author, (byAuthor.get(d.author) ?? 0) + 1);
  const withReason = all.filter((d) => (d.reason ?? "").trim().length > 0).length;
  const withDissent = all.filter((d) => (d.disagreement ?? []).length > 0).length;
  const refused = all.filter((d) => d.rejections.length > 0).length;
  const outOfRange = all.filter((d) => d.requestedIndex !== null).length;
  const distinct = new Set(all.map((d) => d.positionKey)).size;
  const share = all.length ? ` (${((distinct / all.length) * 100).toFixed(1)}% of decisions)` : "";

  return [
    `games ${games}   decisions ${all.length}   forced ${forced}   aborts ${aborts}`,
    // Authorship first, because it is the question a corpus is read with: how much of this was
    // actually decided by the thing named in the header. A council that degraded shows up here.
    `  by author: ${(["human", "model", "heuristic"] as Author[])
      .map((a) => `${a}=${byAuthor.get(a) ?? 0}`)
      .join("  ")}   contested: ${contested(entries).length}`,
    `  distinct positions: ${distinct}${share}`,
    `  with a written reason: ${withReason}   with dissent: ${withDissent}   ` +
      `engine refused a pick: ${refused}   agent asked out of range: ${outOfRange}`,
    `  by agent: ${[...byAgent.entries()].map(([a, n]) => `${a}=${n}`).join("  ") || "none"}`,
  ].join("\n");
}


/**
 * Convenience for the CLI: resolve `--log` against the repo root and default to a stamped name.
 *
 * The pid suffix is load-bearing, not decoration. `logStamp` has one-second resolution and
 * `openDecisionLog` opens in APPEND mode (deliberately — run N+1 must not destroy run N), so two runs
 * started in the same second resolved to the same filename and silently merged: one file, two `run`
 * headers, and two unrelated games both numbered `game: 1`. A scripted run reaches the writer in well
 * under a second, and this repo already runs batches in parallel, so that was reachable rather than
 * theoretical. An explicit `--log <path>` still shares a file on purpose if you point two runs at one.
 */
export function defaultLogPath(root: string, now = new Date(), pid = process.pid): string {
  return resolve(root, "arena/logs", `${logStamp(now)}-${pid}.jsonl`);
}


/**
 * The seam the driver writes through. Deliberately narrower than `DecisionLogWriter`: a driver knows
 * about ONE game and must not have to know its index, so `sinkFor` closes over that. It also means
 * the driver has no dependency on a file, which is what lets the tests drive it with an array.
 */
export type SinkAuto = Omit<AutoEntry, "type" | "game">;
export type SinkDecision = Omit<DecisionEntry, "type" | "game" | "positionKey">;
export type SinkAbort = Omit<AbortEntry, "type" | "game">;

export interface DecisionSink {
  auto(entry: SinkAuto): void;
  decision(entry: SinkDecision): void;
  abort(entry: SinkAbort): void;
}

export function sinkFor(writer: DecisionLogWriter, game: number): DecisionSink {
  return {
    auto: (entry) => writer.auto({ game, ...entry }),
    decision: (entry) => writer.decision({ game, ...entry }),
    abort: (entry) => writer.abort({ game, ...entry }),
  };
}

/** An in-memory sink, for tests and for anything that wants the entries without a file. */
export function collectingSink(into: Array<SinkAuto | SinkDecision | SinkAbort>): DecisionSink {
  return {
    auto: (entry) => into.push(entry),
    decision: (entry) => into.push(entry),
    abort: (entry) => into.push(entry),
  };
}
