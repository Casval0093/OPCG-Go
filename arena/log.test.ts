// Tests for the decision log. `node --test arena/log.test.ts` from the repo root — no engine, no
// vitest, no 767 MB vendored clone. That is possible because `log.ts` imports the engine's types with
// `import type` only, which Node's type stripping erases, so the corpus format is testable on a clean
// checkout. The engine-dependent half (does the driver populate it, does a killed run leave a
// readable file) is verified by `./scripts/arena.sh --verify-replay` and by the kill test recorded in
// `docs/arena.md`; it cannot live here.
//
// EVERY ASSERTION HERE WAS MUTATION-CHECKED. CLAUDE.md records that tests which cannot fail are this
// project's most frequent defect — three shipped in one task, past two review rounds — so each test
// below was confirmed RED against a deliberate break of the behaviour it names. The mutants are listed
// in `docs/arena.md`. A test added later without that step is worth nothing.

import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  collectingSink,
  contested,
  decisions,
  LOG_FORMAT_VERSION,
  logStamp,
  menuOf,
  openDecisionLog,
  positionKeyOf,
  defaultLogPath,
  readLog,
  renderTranscript,
  sinkFor,
  summarise,
  type DecisionEntry,
  type LogEntry,
} from "./log.ts";
// Type-only, so Node's type stripping erases these lines entirely and never resolves the paths —
// which is exactly why this suite runs from the repo root, where `../src/types.ts` does not exist.
import type { Author, Choice } from "./types.ts";
import type { MatchConfig } from "../src/types.ts";

const scratch = () => mkdtempSync(join(tmpdir(), "arena-log-"));

/** Minimal but complete — the point is that every field the corpus promises is actually present. */
function choice(index: number, label: string, extra: Partial<Choice> = {}): Choice {
  return {
    index,
    command: { type: "endTurn", seat: "south" } as Choice["command"],
    label,
    kind: "endTurn",
    cardId: null,
    instanceId: null,
    targetCardId: null,
    targetInstanceId: null,
    note: null,
    numbers: null,
    ...extra,
  };
}

function decisionEntry(over: Partial<DecisionEntry> = {}): DecisionEntry {
  return {
    type: "decision",
    game: 1,
    commandIndex: 7,
    seat: "south",
    agent: "scripted:improved",
    author: "heuristic",
    turnNumber: 3,
    source: "command",
    kind: "declareAttack",
    choiceCount: 2,
    chosenIndex: 0,
    requestedIndex: null,
    chosenLabel: "Attack the Leader",
    reason: null,
    disagreement: null,
    phase: "main",
    position: { myLife: 4 },
    menu: menuOf([choice(0, "Attack the Leader"), choice(1, "End turn")]),
    rejections: [],
    prompt: null,
    truncated: false,
    positionKey: "x",
    command: { type: "endTurn", seat: "south" } as DecisionEntry["command"],
    ...over,
  };
}

const CONFIG = { seed: 1000, firstPlayer: "north" } as unknown as MatchConfig;

test("a record is on disk BEFORE the log is closed — the abandoned-game guarantee", () => {
  const dir = scratch();
  const path = join(dir, "live.jsonl");
  const writer = openDecisionLog(path, { note: "smoke" });
  writer.game({ game: 1, seats: { south: "human:ping", north: "scripted:improved" }, config: CONFIG });
  writer.decision(decisionEntry());

  // No close(). This is the whole reason the format is append-per-decision: a human closing the
  // browser tab, or a Ctrl-C, must not cost the game. If this ever buffers, that promise is void.
  const { entries, torn } = readLog(path);
  assert.equal(torn, false);
  assert.deepEqual(entries.map((e) => e.type), ["run", "game", "decision"]);
  writer.close();
});

test("a torn final line is reported and every complete record survives it", () => {
  const dir = scratch();
  const path = join(dir, "torn.jsonl");
  const writer = openDecisionLog(path, {});
  writer.decision(decisionEntry({ commandIndex: 1 }));
  writer.decision(decisionEntry({ commandIndex: 2 }));
  writer.close();
  // Exactly what a SIGKILL mid-write leaves behind.
  appendFileSync(path, '{"type":"decision","game":1,"commandIn');

  const { entries, torn } = readLog(path);
  assert.equal(torn, true, "a half-written final line must be reported, not silently dropped");
  assert.equal(decisions(entries).length, 2, "both complete decisions must survive the tear");
});

test("a complete log is not reported as torn, and the version is stamped", () => {
  const dir = scratch();
  const path = join(dir, "clean.jsonl");
  const writer = openDecisionLog(path, { deckSouth: "sim/decks/st01.json" });
  writer.auto({ game: 1, commandIndex: 0, seat: "north", turn: 1, kind: "startGame", label: "Start the game", command: { type: "startGame", seat: "north" } as never });
  writer.outcome({ game: 1, winner: "north", termination: "rules-win", turns: 11, commands: 142, decisions: 129 });
  writer.close();

  const { entries, torn, unknown } = readLog(path);
  assert.equal(torn, false);
  assert.equal(unknown, 0);
  const run = entries[0];
  assert.equal(run?.type, "run");
  assert.equal(run.type === "run" ? run.version : -1, LOG_FORMAT_VERSION);
  assert.deepEqual(run.type === "run" ? run.setup : {}, { deckSouth: "sim/decks/st01.json" });
});

test("a record of an unknown type is counted, not thrown — a newer format stays readable", () => {
  const dir = scratch();
  const path = join(dir, "future.jsonl");
  writeFileSync(
    path,
    `${JSON.stringify({ type: "run", version: 99, startedAt: "later", setup: {} })}\n` +
      `${JSON.stringify({ type: "telepathy", game: 1 })}\n` +
      `${JSON.stringify(decisionEntry())}\n`,
  );
  const { entries, unknown } = readLog(path);
  assert.equal(unknown, 1);
  assert.equal(decisions(entries).length, 1);
});

test("writing to a closed log throws instead of silently discarding the decision", () => {
  const dir = scratch();
  const path = join(dir, "closed.jsonl");
  const writer = openDecisionLog(path, {});
  writer.close();
  assert.throws(() => writer.decision(decisionEntry()), /closed/);
});

test("contested ignores a heuristic's reason and keeps a human's", () => {
  // scriptedAgent narrates EVERY decision ("improved score 1210"), so counting text alone would mark
  // 100% of a scripted game contested. This is the assertion that made `author` a field.
  const entries: LogEntry[] = [
    decisionEntry({ author: "heuristic", reason: "improved score 1210" }),
    decisionEntry({ author: "human", reason: "holding the counter for their Leader swing" }),
    decisionEntry({ author: "human", reason: null }),
    decisionEntry({ author: "human", reason: "   " }),
    decisionEntry({ author: "model", reason: null, disagreement: ["tempo:[2] swing now"] }),
    decisionEntry({ author: "model", reason: "unanimous: all three lenses agree", disagreement: [] }),
  ];
  const hard = contested(entries);
  assert.equal(hard.length, 3, "human-with-a-reason, model-with-dissent, model-with-a-reason");
  assert.equal(
    hard.some((d) => d.author === "heuristic"),
    false,
    "a heuristic's debug narration is not a difficulty signal",
  );
});

test("positionKey is stable across key order and moves with the menu", () => {
  const menu = menuOf([choice(0, "Attack the Leader"), choice(1, "End turn")]);
  const a = positionKeyOf({ myLife: 4, oppLife: 2 }, menu);
  const b = positionKeyOf({ oppLife: 2, myLife: 4 }, menu);
  assert.equal(a, b, "key order must not change the fingerprint — it is a canonicalising hash");

  const sameMenuDifferentPosition = positionKeyOf({ myLife: 3, oppLife: 2 }, menu);
  assert.notEqual(a, sameMenuDifferentPosition, "a different position is a different key");

  const samePositionDifferentMenu = positionKeyOf(
    { myLife: 4, oppLife: 2 },
    menuOf([choice(0, "Attack the Leader")]),
  );
  assert.notEqual(a, samePositionDifferentMenu, "the legal-move set is part of the key");
});

test("menuOf keeps the fields a policy needs and drops the nulls", () => {
  const [attack, plain] = menuOf([
    choice(0, "Attack the Leader", {
      kind: "declareAttack",
      cardId: "OP16-017",
      targetCardId: "OP16-001",
      note: "6000 vs 5000",
      numbers: { attackPower: 6000, targetIsLeader: true },
    }),
    choice(1, "End turn"),
  ]);
  assert.deepEqual(attack, {
    i: 0,
    kind: "declareAttack",
    label: "Attack the Leader",
    note: "6000 vs 5000",
    cardId: "OP16-017",
    targetCardId: "OP16-001",
    numbers: { attackPower: 6000, targetIsLeader: true },
  });
  // Absent, not null: 120 decisions x 12 options x 4 null fields is most of the file.
  assert.deepEqual(Object.keys(plain!), ["i", "kind", "label"]);
});

test("sinkFor stamps the game index; collectingSink keeps every kind", () => {
  const dir = scratch();
  const path = join(dir, "sink.jsonl");
  const writer = openDecisionLog(path, {});
  const sink = sinkFor(writer, 4);
  const { type: _t, game: _g, positionKey: _k, ...decisionWithoutStamp } = decisionEntry();
  sink.decision(decisionWithoutStamp);
  writer.close();

  const logged = decisions(readLog(path).entries);
  assert.equal(logged[0]?.game, 4, "the driver knows one game and must not have to know its index");
  assert.ok(logged[0]?.positionKey && logged[0].positionKey !== "x", "the writer computes the key");

  const collected: unknown[] = [];
  const memory = collectingSink(collected as never);
  memory.decision(decisionWithoutStamp);
  memory.auto({ commandIndex: 0, seat: "south", turn: 1, kind: "startGame", label: "Start", command: {} as never });
  memory.abort({ commandIndex: 9, seat: "south", turn: 4, source: "prompt", kind: "selectCards", position: {}, menu: [], rejections: [], prompt: null });
  assert.equal(collected.length, 3);
});

test("the transcript shows the pick, the forced steps, an abort and its refusals", () => {
  const entries: LogEntry[] = [
    { type: "run", version: LOG_FORMAT_VERSION, startedAt: "2026-08-19T10:00:00.000Z", setup: { games: 1 } },
    { type: "game", game: 1, seats: { south: "human:ping", north: "council" }, config: CONFIG },
    { type: "auto", game: 1, commandIndex: 0, seat: "north", turn: 1, kind: "startGame", label: "Start the game", command: {} as never },
    decisionEntry({
      commandIndex: 1,
      author: "human",
      agent: "human:ping",
      reason: "banking the counter",
      rejections: [{ i: 3, label: "Play Marco", reason: "Prompt resolution could not be applied." }],
    }),
    {
      type: "abort",
      game: 1,
      commandIndex: 2,
      seat: "south",
      turn: 3,
      source: "prompt",
      kind: "selectCards",
      position: {},
      menu: menuOf([choice(0, "Reveal Vista")]),
      rejections: [{ i: 0, label: "Reveal Vista", reason: "Prompt resolution could not be applied." }],
      prompt: { id: "p1", label: "Reveal up to 1 Whitebeard Pirates card", details: "", choiceKind: "selectCards", minSelections: 0, maxSelections: 1 },
    },
    { type: "outcome", game: 1, winner: "north", termination: "illegal-command", turns: 3, commands: 2, decisions: 1 },
  ];

  const text = renderTranscript(entries);
  assert.match(text, /GAME 1 {2}seed=1000/);
  assert.match(text, /forced {3}Start the game/);
  assert.match(text, /\[human:ping\/human\] Attack the Leader/);
  assert.match(text, /why: banking the counter/);
  assert.match(text, /REFUSED \[3\] Play Marco/, "a near-miss is how an engine mismatch is diagnosed");
  assert.match(text, /\*\*\* ABORTED on prompt\/selectCards: all 1 option\(s\) refused/);
  assert.match(text, /Reveal up to 1 Whitebeard Pirates card/);
  assert.match(text, /illegal-command/);

  // Alternatives are opt-in: 12 options x 120 decisions is not something anyone reads by choice.
  assert.equal(/End turn/.test(text), false, "the unchosen option is hidden by default");
  assert.match(renderTranscript(entries, { verbose: true }), /· \[1\] End turn/);
});

test("summarise reports authorship, and does not credit a degraded council to the model", () => {
  const entries: LogEntry[] = [
    decisionEntry({ author: "model", agent: "deepseek-council", disagreement: ["tempo:[1] end turn"] }),
    decisionEntry({ author: "heuristic", agent: "deepseek-council", reason: "[degraded: rate limit] improved score 200" }),
    decisionEntry({ author: "human", agent: "human:ping", reason: "trading down on purpose" }),
    { type: "game", game: 1, seats: { south: "a", north: "b" }, config: CONFIG },
    { type: "auto", game: 1, commandIndex: 0, seat: "north", turn: 1, kind: "startGame", label: "Start", command: {} as never },
  ];
  const text = summarise(entries);
  assert.match(text, /decisions 3 {3}forced 1/);
  assert.match(text, /human=1 {2}model=1 {2}heuristic=1/);
  assert.match(text, /contested: 2/);
});

test("a corrupt MIDDLE line is skipped and counted, not fatal to the whole file", () => {
  // The tail is covered above. A middle line can be torn by two processes appending to one path, or
  // by a short write, and until this was fixed one such line threw and denied access to every intact
  // decision in the file — the opposite of what NDJSON was chosen for.
  const dir = scratch();
  const path = join(dir, "middle.jsonl");
  const writer = openDecisionLog(path, {});
  writer.decision(decisionEntry({ commandIndex: 1 }));
  writer.close();
  appendFileSync(path, '{"type":"decisi\n');
  const writer2 = openDecisionLog(path, {});
  writer2.decision(decisionEntry({ commandIndex: 2 }));
  writer2.close();

  const { entries, torn, corrupt } = readLog(path);
  assert.equal(corrupt, 1, "the bad line must be counted");
  assert.equal(torn, false, "the file ends with a newline, so nothing is torn");
  assert.equal(decisions(entries).length, 2, "both intact decisions must still be readable");
});

test("the default log path cannot collide between two runs in the same second", () => {
  // logStamp has one-second resolution and the writer APPENDS, so without a per-process suffix two
  // runs starting in the same second merged into one file with two `run` headers and two `game: 1`s.
  const now = new Date("2026-08-19T10:18:45.000Z");
  const a = defaultLogPath("/repo", now, 1234);
  const b = defaultLogPath("/repo", now, 5678);
  assert.notEqual(a, b, "same second, different process, must be a different file");
  assert.match(a, /2026-08-19T10-18-45-1234\.jsonl$/);
});

test("an out-of-range request is recorded separately and never corrupts chosenIndex", () => {
  // The driver plays option 0 when an agent names an option that does not exist. The row must still
  // satisfy `menu[chosenIndex] === what was played`, or the corpus contradicts itself.
  const entry = decisionEntry({ chosenIndex: 0, requestedIndex: 12, choiceCount: 2 });
  assert.ok(
    entry.menu.some((m) => m.i === entry.chosenIndex),
    "chosenIndex must name an option that is actually in this row's menu",
  );
  const text = renderTranscript([entry]);
  assert.match(text, /OUT OF RANGE: agent asked for \[12\] of 2 — option 0 was played instead/);
  assert.match(summarise([entry]), /agent asked out of range: 1/);
  assert.equal(/OUT OF RANGE/.test(renderTranscript([decisionEntry()])), false, "silent when honoured");
});

test("logStamp is filename-safe and sorts chronologically", () => {
  const early = logStamp(new Date("2026-08-19T09:07:03.412Z"));
  const late = logStamp(new Date("2026-08-19T10:18:45.000Z"));
  assert.equal(early, "2026-08-19T09-07-03");
  assert.equal(early < late, true);
  assert.equal(/[:/\\]/.test(early), false, "a colon is not a legal filename character everywhere");
});

test("openDecisionLog creates the directory it was pointed at", () => {
  const dir = scratch();
  const path = join(dir, "nested", "deeper", "run.jsonl");
  const writer = openDecisionLog(path, {});
  writer.close();
  assert.equal(existsSync(path), true);
  assert.match(readFileSync(path, "utf8"), /"type":"run"/);
});

test("an append reopens rather than truncates — two runs to one path accumulate", () => {
  const dir = scratch();
  const path = join(dir, "shared.jsonl");
  openDecisionLog(path, { run: 1 }).close();
  openDecisionLog(path, { run: 2 }).close();
  const { entries } = readLog(path);
  assert.equal(entries.filter((e) => e.type === "run").length, 2, "run N+1 must not destroy run N");
});

