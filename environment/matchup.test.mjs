import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { gameplayHashForDeck } from "./deck.mjs";
import { EnvironmentError } from "./errors.mjs";
import { environmentKey } from "./manifest.mjs";
import { finalizeSnapshot, verifySnapshot } from "./snapshot.mjs";
import {
  buildSimulatedMatchupSnapshot,
  clockAuthorizationFor,
  MATCHUP_KIND,
  pairingKeyFor,
  parseEnvironmentKey,
  validateObservedMatchupSnapshot,
  validateScoreableMatchupCell,
} from "./matchup.mjs";

/* ------------------------------------------------------------------ *
 * Fixtures. Every hash below was produced by the project's own
 * builders (see the task-11 report's fixture-derivation section); the
 * first test block re-derives each recomputable one so a hand-typed
 * hash could never survive here.
 * ------------------------------------------------------------------ */

function fixture(name) {
  return JSON.parse(readFileSync(new URL(`../tests/fixtures/environment/${name}`, import.meta.url), "utf8"));
}

const diagnosticBundle = fixture("minimal-resolved-plan.json");
const timeoutScenario = fixture("accepted-clock-timeout-results.json");
const officialBundle = timeoutScenario.plan;

function deckOf(bundle, snapshotId) {
  const deck = bundle.deckSnapshots.find((entry) => entry.snapshotId === snapshotId);
  assert.ok(deck, `bundle has no deck snapshot ${snapshotId}`);
  return deck;
}

function failure(fn) {
  try {
    fn();
  } catch (error) {
    if (error instanceof EnvironmentError) return error;
    throw error;
  }
  throw new assert.AssertionError({ message: "expected an EnvironmentError but none was thrown" });
}

const SC_IDENTITY = {
  edition: "SC",
  metagameRegion: "CN",
  language: "zh-Hans",
  formatId: "standard-block2-op16",
  timeZone: "Asia/Shanghai",
};

/* ------------------------------------------------------------------ *
 * 1. The fixtures are hash-genuine
 * ------------------------------------------------------------------ */

test("every deck snapshot in a plan bundle verifies and recomputes its own gameplay hash", () => {
  for (const bundle of [diagnosticBundle, officialBundle]) {
    assert.ok(bundle.deckSnapshots.length >= 2);
    for (const deck of bundle.deckSnapshots) {
      verifySnapshot(deck);
      assert.equal(
        deck.data.gameplayHash,
        gameplayHashForDeck(deck.data.leaderGameplayId, deck.data.mainDeckCounts),
      );
    }
  }
});

test("a plan bundle's refs bind their own content: every id carries its content hash suffix", () => {
  for (const bundle of [diagnosticBundle, officialBundle]) {
    const resolved = bundle.resolved;
    const refs = [
      ["manifestRef", { snapshotId: resolved.manifestRef.manifestId, contentHash: resolved.manifestRef.contentHash }],
      ["candidateDeckRef", resolved.candidateDeckRef],
      ["capabilityRef", resolved.capabilityRef],
      ...Object.entries(resolved.references),
      ...resolved.marketRefs.map((ref, index) => [`marketRefs[${index}]`, ref]),
      ...resolved.strata.flatMap((row, index) => row.representatives.map((representative, deckIndex) => (
        [`strata[${index}].representatives[${deckIndex}].deckRef`, representative.deckRef]
      ))),
      ...(resolved.clockRef === null ? [] : [["clockRef", resolved.clockRef]]),
    ];
    for (const [label, ref] of refs) {
      assert.match(ref.contentHash, /^sha256:[0-9a-f]{64}$/, label);
      assert.ok(ref.snapshotId.endsWith(ref.contentHash.slice(7, 23)), `${label} id/hash suffix`);
    }
    assert.equal(
      resolved.candidateGameplayHash,
      deckOf(bundle, resolved.candidateDeckRef.snapshotId).data.gameplayHash,
    );
    for (const row of resolved.strata) {
      for (const representative of row.representatives) {
        assert.equal(
          representative.gameplayHash,
          deckOf(bundle, representative.deckRef.snapshotId).data.gameplayHash,
        );
      }
    }
  }
});

test("the diagnostic fixture is blocker-bearing and clockless; the official one carries an accepted clock", () => {
  assert.equal(diagnosticBundle.resolved.evaluationMode, "diagnostic_estimate");
  assert.equal(diagnosticBundle.resolved.clockRef, null);
  assert.equal(diagnosticBundle.resolved.roundTimeoutPolicy, null);
  assert.ok(diagnosticBundle.resolved.blockers.length > 0);
  assert.equal(diagnosticBundle.resolved.blockers[0].code, "clock_model_unavailable");

  assert.equal(officialBundle.resolved.evaluationMode, "official");
  assert.notEqual(officialBundle.resolved.clockRef, null);
  assert.equal(officialBundle.resolved.roundTimeoutPolicy.stage, "swiss");
  assert.equal(officialBundle.resolved.roundTimeoutPolicy.timeoutScoring, "double-loss");
  assert.deepEqual(officialBundle.resolved.blockers, []);
});

/* ------------------------------------------------------------------ *
 * 2. environmentKey is inverted, never invented
 * ------------------------------------------------------------------ */

test("parseEnvironmentKey inverts the Manifest's own environmentKey and proves it by round trip", () => {
  const identity = parseEnvironmentKey(officialBundle.resolved.environmentKey);
  assert.deepEqual(identity, { ...SC_IDENTITY, asOf: "2026-08-20" });
  assert.equal(environmentKey(identity), officialBundle.resolved.environmentKey);
});

test("parseEnvironmentKey refuses a key it cannot round trip", () => {
  for (const key of [
    "SC:CN:zh-Hans:Asia/Shanghai:standard-block2-op16",
    "SC:CN:en:Asia/Shanghai:standard-block2-op16:2026-08-20",
    "XX:CN:zh-Hans:Asia/Shanghai:standard-block2-op16:2026-08-20",
    "SC:CN:zh-Hans:Asia/Shanghai:standard-block2-op16:2026-08-20:extra",
    "",
  ]) {
    const error = failure(() => parseEnvironmentKey(key));
    assert.equal(error.code, "environment_identity_mismatch", key);
  }
});

/* ------------------------------------------------------------------ *
 * 3. pairing keys
 * ------------------------------------------------------------------ */

test("a pairing key is the stable archetype x representative x seat identity", () => {
  const [first, second] = officialBundle.resolved.strata;
  const key = pairingKeyFor({
    archetypeId: first.archetypeId,
    opponentGameplayHash: first.representatives[0].gameplayHash,
    seat: "play",
  });
  assert.equal(
    key,
    pairingKeyFor({
      archetypeId: first.archetypeId,
      opponentGameplayHash: first.representatives[0].gameplayHash,
      seat: "play",
    }),
  );
  const others = [
    { archetypeId: first.archetypeId, opponentGameplayHash: first.representatives[0].gameplayHash, seat: "draw" },
    { archetypeId: second.archetypeId, opponentGameplayHash: second.representatives[0].gameplayHash, seat: "play" },
    { archetypeId: first.archetypeId, opponentGameplayHash: second.representatives[0].gameplayHash, seat: "play" },
  ];
  for (const other of others) assert.notEqual(pairingKeyFor(other), key);
  assert.equal(failure(() => pairingKeyFor({ ...others[0], seat: "north" })).code, "matchup_cell_invalid");
});

/* ------------------------------------------------------------------ *
 * 4. the scoreable matchup cell contract
 * ------------------------------------------------------------------ */

const FLOOR = 200;

function cellFor({ seat = "play", ...overrides } = {}) {
  const candidate = deckOf(officialBundle, officialBundle.resolved.candidateDeckRef.snapshotId);
  const opponent = deckOf(officialBundle, officialBundle.resolved.strata[1].representatives[0].deckRef.snapshotId);
  return {
    candidateDeckSnapshotId: candidate.snapshotId,
    candidateContentHash: candidate.contentHash,
    candidateGameplayHash: candidate.data.gameplayHash,
    opponentDeckSnapshotId: opponent.snapshotId,
    opponentContentHash: opponent.contentHash,
    opponentGameplayHash: opponent.data.gameplayHash,
    candidateSeat: seat,
    wins: 110,
    losses: 90,
    scoredRoundTimeouts: 0,
    validGames: 200,
    sampleSize: 200,
    unfinished: 0,
    toolFailures: 0,
    roundTimeout: null,
    ...overrides,
  };
}

function gameRows(count = 200) {
  return Array.from({ length: count }, (_, index) => ({
    seed: 900000 + index,
    requestedSeat: "play",
    actualSeat: "north",
    aOnPlay: true,
    outcome: index < 110 ? "win" : "loss",
    engineTermination: "rules-win",
    terminationCause: "rules-win",
    turns: 9,
    commands: 91,
  }));
}

function contextFor(overrides = {}) {
  const resolved = officialBundle.resolved;
  return {
    method: "simulated",
    applicability: "native",
    formatId: SC_IDENTITY.formatId,
    stage: "swiss",
    timeoutScoring: "double-loss",
    population: "SC simulated field (fixture)",
    window: { startLocalDate: "2026-07-22", asOf: "2026-08-20", timeZone: SC_IDENTITY.timeZone },
    minimumCompletedGamesPerSeat: FLOOR,
    clock: clockAuthorizationFor(resolved),
    simulation: {
      engineRevision: "engine-commit-fixture",
      strategyCandidate: "valueRanked",
      strategyOpponent: "valueRanked",
      capabilityRef: resolved.capabilityRef,
      maxCommands: 800,
      maxTurns: 40,
      planHash: `sha256:${"1".repeat(64)}`,
      jobId: `sha256:${"2".repeat(64)}`,
    },
    ...overrides,
  };
}

test("a complete simulated cell is scoreable and pins every provenance field", () => {
  const scored = validateScoreableMatchupCell(cellFor({ games: gameRows() }), contextFor());
  assert.equal(scored.method, "simulated");
  assert.equal(scored.applicability, "native");
  assert.equal(scored.candidateSeat, "play");
  assert.equal(scored.formatId, SC_IDENTITY.formatId);
  assert.equal(scored.stage, "swiss");
  assert.equal(scored.timeoutScoring, "double-loss");
  assert.equal(scored.population, "SC simulated field (fixture)");
  assert.equal(scored.window.asOf, "2026-08-20");
  assert.equal(scored.sampleSize, 200);
  assert.equal(scored.validGames, 200);
  assert.equal(scored.winRate, 110 / 200);
  assert.ok(Object.isFrozen(scored));
});

test("both provenance axes are required and neither may be inferred from the other", () => {
  for (const overrides of [
    { method: undefined },
    { method: "native" },
    { method: "observed_simulated" },
    { applicability: undefined },
    { applicability: "observed" },
    { applicability: "native_proxy" },
  ]) {
    const error = failure(() => validateScoreableMatchupCell(cellFor({ games: gameRows() }), contextFor(overrides)));
    assert.equal(error.code, "matchup_provenance_invalid", JSON.stringify(overrides));
  }
});

test("a scoreable cell must identify both decks exactly", () => {
  for (const key of [
    "candidateDeckSnapshotId", "candidateContentHash", "candidateGameplayHash",
    "opponentDeckSnapshotId", "opponentContentHash", "opponentGameplayHash",
  ]) {
    const error = failure(() => validateScoreableMatchupCell(
      cellFor({ games: gameRows(), [key]: key.endsWith("Hash") ? `sha256:${"z".repeat(64)}` : "not/a/safe id" }),
      contextFor(),
    ));
    assert.equal(error.code, "matchup_cell_invalid", key);
    assert.equal(error.details.field, key);
  }
});

test("a scoreable cell must pin a play or draw seat", () => {
  for (const seat of [undefined, "north", "alternate", "PLAY"]) {
    const error = failure(() => validateScoreableMatchupCell(cellFor({ games: gameRows(), candidateSeat: seat }), contextFor()));
    assert.equal(error.code, "matchup_cell_invalid");
    assert.equal(error.details.field, "candidateSeat");
  }
});

test("outcome arithmetic must reconcile exactly", () => {
  for (const overrides of [
    { wins: 111 },
    { losses: 89 },
    { scoredRoundTimeouts: 1 },
    { validGames: 199 },
  ]) {
    const error = failure(() => validateScoreableMatchupCell(cellFor({ games: gameRows(), ...overrides }), contextFor()));
    assert.equal(error.code, "matchup_cell_invalid", JSON.stringify(overrides));
    assert.ok(
      ["outcome_counts_inconsistent", "sample_size_inconsistent", "round_timeout_unauthorized"].includes(error.details.reason),
      `${JSON.stringify(overrides)} -> ${error.details.reason}`,
    );
  }
  // The exact-reconciliation guard, isolated: counts that sum correctly but to the wrong total.
  const error = failure(() => validateScoreableMatchupCell(
    cellFor({ games: gameRows(), wins: 109, losses: 90, validGames: 200, sampleSize: 200 }),
    contextFor(),
  ));
  assert.equal(error.details.reason, "outcome_counts_inconsistent");
});

test("sampleSize must equal the valid games plus every excluded row", () => {
  const error = failure(() => validateScoreableMatchupCell(
    cellFor({ games: gameRows(), sampleSize: 201 }),
    contextFor(),
  ));
  assert.equal(error.details.reason, "sample_size_inconsistent");
});

test("a cell below the per-seat completed-game floor is not scoreable", () => {
  const error = failure(() => validateScoreableMatchupCell(
    cellFor({ games: gameRows(199), wins: 109, losses: 90, validGames: 199, sampleSize: 199 }),
    contextFor(),
  ));
  assert.equal(error.code, "insufficient_matchup_coverage");
  assert.equal(error.details.reason, "below_per_seat_floor");
});

test("ANY unfinished or tool-failure row invalidates the whole cell even when the floor is met", () => {
  for (const overrides of [{ unfinished: 2 }, { toolFailures: 1 }, { unfinished: 1, toolFailures: 1 }]) {
    const excluded = (overrides.unfinished ?? 0) + (overrides.toolFailures ?? 0);
    const error = failure(() => validateScoreableMatchupCell(
      cellFor({ games: gameRows(), sampleSize: 200 + excluded, ...overrides }),
      contextFor(),
    ));
    assert.equal(error.code, "insufficient_matchup_coverage", JSON.stringify(overrides));
    assert.equal(error.details.reason, "cell_invalidated_by_unfinished_row");
    // The floor itself is met: 200 clean valid games. The rule is not a floor check.
    assert.equal(error.details.validGames, 200);
  }
});

test("format, stage, timeout policy, population, window and floor must all be supplied", () => {
  for (const overrides of [
    { formatId: undefined },
    { stage: undefined },
    { timeoutScoring: undefined },
    { population: "" },
    { window: undefined },
    { window: { startLocalDate: "2026-07-22", asOf: "2026-08-20" } },
    { minimumCompletedGamesPerSeat: undefined },
    { minimumCompletedGamesPerSeat: 0 },
  ]) {
    const error = failure(() => validateScoreableMatchupCell(cellFor({ games: gameRows() }), contextFor(overrides)));
    assert.equal(error.code, "matchup_cell_invalid", JSON.stringify(overrides));
  }
});

test("a simulated cell requires every per-game row plus engine, policy and capability hashes", () => {
  assert.equal(
    failure(() => validateScoreableMatchupCell(cellFor(), contextFor())).details.reason,
    "simulated_rows_missing",
  );
  assert.equal(
    failure(() => validateScoreableMatchupCell(cellFor({ games: gameRows(199) }), contextFor())).details.reason,
    "simulated_rows_incomplete",
  );
  for (const key of ["engineRevision", "strategyCandidate", "strategyOpponent", "capabilityRef", "maxCommands", "maxTurns", "planHash", "jobId"]) {
    const simulation = { ...contextFor().simulation };
    delete simulation[key];
    const error = failure(() => validateScoreableMatchupCell(cellFor({ games: gameRows() }), contextFor({ simulation })));
    assert.equal(error.code, "matchup_cell_invalid", key);
    assert.equal(error.details.reason, "simulation_provenance_incomplete", key);
  }
});

/* ------------------------------------------------------------------ *
 * 5. round_timeout is gated on the full accepted ClockModel
 * ------------------------------------------------------------------ */

function timeoutCell(overrides = {}) {
  return cellFor({
    games: gameRows(),
    wins: 105,
    losses: 90,
    scoredRoundTimeouts: 5,
    validGames: 200,
    sampleSize: 200,
    roundTimeout: {
      clockModelRef: { ...officialBundle.resolved.clockRef },
      ...SC_IDENTITY,
      stage: "swiss",
      roundDurationMinutes: 30,
      timeoutScoring: "double-loss",
    },
    ...overrides,
  });
}

test("an accepted, exactly-matching clock model makes a round timeout scoreable at 0 for the candidate", () => {
  const scored = validateScoreableMatchupCell(timeoutCell(), contextFor());
  assert.equal(scored.scoredRoundTimeouts, 5);
  // Double loss: the timeouts score zero AND stay in the denominator.
  assert.equal(scored.winRate, 105 / 200);
  assert.equal(scored.validGames, 200);
  assert.equal(scored.roundTimeout.clockModelRef.contentHash, officialBundle.resolved.clockRef.contentHash);
});

test("a timeout row without the accepted clock hash fails simulation_result_mismatch/clock_model_hash", () => {
  // (a) the environment has no accepted clock at all (the diagnostic plan).
  const diagnosticContext = contextFor({ clock: clockAuthorizationFor(diagnosticBundle.resolved) });
  assert.equal(diagnosticContext.clock, null);
  let error = failure(() => validateScoreableMatchupCell(timeoutCell(), diagnosticContext));
  assert.equal(error.code, "simulation_result_mismatch");
  assert.equal(error.details.reason, "clock_model_hash");

  // (b) the cell declares no clock at all.
  error = failure(() => validateScoreableMatchupCell(timeoutCell({ roundTimeout: null }), contextFor()));
  assert.equal(error.code, "simulation_result_mismatch");
  assert.equal(error.details.reason, "clock_model_hash");

  // (c) the cell declares a DIFFERENT clock hash.
  error = failure(() => validateScoreableMatchupCell(
    timeoutCell({
      roundTimeout: {
        clockModelRef: { snapshotId: officialBundle.resolved.clockRef.snapshotId, contentHash: `sha256:${"c".repeat(64)}` },
        ...SC_IDENTITY,
        stage: "swiss",
        roundDurationMinutes: 30,
        timeoutScoring: "double-loss",
      },
    }),
    contextFor(),
  ));
  assert.equal(error.code, "simulation_result_mismatch");
  assert.equal(error.details.reason, "clock_model_hash");
});

test("every one of the eight clock dimensions must match exactly", () => {
  const dimensions = {
    edition: "EN",
    metagameRegion: "GLOBAL_EN",
    language: "en",
    formatId: "standard-block2-op17",
    stage: "top-cut",
    roundDurationMinutes: 45,
    timeoutScoring: "extra-turns",
  };
  for (const [key, value] of Object.entries(dimensions)) {
    const cell = timeoutCell();
    const error = failure(() => validateScoreableMatchupCell(
      { ...cell, roundTimeout: { ...cell.roundTimeout, [key]: value } },
      contextFor(),
    ));
    assert.equal(error.code, "simulation_result_mismatch", key);
    assert.equal(error.details.reason, "clock_model_mismatch", key);
    assert.deepEqual(error.details.mismatches, [key]);
  }
  // ...and the hash is the eighth dimension, covered by the test above.
  assert.equal(Object.keys(dimensions).length, 7);
});

test("a cell with no timeouts must not carry a clock authorization it does not need", () => {
  const error = failure(() => validateScoreableMatchupCell(
    timeoutCell({ wins: 110, losses: 90, scoredRoundTimeouts: 0 }),
    contextFor(),
  ));
  assert.equal(error.code, "matchup_cell_invalid");
  assert.equal(error.details.reason, "round_timeout_unauthorized");
});

test("clockAuthorizationFor derives the eight dimensions from the resolved plan alone", () => {
  const authorization = clockAuthorizationFor(officialBundle.resolved);
  assert.deepEqual(authorization, {
    clockModelRef: { ...officialBundle.resolved.clockRef },
    edition: "SC",
    metagameRegion: "CN",
    language: "zh-Hans",
    formatId: "standard-block2-op16",
    stage: "swiss",
    roundDurationMinutes: 30,
    timeoutScoring: "double-loss",
  });
  assert.ok(Object.isFrozen(authorization));
  assert.equal(clockAuthorizationFor(diagnosticBundle.resolved), null);
});

/* ------------------------------------------------------------------ *
 * 6. the simulated MatchupSnapshot
 * ------------------------------------------------------------------ */

function simulatedSnapshotInput(overrides = {}) {
  return {
    resolved: officialBundle.resolved,
    archetypeId: officialBundle.resolved.strata[1].archetypeId,
    seat: "play",
    cell: cellFor({ games: gameRows() }),
    context: contextFor(),
    idStem: "matchup-sc-simulated-fixture",
    ...overrides,
  };
}

test("buildSimulatedMatchupSnapshot produces a verifiable simulated matchup snapshot", () => {
  const snapshot = buildSimulatedMatchupSnapshot(simulatedSnapshotInput());
  verifySnapshot(snapshot);
  assert.equal(snapshot.kind, MATCHUP_KIND);
  assert.equal(snapshot.data.method, "simulated");
  assert.equal(snapshot.data.applicability, "native");
  assert.deepEqual(snapshot.environment, SC_IDENTITY);
  assert.equal(snapshot.asOf, "2026-08-20");
  assert.equal(snapshot.data.cells.length, 1);
  assert.equal(snapshot.data.cells[0].winRate, 110 / 200);
  assert.equal(snapshot.data.games.length, 200);
  for (const key of ["seed", "requestedSeat", "actualSeat", "outcome", "engineTermination", "terminationCause", "turns", "commands"]) {
    assert.ok(Object.hasOwn(snapshot.data.games[0], key), key);
  }
});

test("applicability is inherited from the Manifest, never asserted by the caller", () => {
  const resolved = {
    ...officialBundle.resolved,
    matchupEvidence: { ...officialBundle.resolved.matchupEvidence, applicability: "proxy" },
  };
  const snapshot = buildSimulatedMatchupSnapshot(simulatedSnapshotInput({
    resolved,
    context: contextFor({ applicability: "proxy" }),
  }));
  assert.equal(snapshot.data.applicability, "proxy");
  // A caller that contradicts the Manifest is refused rather than silently believed.
  const error = failure(() => buildSimulatedMatchupSnapshot(simulatedSnapshotInput({
    resolved,
    context: contextFor({ applicability: "native" }),
  })));
  assert.equal(error.code, "matchup_provenance_invalid");
});

test("a simulated snapshot can never be built from observed evidence", () => {
  const error = failure(() => buildSimulatedMatchupSnapshot(simulatedSnapshotInput({
    context: contextFor({ method: "observed" }),
  })));
  assert.equal(error.code, "matchup_provenance_invalid");
  assert.equal(error.details.reason, "method_not_simulated");
});

/* ------------------------------------------------------------------ *
 * 7. observed evidence: scoreable or calibration-only, never merged
 * ------------------------------------------------------------------ */

function observedDraft() {
  const candidate = deckOf(officialBundle, officialBundle.resolved.candidateDeckRef.snapshotId);
  const cell = (opponent, seat, extra = {}) => ({
    candidateDeckSnapshotId: candidate.snapshotId,
    candidateContentHash: candidate.contentHash,
    candidateGameplayHash: candidate.data.gameplayHash,
    opponentDeckSnapshotId: opponent.snapshotId,
    opponentContentHash: opponent.contentHash,
    opponentGameplayHash: opponent.data.gameplayHash,
    candidateSeat: seat,
    wins: 108,
    losses: 90,
    scoredRoundTimeouts: 2,
    validGames: 200,
    sampleSize: 200,
    unfinished: 0,
    toolFailures: 0,
    roundTimeout: {
      clockModelRef: { ...officialBundle.resolved.clockRef },
      ...SC_IDENTITY,
      stage: "swiss",
      roundDurationMinutes: 30,
      timeoutScoring: "double-loss",
    },
    ...extra,
  });
  const opponents = officialBundle.resolved.strata.map((row) => deckOf(officialBundle, row.representatives[0].deckRef.snapshotId));
  return {
    schemaVersion: 1,
    kind: MATCHUP_KIND,
    environment: { ...SC_IDENTITY },
    asOf: "2026-08-20",
    source: { provider: "fixture", surface: "matchup", sourceRef: { fixtureId: "observed" } },
    coverage: { status: "complete", warnings: [], missingFields: [] },
    data: {
      method: "observed",
      applicability: "native",
      population: "SC Swiss observed population (fixture)",
      window: { startLocalDate: "2026-07-01", asOf: "2026-08-20", timeZone: SC_IDENTITY.timeZone },
      roundPolicy: { stage: "swiss", roundDurationMinutes: 30, timeoutScoring: "double-loss" },
      formatId: SC_IDENTITY.formatId,
      cells: opponents.flatMap((opponent) => [cell(opponent, "play"), cell(opponent, "draw")]),
    },
  };
}

// Mutations are applied to the DRAFT and then finalized, so the snapshot stays hash-genuine and the
// behaviour under test is the contract, never an incidental hash failure.
function observedSnapshot(mutate = () => {}) {
  const draft = observedDraft();
  mutate(draft);
  return finalizeSnapshot(draft, "matchup-sc-observed-fixture");
}

function observedContext() {
  return {
    resolved: officialBundle.resolved,
    minimumCompletedGamesPerSeat: FLOOR,
  };
}

test("complete observed evidence is scoreable", () => {
  const result = validateObservedMatchupSnapshot(observedSnapshot(), observedContext());
  assert.equal(result.status, "scoreable");
  assert.deepEqual(result.reasons, []);
  assert.equal(result.cells.length, 4);
  assert.equal(result.cells[0].method, "observed");
  assert.equal(result.cells[0].winRate, 108 / 200);
});

test("observed evidence without exact deck hashes, counts or a seat split is calibration-only", () => {
  const cases = [
    ["deck_hashes_incomplete", (draft) => {
      draft.data.cells = draft.data.cells.map((cell) => {
        const copy = { ...cell };
        delete copy.opponentGameplayHash;
        return copy;
      });
    }],
    ["outcome_counts_inconsistent", (draft) => {
      draft.data.cells = draft.data.cells.map((cell, index) => (index === 0 ? { ...cell, wins: cell.wins + 3 } : cell));
    }],
    ["seat_split_incomplete", (draft) => {
      draft.data.cells = draft.data.cells.filter((cell) => cell.candidateSeat === "play");
    }],
    ["sample_size_missing", (draft) => {
      draft.data.cells = draft.data.cells.map((cell) => {
        const copy = { ...cell };
        delete copy.sampleSize;
        return copy;
      });
    }],
    ["population_provenance_missing", (draft) => { draft.data.population = ""; }],
    ["window_provenance_missing", (draft) => { delete draft.data.window; }],
    ["format_mismatch", (draft) => { draft.data.formatId = "standard-block2-op17"; }],
    ["below_per_seat_floor", (draft) => {
      draft.data.cells = draft.data.cells.map((cell) => ({
        ...cell, wins: 8, losses: 90, scoredRoundTimeouts: 2, validGames: 100, sampleSize: 100,
      }));
    }],
  ];
  for (const [reason, mutate] of cases) {
    const result = validateObservedMatchupSnapshot(observedSnapshot(mutate), observedContext());
    assert.equal(result.status, "calibration_only", reason);
    assert.ok(result.reasons.includes(reason), `${reason} not in ${JSON.stringify(result.reasons)}`);
    assert.deepEqual(result.cells, []);
  }
});

test("observed evidence carrying timeouts with no accepted clock is calibration-only, never scored", () => {
  const result = validateObservedMatchupSnapshot(observedSnapshot(), {
    resolved: diagnosticBundle.resolved,
    minimumCompletedGamesPerSeat: FLOOR,
  });
  assert.equal(result.status, "calibration_only");
  assert.ok(result.reasons.includes("clock_model_hash"));
});

test("validateObservedMatchupSnapshot refuses a simulated snapshot outright", () => {
  const error = failure(() => validateObservedMatchupSnapshot(
    observedSnapshot((draft) => { draft.data.method = "simulated"; }),
    observedContext(),
  ));
  assert.equal(error.code, "matchup_provenance_invalid");
  assert.equal(error.details.reason, "method_not_observed");
});

test("a structurally broken observed snapshot throws rather than degrading to calibration-only", () => {
  for (const mutate of [
    (draft) => { draft.kind = "field"; },
    (draft) => { draft.data.cells = []; },
    (draft) => { draft.data.cells = "not an array"; },
    (draft) => { draft.environment = { ...SC_IDENTITY, edition: "EN", metagameRegion: "GLOBAL_EN", language: "en" }; },
  ]) {
    const error = failure(() => validateObservedMatchupSnapshot(observedSnapshot(mutate), observedContext()));
    assert.ok(
      ["matchup_snapshot_invalid", "environment_identity_mismatch"].includes(error.code),
      error.code,
    );
  }
  // A snapshot tampered with AFTER publication fails its own hash verification, not a soft label.
  const tampered = structuredClone(observedSnapshot());
  tampered.data.cells[0].wins = 1;
  const error = failure(() => validateObservedMatchupSnapshot(tampered, observedContext()));
  assert.equal(error.code, "matchup_snapshot_invalid");
});

/* ------------------------------------------------------------------ *
 * 8. the legacy EV implementation is never reachable from here
 * ------------------------------------------------------------------ */

test("no Task 11 module imports or shells to the legacy mirrored-pair / Nash implementation", () => {
  // Timeout-bearing evidence must never reach the older EV tooling: its mirrored-pair consistency
  // and Nash routines assume every game has a winner, and under SC Swiss a timed-out round is a
  // DOUBLE loss. The guard is deliberately about REACHABILITY, not vocabulary -- a module is allowed
  // to name the legacy artifacts in order to refuse them (environment/simulation.mjs does exactly
  // that), but never to import, require or spawn one.
  const executableLinesOf = (source) => source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"));

  const names = ["matchup.mjs", "simulation.mjs", "report.mjs"];
  const sources = new Map(names.map((name) => (
    [name, executableLinesOf(readFileSync(new URL(`./${name}`, import.meta.url), "utf8"))]
  )));
  sources.set(
    "tools/environment_evaluate.mjs",
    executableLinesOf(readFileSync(new URL("../tools/environment_evaluate.mjs", import.meta.url), "utf8")),
  );

  for (const [name, lines] of sources) {
    const body = lines.join("\n");

    // (a) never imported, statically or dynamically, and never resolved as a path.
    for (const forbidden of ["ev_analysis", "arena/", "sim/results", "last-run"]) {
      for (const line of lines) {
        const references = line.includes(forbidden);
        const imports = /\b(?:import|require)\b|\bfrom\s+["']/.test(line);
        assert.ok(!(references && imports), `${name} must not import ${forbidden}: ${line.trim()}`);
      }
    }

    // (b) never shelled to. The only child process this domain may start is the simulator itself.
    for (const line of lines) {
      if (!/spawn|exec|execFile|fork\s*\(/.test(line)) continue;
      for (const forbidden of ["python", "ev_analysis", "arena", "last-run"]) {
        assert.ok(!line.includes(forbidden), `${name} must not spawn ${forbidden}: ${line.trim()}`);
      }
    }

    // (c) identifiers that can never have an innocent use here.
    for (const forbidden of ["ev_analysis", "nash", "Nash", "mirroredPair"]) {
      assert.ok(!body.includes(forbidden), `${name} must not reference ${forbidden}`);
    }

    // (d) the legacy artifacts MAY be named, but only inside a refusal marker list. Any other
    // mention -- an actual read, a call, a fallback -- fails here.
    for (const forbidden of ["pairedDiff", "last-run", "baselineGames", "chosenIndex"]) {
      for (const line of lines) {
        if (!line.includes(forbidden)) continue;
        assert.match(
          line,
          /MARKERS|reject|refus/i,
          `${name} names ${forbidden} outside a refusal marker list: ${line.trim()}`,
        );
      }
    }
  }

  // The legacy detector must actually be wired in, or (d) above would pass vacuously on a module
  // that simply forgot to defend itself.
  const simulation = readFileSync(new URL("./simulation.mjs", import.meta.url), "utf8");
  assert.match(simulation, /LEGACY_LAST_RUN_MARKERS/);
  assert.match(simulation, /ARENA_MARKERS/);
});

test("B1: the public barrel exports every Task 11 name flat, once, and never Task 10's contract", async () => {
  const barrel = await import("./index.mjs");
  const owned = {
    // Each name exactly once, from its owning module. The four shared primitives are matchup's.
    "matchup.mjs": [
      "MATCHUP_ERROR_CODES", "MATCHUP_KIND", "SEATS", "WEIGHT_TOLERANCE", "assertExactCoverage",
      "assertRoundTimeoutAuthorized", "buildSimulatedMatchupSnapshot", "clockAuthorizationFor",
      "createXorshift32", "pairingKeyFor", "parseEnvironmentKey", "validateObservedMatchupSnapshot",
      "validateScoreableMatchupCell",
    ],
    "simulation.mjs": [
      "MINIMUM_COMPLETED_GAMES_PER_SEAT", "SIMULATION_ERROR_CODES", "SIMULATION_PLAN_KIND",
      "applyRoundTimeoutAdjudication", "countJobResult", "createSimulateShRunner",
      "executeSimulationPlan", "expandSimulationPlan", "jobCacheDirectoryFor", "jobResultPathFor",
      "materializeJobFile", "seedScheduleFor", "validateJobResult",
    ],
    "report.mjs": [
      "BOOTSTRAP_REPLICATES", "BOOTSTRAP_SEED", "COMPARISON_KIND", "CONFIDENCE_EXCLUSIONS",
      "ENVIRONMENT_COMPARISON_KIND", "REPORT_ERROR_CODES", "REPORT_KIND", "aggregateEnvironment",
      "compareEnvironments", "compareVariants", "weightedSeatEv", "wilsonInterval",
    ],
  };
  for (const [module, names] of Object.entries(owned)) {
    const source = await import(`./${module}`);
    for (const name of names) {
      assert.ok(Object.hasOwn(barrel, name), `missing flat export: ${name}`);
      assert.equal(barrel[name], source[name], `${name} must be re-exported from ${module}`);
    }
  }
  // The six names the Task 6 fence now asserts positively.
  for (const name of [
    "expandSimulationPlan", "buildSimulatedMatchupSnapshot", "weightedSeatEv",
    "compareVariants", "compareEnvironments", "aggregateEnvironment",
  ]) {
    assert.equal(typeof barrel[name], "function", name);
  }
  // ONE export face per binding: the shared primitives are matchup's and report.mjs must not
  // re-export them, or the barrel would carry the same binding from two modules.
  const report = await import("./report.mjs");
  for (const name of ["WEIGHT_TOLERANCE", "assertExactCoverage", "createXorshift32", "clockAuthorizationFor"]) {
    assert.equal(Object.hasOwn(report, name), false, `report.mjs must not re-export ${name}`);
  }
  // Task 10's contract is IMPORTED by environment/simulation.mjs, never re-exported through this
  // barrel: re-exporting it would create an environment/ -> sim/ -> environment/ directory cycle.
  const simulation = await import("./simulation.mjs");
  for (const name of ["validateEnvironmentJob", "validateRawJobResult", "buildRawJobResult", "computeJobId", "computePlanHash"]) {
    assert.equal(Object.hasOwn(barrel, name), false, `the barrel must not re-export ${name}`);
    assert.equal(Object.hasOwn(simulation, name), false, `simulation must not re-export ${name}`);
  }
});
