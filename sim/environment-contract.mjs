// Task 10: strict fixed-seat environment job contract.
//
// PURE by design — this module imports ONLY ../environment/canonical.mjs and ../environment/hash.mjs
// (the project's one canonical hashing implementation; see CLAUDE.md). It intentionally does NOT
// import environment/errors.mjs or environment/store.mjs: scripts/simulate.sh's --harness-tests
// mode copies this file plus batch-runner.ts into the vendored engine's test directory, and per the
// controller ruling only canonical.mjs+hash.mjs are copied alongside it. Keeping this module's own
// dependency graph to those two files is what makes that copy set correct — anything more and the
// harness copy would be silently incomplete. Errors here are plain Error objects with a `.code`
// (mirroring canonical.mjs's own canonicalError() convention), not environment/errors.mjs's class.
//
// classifyTermination() NEVER returns "round_timeout": that outcome exists only behind a validated
// ClockModel, which Task 11 owns. Every non-`rules-win` engine cause is treated as a tool/engine
// limit here, never a rules outcome.
import { sha256Canonical, hashProjection } from "../environment/hash.mjs";

export const JOB_KIND = "environment-simulation-job";
export const PLAN_KIND = "environment-simulation-job-plan";
export const RESULT_KIND = "environment-raw-job-result";

const FULL_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const ENGINE_REVISION_PATTERN = /^[0-9a-f]{7,64}$/i;
const FIRST_PLAYER_VALUES = new Set(["play", "draw", "alternate"]);
const RAW_OUTCOMES = new Set(["win", "loss", "unfinished", "tool_failure"]);
// Computational-ceiling causes the ENGINE itself can report; these map to "unfinished" with their
// exact cause retained rather than to "tool_failure". "repeated-state" is the engine's cycle
// detector; "max-actions" is the engine's own command-budget exhaustion (bot-harness.ts's for-loop
// bound, which we always set from spec.maxCommands, so it already covers the command ceiling).
const ENGINE_CEILING_CAUSES = new Set(["repeated-state", "max-actions"]);
// Causes WE synthesize ourselves (not reported by the engine) when overriding an engine-reported
// rules-win because it took too long by OUR external ceilings.
const SYNTHETIC_CEILING_CAUSES = new Set(["turn_budget_exhausted", "command_budget_exhausted"]);

// Closed key sets (fix round 1, I3): a mutable caller deck path, or any other unlisted field, at
// any of these three levels is rejected outright rather than silently ignored or silently hashed.
// This is independent of (and strictly stronger than) hash-consistency checks: an attacker who
// controls the whole job can always recompute planHash/jobId to match an extra field they added,
// so closed keys are the only thing that actually closes this off.
const JOB_KEYS = new Set(["schemaVersion", "kind", "plan", "candidate", "opponent", "jobId"]);
const PLAN_KEYS = new Set([
  "schemaVersion",
  "kind",
  "fixedSeat",
  "seeds",
  "completedGameTarget",
  "strategyCandidate",
  "strategyOpponent",
  "engineRevision",
  "maxCommands",
  "maxTurns",
  "planHash",
]);
const DECK_INPUT_KEYS = new Set([
  "displayName",
  "leaderGameplayId",
  "mainDeckCounts",
  "artifactHash",
  "gameplayHash",
]);

function contractError(code, message, details) {
  const error = new Error(message ? `${code}: ${message}` : code);
  error.code = code;
  error.details = details ?? {};
  return error;
}

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fail(code, message, details) {
  throw contractError(code, message, details);
}

function assertRecord(value, path) {
  if (!isRecord(value)) fail("environment_job_invalid", `${path} must be an object`, { path });
}

function assertNonEmptyString(value, path) {
  if (typeof value !== "string" || value.length === 0) {
    fail("environment_job_invalid", `${path} must be a non-empty string`, { path });
  }
}

function assertHash(value, path) {
  if (typeof value !== "string" || !FULL_HASH_PATTERN.test(value)) {
    fail("environment_job_hash_invalid", `${path} must be a full lowercase sha256 hash`, { path, value });
  }
}

function assertPositiveSafeInteger(value, path) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail("environment_job_limit_invalid", `${path} must be a positive safe integer`, { path, value });
  }
}

function assertEngineRevision(value) {
  if (value !== "engine-commit-fixture" && !(typeof value === "string" && ENGINE_REVISION_PATTERN.test(value))) {
    fail(
      "environment_job_engine_revision_invalid",
      "engineRevision must be a git commit hash (7-64 hex chars) or the fixture placeholder",
      { engineRevision: value },
    );
  }
}

function assertClosedKeys(value, allowedKeys, path) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      fail("environment_job_unknown_key", `${path} has an unrecognized key: ${key}`, { path, key });
    }
  }
}

// ---------------------------------------------------------------------------
// Termination-token normalization (fix round 1, I1): a laundered spelling of "round_timeout"
// ("round-timeout", "ROUND_TIMEOUT", " round_timeout ") must be caught the same as the exact
// literal, in EITHER terminationCause or engineTermination — both are attacker/bug-controlled
// strings arriving from outside this module, so both must go through the same normalizer rather
// than each having its own ad hoc literal comparison.
// ---------------------------------------------------------------------------
function normalizeTerminationToken(value) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/-/g, "_") : value;
}

function isRoundTimeoutToken(value) {
  return normalizeTerminationToken(value) === "round_timeout";
}

// ---------------------------------------------------------------------------
// gameplayHashForDeck (fix round 1, C1): replicated from environment/deck.mjs's own
// gameplayHashForDeck rather than imported, so this module's dependency footprint (and therefore
// the --harness-tests copy set) stays exactly { canonical.mjs, hash.mjs } — importing deck.mjs
// would also pull in environment/errors.mjs and environment/snapshot.mjs. environment/deck.mjs
// remains the canonical source of this algorithm; sim/environment-contract.test.mjs pins
// byte-for-byte equality between the two so they can never silently diverge.
// ---------------------------------------------------------------------------
export function gameplayHashForDeck(leaderGameplayId, mainDeckCounts) {
  const sortedCounts = {};
  for (const [gameplayId, count] of Object.entries(mainDeckCounts).sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  ))) {
    sortedCounts[gameplayId] = count;
  }
  return sha256Canonical({
    schemaVersion: 1,
    leaderGameplayId,
    mainDeckCounts: sortedCounts,
  });
}

// ---------------------------------------------------------------------------
// parseFirstPlayerValue — the ONE enum parser shared by the legacy --first CLI flag (via
// batch-runner.ts's legacy adapter reading SIM_FIRST) and job.plan.fixedSeat validation below.
// An invalid value must fail loudly as invalid_first_player rather than silently becoming
// "alternate" behavior, which is exactly the bug this task fixes in the legacy adapter.
// ---------------------------------------------------------------------------
export function parseFirstPlayerValue(raw) {
  if (typeof raw !== "string" || !FIRST_PLAYER_VALUES.has(raw)) {
    fail("invalid_first_player", `unknown first-player value: ${JSON.stringify(raw)}`, { value: raw });
  }
  return raw;
}

// ---------------------------------------------------------------------------
// classifyTermination — fail-closed and ordered: non-rules-win engine cause first, then
// computational limits, then the winner. See CLAUDE.md/docs/simulation.md for why conflating a
// tool limit with a rules outcome is the project's own recorded failure mode.
// ---------------------------------------------------------------------------
export function classifyTermination(input) {
  if (!isRecord(input)) fail("termination_input_invalid", "input must be an object");
  const { engineTermination, winner, turns, maxTurns } = input;
  if (typeof engineTermination !== "string" || engineTermination.length === 0) {
    fail("termination_input_invalid", "engineTermination must be a non-empty string", { engineTermination });
  }
  if (winner !== null && winner !== "candidate" && winner !== "opponent") {
    fail("termination_input_invalid", "winner must be \"candidate\", \"opponent\", or null", { winner });
  }
  if (!Number.isSafeInteger(turns) || turns < 0) {
    fail("termination_input_invalid", "turns must be a non-negative safe integer", { turns });
  }
  if (!Number.isSafeInteger(maxTurns) || maxTurns <= 0) {
    fail("termination_input_invalid", "maxTurns must be a positive safe integer", { maxTurns });
  }
  const hasCommandCeiling = input.commands !== undefined || input.maxCommands !== undefined;
  if (hasCommandCeiling) {
    if (!Number.isSafeInteger(input.commands) || input.commands < 0) {
      fail("termination_input_invalid", "commands must be a non-negative safe integer", { commands: input.commands });
    }
    if (!Number.isSafeInteger(input.maxCommands) || input.maxCommands <= 0) {
      fail("termination_input_invalid", "maxCommands must be a positive safe integer", { maxCommands: input.maxCommands });
    }
  }

  // Task 10 never classifies a round clock: that requires a validated ClockModel (Task 11).
  // Normalized (I1 fix round 1) so a laundered spelling ("round-timeout", "ROUND_TIMEOUT",
  // " round_timeout ") cannot slip past a literal-only comparison.
  if (isRoundTimeoutToken(engineTermination)) {
    fail("round_timeout_forbidden", "round_timeout requires a validated ClockModel (Task 11), not Task 10", {
      engineTermination,
    });
  }

  if (engineTermination !== "rules-win") {
    if (ENGINE_CEILING_CAUSES.has(engineTermination)) {
      return Object.freeze({ outcome: "unfinished", terminationCause: engineTermination });
    }
    // illegal-command, unsupported-prompt, and any unrecognized/unknown engine cause: fail closed
    // to tool_failure rather than guessing it is a real game result. The exact cause is retained.
    return Object.freeze({ outcome: "tool_failure", terminationCause: engineTermination });
  }

  // engineTermination === "rules-win" from here on.
  if (winner === null) {
    // The engine claims a rules conclusion but named no winner. Contradictory, never a game result.
    return Object.freeze({ outcome: "tool_failure", terminationCause: "contradictory-winner-state" });
  }
  if (turns > maxTurns) {
    return Object.freeze({ outcome: "unfinished", terminationCause: "turn_budget_exhausted" });
  }
  if (hasCommandCeiling && input.commands > input.maxCommands) {
    return Object.freeze({ outcome: "unfinished", terminationCause: "command_budget_exhausted" });
  }
  return Object.freeze({
    outcome: winner === "candidate" ? "win" : "loss",
    terminationCause: "rules-win",
  });
}

// ---------------------------------------------------------------------------
// Plan / job hash projections (Step 3).
// ---------------------------------------------------------------------------

/** planHash is derived over job.plan EXCLUDING the derived planHash field itself. */
export function computePlanHash(plan) {
  assertRecord(plan, "plan");
  return hashProjection(plan, ["planHash"]);
}

/**
 * jobId is derived over the exact projection named in the brief's Step 3: planHash, candidate and
 * opponent artifact/gameplay hashes, fixedSeat, seeds, strategies, completedGameTarget,
 * engineRevision, maxCommands, maxTurns. Nothing else — in particular, no display names, no
 * source paths, no runtime metadata.
 */
export function computeJobId(job) {
  assertRecord(job, "job");
  assertRecord(job.plan, "job.plan");
  assertRecord(job.candidate, "job.candidate");
  assertRecord(job.opponent, "job.opponent");
  return sha256Canonical({
    planHash: job.plan.planHash,
    candidate: {
      artifactHash: job.candidate.artifactHash,
      gameplayHash: job.candidate.gameplayHash,
    },
    opponent: {
      artifactHash: job.opponent.artifactHash,
      gameplayHash: job.opponent.gameplayHash,
    },
    fixedSeat: job.plan.fixedSeat,
    seeds: [...job.plan.seeds],
    strategies: {
      candidate: job.plan.strategyCandidate,
      opponent: job.plan.strategyOpponent,
    },
    completedGameTarget: job.plan.completedGameTarget,
    engineRevision: job.plan.engineRevision,
    maxCommands: job.plan.maxCommands,
    maxTurns: job.plan.maxTurns,
  });
}

function assertDeckInput(value, path) {
  assertRecord(value, path);
  assertClosedKeys(value, DECK_INPUT_KEYS, path);
  assertNonEmptyString(value.leaderGameplayId, `${path}.leaderGameplayId`);
  assertHash(value.artifactHash, `${path}.artifactHash`);
  assertHash(value.gameplayHash, `${path}.gameplayHash`);
  assertRecord(value.mainDeckCounts, `${path}.mainDeckCounts`);
  const keys = Object.keys(value.mainDeckCounts);
  if (keys.length === 0) {
    fail("environment_job_deck_invalid", `${path}.mainDeckCounts must not be empty`, { path });
  }
  for (const key of keys) {
    const count = value.mainDeckCounts[key];
    if (!Number.isSafeInteger(count) || count <= 0) {
      fail("environment_job_deck_invalid", `${path}.mainDeckCounts.${key} must be a positive safe integer`, {
        path,
        key,
        count,
      });
    }
  }

  // C1 fix round 1: the deck the engine actually plays is { leaderGameplayId, mainDeckCounts } —
  // gameplayHash is supposed to BIND to exactly that pair. Without recomputing it here, nothing
  // stopped a caller from mutating mainDeckCounts (e.g. to 51 cards) or swapping leaderGameplayId
  // while leaving the declared gameplayHash untouched; jobId's own projection only echoes the
  // DECLARED hash, so it could never catch this on its own.
  const expectedGameplayHash = gameplayHashForDeck(value.leaderGameplayId, value.mainDeckCounts);
  if (expectedGameplayHash !== value.gameplayHash) {
    fail(
      "environment_job_deck_hash_mismatch",
      `${path}.gameplayHash does not match the recomputed hash of leaderGameplayId + mainDeckCounts`,
      { path, expectedGameplayHash, gameplayHash: value.gameplayHash },
    );
  }
}

function assertSeeds(seeds) {
  if (!Array.isArray(seeds) || seeds.length === 0) {
    fail("environment_job_seeds_empty", "plan.seeds must be a non-empty array", { seeds });
  }
  for (const seed of seeds) {
    if (!Number.isSafeInteger(seed)) {
      fail("environment_job_seed_invalid", "every seed must be an explicit safe integer (no coerced strings)", {
        seed,
      });
    }
  }
  // JavaScript Set uses SameValueZero, which already treats +0 and -0 as the same value — exactly
  // the "0/-0 count as one seed" requirement, with no special-casing needed.
  if (new Set(seeds).size !== seeds.length) {
    fail("environment_job_seed_duplicate", "plan.seeds must not contain duplicate seeds", { seeds });
  }
}

// ---------------------------------------------------------------------------
// validateEnvironmentJob — Step 1/3.
// ---------------------------------------------------------------------------
export function validateEnvironmentJob(job) {
  assertRecord(job, "job");
  assertClosedKeys(job, JOB_KEYS, "job");
  if (job.schemaVersion !== 1) {
    fail("environment_job_schema_unsupported", `unsupported job schemaVersion: ${job.schemaVersion}`, {
      schemaVersion: job.schemaVersion,
    });
  }
  if (job.kind !== JOB_KIND) {
    fail("environment_job_invalid", `job.kind must be ${JOB_KIND}`, { kind: job.kind });
  }
  assertHash(job.jobId, "job.jobId");

  const plan = job.plan;
  assertRecord(plan, "job.plan");
  assertClosedKeys(plan, PLAN_KEYS, "job.plan");
  if (plan.schemaVersion !== 1) {
    fail("environment_job_schema_unsupported", `unsupported plan schemaVersion: ${plan.schemaVersion}`, {
      schemaVersion: plan.schemaVersion,
    });
  }
  if (plan.kind !== PLAN_KIND) {
    fail("environment_job_invalid", `job.plan.kind must be ${PLAN_KIND}`, { kind: plan.kind });
  }
  assertHash(plan.planHash, "job.plan.planHash");

  // Value validation happens before the "must be play or draw" job-mode restriction, so an
  // unrecognized value always reports invalid_first_player rather than being mistaken for the
  // (also-rejected-here, but differently-coded) legacy "alternate" mode.
  const fixedSeat = parseFirstPlayerValue(plan.fixedSeat);
  if (fixedSeat === "alternate") {
    fail(
      "environment_job_fixed_seat_alternate_forbidden",
      "environment jobs must pin an exact play or draw seat, never alternate",
      { fixedSeat },
    );
  }

  assertSeeds(plan.seeds);
  if (!Number.isSafeInteger(plan.completedGameTarget) || plan.completedGameTarget <= 0) {
    fail(
      "environment_job_completed_target_invalid",
      "completedGameTarget must be a positive safe integer",
      { completedGameTarget: plan.completedGameTarget },
    );
  }
  if (plan.completedGameTarget > plan.seeds.length) {
    fail(
      "environment_job_completed_target_invalid",
      "completedGameTarget cannot exceed the number of unique explicit seeds",
      { completedGameTarget: plan.completedGameTarget, seedCount: plan.seeds.length },
    );
  }
  assertNonEmptyString(plan.strategyCandidate, "job.plan.strategyCandidate");
  assertNonEmptyString(plan.strategyOpponent, "job.plan.strategyOpponent");
  assertEngineRevision(plan.engineRevision);
  assertPositiveSafeInteger(plan.maxCommands, "job.plan.maxCommands");
  assertPositiveSafeInteger(plan.maxTurns, "job.plan.maxTurns");

  assertDeckInput(job.candidate, "job.candidate");
  assertDeckInput(job.opponent, "job.opponent");

  const expectedPlanHash = computePlanHash(plan);
  if (expectedPlanHash !== plan.planHash) {
    fail("environment_job_plan_hash_mismatch", "planHash does not match the recomputed projection", {
      expectedPlanHash,
      planHash: plan.planHash,
    });
  }

  const expectedJobId = computeJobId(job);
  if (expectedJobId !== job.jobId) {
    fail("environment_job_id_mismatch", "jobId does not match the recomputed projection", {
      expectedJobId,
      jobId: job.jobId,
    });
  }

  return job;
}

// ---------------------------------------------------------------------------
// buildRawJobResult / validateRawJobResult — the raw job-result envelope (Step 4/7).
// ---------------------------------------------------------------------------

/** Pure envelope builder. Filesystem writing (atomic, no-clobber) lives in batch-runner.ts. */
export function buildRawJobResult(job, games) {
  if (!Array.isArray(games)) fail("environment_job_invalid", "games must be an array", { games });
  const draft = {
    schemaVersion: 1,
    kind: RESULT_KIND,
    jobId: job.jobId,
    planHash: job.plan.planHash,
    fixedSeat: job.plan.fixedSeat,
    seeds: [...job.plan.seeds],
    completedGameTarget: job.plan.completedGameTarget,
    strategyCandidate: job.plan.strategyCandidate,
    strategyOpponent: job.plan.strategyOpponent,
    engineRevision: job.plan.engineRevision,
    maxCommands: job.plan.maxCommands,
    maxTurns: job.plan.maxTurns,
    candidate: {
      artifactHash: job.candidate.artifactHash,
      gameplayHash: job.candidate.gameplayHash,
    },
    opponent: {
      artifactHash: job.opponent.artifactHash,
      gameplayHash: job.opponent.gameplayHash,
    },
    games: games.map((game) => ({ ...game })),
  };
  const resultHash = hashProjection(draft, ["resultHash"]);
  return { ...draft, resultHash };
}

function terminationCauseConsistentWithOutcome(outcome, terminationCause) {
  if (terminationCause === "rules-win") return outcome === "win" || outcome === "loss";
  if (ENGINE_CEILING_CAUSES.has(terminationCause) || SYNTHETIC_CEILING_CAUSES.has(terminationCause)) {
    return outcome === "unfinished";
  }
  return outcome === "tool_failure";
}

/**
 * validateRawJobResult cross-checks a raw result envelope against the job that produced it.
 * Every failure here throws with code "simulation_result_mismatch" and a `details.reason`
 * discriminator — the same convention Task 11 extends for its own clock-model checks.
 */
export function validateRawJobResult(job, result) {
  assertRecord(result, "result");

  const mismatch = (reason, extra) => {
    throw contractError("simulation_result_mismatch", reason, { reason, ...extra });
  };

  if (result.schemaVersion !== 1 || result.kind !== RESULT_KIND) mismatch("malformed_envelope");
  if (!Array.isArray(result.games) || result.games.length === 0) mismatch("malformed_envelope");

  let expectedHash;
  try {
    expectedHash = hashProjection(result, ["resultHash"]);
  } catch {
    mismatch("malformed_envelope");
  }
  if (typeof result.resultHash !== "string" || result.resultHash !== expectedHash) {
    mismatch("result_hash_mismatch", { expectedHash, resultHash: result.resultHash });
  }

  if (result.jobId !== job.jobId) mismatch("job_id_mismatch");
  if (result.planHash !== job.plan.planHash) mismatch("plan_hash_mismatch");
  if (result.fixedSeat !== job.plan.fixedSeat) mismatch("fixed_seat_mismatch");
  if (result.completedGameTarget !== job.plan.completedGameTarget) mismatch("settings_mismatch");
  if (result.strategyCandidate !== job.plan.strategyCandidate) mismatch("settings_mismatch");
  if (result.strategyOpponent !== job.plan.strategyOpponent) mismatch("settings_mismatch");
  if (result.engineRevision !== job.plan.engineRevision) mismatch("settings_mismatch");
  if (result.maxCommands !== job.plan.maxCommands) mismatch("settings_mismatch");
  if (result.maxTurns !== job.plan.maxTurns) mismatch("settings_mismatch");
  if (result.candidate?.artifactHash !== job.candidate.artifactHash) mismatch("candidate_hash_mismatch");
  if (result.candidate?.gameplayHash !== job.candidate.gameplayHash) mismatch("candidate_hash_mismatch");
  if (result.opponent?.artifactHash !== job.opponent.artifactHash) mismatch("opponent_hash_mismatch");
  if (result.opponent?.gameplayHash !== job.opponent.gameplayHash) mismatch("opponent_hash_mismatch");

  const expectedSeeds = job.plan.seeds;
  if (result.games.length !== expectedSeeds.length) mismatch("seed_schedule_mismatch");
  if (!Array.isArray(result.seeds) || result.seeds.length !== expectedSeeds.length) {
    mismatch("seed_schedule_mismatch");
  } else {
    // Strict `!==` (not Object.is) is deliberate: it treats -0 and 0 as the same seed value,
    // matching the "0/-0 count as one seed" rule already enforced at job-validation time.
    for (let index = 0; index < expectedSeeds.length; index += 1) {
      if (result.seeds[index] !== expectedSeeds[index]) {
        mismatch("seed_schedule_mismatch", { index });
      }
    }
  }

  const expectedActualSeat = job.plan.fixedSeat === "play" ? "north" : "south";
  const expectedAOnPlay = job.plan.fixedSeat === "play";

  let completed = 0;
  for (let index = 0; index < result.games.length; index += 1) {
    const game = result.games[index];
    if (!isRecord(game)) mismatch("malformed_game_row", { index });
    if (game.seed !== expectedSeeds[index]) mismatch("seed_schedule_mismatch", { index });
    if (game.requestedSeat !== job.plan.fixedSeat) mismatch("requested_seat_mismatch", { index });
    if (game.actualSeat !== expectedActualSeat) mismatch("actual_seat_mismatch", { index, actualSeat: game.actualSeat });
    if (game.aOnPlay !== expectedAOnPlay) {
      mismatch("a_on_play_mismatch", { index, aOnPlay: game.aOnPlay, fixedSeat: job.plan.fixedSeat });
    }
    // I1 fix round 1: round_timeout laundering is checked FIRST, across all three fields a caller
    // could hide it in (outcome, terminationCause, engineTermination), through the same normalizer
    // classifyTermination uses — a laundered spelling must be caught here exactly as if it were the
    // literal string. M2 fix round 1: a plain invalid outcome that is NOT round-timeout-shaped
    // (e.g. "garbage") is a separate, more specific code — outcome_invalid — so Task 11 does not
    // have to treat every malformed row as if it were a timeout-laundering attempt.
    if (
      isRoundTimeoutToken(game.outcome)
      || isRoundTimeoutToken(game.terminationCause)
      || isRoundTimeoutToken(game.engineTermination)
    ) {
      mismatch("round_timeout_present", {
        index,
        outcome: game.outcome,
        terminationCause: game.terminationCause,
        engineTermination: game.engineTermination,
      });
    }
    if (!RAW_OUTCOMES.has(game.outcome)) mismatch("outcome_invalid", { index, outcome: game.outcome });
    if (typeof game.terminationCause !== "string" || game.terminationCause.length === 0) {
      mismatch("malformed_game_row", { index, terminationCause: game.terminationCause });
    }
    if (!terminationCauseConsistentWithOutcome(game.outcome, game.terminationCause)) {
      mismatch("outcome_termination_inconsistent", { index, outcome: game.outcome, terminationCause: game.terminationCause });
    }
    if (game.outcome === "win" || game.outcome === "loss") completed += 1;
  }

  if (completed < job.plan.completedGameTarget) {
    mismatch("completed_game_target_unmet", { completed, target: job.plan.completedGameTarget });
  }

  return result;
}
