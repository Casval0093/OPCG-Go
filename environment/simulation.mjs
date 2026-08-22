// Environment orchestration: a verified resolved environment in, published simulated matchup
// evidence out.
//
// The contract with the simulator is Task 10's, imported verbatim from ../sim/environment-contract.mjs
// and never reimplemented here. It is IMPORTED rather than re-exported through environment/index.mjs
// on purpose: re-exporting would make environment/ depend on sim/ depend on environment/, a
// directory cycle the Task 10 review explicitly ruled against.
//
// Three orchestration rules are load-bearing and each one exists because of a measured failure:
//
//   * The candidate/opponent deck the engine plays is MATERIALIZED from a verified DeckSnapshot into
//     a job-private file. A caller path is never authoritative, and Task 10's own assertDeckInput
//     recomputes the gameplay hash from the materialized payload, so a deck that drifted from its
//     snapshot cannot be played.
//   * The final result target is checked BEFORE the runner is invoked. Task 10's known M4 is that the
//     whole batch runs before the no-clobber refusal -- minutes of engine time per mistake at 200
//     games x 2 seats x N representatives.
//   * A seed schedule is a function of the comparison seed and the stratum identity ONLY. Nothing
//     about the candidate deck, the plan, or the job may reach it, or a baseline and its tech-slot
//     variant could not share common random numbers and the paired comparison would be noise.
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { canonicalJson } from "./canonical.mjs";
import { EnvironmentError } from "./errors.mjs";
import { sha256Canonical } from "./hash.mjs";
import { verifySnapshot } from "./snapshot.mjs";
import { publishImmutableArtifact, realIo, SNAPSHOT_ARTIFACT_CONTRACT } from "./store.mjs";
import {
  assertExactCoverage,
  assertRoundTimeoutAuthorized,
  buildSimulatedMatchupSnapshot,
  clockAuthorizationFor,
  createXorshift32,
  pairingKeyFor,
  parseEnvironmentKey,
  SEATS,
} from "./matchup.mjs";
import {
  computeJobId,
  computePlanHash,
  validateEnvironmentJob,
  validateRawJobResult,
} from "../sim/environment-contract.mjs";

export const SIMULATION_PLAN_KIND = "environment-simulation-plan";
export const MINIMUM_COMPLETED_GAMES_PER_SEAT = 200;

export const SIMULATION_ERROR_CODES = Object.freeze([
  "simulation_plan_invalid",
  "simulation_settings_invalid",
  "simulation_seed_input_invalid",
  "simulation_result_mismatch",
  "simulation_not_ready",
  "insufficient_matchup_coverage",
  "missing_representative_deck",
  "legacy_evidence_rejected",
  "environment_job_exists",
]);

const FULL_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*-[0-9a-f]{16}$/;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

// The resolved boundary is CLOSED: an unlisted field (a mutable deck path, a caller-chosen results
// root, an extra weight) is refused rather than ignored. Task 6's boundary is certified, so a new
// key here means something upstream changed and this module must be re-read, not silently adapted.
const RESOLVED_KEYS = Object.freeze([
  "schemaVersion",
  "requestedEnvironment",
  "environmentKey",
  "manifestRef",
  "candidateDeckRef",
  "candidateGameplayHash",
  "evaluationMode",
  "strata",
  "turnOrderWeights",
  "minimumCompletedGamesPerSeat",
  "matchupEvidence",
  "capabilityRef",
  "clockRef",
  "marketRefs",
  "roundTimeoutPolicy",
  "references",
  "blockers",
  "warnings",
]);

const SETTINGS_SCALARS = Object.freeze([
  "strategyCandidate",
  "strategyOpponent",
  "engineRevision",
  "maxCommands",
  "maxTurns",
  "comparisonSeed",
]);
const SETTINGS_KEYS = Object.freeze([...SETTINGS_SCALARS, "opponentDecks"]);
const SEED_IDENTITY_KEYS = Object.freeze([
  "comparisonSeed",
  "archetypeId",
  "opponentGameplayHash",
  "seat",
  "count",
]);
const EXECUTE_OPTION_KEYS = Object.freeze([
  "runner",
  "cacheRoot",
  "resultsRoot",
  "now",
  "io",
  "timeoutAdjudication",
]);

// The raw job-result envelope Task 10's buildRawJobResult produces, exactly. Anything else in the
// file the runner wrote is a different document and is refused rather than hashed and believed.
const RAW_RESULT_KEYS = Object.freeze([
  "schemaVersion",
  "kind",
  "jobId",
  "planHash",
  "fixedSeat",
  "seeds",
  "completedGameTarget",
  "strategyCandidate",
  "strategyOpponent",
  "engineRevision",
  "maxCommands",
  "maxTurns",
  "candidate",
  "opponent",
  "games",
  "resultHash",
]);

// Markers of the two OTHER result files this repository contains. Neither is environment evidence
// and both would otherwise parse as "some JSON with games in it".
const LEGACY_LAST_RUN_MARKERS = Object.freeze(["baselineGames", "turnBudgetKind", "pairedDiff", "symmetricStrategy"]);
const ARENA_MARKERS = Object.freeze(["chosenIndex", "requestedIndex", "positionKey", "decisions"]);

function fail(code, message, details = {}) {
  const rendered = message.startsWith(`${code}:`) ? message : `${code}: ${message}`;
  throw new EnvironmentError(code, rendered, details);
}

function mismatch(reason, details = {}) {
  fail("simulation_result_mismatch", reason, { reason, ...details });
}

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isFullHash(value) {
  return typeof value === "string" && FULL_HASH_PATTERN.test(value);
}

function isSafeArtifactId(value) {
  return typeof value === "string" && SAFE_ID_PATTERN.test(value);
}

function freezeDeep(value, active = new Set()) {
  if (value === null || typeof value !== "object" || active.has(value)) return value;
  active.add(value);
  try {
    for (const child of Object.values(value)) freezeDeep(child, active);
    return Object.freeze(value);
  } finally {
    active.delete(value);
  }
}

/** A filesystem-safe identifier from a full hash: the 64 hex characters, with no `sha256:` colon. */
function safeIdOf(fullHash, field) {
  if (!isFullHash(fullHash)) {
    fail("simulation_plan_invalid", `${field} must be a full lowercase sha256 hash`, { field });
  }
  return fullHash.slice(7);
}

/* ------------------------------------------------------------------ *
 * paths
 * ------------------------------------------------------------------ */

export function jobCacheDirectoryFor(cacheRoot, planHash) {
  if (typeof cacheRoot !== "string" || cacheRoot.length === 0) {
    fail("simulation_plan_invalid", "a job cache root must be an explicit path", { field: "cacheRoot" });
  }
  return join(cacheRoot, safeIdOf(planHash, "planHash"));
}

export function jobResultPathFor(resultsRoot, manifestId, jobId) {
  if (typeof resultsRoot !== "string" || resultsRoot.length === 0) {
    fail("simulation_plan_invalid", "a results root must be an explicit path", { field: "resultsRoot" });
  }
  if (!isSafeArtifactId(manifestId)) {
    fail("simulation_plan_invalid", "a results path needs a safe immutable Manifest id", { field: "manifestId" });
  }
  return join(resultsRoot, manifestId, `${safeIdOf(jobId, "jobId")}.json`);
}

/* ------------------------------------------------------------------ *
 * seed schedules
 * ------------------------------------------------------------------ */

/**
 * The seed schedule for one stratum cell. Derived from the explicit comparison seed plus the stable
 * `archetype x representative x seat` identity and NOTHING else, so a baseline and a variant that
 * differ only in the candidate deck share every seed -- the definition of common random numbers.
 * Longer schedules extend shorter ones (a prefix property), so raising the game target never
 * reshuffles the games already played.
 */
export function seedScheduleFor(identity) {
  if (!isRecord(identity)) {
    fail("simulation_seed_input_invalid", "a seed schedule needs a stratum identity", {});
  }
  const unexpected = Object.keys(identity).filter((key) => !SEED_IDENTITY_KEYS.includes(key));
  if (unexpected.length > 0) {
    fail("simulation_seed_input_invalid", "a seed schedule accepts only the comparison seed and stratum identity", {
      unexpected,
    });
  }
  const { comparisonSeed, archetypeId, opponentGameplayHash, seat, count } = identity;
  if (!Number.isSafeInteger(comparisonSeed) || comparisonSeed <= 0) {
    fail("simulation_seed_input_invalid", "the comparison seed must be an explicit positive integer", {
      field: "comparisonSeed",
    });
  }
  if (typeof archetypeId !== "string" || archetypeId.length === 0) {
    fail("simulation_seed_input_invalid", "a seed schedule needs a canonical archetype id", { field: "archetypeId" });
  }
  if (!isFullHash(opponentGameplayHash)) {
    fail("simulation_seed_input_invalid", "a seed schedule needs the representative's gameplay hash", {
      field: "opponentGameplayHash",
    });
  }
  if (!SEATS.includes(seat)) {
    fail("simulation_seed_input_invalid", "a seed schedule needs a play or draw seat", { field: "seat" });
  }
  if (!Number.isSafeInteger(count) || count <= 0) {
    fail("simulation_seed_input_invalid", "a seed schedule needs a positive game count", { field: "count" });
  }

  const digest = sha256Canonical({
    schemaVersion: 1,
    purpose: "environment-seed-schedule",
    comparisonSeed,
    archetypeId,
    opponentGameplayHash,
    seat,
  });
  const state = Number.parseInt(digest.slice(7, 15), 16) >>> 0;
  const next = createXorshift32(state === 0 ? 0x9e3779b9 : state | 0);
  const seeds = [];
  const seen = new Set();
  // 2**31 - 1 keeps every seed a positive 32-bit value: the engine's own seed is a 32-bit integer.
  const modulus = 2 ** 31 - 1;
  while (seeds.length < count) {
    const seed = (next() % modulus) + 1;
    if (seen.has(seed)) continue;
    seen.add(seed);
    seeds.push(seed);
  }
  return Object.freeze(seeds);
}

/* ------------------------------------------------------------------ *
 * the resolved boundary
 * ------------------------------------------------------------------ */

function assertResolvedEnvironment(resolved) {
  if (!isRecord(resolved)) {
    fail("simulation_plan_invalid", "a simulation plan needs a resolved environment", { reason: "not_an_object" });
  }
  const unexpected = Object.keys(resolved).filter((key) => !RESOLVED_KEYS.includes(key));
  if (unexpected.length > 0) {
    fail("simulation_plan_invalid", "the resolved environment carries an unrecognized field", {
      reason: "unknown_resolved_key",
      unexpected,
    });
  }
  const missing = RESOLVED_KEYS.filter((key) => resolved[key] === undefined);
  if (missing.length > 0) {
    fail("simulation_plan_invalid", "the resolved environment is missing a required field", {
      reason: "resolved_field_missing",
      missing,
    });
  }
  if (resolved.schemaVersion !== 1) {
    fail("simulation_plan_invalid", "unsupported resolved-environment schemaVersion", {
      reason: "schema_unsupported",
      schemaVersion: resolved.schemaVersion,
    });
  }
  if (!isRecord(resolved.manifestRef) || !isSafeArtifactId(resolved.manifestRef.manifestId)
    || !isFullHash(resolved.manifestRef.contentHash)) {
    fail("simulation_plan_invalid", "the resolved environment names no immutable Manifest", {
      reason: "manifest_ref_invalid",
    });
  }
  if (!isRecord(resolved.candidateDeckRef) || !isSafeArtifactId(resolved.candidateDeckRef.snapshotId)
    || !isFullHash(resolved.candidateDeckRef.contentHash) || !isFullHash(resolved.candidateGameplayHash)) {
    fail("simulation_plan_invalid", "the resolved environment names no exact candidate deck", {
      reason: "candidate_ref_invalid",
    });
  }
  if (!isRecord(resolved.matchupEvidence) || resolved.matchupEvidence.method !== "simulated") {
    fail("matchup_provenance_invalid", "a simulation plan can only be expanded from simulated evidence", {
      reason: "method_not_simulated",
      method: resolved.matchupEvidence?.method ?? null,
    });
  }
  if (!["official", "proxy", "diagnostic_estimate"].includes(resolved.evaluationMode)) {
    fail("simulation_plan_invalid", "unrecognized evaluation mode", {
      reason: "evaluation_mode_invalid",
      evaluationMode: resolved.evaluationMode,
    });
  }
  if (!Array.isArray(resolved.blockers) || !Array.isArray(resolved.warnings)) {
    fail("simulation_plan_invalid", "the resolved environment must state its blockers and warnings", {
      reason: "blockers_invalid",
    });
  }
  // A diagnostic estimate is only ever produced on explicit request AND always names what blocked
  // it; an official or proxy result may never carry a blocker. Either contradiction is refused
  // rather than relabelled, because the label is the whole claim.
  if (resolved.evaluationMode === "diagnostic_estimate" && resolved.blockers.length === 0) {
    fail("simulation_plan_invalid", "a diagnostic estimate must name the blockers that caused it", {
      reason: "diagnostic_without_blockers",
    });
  }
  if (resolved.evaluationMode !== "diagnostic_estimate" && resolved.blockers.length > 0) {
    fail("simulation_plan_invalid", "an official or proxy environment can never carry a blocker", {
      reason: "official_with_blockers",
      blockers: resolved.blockers.map((blocker) => blocker?.code ?? null),
    });
  }
  const floor = resolved.minimumCompletedGamesPerSeat;
  if (!Number.isSafeInteger(floor) || floor < MINIMUM_COMPLETED_GAMES_PER_SEAT) {
    fail("simulation_plan_invalid", "the per-seat completed-game target is below the v1 floor", {
      reason: "completed_game_target_below_floor",
      minimumCompletedGamesPerSeat: floor,
      floor: MINIMUM_COMPLETED_GAMES_PER_SEAT,
    });
  }
  assertExactCoverage(resolved.strata);
  parseEnvironmentKey(resolved.environmentKey);
  return resolved;
}

function assertSettings(settings) {
  if (!isRecord(settings)) {
    fail("simulation_settings_invalid", "explicit simulation settings are required", { reason: "not_an_object" });
  }
  const unexpected = Object.keys(settings).filter((key) => !SETTINGS_KEYS.includes(key));
  if (unexpected.length > 0) {
    fail("simulation_settings_invalid", "simulation settings accept no unlisted field, and never a path", {
      reason: "unknown_setting",
      unexpected,
    });
  }
  for (const field of SETTINGS_SCALARS) {
    if (settings[field] === undefined) {
      fail("simulation_settings_invalid", `simulation settings must state ${field} explicitly`, { field });
    }
  }
  for (const field of ["strategyCandidate", "strategyOpponent", "engineRevision"]) {
    if (typeof settings[field] !== "string" || settings[field].length === 0) {
      fail("simulation_settings_invalid", `${field} must be a non-empty string`, { field });
    }
  }
  for (const field of ["maxCommands", "maxTurns", "comparisonSeed"]) {
    if (!Number.isSafeInteger(settings[field]) || settings[field] <= 0) {
      fail("simulation_settings_invalid", `${field} must be a positive safe integer`, { field });
    }
  }
  if (!Array.isArray(settings.opponentDecks) || settings.opponentDecks.length === 0) {
    fail("simulation_settings_invalid", "the representative DeckSnapshots must be supplied", {
      field: "opponentDecks",
    });
  }
  return settings;
}

/**
 * A verified DeckSnapshot turned into Task 10's closed five-field deck payload. `verifySnapshot`
 * recomputes the snapshot's own content hash, and Task 10's assertDeckInput then recomputes the
 * gameplay hash from THIS payload, so the deck the engine plays is bound at both ends.
 */
function materializeDeck(deck, ref, gameplayHash, { field }) {
  verifySnapshot(deck);
  if (deck.kind !== "deck") {
    fail("simulation_plan_invalid", `${field} is not a deck snapshot`, { field, kind: deck.kind });
  }
  if (deck.snapshotId !== ref.snapshotId || deck.contentHash !== ref.contentHash) {
    fail("simulation_plan_invalid", `${field} is not the deck this environment pinned`, {
      field,
      reason: field === "candidate" ? "candidate_deck_mismatch" : "representative_deck_mismatch",
    });
  }
  if (deck.data?.gameplayHash !== gameplayHash) {
    fail("simulation_plan_invalid", `${field}'s gameplay hash does not match the pinned hash`, {
      field,
      reason: field === "candidate" ? "candidate_deck_mismatch" : "representative_deck_mismatch",
    });
  }
  return {
    displayName: deck.data.displayName ?? null,
    leaderGameplayId: deck.data.leaderGameplayId,
    mainDeckCounts: { ...deck.data.mainDeckCounts },
    artifactHash: deck.contentHash,
    gameplayHash: deck.data.gameplayHash,
  };
}

/* ------------------------------------------------------------------ *
 * expansion
 * ------------------------------------------------------------------ */

export function expandSimulationPlan(resolved, candidateDeck, rawSettings) {
  assertResolvedEnvironment(resolved);
  const settings = assertSettings(rawSettings);
  const identity = parseEnvironmentKey(resolved.environmentKey);

  const candidate = materializeDeck(
    candidateDeck,
    resolved.candidateDeckRef,
    resolved.candidateGameplayHash,
    { field: "candidate" },
  );

  const decksById = new Map();
  for (const deck of settings.opponentDecks) {
    if (!isRecord(deck) || typeof deck.snapshotId !== "string") {
      fail("simulation_settings_invalid", "every representative deck must be a DeckSnapshot", {
        field: "opponentDecks",
      });
    }
    decksById.set(deck.snapshotId, deck);
  }

  const completedGameTarget = resolved.minimumCompletedGamesPerSeat;
  const scalarSettings = Object.fromEntries(SETTINGS_SCALARS.map((key) => [key, settings[key]]));
  const strata = resolved.strata.map((row) => ({
    archetypeId: row.archetypeId,
    fieldWeight: row.fieldWeight,
    representatives: row.representatives.map((representative) => ({
      deckRef: { ...representative.deckRef },
      gameplayHash: representative.gameplayHash,
      withinArchetypeWeight: representative.withinArchetypeWeight,
    })),
  }));

  // planHash covers every immutable input and every setting -- including the candidate deck, which
  // is what keeps a baseline and its variant on distinct plan hashes while they share seeds.
  const planHash = sha256Canonical({
    schemaVersion: 1,
    kind: SIMULATION_PLAN_KIND,
    manifestRef: { ...resolved.manifestRef },
    environmentKey: resolved.environmentKey,
    evaluationMode: resolved.evaluationMode,
    candidate: {
      deckRef: { ...resolved.candidateDeckRef },
      gameplayHash: resolved.candidateGameplayHash,
    },
    settings: scalarSettings,
    completedGameTarget,
    seats: [...SEATS],
    strata,
  });

  const jobs = [];
  for (const row of strata) {
    for (const representative of row.representatives) {
      const opponentDeck = decksById.get(representative.deckRef.snapshotId);
      if (opponentDeck === undefined) {
        fail("missing_representative_deck", "a representative deck snapshot was not supplied", {
          archetypeId: row.archetypeId,
          deckSnapshotId: representative.deckRef.snapshotId,
        });
      }
      const opponent = materializeDeck(
        opponentDeck,
        representative.deckRef,
        representative.gameplayHash,
        { field: "opponent" },
      );
      for (const seat of SEATS) {
        const seeds = seedScheduleFor({
          comparisonSeed: settings.comparisonSeed,
          archetypeId: row.archetypeId,
          opponentGameplayHash: representative.gameplayHash,
          seat,
          count: completedGameTarget,
        });
        const plan = {
          schemaVersion: 1,
          kind: "environment-simulation-job-plan",
          fixedSeat: seat,
          seeds: [...seeds],
          completedGameTarget,
          strategyCandidate: settings.strategyCandidate,
          strategyOpponent: settings.strategyOpponent,
          engineRevision: settings.engineRevision,
          maxCommands: settings.maxCommands,
          maxTurns: settings.maxTurns,
        };
        plan.planHash = computePlanHash(plan);
        const job = {
          schemaVersion: 1,
          kind: "environment-simulation-job",
          plan,
          candidate: { ...candidate, mainDeckCounts: { ...candidate.mainDeckCounts } },
          opponent: { ...opponent, mainDeckCounts: { ...opponent.mainDeckCounts } },
        };
        job.jobId = computeJobId(job);
        validateEnvironmentJob(job);
        jobs.push({
          pairingKey: pairingKeyFor({
            archetypeId: row.archetypeId,
            opponentGameplayHash: representative.gameplayHash,
            seat,
          }),
          archetypeId: row.archetypeId,
          opponentGameplayHash: representative.gameplayHash,
          opponentDeckRef: { ...representative.deckRef },
          fieldWeight: row.fieldWeight,
          withinArchetypeWeight: representative.withinArchetypeWeight,
          seat,
          seeds: [...seeds],
          job,
        });
      }
    }
  }

  return freezeDeep({
    schemaVersion: 1,
    kind: SIMULATION_PLAN_KIND,
    planHash,
    requestedEnvironment: resolved.requestedEnvironment,
    environmentKey: resolved.environmentKey,
    identity,
    manifestRef: { ...resolved.manifestRef },
    evaluationMode: resolved.evaluationMode,
    officialStrengthClaim: resolved.evaluationMode === "official",
    method: "simulated",
    applicability: resolved.matchupEvidence.applicability,
    candidate: {
      deckRef: { ...resolved.candidateDeckRef },
      gameplayHash: resolved.candidateGameplayHash,
      artifactHash: candidate.artifactHash,
      displayName: candidate.displayName,
      leaderGameplayId: candidate.leaderGameplayId,
    },
    settings: scalarSettings,
    completedGameTarget,
    turnOrderWeights: { ...resolved.turnOrderWeights },
    capabilityRef: { ...resolved.capabilityRef },
    clockRef: resolved.clockRef === null ? null : { ...resolved.clockRef },
    roundTimeoutPolicy: resolved.roundTimeoutPolicy === null ? null : { ...resolved.roundTimeoutPolicy },
    marketRefs: resolved.marketRefs.map((ref) => ({ ...ref })),
    references: Object.fromEntries(Object.entries(resolved.references).map(([key, ref]) => [key, { ...ref }])),
    blockers: resolved.blockers.map((blocker) => ({ ...blocker })),
    warnings: resolved.warnings.map((warning) => ({ ...warning })),
    strata,
    jobs,
  });
}

/* ------------------------------------------------------------------ *
 * job files
 * ------------------------------------------------------------------ */

const JOB_ARTIFACT_CONTRACT = Object.freeze({ verify: validateEnvironmentJob, idKey: "jobId" });

/**
 * Writes one job to its plan-private cache path through the store's own atomic, restrictive,
 * fsynced, no-clobber protocol, then reads it BACK and compares canonical bytes. The readback is not
 * belt-and-braces: a job envelope carries no contentHash field of its own (Task 10's key set is
 * closed), so the store's hash-equality check cannot see a difference in a field jobId does not
 * cover -- displayName being the real one.
 */
export function materializeJobFile(plan, entry, { cacheRoot, io = realIo } = {}) {
  const directory = jobCacheDirectoryFor(cacheRoot, plan.planHash);
  const target = join(directory, `${safeIdOf(entry.job.jobId, "jobId")}.json`);
  publishImmutableArtifact(target, entry.job, io, JOB_ARTIFACT_CONTRACT);
  let onDisk;
  try {
    onDisk = validateEnvironmentJob(JSON.parse(io.readFile(target, "utf8")));
  } catch (error) {
    fail("environment_job_exists", "the materialized job file could not be read back", {
      cause: error?.code ?? "unreadable",
    });
  }
  if (canonicalJson(onDisk).toString("utf8") !== canonicalJson(entry.job).toString("utf8")) {
    fail("environment_job_exists", "a different job is already published at this job path", {
      jobId: entry.job.jobId,
    });
  }
  return target;
}

/* ------------------------------------------------------------------ *
 * result validation
 * ------------------------------------------------------------------ */

function assertNotLegacyOrArena(value) {
  if (!isRecord(value)) return;
  if (LEGACY_LAST_RUN_MARKERS.some((key) => Object.hasOwn(value, key))
    || (Object.hasOwn(value, "deckA") && Object.hasOwn(value, "deckB"))) {
    fail("legacy_evidence_rejected", "the legacy sim/results summary is not environment evidence", {
      reason: "legacy_last_run_summary",
    });
  }
  if (ARENA_MARKERS.some((key) => Object.hasOwn(value, key))) {
    fail("legacy_evidence_rejected", "an arena decision log is not environment evidence", {
      reason: "arena_decision_log",
    });
  }
}

/** Wins, losses and excluded rows, counted from the per-game rows rather than trusted. */
export function countJobResult(result) {
  const counts = { wins: 0, losses: 0, scoredRoundTimeouts: 0, unfinished: 0, toolFailures: 0 };
  for (const game of result.games) {
    if (game.outcome === "win") counts.wins += 1;
    else if (game.outcome === "loss") counts.losses += 1;
    else if (game.outcome === "round_timeout") counts.scoredRoundTimeouts += 1;
    else if (game.outcome === "unfinished") counts.unfinished += 1;
    else counts.toolFailures += 1;
  }
  counts.validGames = counts.wins + counts.losses + counts.scoredRoundTimeouts;
  counts.sampleSize = counts.validGames + counts.unfinished + counts.toolFailures;
  return counts;
}

/**
 * Task 10's raw-result contract plus the three checks Task 11 owns: this is not some other result
 * file; the envelope has no unrecognized field; and no engine-unfinished or tool-failure row is
 * present at all. That last rule is deliberately NOT a floor check: a batch that met its 200-game
 * floor and also abandoned two games is a biased subset, so the whole cell is invalidated and a
 * clean replacement job is required.
 *
 * `requireScoreableCell` defaults to TRUE (fix round 1): a bare two-argument call is the shape a
 * caller reaches for, and it used to accept a result carrying a tool_failure row. The lenient path
 * stays available for the one caller that genuinely wants to ask "would Task 10 accept this?"
 * separately from "is this scoreable?", but it must now be requested explicitly.
 */
export function validateJobResult(job, result, { requireScoreableCell = true } = {}) {
  assertNotLegacyOrArena(result);
  if (!isRecord(result)) mismatch("malformed_envelope");
  const unexpected = Object.keys(result).filter((key) => !RAW_RESULT_KEYS.includes(key));
  if (unexpected.length > 0) mismatch("unknown_result_key", { unexpected });

  try {
    validateRawJobResult(job, result);
  } catch (error) {
    // Task 10 throws plain Errors with a stable `.code` and `.details.reason`; re-raise them as this
    // domain's EnvironmentError without inventing or losing a discriminator.
    if (error?.code === "simulation_result_mismatch") {
      fail("simulation_result_mismatch", error.details?.reason ?? "malformed_envelope", { ...error.details });
    }
    fail("simulation_result_mismatch", error?.code ?? "malformed_envelope", {
      reason: error?.code ?? "malformed_envelope",
    });
  }

  if (requireScoreableCell) {
    const counts = countJobResult(result);
    if (counts.unfinished > 0 || counts.toolFailures > 0) {
      fail("insufficient_matchup_coverage", "an unfinished or tool-failure row invalidates the whole matchup cell", {
        reason: "cell_invalidated_by_unfinished_row",
        validGames: counts.validGames,
        unfinished: counts.unfinished,
        toolFailures: counts.toolFailures,
      });
    }
  }
  return result;
}

/* ------------------------------------------------------------------ *
 * round-timeout adjudication
 * ------------------------------------------------------------------ */

/**
 * Re-labels the named seeds as `round_timeout` under an ACCEPTED clock authorization.
 *
 * Task 10's raw contract forbids `round_timeout` outright, so a timeout can only ever enter here,
 * behind this gate. The two refusals that matter: without an accepted matching ClockModel nothing is
 * adjudicable (`clock_model_hash`), and a row the engine did not finish under the rules can never
 * become a tournament timeout (`round_timeout_from_non_rules_row`) -- a turn budget, a command
 * ceiling, repeated state, an illegal command and a crashed process are all excluded by that one
 * rule, because none of them carries `terminationCause: "rules-win"`.
 */
export function applyRoundTimeoutAdjudication(result, cell, authorization) {
  const timedOutSeeds = cell?.timedOutSeeds ?? [];
  if (!Array.isArray(timedOutSeeds)) {
    mismatch("round_timeout_adjudication_invalid", { cause: "timedOutSeeds_not_an_array" });
  }
  if (timedOutSeeds.length === 0) return result;
  assertRoundTimeoutAuthorized(authorization, authorization);

  const seen = new Set();
  const wanted = new Set();
  for (const seed of timedOutSeeds) {
    if (!Number.isSafeInteger(seed)) mismatch("round_timeout_adjudication_invalid", { cause: "seed_not_an_integer" });
    if (seen.has(seed)) mismatch("round_timeout_seed_duplicate", { seed });
    seen.add(seed);
    wanted.add(seed);
  }
  const played = new Set(result.games.map((game) => game.seed));
  for (const seed of wanted) {
    if (!played.has(seed)) mismatch("round_timeout_seed_unknown", { seed });
  }

  const games = result.games.map((game) => {
    if (!wanted.has(game.seed)) return { ...game };
    if (game.terminationCause !== "rules-win" || (game.outcome !== "win" && game.outcome !== "loss")) {
      mismatch("round_timeout_from_non_rules_row", {
        seed: game.seed,
        outcome: game.outcome,
        terminationCause: game.terminationCause,
      });
    }
    return {
      ...game,
      outcome: "round_timeout",
      terminationCause: "round_timeout",
      // The rules result the engine itself reached, retained rather than overwritten: the clock model
      // decided the round would not have finished in time, it did not decide who was winning.
      engineOutcome: game.outcome,
      roundTimeoutClockHash: authorization.clockModelRef.contentHash,
    };
  });
  const adjudicated = { ...result, games, rawResultHash: result.resultHash };
  delete adjudicated.resultHash;
  return adjudicated;
}

/* ------------------------------------------------------------------ *
 * execution
 * ------------------------------------------------------------------ */

/**
 * The real runner: `scripts/simulate.sh --job JOB --out OUT`, a FIXED argument array with
 * `shell: false`, exit 0 success / non-zero failure. It is the same interface the offline fake
 * runner presents, which is what lets every automated test stay off the vendored engine (~2-4
 * games/s, so one 4-job plan is ~800 games of real engine time).
 */
export function createSimulateShRunner({ repoRoot, timeoutMs = 4 * 60 * 60 * 1000 } = {}) {
  if (typeof repoRoot !== "string" || repoRoot.length === 0) {
    fail("simulation_not_ready", "the real runner needs an explicit repository root", { field: "repoRoot" });
  }
  return {
    name: "scripts/simulate.sh",
    run({ jobPath, outPath }) {
      const result = spawnSync(
        join(repoRoot, "scripts", "simulate.sh"),
        ["--job", jobPath, "--out", outPath],
        { shell: false, encoding: "utf8", cwd: repoRoot, timeout: timeoutMs },
      );
      if (result.error) return { status: "failed", exitCode: -1, stderr: String(result.error.message) };
      return {
        status: result.status === 0 ? "ok" : "failed",
        exitCode: result.status ?? -1,
        stderr: result.stderr ?? "",
      };
    },
  };
}

function readExistingResult(target, io) {
  try {
    const stats = io.stat(target);
    if (!stats.isFile()) mismatch("existing_result_differs", { cause: "not_a_regular_file" });
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
  try {
    return verifySnapshot(JSON.parse(io.readFile(target, "utf8")));
  } catch (error) {
    mismatch("existing_result_differs", { cause: error?.code ?? "unreadable" });
  }
  return null;
}

function existingMatchesJob(existing, plan, entry) {
  const simulation = existing?.data?.simulation;
  if (!isRecord(simulation)) return false;
  if (existing.kind !== "matchup" || existing.data.method !== "simulated") return false;
  if (simulation.jobId !== entry.job.jobId || simulation.planHash !== plan.planHash) return false;
  if (simulation.engineRevision !== plan.settings.engineRevision) return false;
  if (simulation.strategyCandidate !== plan.settings.strategyCandidate) return false;
  if (simulation.strategyOpponent !== plan.settings.strategyOpponent) return false;
  if (simulation.maxCommands !== plan.settings.maxCommands) return false;
  if (simulation.maxTurns !== plan.settings.maxTurns) return false;
  if (simulation.completedGameTarget !== plan.completedGameTarget) return false;
  if (existing.data.pairingKey !== entry.pairingKey) return false;
  const seeds = existing.data.games?.map((game) => game.seed) ?? [];
  return seeds.length === entry.seeds.length && seeds.every((seed, index) => seed === entry.seeds[index]);
}

function invokeRunner(runner, request) {
  if (!isRecord(runner) && typeof runner?.run !== "function") {
    fail("simulation_not_ready", "an injectable runner with a run(request) function is required", {
      reason: "runner_missing",
    });
  }
  let outcome;
  try {
    outcome = runner.run(request);
  } catch (error) {
    if (error instanceof EnvironmentError) throw error;
    fail("simulation_not_ready", "the simulation runner threw", {
      reason: "runner_failed",
      cause: error?.code ?? "threw",
    });
  }
  if (!isRecord(outcome) || outcome.status !== "ok" || outcome.exitCode !== 0) {
    fail("simulation_not_ready", "the simulation runner did not succeed", {
      reason: "runner_failed",
      status: outcome?.status ?? null,
      exitCode: outcome?.exitCode ?? null,
    });
  }
  return outcome;
}

function readRawOutput(outPath, io) {
  let text;
  try {
    text = io.readFile(outPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      mismatch("output_absent", { cause: error.code });
    }
    mismatch("output_unreadable", { cause: error?.code ?? "unreadable" });
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    mismatch("output_unreadable", { cause: "json_invalid" });
  }
  return null;
}

export function executeSimulationPlan(plan, options = {}) {
  if (!isRecord(plan) || plan.kind !== SIMULATION_PLAN_KIND) {
    fail("simulation_plan_invalid", "executeSimulationPlan needs an expanded simulation plan", {
      reason: "not_a_plan",
    });
  }
  const unexpected = Object.keys(options).filter((key) => !EXECUTE_OPTION_KEYS.includes(key));
  if (unexpected.length > 0) {
    fail("simulation_plan_invalid", "executeSimulationPlan accepts no unlisted option", {
      reason: "unknown_option",
      unexpected,
    });
  }
  const { runner, cacheRoot, resultsRoot, now, timeoutAdjudication = null } = options;
  const io = { ...realIo, ...(options.io ?? {}) };
  for (const [field, value] of [["cacheRoot", cacheRoot], ["resultsRoot", resultsRoot]]) {
    if (typeof value !== "string" || value.length === 0) {
      fail("simulation_plan_invalid", `${field} must be an explicit injected path`, { field });
    }
  }
  // This library never reads host clock time; a caller that forgets `now` fails closed. It is used
  // only as display metadata on the returned run record and never enters any hash.
  if (typeof now !== "string" || !RFC3339_PATTERN.test(now)) {
    fail("simulation_plan_invalid", "executeSimulationPlan requires an explicit RFC 3339 now instant", {
      field: "now",
    });
  }

  const authorization = clockAuthorizationFor(plan);
  if (timeoutAdjudication !== null) {
    if (!isRecord(timeoutAdjudication) || !isRecord(timeoutAdjudication.cells)) {
      fail("simulation_plan_invalid", "a timeout adjudication must name its clock model and its cells", {
        reason: "timeout_adjudication_invalid",
      });
    }
    // I2 (fix round 1): authorization is required whenever an adjudication is supplied AT ALL, not
    // only when it happens to name a timed-out seed. An adjudication that ran and found nothing is a
    // real measurement and must be just as authorized as one that found five -- otherwise "we
    // measured zero" could be claimed against a clock model this environment never accepted.
    assertRoundTimeoutAuthorized(timeoutAdjudication, authorization);
    // ...and it must cover EVERY cell, or a partial adjudication would be reported as though the
    // whole field had been adjudicated.
    const missing = plan.jobs
      .map((entry) => entry.pairingKey)
      .filter((key) => !isRecord(timeoutAdjudication.cells[key]));
    if (missing.length > 0) {
      fail("simulation_result_mismatch", "the timeout adjudication does not cover every stratum and seat", {
        reason: "round_timeout_adjudication_incomplete",
        missingCells: missing.length,
      });
    }
    // I-4 (final fix wave): presence is not evidence of work. `applied` used to be
    // `timeoutAdjudication !== null`, so an adjudication whose every cell was `{ timedOutSeeds: [] }`
    // minted `officialStrengthClaim: true` with `blockers: []`. You did not have to forge a verdict
    // -- you had to supply none. Each cell must therefore state how many completed games the clock
    // model actually EVALUATED, and that number is cross-checked against the games the cell really
    // played (below, once they exist). "The model ran and found nothing" stays expressible --
    // evaluatedSeeds = every game, timedOutSeeds = none -- while an empty block does not.
    const unevaluated = plan.jobs
      .map((entry) => timeoutAdjudication.cells[entry.pairingKey])
      .filter((cell) => !Number.isSafeInteger(cell.evaluatedSeeds) || cell.evaluatedSeeds < 0);
    if (unevaluated.length > 0) {
      fail("simulation_plan_invalid", "every adjudicated cell must state how many completed games it evaluated", {
        reason: "round_timeout_adjudication_unevaluated",
        unevaluatedCells: unevaluated.length,
      });
    }
  }

  mkdirSync(jobCacheDirectoryFor(cacheRoot, plan.planHash), { recursive: true, mode: 0o700 });
  mkdirSync(join(resultsRoot, plan.manifestRef.manifestId), { recursive: true, mode: 0o755 });

  const results = [];
  for (const entry of plan.jobs) {
    const target = jobResultPathFor(resultsRoot, plan.manifestRef.manifestId, entry.job.jobId);

    // PRE-CHECK, before a single game is played (Task 10's known M4).
    const existing = readExistingResult(target, io);
    if (existing !== null) {
      if (!existingMatchesJob(existing, plan, entry)) {
        mismatch("existing_result_differs", { jobId: entry.job.jobId });
      }
      results.push(recordFor(plan, entry, existing, { reused: true, path: target }));
      continue;
    }

    const jobPath = materializeJobFile(plan, entry, { cacheRoot, io });
    const outPath = join(
      jobCacheDirectoryFor(cacheRoot, plan.planHash),
      `.raw-${safeIdOf(entry.job.jobId, "jobId")}.${process.pid}.json`,
    );
    try {
      statSync(outPath);
      mismatch("raw_output_exists", { cause: "stale_raw_output" });
    } catch (error) {
      if (error instanceof EnvironmentError) throw error;
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
    }

    invokeRunner(runner, { job: entry.job, jobPath, outPath });
    const raw = readRawOutput(outPath, io);
    validateJobResult(entry.job, raw, { requireScoreableCell: true });
    const adjudicated = applyRoundTimeoutAdjudication(
      raw,
      timeoutAdjudication === null ? null : timeoutAdjudication.cells[entry.pairingKey] ?? null,
      authorization,
    );
    const snapshot = snapshotFor(plan, entry, adjudicated, raw, authorization);
    publishImmutableArtifact(target, snapshot, io, SNAPSHOT_ARTIFACT_CONTRACT);
    results.push(recordFor(plan, entry, snapshot, { reused: false, path: target }));
  }

  // I2 (fix round 1): the run says whether an adjudicator RAN, so a report can distinguish a
  // measured zero from a never-measured zero. `applied` is about the adjudicator, not about whether
  // it found anything: an adjudication covering every cell with no timed-out seeds is applied.
  const adjudicatedSeeds = timeoutAdjudication === null
    ? 0
    : Object.values(timeoutAdjudication.cells)
      .reduce((total, cell) => total + (cell?.timedOutSeeds ?? []).length, 0);
  // I-4: the declared per-cell evaluation is reconciled against the completed games the cell
  // actually produced -- reused cache hits included, since a re-run over cached results is exactly
  // where a stale adjudication would otherwise be re-asserted over games it never saw.
  let evaluatedSeeds = 0;
  if (timeoutAdjudication !== null) {
    for (const record of results) {
      const declared = timeoutAdjudication.cells[record.pairingKey].evaluatedSeeds;
      if (declared !== record.cell.validGames) {
        mismatch("round_timeout_evaluated_seed_count_mismatch", {
          pairingKey: record.pairingKey,
          declared,
          completedGames: record.cell.validGames,
        });
      }
      evaluatedSeeds += declared;
    }
  }
  return freezeDeep({
    plan,
    executedAt: now,
    runner: typeof runner?.name === "string" ? runner.name : "unnamed",
    timeoutAdjudication: {
      applied: timeoutAdjudication !== null,
      // N1 (fix round 2): the FULL eight-dimension authorization is recorded, not a readable
      // subset, so aggregateEnvironment can re-authenticate this block with the same
      // assertRoundTimeoutAuthorized the execute path used rather than trusting it.
      source: timeoutAdjudication === null ? null : {
        clockModelRef: { ...timeoutAdjudication.clockModelRef },
        edition: timeoutAdjudication.edition,
        metagameRegion: timeoutAdjudication.metagameRegion,
        language: timeoutAdjudication.language,
        formatId: timeoutAdjudication.formatId,
        stage: timeoutAdjudication.stage,
        roundDurationMinutes: timeoutAdjudication.roundDurationMinutes,
        timeoutScoring: timeoutAdjudication.timeoutScoring,
      },
      adjudicatedCells: timeoutAdjudication === null ? 0 : Object.keys(timeoutAdjudication.cells).length,
      adjudicatedSeeds,
      evaluatedSeeds,
    },
    results,
  });
}

function snapshotFor(plan, entry, adjudicated, raw, authorization) {
  const counts = countJobResult(adjudicated);
  const cell = {
    candidateDeckSnapshotId: plan.candidate.deckRef.snapshotId,
    candidateContentHash: plan.candidate.deckRef.contentHash,
    candidateGameplayHash: plan.candidate.gameplayHash,
    opponentDeckSnapshotId: entry.opponentDeckRef.snapshotId,
    opponentContentHash: entry.opponentDeckRef.contentHash,
    opponentGameplayHash: entry.opponentGameplayHash,
    candidateSeat: entry.seat,
    wins: counts.wins,
    losses: counts.losses,
    scoredRoundTimeouts: counts.scoredRoundTimeouts,
    validGames: counts.validGames,
    sampleSize: counts.sampleSize,
    unfinished: counts.unfinished,
    toolFailures: counts.toolFailures,
    roundTimeout: counts.scoredRoundTimeouts > 0 ? { ...authorization } : null,
    games: adjudicated.games,
  };
  return buildSimulatedMatchupSnapshot({
    resolved: {
      environmentKey: plan.environmentKey,
      manifestRef: plan.manifestRef,
      matchupEvidence: { method: "simulated", applicability: plan.applicability },
      evaluationMode: plan.evaluationMode,
      clockRef: plan.clockRef,
    },
    archetypeId: entry.archetypeId,
    seat: entry.seat,
    cell,
    context: {
      method: "simulated",
      applicability: plan.applicability,
      formatId: plan.identity.formatId,
      stage: plan.roundTimeoutPolicy === null ? "unclocked" : plan.roundTimeoutPolicy.stage,
      timeoutScoring: plan.roundTimeoutPolicy === null ? "unscoreable" : plan.roundTimeoutPolicy.timeoutScoring,
      population: `simulated field of ${plan.environmentKey}`,
      window: {
        startLocalDate: plan.identity.asOf,
        asOf: plan.identity.asOf,
        timeZone: plan.identity.timeZone,
      },
      minimumCompletedGamesPerSeat: plan.completedGameTarget,
      clock: counts.scoredRoundTimeouts > 0 ? authorization : null,
      simulation: {
        manifestRef: plan.manifestRef,
        planHash: plan.planHash,
        jobId: entry.job.jobId,
        jobPlanHash: entry.job.plan.planHash,
        rawResultHash: raw.resultHash,
        engineRevision: plan.settings.engineRevision,
        strategyCandidate: plan.settings.strategyCandidate,
        strategyOpponent: plan.settings.strategyOpponent,
        maxCommands: plan.settings.maxCommands,
        maxTurns: plan.settings.maxTurns,
        comparisonSeed: plan.settings.comparisonSeed,
        completedGameTarget: plan.completedGameTarget,
        capabilityRef: plan.capabilityRef,
        seeds: entry.seeds,
      },
    },
    idStem: `matchup-simulated-${entry.seat}-${safeIdOf(entry.job.jobId, "jobId").slice(0, 12)}`,
  });
}

function recordFor(plan, entry, snapshot, { reused, path }) {
  return {
    pairingKey: entry.pairingKey,
    archetypeId: entry.archetypeId,
    opponentGameplayHash: entry.opponentGameplayHash,
    opponentDeckRef: entry.opponentDeckRef,
    fieldWeight: entry.fieldWeight,
    withinArchetypeWeight: entry.withinArchetypeWeight,
    seat: entry.seat,
    seeds: entry.seeds,
    jobId: entry.job.jobId,
    reused,
    path,
    cell: snapshot.data.cells[0],
    snapshot,
  };
}
