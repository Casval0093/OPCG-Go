import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { canonicalJson } from "./canonical.mjs";
import { EnvironmentError } from "./errors.mjs";
import { hashProjection, sha256Canonical } from "./hash.mjs";
import { finalizeSnapshot, verifySnapshot } from "./snapshot.mjs";
import {
  applyRoundTimeoutAdjudication,
  executeSimulationPlan,
  expandSimulationPlan,
  jobCacheDirectoryFor,
  jobResultPathFor,
  materializeJobFile,
  seedScheduleFor,
  validateJobResult,
} from "./simulation.mjs";
import { clockAuthorizationFor, createXorshift32 } from "./matchup.mjs";
import {
  buildRawJobResult,
  computeJobId,
  computePlanHash,
  validateEnvironmentJob,
} from "../sim/environment-contract.mjs";
import { createFakeRunner } from "../tests/fixtures/environment/fake-simulation-runner.mjs";

function fixture(name) {
  return JSON.parse(readFileSync(new URL(`../tests/fixtures/environment/${name}`, import.meta.url), "utf8"));
}

const diagnosticBundle = fixture("minimal-resolved-plan.json");
const timeoutScenario = fixture("accepted-clock-timeout-results.json");
const officialBundle = timeoutScenario.plan;
const pairedScenario = fixture("base-variant-paired-results.json");
const defaultScript = fixture("minimal-valid-results.json");

const NOW = "2026-08-21T10:00:00+08:00";

function settingsFor(bundle, overrides = {}) {
  return { ...bundle.settings, opponentDecks: bundle.deckSnapshots, ...overrides };
}

function candidateDeckOf(bundle) {
  const deck = bundle.deckSnapshots.find((entry) => entry.snapshotId === bundle.resolved.candidateDeckRef.snapshotId);
  assert.ok(deck);
  return deck;
}

function planFor(bundle, overrides = {}) {
  return expandSimulationPlan(bundle.resolved, candidateDeckOf(bundle), settingsFor(bundle, overrides));
}

function jobByKey(plan, pairingKey) {
  const entry = plan.jobs.find((job) => job.pairingKey === pairingKey);
  assert.ok(entry, `no job for ${pairingKey}`);
  return entry;
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

function withRoot(run) {
  const root = mkdtempSync(join(tmpdir(), "environment-simulation-test-"));
  try {
    return run({
      root,
      cacheRoot: join(root, ".cache", "environment-jobs"),
      resultsRoot: join(root, "sim", "results", "environments"),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** A raw envelope re-signed over its own mutated content, so the failure under test is semantic. */
function resign(draft) {
  const copy = { ...draft };
  delete copy.resultHash;
  return { ...copy, resultHash: hashProjection(copy, ["resultHash"]) };
}

function cleanGames(job, { unfinished = 0, toolFailures = 0, wins = null } = {}) {
  const actualSeat = job.plan.fixedSeat === "play" ? "north" : "south";
  const clean = job.plan.seeds.length - unfinished - toolFailures;
  const winCount = wins === null ? Math.ceil(clean / 2) : wins;
  return job.plan.seeds.map((seed, index) => {
    const base = {
      seed,
      requestedSeat: job.plan.fixedSeat,
      actualSeat,
      aOnPlay: job.plan.fixedSeat === "play",
      turns: 9,
      commands: 91,
    };
    if (index < clean) {
      return {
        ...base,
        outcome: index < winCount ? "win" : "loss",
        engineTermination: "rules-win",
        terminationCause: "rules-win",
      };
    }
    if (index < clean + unfinished) {
      return { ...base, outcome: "unfinished", engineTermination: "max-actions", terminationCause: "max-actions" };
    }
    return { ...base, outcome: "tool_failure", engineTermination: "illegal-command", terminationCause: "illegal-command" };
  });
}

/* ------------------------------------------------------------------ *
 * 1. deterministic expansion
 * ------------------------------------------------------------------ */

test("expansion creates exactly two fixed-seat jobs per representative deck, one play and one draw", () => {
  const plan = planFor(officialBundle);
  const representatives = officialBundle.resolved.strata.flatMap((row) => row.representatives);
  assert.equal(plan.jobs.length, representatives.length * 2);
  for (const row of officialBundle.resolved.strata) {
    for (const representative of row.representatives) {
      const seats = plan.jobs
        .filter((job) => job.archetypeId === row.archetypeId && job.opponentGameplayHash === representative.gameplayHash)
        .map((job) => job.seat)
        .sort();
      assert.deepEqual(seats, ["draw", "play"]);
    }
  }
  for (const job of plan.jobs) {
    assert.equal(job.job.plan.fixedSeat, job.seat);
    validateEnvironmentJob(job.job);
  }
  assert.equal(new Set(plan.jobs.map((job) => job.job.jobId)).size, plan.jobs.length);
  assert.ok(Object.isFrozen(plan));
});

test("every job targets at least 200 valid completed games and pins exactly that many unique seeds", () => {
  const plan = planFor(officialBundle);
  assert.equal(plan.completedGameTarget, 200);
  for (const job of plan.jobs) {
    assert.equal(job.job.plan.completedGameTarget, 200);
    assert.equal(job.seeds.length, 200);
    assert.equal(new Set(job.seeds).size, 200);
    for (const seed of job.seeds) assert.ok(Number.isSafeInteger(seed) && seed > 0);
  }
  const schedules = plan.jobs.map((job) => job.seeds.join(","));
  assert.equal(new Set(schedules).size, plan.jobs.length);
});

test("a Manifest floor below 200 valid games per seat is refused", () => {
  const error = failure(() => expandSimulationPlan(
    { ...officialBundle.resolved, minimumCompletedGamesPerSeat: 199 },
    candidateDeckOf(officialBundle),
    settingsFor(officialBundle),
  ));
  assert.equal(error.code, "simulation_plan_invalid");
  assert.equal(error.details.reason, "completed_game_target_below_floor");
});

test("each job carries its own immutable deck materialization whose gameplay hash recomputes", () => {
  const plan = planFor(officialBundle);
  for (const job of plan.jobs) {
    for (const side of ["candidate", "opponent"]) {
      assert.deepEqual(
        Object.keys(job.job[side]).sort(),
        ["artifactHash", "displayName", "gameplayHash", "leaderGameplayId", "mainDeckCounts"],
      );
    }
    // validateEnvironmentJob recomputes gameplayHash from leaderGameplayId + mainDeckCounts, so a
    // materialization that drifted from its DeckSnapshot cannot survive this call.
    validateEnvironmentJob(job.job);
    assert.equal(job.job.candidate.gameplayHash, officialBundle.resolved.candidateGameplayHash);
    assert.equal(job.job.opponent.gameplayHash, job.opponentGameplayHash);
    assert.equal(job.job.candidate.artifactHash, officialBundle.resolved.candidateDeckRef.contentHash);
  }
});

test("expansion refuses a candidate or representative deck that is not the one the plan pinned", () => {
  const otherDeck = candidateDeckOf(pairedScenario.variant);
  let error = failure(() => expandSimulationPlan(officialBundle.resolved, otherDeck, settingsFor(officialBundle)));
  assert.equal(error.code, "simulation_plan_invalid");
  assert.equal(error.details.reason, "candidate_deck_mismatch");

  error = failure(() => expandSimulationPlan(
    officialBundle.resolved,
    candidateDeckOf(officialBundle),
    settingsFor(officialBundle, { opponentDecks: [candidateDeckOf(officialBundle)] }),
  ));
  assert.equal(error.code, "missing_representative_deck");

  const tampered = structuredClone(candidateDeckOf(officialBundle));
  tampered.data.mainDeckCounts["OP16-020"] = 3;
  error = failure(() => expandSimulationPlan(officialBundle.resolved, tampered, settingsFor(officialBundle)));
  assert.equal(error.code, "snapshot_hash_mismatch");
});

test("a deck with the right gameplay hash but a different artifact is still refused", () => {
  // The discriminating control the earlier test cannot be: this deck plays exactly the same 50
  // cards (identical gameplayHash) but is a DIFFERENT artifact, so only the snapshotId/contentHash
  // check can catch it. Without that check a re-published deck with different provenance would be
  // played while the report cited the pinned artifact.
  const original = candidateDeckOf(officialBundle);
  const draft = structuredClone(original);
  delete draft.snapshotId;
  delete draft.contentHash;
  draft.source = { ...draft.source, sourceRef: { fixtureId: "a-different-capture" } };
  const twin = finalizeSnapshot(draft, "deck-ace-op16-twin");
  assert.equal(twin.data.gameplayHash, original.data.gameplayHash);
  assert.notEqual(twin.contentHash, original.contentHash);

  const error = failure(() => expandSimulationPlan(officialBundle.resolved, twin, settingsFor(officialBundle)));
  assert.equal(error.code, "simulation_plan_invalid");
  assert.equal(error.details.reason, "candidate_deck_mismatch");

  // The same control on the opponent side.
  const opponentOriginal = officialBundle.deckSnapshots.find((deck) => (
    deck.snapshotId === officialBundle.resolved.strata[1].representatives[0].deckRef.snapshotId
  ));
  const opponentDraft = structuredClone(opponentOriginal);
  delete opponentDraft.snapshotId;
  delete opponentDraft.contentHash;
  opponentDraft.source = { ...opponentDraft.source, sourceRef: { fixtureId: "a-different-capture" } };
  const opponentTwin = finalizeSnapshot(opponentDraft, "deck-teach-op16-twin");
  const opponentError = failure(() => expandSimulationPlan(
    officialBundle.resolved,
    candidateDeckOf(officialBundle),
    settingsFor(officialBundle, {
      opponentDecks: officialBundle.deckSnapshots
        .filter((deck) => deck.snapshotId !== opponentOriginal.snapshotId)
        .concat([opponentTwin]),
    }),
  ));
  assert.equal(opponentError.code, "missing_representative_deck");
});

test("expansion never accepts a caller-supplied path or any unlisted setting", () => {
  for (const extra of [{ deckPath: "/tmp/attacker/deck.json" }, { resultsRoot: "/tmp/attacker" }, { seeds: [1, 2] }]) {
    const error = failure(() => expandSimulationPlan(
      officialBundle.resolved,
      candidateDeckOf(officialBundle),
      settingsFor(officialBundle, extra),
    ));
    assert.equal(error.code, "simulation_settings_invalid", JSON.stringify(extra));
    assert.deepEqual(error.details.unexpected, Object.keys(extra));
  }
});

test("the resolved boundary is closed: an unlisted field is refused, not ignored", () => {
  for (const extra of [{ deckPath: "/tmp/attacker/deck.json" }, { turnOrderWeightsOverride: 1 }]) {
    const error = failure(() => expandSimulationPlan(
      { ...officialBundle.resolved, ...extra },
      candidateDeckOf(officialBundle),
      settingsFor(officialBundle),
    ));
    assert.equal(error.code, "simulation_plan_invalid", JSON.stringify(extra));
    assert.equal(error.details.reason, "unknown_resolved_key");
    assert.deepEqual(error.details.unexpected, Object.keys(extra));
  }
  // ...and a MISSING field is refused too, so the closed set is checked in both directions.
  const stripped = { ...officialBundle.resolved };
  delete stripped.marketRefs;
  const error = failure(() => expandSimulationPlan(stripped, candidateDeckOf(officialBundle), settingsFor(officialBundle)));
  assert.equal(error.details.reason, "resolved_field_missing");
  assert.deepEqual(error.details.missing, ["marketRefs"]);
});

test("every simulation setting must be supplied explicitly", () => {
  for (const key of ["strategyCandidate", "strategyOpponent", "engineRevision", "maxCommands", "maxTurns", "comparisonSeed"]) {
    const settings = settingsFor(officialBundle);
    delete settings[key];
    const error = failure(() => expandSimulationPlan(officialBundle.resolved, candidateDeckOf(officialBundle), settings));
    assert.equal(error.code, "simulation_settings_invalid", key);
    assert.equal(error.details.field, key);
  }
});

test("a simulated plan cannot be expanded from observed evidence", () => {
  const resolved = {
    ...officialBundle.resolved,
    matchupEvidence: { ...officialBundle.resolved.matchupEvidence, method: "observed" },
  };
  const error = failure(() => expandSimulationPlan(resolved, candidateDeckOf(officialBundle), settingsFor(officialBundle)));
  assert.equal(error.code, "matchup_provenance_invalid");
  assert.equal(error.details.reason, "method_not_simulated");
});

test("a diagnostic plan must be blocker-bearing, withholds official strength, and an official plan must be clean", () => {
  const diagnostic = planFor(diagnosticBundle);
  assert.equal(diagnostic.evaluationMode, "diagnostic_estimate");
  assert.equal(diagnostic.officialStrengthClaim, false);
  assert.ok(diagnostic.blockers.length > 0);

  const official = planFor(officialBundle);
  assert.equal(official.evaluationMode, "official");
  assert.equal(official.officialStrengthClaim, true);

  let error = failure(() => expandSimulationPlan(
    { ...diagnosticBundle.resolved, blockers: [] },
    candidateDeckOf(diagnosticBundle),
    settingsFor(diagnosticBundle),
  ));
  assert.equal(error.details.reason, "diagnostic_without_blockers");

  error = failure(() => expandSimulationPlan(
    { ...officialBundle.resolved, blockers: [{ code: "clock_model_unavailable" }] },
    candidateDeckOf(officialBundle),
    settingsFor(officialBundle),
  ));
  assert.equal(error.details.reason, "official_with_blockers");
});

test("a partial field is refused at expansion time and never renormalized", () => {
  const incomplete = fixture("incomplete-field-plan.json");
  const error = failure(() => expandSimulationPlan(
    incomplete.resolved,
    candidateDeckOf(incomplete),
    settingsFor(incomplete),
  ));
  assert.equal(error.code, "field_not_representative");
  assert.ok(Math.abs(error.details.sum - 1) > 1e-12);
});

/* ------------------------------------------------------------------ *
 * 2. the seed schedule
 * ------------------------------------------------------------------ */

test("baseline and variant share every seed schedule while their plan hashes differ", () => {
  const base = planFor(pairedScenario.base);
  const variant = planFor(pairedScenario.variant);
  assert.equal(base.jobs.length, variant.jobs.length);
  for (const key of base.jobs.map((job) => job.pairingKey)) {
    assert.deepEqual(jobByKey(base, key).seeds, jobByKey(variant, key).seeds);
  }
  assert.notEqual(base.planHash, variant.planHash);
  for (const key of base.jobs.map((job) => job.pairingKey)) {
    assert.notEqual(jobByKey(base, key).job.jobId, jobByKey(variant, key).job.jobId);
  }
});

test("the seed schedule derives ONLY from the comparison seed and the stratum identity", () => {
  const identity = {
    comparisonSeed: 20260820,
    archetypeId: "leader:OP16-001",
    opponentGameplayHash: officialBundle.resolved.strata[0].representatives[0].gameplayHash,
    seat: "play",
    count: 12,
  };
  const seeds = seedScheduleFor(identity);
  assert.equal(seeds.length, 12);
  assert.deepEqual(seedScheduleFor(identity), seeds);
  assert.notDeepEqual(seedScheduleFor({ ...identity, seat: "draw" }), seeds);
  assert.notDeepEqual(seedScheduleFor({ ...identity, archetypeId: "leader:OP16-080" }), seeds);
  assert.notDeepEqual(
    seedScheduleFor({ ...identity, opponentGameplayHash: officialBundle.resolved.strata[1].representatives[0].gameplayHash }),
    seeds,
  );
  assert.notDeepEqual(seedScheduleFor({ ...identity, comparisonSeed: 20260821 }), seeds);
  assert.deepEqual(seedScheduleFor({ ...identity, count: 5 }), seeds.slice(0, 5));
  for (const extra of [{ candidateGameplayHash: "x" }, { planHash: "x" }, { jobId: "x" }]) {
    assert.equal(failure(() => seedScheduleFor({ ...identity, ...extra })).code, "simulation_seed_input_invalid");
  }
});

test("a seed schedule stays collision-free at a scale where the raw stream collides", () => {
  // The dedup path is unreachable at 200 draws, so it is measured where it is genuinely exercised:
  // 100000 draws from a 2**31-1 modulus collide twice in this exact stream (birthday bound ~2.3), and
  // a schedule that let those through would hand Task 10 a job it rejects for duplicate seeds.
  const identity = {
    comparisonSeed: 20260820,
    archetypeId: "leader:OP16-001",
    opponentGameplayHash: officialBundle.resolved.strata[0].representatives[0].gameplayHash,
    seat: "play",
    count: 100000,
  };
  const seeds = seedScheduleFor(identity);
  assert.equal(seeds.length, 100000);
  assert.equal(new Set(seeds).size, 100000);
  // The control: the undeduplicated stream this schedule is drawn from DOES repeat, so the
  // assertion above is not vacuously true of the generator.
  const digest = sha256Canonical({
    schemaVersion: 1,
    purpose: "environment-seed-schedule",
    comparisonSeed: identity.comparisonSeed,
    archetypeId: identity.archetypeId,
    opponentGameplayHash: identity.opponentGameplayHash,
    seat: identity.seat,
  });
  const next = createXorshift32(Number.parseInt(digest.slice(7, 15), 16) >>> 0);
  const raw = Array.from({ length: 100000 }, () => (next() % (2 ** 31 - 1)) + 1);
  assert.ok(new Set(raw).size < raw.length, "the raw stream must collide or this test proves nothing");
});

test("the candidate deck cannot reach the seed schedule through the plan either", () => {
  const base = planFor(pairedScenario.base);
  const variant = planFor(pairedScenario.variant);
  for (const job of base.jobs) {
    assert.deepEqual(
      seedScheduleFor({
        comparisonSeed: base.settings.comparisonSeed,
        archetypeId: job.archetypeId,
        opponentGameplayHash: job.opponentGameplayHash,
        seat: job.seat,
        count: base.completedGameTarget,
      }),
      job.seeds,
    );
    assert.deepEqual(jobByKey(variant, job.pairingKey).seeds, job.seeds);
  }
});

/* ------------------------------------------------------------------ *
 * 3. job identity
 * ------------------------------------------------------------------ */

test("every immutable input and every setting moves the job ids and the plan hash", () => {
  const base = planFor(officialBundle);
  const cases = [
    ["strategyCandidate", { strategyCandidate: "greedy" }],
    ["strategyOpponent", { strategyOpponent: "greedy" }],
    ["engineRevision", { engineRevision: "0123456789abcdef0123456789abcdef01234567" }],
    ["maxCommands", { maxCommands: 900 }],
    ["maxTurns", { maxTurns: 41 }],
    ["comparisonSeed", { comparisonSeed: 20260821 }],
  ];
  for (const [label, overrides] of cases) {
    const other = planFor(officialBundle, overrides);
    assert.notEqual(other.planHash, base.planHash, label);
    for (const job of base.jobs) {
      assert.notEqual(jobByKey(other, job.pairingKey).job.jobId, job.job.jobId, label);
    }
  }
  assert.notEqual(planFor(pairedScenario.variant).planHash, base.planHash);
  const rehomed = expandSimulationPlan(
    { ...officialBundle.resolved, manifestRef: { ...officialBundle.resolved.manifestRef, contentHash: `sha256:${"9".repeat(64)}` } },
    candidateDeckOf(officialBundle),
    settingsFor(officialBundle),
  );
  assert.notEqual(rehomed.planHash, base.planHash);
});

test("the plan hash is a pure function of its immutable inputs", () => {
  assert.equal(planFor(officialBundle).planHash, planFor(officialBundle).planHash);
});

/* ------------------------------------------------------------------ *
 * 4. job file materialization
 * ------------------------------------------------------------------ */

test("a job file is written restrictively, atomically, and never overwritten with different content", () => {
  withRoot(({ cacheRoot }) => {
    const plan = planFor(officialBundle);
    const entry = plan.jobs[0];
    const path = materializeJobFile(plan, entry, { cacheRoot });
    assert.ok(path.startsWith(jobCacheDirectoryFor(cacheRoot, plan.planHash)));
    assert.ok(!path.includes(":"), "a job path never embeds a raw sha256: hash");
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const onDisk = validateEnvironmentJob(JSON.parse(readFileSync(path, "utf8")));
    assert.equal(onDisk.jobId, entry.job.jobId);
    assert.equal(canonicalJson(onDisk).toString("utf8"), canonicalJson(entry.job).toString("utf8"));

    // Idempotent for identical content.
    assert.equal(materializeJobFile(plan, entry, { cacheRoot }), path);
  });

  withRoot(({ cacheRoot }) => {
    // A DIFFERENT job already occupying the computed path is refused, never clobbered. jobId does
    // not cover displayName, so this is the one shape that can genuinely collide.
    const plan = planFor(officialBundle);
    const entry = plan.jobs[0];
    const foreign = structuredClone(entry.job);
    foreign.candidate = { ...foreign.candidate, displayName: "a different deck name" };
    assert.equal(computeJobId(foreign), entry.job.jobId);
    const path = join(jobCacheDirectoryFor(cacheRoot, plan.planHash), `${entry.job.jobId.slice(7)}.json`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(foreign, null, 2)}\n`);
    const error = failure(() => materializeJobFile(plan, entry, { cacheRoot }));
    assert.equal(error.code, "environment_job_exists");
  });
});

/* ------------------------------------------------------------------ *
 * 5. result validation
 * ------------------------------------------------------------------ */

test("a clean raw result passes and every corruption of it is rejected", () => {
  const plan = planFor(officialBundle);
  const job = plan.jobs[0].job;
  const good = buildRawJobResult(job, cleanGames(job));
  assert.equal(validateJobResult(job, good).resultHash, good.resultHash);

  const cases = [
    ["seed_schedule_mismatch", (result) => { result.seeds = result.seeds.slice(0, -1); }],
    ["seed_schedule_mismatch", (result) => { result.seeds = [...result.seeds.slice(0, -1), result.seeds[0]]; }],
    ["seed_schedule_mismatch", (result) => { result.games[3].seed = result.games[4].seed; }],
    ["actual_seat_mismatch", (result) => { result.games[0].actualSeat = "south"; }],
    ["requested_seat_mismatch", (result) => { result.games[0].requestedSeat = "draw"; }],
    ["a_on_play_mismatch", (result) => { result.games[0].aOnPlay = false; }],
    ["plan_hash_mismatch", (result) => { result.planHash = `sha256:${"4".repeat(64)}`; }],
    ["job_id_mismatch", (result) => { result.jobId = `sha256:${"5".repeat(64)}`; }],
    ["candidate_hash_mismatch", (result) => { result.candidate = { ...result.candidate, gameplayHash: `sha256:${"6".repeat(64)}` }; }],
    ["opponent_hash_mismatch", (result) => { result.opponent = { ...result.opponent, artifactHash: `sha256:${"7".repeat(64)}` }; }],
    ["settings_mismatch", (result) => { result.engineRevision = "deadbeefdeadbeef"; }],
    ["settings_mismatch", (result) => { result.maxTurns = 41; }],
    ["settings_mismatch", (result) => { result.strategyCandidate = "greedy"; }],
    ["round_timeout_present", (result) => { result.games[0].outcome = "round_timeout"; }],
    ["round_timeout_present", (result) => { result.games[0].terminationCause = "ROUND-TIMEOUT"; }],
    ["outcome_invalid", (result) => { result.games[0].outcome = "garbage"; }],
    ["completed_game_target_unmet", (result) => {
      result.games[0].outcome = "unfinished";
      result.games[0].terminationCause = "max-actions";
      result.games[0].engineTermination = "max-actions";
    }],
    ["unknown_result_key", (result) => { result.attackerNote = "extra"; }],
    ["result_hash_mismatch", (result) => { result.resultHash = `sha256:${"8".repeat(64)}`; result.keepHash = true; }],
  ];
  for (const [reason, mutate] of cases) {
    const draft = structuredClone(good);
    mutate(draft);
    const keepHash = draft.keepHash === true;
    delete draft.keepHash;
    const error = failure(() => validateJobResult(job, keepHash ? draft : resign(draft)));
    assert.equal(error.code, "simulation_result_mismatch", reason);
    assert.equal(error.details.reason, reason, `expected ${reason}, got ${error.details.reason}`);
  }
});

test("a stale result, a legacy last-run file and an arena log are all refused", () => {
  const plan = planFor(officialBundle);
  const job = plan.jobs[0].job;
  const other = plan.jobs[1].job;

  const stale = buildRawJobResult(other, cleanGames(other));
  let error = failure(() => validateJobResult(job, stale));
  assert.equal(error.code, "simulation_result_mismatch");
  assert.ok(["job_id_mismatch", "plan_hash_mismatch", "fixed_seat_mismatch"].includes(error.details.reason));

  error = failure(() => validateJobResult(job, {
    deckA: "Ace OP16", deckB: "Teach OP16", games: 200, strategyA: "valueRanked", strategyB: "valueRanked",
    symmetricStrategy: true, turnBudget: 40, turnBudgetKind: "legacy_turn_budget_proxy", seed0: 1000,
    baseline: {}, baselineGames: [],
  }));
  assert.equal(error.code, "legacy_evidence_rejected");
  assert.equal(error.details.reason, "legacy_last_run_summary");

  // Each legacy MARKER on its own, with no deckA/deckB pair to fall back on: otherwise one broad
  // control would pass while the marker list itself was dead code.
  for (const marker of ["baselineGames", "turnBudgetKind", "pairedDiff", "symmetricStrategy"]) {
    const solo = failure(() => validateJobResult(job, { schemaVersion: 1, games: [], [marker]: 1 }));
    assert.equal(solo.code, "legacy_evidence_rejected", marker);
    assert.equal(solo.details.reason, "legacy_last_run_summary", marker);
  }
  for (const marker of ["chosenIndex", "requestedIndex", "positionKey", "decisions"]) {
    const solo = failure(() => validateJobResult(job, { schemaVersion: 1, [marker]: 1 }));
    assert.equal(solo.code, "legacy_evidence_rejected", marker);
    assert.equal(solo.details.reason, "arena_decision_log", marker);
  }

  error = failure(() => validateJobResult(job, {
    schemaVersion: 1, kind: "decision", author: "human", chosenIndex: 2, requestedIndex: null,
    menu: [], positionKey: "abc",
  }));
  assert.equal(error.code, "legacy_evidence_rejected");
  assert.equal(error.details.reason, "arena_decision_log");
});

test("ANY unfinished or tool-failure row invalidates the cell even when the 200-game floor is met", () => {
  // A Task-10-legal job with headroom: 202 seeds, a 200-game target. Task 10 accepts a result with
  // 200 clean games plus 2 unfinished rows, so this rule is the ONLY thing that refuses it.
  const entry = planFor(officialBundle).jobs[0];
  const widened = structuredClone(entry.job);
  widened.plan.seeds = [...widened.plan.seeds, 987654321, 987654322];
  widened.plan.planHash = computePlanHash(widened.plan);
  widened.jobId = computeJobId(widened);
  validateEnvironmentJob(widened);

  for (const excluded of [{ unfinished: 2 }, { toolFailures: 2 }, { unfinished: 1, toolFailures: 1 }]) {
    const result = buildRawJobResult(widened, cleanGames(widened, excluded));
    // Task 10 is satisfied: the floor is met. That answer is only reachable by asking for it
    // explicitly now (see the strict-default test below).
    assert.equal(
      validateJobResult(widened, result, { requireScoreableCell: false }).resultHash,
      result.resultHash,
    );
    const error = failure(() => validateJobResult(widened, result, { requireScoreableCell: true }));
    assert.equal(error.code, "insufficient_matchup_coverage", JSON.stringify(excluded));
    assert.equal(error.details.reason, "cell_invalidated_by_unfinished_row");
    assert.equal(error.details.validGames, 200);
  }
  // The positive control: 202 clean games scores, so the rule above is not just a headroom check.
  const clean = buildRawJobResult(widened, cleanGames(widened));
  assert.equal(validateJobResult(widened, clean, { requireScoreableCell: true }).resultHash, clean.resultHash);
});

test("minor (fix round 1): a bare validateJobResult call is STRICT, and the lenient path is explicit", () => {
  const entry = planFor(officialBundle).jobs[0];
  const widened = structuredClone(entry.job);
  widened.plan.seeds = [...widened.plan.seeds, 987654321, 987654322];
  widened.plan.planHash = computePlanHash(widened.plan);
  widened.jobId = computeJobId(widened);
  const dirty = buildRawJobResult(widened, cleanGames(widened, { toolFailures: 1, unfinished: 1 }));

  // The default, with no options object at all: refused.
  const bare = failure(() => validateJobResult(widened, dirty));
  assert.equal(bare.code, "insufficient_matchup_coverage");
  assert.equal(bare.details.reason, "cell_invalidated_by_unfinished_row");
  // An empty options object is the same default, not a loophole.
  assert.equal(failure(() => validateJobResult(widened, dirty, {})).code, "insufficient_matchup_coverage");
  // The lenient path still exists for the caller that wants Task 10's verdict on its own.
  assert.equal(
    validateJobResult(widened, dirty, { requireScoreableCell: false }).resultHash,
    dirty.resultHash,
  );
});

/* ------------------------------------------------------------------ *
 * 6. execution, publication and reuse
 * ------------------------------------------------------------------ */

function execute(bundle, { script = defaultScript, arm, plan: given, ...options } = {}) {
  const plan = given ?? planFor(bundle);
  const calls = [];
  const runner = createFakeRunner(script, { arm, onJob: (job) => calls.push(job.jobId) });
  const outcome = executeSimulationPlan(plan, { runner, now: NOW, ...options });
  return { plan, outcome, calls };
}

test("execution publishes one immutable simulated matchup snapshot per job under the results root", () => {
  withRoot(({ cacheRoot, resultsRoot }) => {
    const { plan, outcome, calls } = execute(officialBundle, { cacheRoot, resultsRoot });
    assert.equal(outcome.results.length, plan.jobs.length);
    assert.equal(calls.length, plan.jobs.length);
    for (const record of outcome.results) {
      const expected = jobResultPathFor(resultsRoot, plan.manifestRef.manifestId, record.jobId);
      assert.equal(record.path, expected);
      assert.ok(expected.includes(plan.manifestRef.manifestId));
      assert.ok(!expected.includes(":"));
      assert.equal(statSync(expected).mode & 0o777, 0o600);
      const published = JSON.parse(readFileSync(expected, "utf8"));
      assert.equal(published.kind, "matchup");
      assert.equal(published.data.method, "simulated");
      assert.equal(published.data.applicability, "native");
      assert.equal(published.data.simulation.jobId, record.jobId);
      assert.equal(published.data.games.length, 200);
      assert.equal(published.contentHash, record.snapshot.contentHash);
    }
    // No runtime timestamp inside the published, hash-covered artifact.
    const text = readFileSync(outcome.results[0].path, "utf8");
    for (const key of ["generatedAt", "publishedAt", "executedAt", "runAt"]) {
      assert.ok(!text.includes(key), key);
    }
  });
});

test("the published result echoes every immutable field, every setting and every game row", () => {
  withRoot(({ cacheRoot, resultsRoot }) => {
    const { plan, outcome } = execute(officialBundle, { cacheRoot, resultsRoot });
    const record = outcome.results[0];
    const data = record.snapshot.data;
    assert.equal(data.simulation.planHash, plan.planHash);
    assert.equal(data.simulation.engineRevision, plan.settings.engineRevision);
    assert.equal(data.simulation.strategyCandidate, plan.settings.strategyCandidate);
    assert.equal(data.simulation.strategyOpponent, plan.settings.strategyOpponent);
    assert.equal(data.simulation.maxCommands, plan.settings.maxCommands);
    assert.equal(data.simulation.maxTurns, plan.settings.maxTurns);
    assert.equal(data.simulation.comparisonSeed, plan.settings.comparisonSeed);
    assert.equal(data.simulation.completedGameTarget, plan.completedGameTarget);
    assert.deepEqual(data.simulation.capabilityRef, plan.capabilityRef);
    assert.deepEqual(data.simulation.manifestRef, plan.manifestRef);
    assert.equal(data.simulation.rawResultHash.slice(0, 7), "sha256:");
    for (const key of ["seed", "requestedSeat", "actualSeat", "aOnPlay", "outcome", "engineTermination", "terminationCause", "turns", "commands"]) {
      assert.ok(Object.hasOwn(data.games[0], key), key);
    }
    assert.deepEqual(data.games.map((game) => game.seed), record.seeds);
  });
});

test("re-running an unchanged plan reuses the published result and never invokes the runner again", () => {
  withRoot(({ cacheRoot, resultsRoot }) => {
    const first = execute(officialBundle, { cacheRoot, resultsRoot });
    assert.equal(first.calls.length, 4);
    assert.ok(first.outcome.results.every((record) => record.reused === false));

    const second = execute(officialBundle, { cacheRoot, resultsRoot });
    assert.deepEqual(second.calls, []);
    assert.ok(second.outcome.results.every((record) => record.reused === true));
    assert.deepEqual(
      second.outcome.results.map((record) => record.snapshot.contentHash),
      first.outcome.results.map((record) => record.snapshot.contentHash),
    );
  });
});

test("a DIFFERENT existing result at a job path is refused BEFORE the runner is invoked", () => {
  withRoot(({ cacheRoot, resultsRoot }) => {
    const plan = planFor(officialBundle);
    const entry = plan.jobs[0];
    const target = jobResultPathFor(resultsRoot, plan.manifestRef.manifestId, entry.job.jobId);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify({ schemaVersion: 1, kind: "matchup", data: {} }, null, 2));

    const calls = [];
    const error = failure(() => executeSimulationPlan(plan, {
      runner: createFakeRunner(defaultScript, { onJob: (job) => calls.push(job.jobId) }),
      cacheRoot,
      resultsRoot,
      now: NOW,
    }));
    assert.equal(error.code, "simulation_result_mismatch");
    assert.equal(error.details.reason, "existing_result_differs");
    // Task 10's known cost: the batch must NOT have run first.
    assert.deepEqual(calls, []);
  });
});

test("a VALID published result belonging to another job is refused before the runner runs", () => {
  withRoot(({ cacheRoot, resultsRoot }) => {
    const plan = planFor(officialBundle);
    // First run one job for real, then move its (genuine, hash-valid) artifact onto a DIFFERENT
    // job's path. The malformed-file case cannot reach this branch: here the file verifies
    // perfectly and only the job/plan/seed cross-check can tell that it is the wrong measurement.
    const first = executeSimulationPlan(plan, {
      runner: createFakeRunner(defaultScript),
      cacheRoot,
      resultsRoot,
      now: NOW,
    });
    const donor = first.results[0];
    const victim = first.results[1];
    rmSync(victim.path, { force: true });
    writeFileSync(victim.path, readFileSync(donor.path, "utf8"));
    // Prove the transplanted file is itself valid evidence, so the refusal below is about identity.
    verifySnapshot(JSON.parse(readFileSync(victim.path, "utf8")));

    const calls = [];
    const error = failure(() => executeSimulationPlan(plan, {
      runner: createFakeRunner(defaultScript, { onJob: (job) => calls.push(job.jobId) }),
      cacheRoot,
      resultsRoot,
      now: NOW,
    }));
    assert.equal(error.code, "simulation_result_mismatch");
    assert.equal(error.details.reason, "existing_result_differs");
    assert.deepEqual(calls, []);
  });
});

test("a runner that fails, writes nothing, or writes garbage is a tool failure, never a measurement", () => {
  withRoot(({ cacheRoot, resultsRoot }) => {
    const plan = planFor(officialBundle);
    const base = { cacheRoot, resultsRoot, now: NOW };

    let error = failure(() => executeSimulationPlan(plan, {
      ...base,
      runner: { name: "failing", run: () => ({ status: "failed", exitCode: 1, stderr: "boom" }) },
    }));
    assert.equal(error.code, "simulation_not_ready");
    assert.equal(error.details.reason, "runner_failed");

    error = failure(() => executeSimulationPlan(plan, {
      ...base,
      runner: { name: "silent", run: () => ({ status: "ok", exitCode: 0 }) },
    }));
    assert.equal(error.code, "simulation_result_mismatch");
    assert.equal(error.details.reason, "output_absent");

    error = failure(() => executeSimulationPlan(plan, {
      ...base,
      runner: {
        name: "truncating",
        run: ({ outPath }) => {
          mkdirSync(dirname(outPath), { recursive: true });
          writeFileSync(outPath, "{\"kind\": \"environment-raw-job-result\", \"games\": [");
          return { status: "ok", exitCode: 0 };
        },
      },
    }));
    assert.equal(error.code, "simulation_result_mismatch");
    assert.equal(error.details.reason, "output_unreadable");
  });
});

test("the runner is handed a job file on disk and the exact job it was asked to run", () => {
  withRoot(({ cacheRoot, resultsRoot }) => {
    const plan = planFor(officialBundle);
    const seen = [];
    executeSimulationPlan(plan, {
      cacheRoot,
      resultsRoot,
      now: NOW,
      runner: {
        name: "recording",
        run: (request) => {
          seen.push(request);
          return createFakeRunner(defaultScript).run(request);
        },
      },
    });
    assert.equal(seen.length, 4);
    for (const request of seen) {
      assert.deepEqual(Object.keys(request).sort(), ["job", "jobPath", "outPath"]);
      assert.equal(statSync(request.jobPath).mode & 0o777, 0o600);
      assert.ok(request.outPath.startsWith(cacheRoot));
      assert.notEqual(request.jobPath, request.outPath);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 7. round timeouts require the accepted clock
 * ------------------------------------------------------------------ */

function adjudicationFor(plan, scenario) {
  const cells = {};
  for (const job of plan.jobs) {
    const key = `${job.archetypeId}|${job.seat}`;
    const indexes = scenario.timeoutAdjudication.cells[key]?.timedOutSeedIndexes ?? [];
    // I-4: an adjudication must declare how many completed games the clock model evaluated. Every
    // job here plays its whole seed schedule, so the honest declaration is the schedule length.
    cells[job.pairingKey] = { timedOutSeeds: indexes.map((index) => job.seeds[index]), evaluatedSeeds: job.seeds.length };
  }
  return {
    clockModelRef: plan.clockRef === null ? null : { ...plan.clockRef },
    edition: "SC",
    metagameRegion: "CN",
    language: "zh-Hans",
    formatId: "standard-block2-op16",
    stage: scenario.timeoutAdjudication.stage,
    roundDurationMinutes: scenario.timeoutAdjudication.roundDurationMinutes,
    timeoutScoring: scenario.timeoutAdjudication.timeoutScoring,
    cells,
  };
}

test("an accepted, exactly-matching clock model makes adjudicated round timeouts scoreable at 0", () => {
  withRoot(({ cacheRoot, resultsRoot }) => {
    const plan = planFor(officialBundle);
    const outcome = executeSimulationPlan(plan, {
      runner: createFakeRunner(timeoutScenario.runnerScript),
      cacheRoot,
      resultsRoot,
      now: NOW,
      timeoutAdjudication: adjudicationFor(plan, timeoutScenario),
    });
    const find = (archetypeId, seat) => outcome.results.find((r) => r.archetypeId === archetypeId && r.seat === seat);
    const acePlay = find("leader:OP16-001", "play");
    assert.equal(acePlay.cell.scoredRoundTimeouts, 5);
    assert.equal(acePlay.cell.wins, 105);
    assert.equal(acePlay.cell.losses, 90);
    assert.equal(acePlay.cell.validGames, 200);
    assert.equal(acePlay.cell.winRate, 105 / 200);

    const aceDraw = find("leader:OP16-001", "draw");
    assert.equal(aceDraw.cell.scoredRoundTimeouts, 1);
    assert.equal(aceDraw.cell.wins, 96);
    assert.equal(aceDraw.cell.losses, 103);

    const teachPlay = find("leader:OP16-080", "play");
    assert.equal(teachPlay.cell.scoredRoundTimeouts, 0);
    assert.equal(teachPlay.cell.wins, 120);

    const timedOut = acePlay.snapshot.data.games.filter((game) => game.outcome === "round_timeout");
    assert.equal(timedOut.length, 5);
    for (const game of timedOut) {
      assert.equal(game.roundTimeoutClockHash, plan.clockRef.contentHash);
      assert.equal(game.terminationCause, "round_timeout");
    }
  });
});

test("an adjudicated timeout without the accepted clock fails simulation_result_mismatch/clock_model_hash", () => {
  withRoot(({ cacheRoot, resultsRoot }) => {
    const plan = planFor(diagnosticBundle);
    assert.equal(plan.clockRef, null);
    const adjudication = adjudicationFor(plan, timeoutScenario);
    adjudication.clockModelRef = { ...officialBundle.resolved.clockRef };
    for (const job of plan.jobs) {
      adjudication.cells[job.pairingKey] = { timedOutSeeds: [job.seeds[0]], evaluatedSeeds: job.seeds.length };
    }

    const error = failure(() => executeSimulationPlan(plan, {
      runner: createFakeRunner(timeoutScenario.runnerScript),
      cacheRoot,
      resultsRoot,
      now: NOW,
      timeoutAdjudication: adjudication,
    }));
    assert.equal(error.code, "simulation_result_mismatch");
    assert.equal(error.details.reason, "clock_model_hash");
  });
});

test("adjudicating a seed the job never played is refused", () => {
  withRoot(({ cacheRoot, resultsRoot }) => {
    const plan = planFor(officialBundle);
    const adjudication = adjudicationFor(plan, timeoutScenario);
    adjudication.cells[plan.jobs[0].pairingKey] = {
      timedOutSeeds: [999999999],
      evaluatedSeeds: plan.jobs[0].seeds.length,
    };
    const error = failure(() => executeSimulationPlan(plan, {
      runner: createFakeRunner(timeoutScenario.runnerScript),
      cacheRoot,
      resultsRoot,
      now: NOW,
      timeoutAdjudication: adjudication,
    }));
    assert.equal(error.code, "simulation_result_mismatch");
    assert.equal(error.details.reason, "round_timeout_seed_unknown");
  });
});

test("a computational ceiling can never be adjudicated into a round timeout", () => {
  // Isolated at the adjudication boundary: in a whole-plan run the unfinished row fails the
  // completed-game floor first, so this guard is unit-tested where it is actually reachable.
  const entry = planFor(officialBundle).jobs[0];
  const widened = structuredClone(entry.job);
  widened.plan.seeds = [...widened.plan.seeds, 987654321, 987654322];
  widened.plan.planHash = computePlanHash(widened.plan);
  widened.jobId = computeJobId(widened);
  const result = buildRawJobResult(widened, cleanGames(widened, { unfinished: 1, toolFailures: 1 }));
  const authorization = clockAuthorizationFor(officialBundle.resolved);

  for (const seed of [987654321, 987654322]) {
    const error = failure(() => applyRoundTimeoutAdjudication(result, { timedOutSeeds: [seed] }, authorization));
    assert.equal(error.code, "simulation_result_mismatch");
    assert.equal(error.details.reason, "round_timeout_from_non_rules_row");
  }
  // A rules-win row in the same result IS adjudicable, so the guard is discriminating.
  const adjudicated = applyRoundTimeoutAdjudication(result, { timedOutSeeds: [result.games[0].seed] }, authorization);
  assert.equal(adjudicated.games[0].outcome, "round_timeout");
  assert.equal(adjudicated.games[0].roundTimeoutClockHash, authorization.clockModelRef.contentHash);
});

test("a duplicated adjudicated seed is refused rather than double counted", () => {
  const entry = planFor(officialBundle).jobs[0];
  const result = buildRawJobResult(entry.job, cleanGames(entry.job));
  const authorization = clockAuthorizationFor(officialBundle.resolved);
  const seed = result.games[0].seed;
  const error = failure(() => applyRoundTimeoutAdjudication(result, { timedOutSeeds: [seed, seed] }, authorization));
  assert.equal(error.code, "simulation_result_mismatch");
  assert.equal(error.details.reason, "round_timeout_seed_duplicate");
});

test("I4: expansion of a multi-representative archetype is deterministic and per-representative", () => {
  const scenario = pairedScenario.multiRepresentative;
  const plan = planFor(scenario.base);
  const ace = "leader:OP16-001";

  // Four jobs for the two-representative archetype: 2 representatives x 2 seats.
  const aceJobs = plan.jobs.filter((job) => job.archetypeId === ace);
  assert.equal(aceJobs.length, 4);
  assert.equal(plan.jobs.length, 6);
  assert.deepEqual(aceJobs.map((job) => job.seat).sort(), ["draw", "draw", "play", "play"]);

  // Each representative is materialized as its OWN opponent deck, not the archetype's first list.
  const opponents = new Set(aceJobs.map((job) => job.job.opponent.gameplayHash));
  assert.equal(opponents.size, 2);
  for (const job of plan.jobs) {
    validateEnvironmentJob(job.job);
    assert.equal(job.job.opponent.gameplayHash, job.opponentGameplayHash);
  }
  assert.equal(new Set(plan.jobs.map((job) => job.job.jobId)).size, 6);
  assert.equal(new Set(plan.jobs.map((job) => job.pairingKey)).size, 6);
  // Distinct seed schedules per (representative, seat) -- the stratum identity includes the
  // representative's gameplay hash, so two lists of one archetype never share games.
  assert.equal(new Set(plan.jobs.map((job) => job.seeds.join(","))).size, 6);

  // The within-archetype weights ride through onto the jobs, so the report can weight them.
  const weights = aceJobs
    .filter((job) => job.seat === "play")
    .map((job) => job.withinArchetypeWeight)
    .sort();
  assert.deepEqual(weights, [0.4, 0.6]);
  for (const job of aceJobs) assert.equal(job.fieldWeight, plan.strata[0].fieldWeight);

  // Both arms share every seed schedule while their plan hashes differ.
  const variant = planFor(scenario.variant);
  assert.notEqual(variant.planHash, plan.planHash);
  for (const job of plan.jobs) {
    assert.deepEqual(jobByKey(variant, job.pairingKey).seeds, job.seeds);
  }
});

test("I4: a multi-representative plan executes and publishes one artifact per representative and seat", () => {
  withRoot(({ cacheRoot, resultsRoot }) => {
    const scenario = pairedScenario.multiRepresentative;
    const plan = planFor(scenario.base);
    const outcome = executeSimulationPlan(plan, {
      runner: createFakeRunner(scenario.runnerScript, { arm: "base" }),
      cacheRoot,
      resultsRoot,
      now: NOW,
    });
    assert.equal(outcome.results.length, 6);
    assert.equal(new Set(outcome.results.map((record) => record.path)).size, 6);
    const acePlay = outcome.results
      .filter((record) => record.archetypeId === "leader:OP16-001" && record.seat === "play")
      .map((record) => record.cell.wins)
      .sort((left, right) => left - right);
    // The runner script keys these two cells by opponent gameplayHash, so the two representatives of
    // one archetype get genuinely different outcomes rather than colliding on their shared leader.
    assert.deepEqual(acePlay, [110, 130]);
  });
});
