// Task 10 harness test: sim/batch-runner.ts's engine-bound primitives.
//
// Vendor-relative imports (see batch-runner.ts's header) — this file only runs after
// scripts/simulate.sh copies it, alongside batch-runner.ts and environment-contract.mjs, into the
// vendored engine's tests/cards/ directory. Invoked via `--harness-tests`.
//
// I4 fix (fix round 1): this file's 12 tests are real, engine-executing tests with NO in-file
// gate, so scripts/simulate.sh's PRE-EXISTING behavior of copying it unconditionally into
// tests/cards/ (needed so matchup.sim.test.ts can import runLegacyMatchupCli from it — see
// batch-runner.ts's own header) meant it would sit there permanently, and any LATER bare `vp test
// run` in that vendor tree would execute all 12 for real rather than skip them — silently changing
// the project's pinned "6078 tests, 0 failures" suite count. Gated the same way
// matchup.sim.test.ts (SIM_RUN) and environment-job.sim.test.ts (SIM_ENV_JOB) already are, on a
// dedicated SIM_HARNESS_TESTS flag that ONLY --harness-tests sets.
import { test } from "vite-plus/test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  EnvironmentOutputError,
  STRATEGIES,
  config,
  deriveCandidateSeat,
  expandMainDeckCounts,
  loadDeck,
  playOne,
  publishRawJobResultFile,
  runBatch,
  runLegacyMatchupCli,
  summarize,
} from "./batch-runner.ts";

const run = process.env.SIM_HARNESS_TESTS === "1" ? test : test.skip;

// A tiny, fast, always-legal deck: the engine's own ST01 starter, mirrored so it cannot rot
// (see sim/decks/st01.json's own note). Kept inline here so this file has zero path dependencies
// beyond what scripts/simulate.sh already copies.
const ST01_LEADER = "ST01-001";
const ST01_COUNTS: Record<string, number> = {
  "ST01-002": 4,
  "ST01-003": 4,
  "ST01-004": 4,
  "ST01-005": 4,
  "ST01-006": 4,
  "ST01-007": 4,
  "ST01-008": 4,
  "ST01-009": 4,
  "ST01-010": 4,
  "ST01-011": 2,
  "ST01-012": 2,
  "ST01-013": 2,
  "ST01-014": 2,
  "ST01-015": 2,
  "ST01-016": 2,
  "ST01-017": 2,
};

function deckInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    displayName: "ST01 fixture",
    leaderGameplayId: ST01_LEADER,
    mainDeckCounts: ST01_COUNTS,
    ...overrides,
  };
}

// A plain legacy Deck object (name/leader/main), used directly rather than via loadDeck(): this
// file runs from inside the vendored engine's tests/cards/, an EXTERNAL symlinked tree with no
// relative path back to this repo's sim/decks/ — see the dedicated loadDeck test below for how a
// real file path is exercised instead (a self-contained temp file).
const LEGACY_DECK = {
  name: "ST01 inline fixture",
  leader: ST01_LEADER,
  main: expandMainDeckCounts(ST01_COUNTS),
};

/** Materializes a tiny, catalog-real deck file tree under a fresh temp root, for CLI-level tests. */
function writeMiniDeckRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "batch-runner-root-"));
  mkdirSync(join(root, "sim", "decks"), { recursive: true });
  writeFileSync(
    join(root, "sim", "decks", "mini.json"),
    JSON.stringify({ name: "mini", leader: ST01_LEADER, main: expandMainDeckCounts(ST01_COUNTS) }),
  );
  return root;
}

run("expandMainDeckCounts flattens counts deterministically, sorted by gameplay id", () => {
  const expanded = expandMainDeckCounts({ b: 2, a: 3 });
  assert.deepEqual(expanded, ["a", "a", "a", "b", "b"]);
});

// I2 fix (fix round 1): deriveCandidateSeat takes ONLY the players record — no candidateSeat
// parameter at all — so there is no way to "pass" this test by returning an assumed value; it must
// genuinely read playerName out of whatever record it is given.
run("deriveCandidateSeat reads playerName from the record — normal case", () => {
  const seat = deriveCandidateSeat({ north: { playerName: "candidate" }, south: { playerName: "opponent" } });
  assert.equal(seat, "north");
});

run("deriveCandidateSeat follows a SWAPPED record to south — proves it is not just echoing an assumed north", () => {
  const seat = deriveCandidateSeat({ north: { playerName: "opponent" }, south: { playerName: "candidate" } });
  assert.equal(seat, "south");
});

run("deriveCandidateSeat throws seat_drift when neither seat reports playerName=candidate", () => {
  assert.throws(
    () => deriveCandidateSeat({ north: { playerName: "opponent" }, south: { playerName: "opponent" } }),
    (error: unknown) => (error as { code?: string }).code === "seat_drift",
  );
});

run("runBatch: a play job seats the candidate north and reads aOnPlay back as true", () => {
  const results = runBatch({
    candidate: deckInput(),
    opponent: deckInput(),
    fixedSeat: "play",
    seeds: [7001, 7002],
    strategyCandidate: "firstLegal",
    strategyOpponent: "firstLegal",
    maxCommands: 500,
    maxTurns: 40,
  });
  assert.equal(results.length, 2);
  for (const [index, r] of results.entries()) {
    assert.equal(r.seed, [7001, 7002][index]);
    assert.equal(r.requestedSeat, "play");
    assert.equal(r.actualSeat, "north");
    assert.equal(r.aOnPlay, true);
    assert.notEqual(r.outcome, "round_timeout");
    assert.ok(["win", "loss", "unfinished", "tool_failure"].includes(r.outcome));
  }
});

run("runBatch: a draw job seats the candidate south and reads aOnPlay back as false", () => {
  const results = runBatch({
    candidate: deckInput(),
    opponent: deckInput(),
    fixedSeat: "draw",
    seeds: [7003, 7004],
    strategyCandidate: "firstLegal",
    strategyOpponent: "firstLegal",
    maxCommands: 500,
    maxTurns: 40,
  });
  assert.equal(results.length, 2);
  for (const r of results) {
    assert.equal(r.requestedSeat, "draw");
    assert.equal(r.actualSeat, "south");
    assert.equal(r.aOnPlay, false);
  }
});

run("runBatch: alternate mode (legacy use only) alternates the candidate's seat by seed index", () => {
  const results = runBatch({
    candidate: deckInput(),
    opponent: deckInput(),
    fixedSeat: "alternate",
    seeds: [7005, 7006, 7007, 7008],
    strategyCandidate: "firstLegal",
    strategyOpponent: "firstLegal",
    maxCommands: 500,
    maxTurns: 40,
  });
  assert.deepEqual(
    results.map((r) => r.actualSeat),
    ["north", "south", "north", "south"],
  );
  assert.deepEqual(
    results.map((r) => r.requestedSeat),
    ["play", "draw", "play", "draw"],
  );
});

run("runBatch: unique seeds are executed exactly once each, in the given order", () => {
  const seeds = [9001, 9002, 9003];
  const results = runBatch({
    candidate: deckInput(),
    opponent: deckInput(),
    fixedSeat: "play",
    seeds,
    strategyCandidate: "firstLegal",
    strategyOpponent: "firstLegal",
    maxCommands: 500,
    maxTurns: 40,
  });
  assert.deepEqual(
    results.map((r) => r.seed),
    seeds,
  );
});

run("legacy primitives: the Summary shape is unchanged after extraction", () => {
  const a = playOne(
    LEGACY_DECK,
    LEGACY_DECK,
    8001,
    "north",
    STRATEGIES.firstLegal!,
    STRATEGIES.firstLegal!,
    40,
    500,
  );
  const b = playOne(
    LEGACY_DECK,
    LEGACY_DECK,
    8002,
    "south",
    STRATEGIES.firstLegal!,
    STRATEGIES.firstLegal!,
    40,
    500,
  );
  const summary = summarize([a, b]);
  assert.deepEqual(
    Object.keys(summary).sort(),
    ["ci", "games", "losses", "meanCommands", "medianTurns", "timeouts", "unfinished", "wins", "winRate"].sort(),
  );
  assert.equal(typeof summary.games, "number");
  assert.equal(summary.ci.length, 2);
});

run("legacy config(): seating deck A north is still what puts it on the play (unchanged)", () => {
  const cfg = config(LEGACY_DECK, LEGACY_DECK, 1234, "north");
  assert.equal(cfg.players.north?.playerName, "A");
  assert.equal(cfg.players.south?.playerName, "B");
});

run("loadDeck: reads a deck file from disk unchanged (leader + main array, warns not throws on non-50)", () => {
  const dir = mkdtempSync(join(tmpdir(), "batch-runner-loaddeck-"));
  try {
    const path = join(dir, "deck.json");
    writeFileSync(path, JSON.stringify({ name: "x", leader: ST01_LEADER, main: ["ST01-002", "ST01-002"] }));
    const deck = loadDeck(path);
    assert.equal(deck.leader, ST01_LEADER);
    assert.deepEqual(deck.main, ["ST01-002", "ST01-002"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

run("runLegacyMatchupCli: an invalid --first value fails as invalid_first_player, not silent alternate", () => {
  const root = writeMiniDeckRoot();
  const keys = [
    "SIM_ROOT", "SIM_DECK_A", "SIM_DECK_B", "SIM_GAMES", "SIM_FIRST", "SIM_OUT", "SIM_COMPARE",
    "SIM_STRATEGY", "SIM_STRATEGY_A", "SIM_STRATEGY_B", "SIM_TURN_BUDGET", "SIM_MAX_COMMANDS",
  ];
  const saved: Record<string, string | undefined> = {};
  for (const k of keys) saved[k] = process.env[k];
  try {
    process.env.SIM_ROOT = root;
    process.env.SIM_DECK_A = "sim/decks/mini.json";
    process.env.SIM_DECK_B = "sim/decks/mini.json";
    process.env.SIM_GAMES = "1";
    process.env.SIM_FIRST = "banana";
    delete process.env.SIM_COMPARE;
    delete process.env.SIM_STRATEGY;
    delete process.env.SIM_STRATEGY_A;
    delete process.env.SIM_STRATEGY_B;
    delete process.env.SIM_TURN_BUDGET;
    delete process.env.SIM_MAX_COMMANDS;
    assert.throws(
      () => runLegacyMatchupCli(),
      (error: unknown) => (error as { code?: string }).code === "invalid_first_player",
    );
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    rmSync(root, { recursive: true, force: true });
  }
});

run("publishRawJobResultFile: writes atomically and cleans up its own temp file", () => {
  const dir = mkdtempSync(join(tmpdir(), "batch-runner-publish-"));
  try {
    const target = join(dir, "out.json");
    publishRawJobResultFile(target, { hello: "world" });
    assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), { hello: "world" });
    const leftover = readdirSync(dir).filter((name) => name !== "out.json");
    assert.deepEqual(leftover, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

run("publishRawJobResultFile: refuses to overwrite an existing target, and never touches its bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "batch-runner-publish-"));
  try {
    const target = join(dir, "out.json");
    writeFileSync(target, "PRE-EXISTING");
    assert.throws(
      () => publishRawJobResultFile(target, { hello: "world" }),
      (error: unknown) => error instanceof EnvironmentOutputError && error.code === "environment_output_exists",
    );
    assert.equal(readFileSync(target, "utf8"), "PRE-EXISTING");
    const leftoverTemps = readdirSync(dir).filter((name) => name !== "out.json");
    assert.deepEqual(leftoverTemps, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
