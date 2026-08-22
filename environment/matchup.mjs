// The matchup-evidence contract: what makes ONE cell of a matchup matrix scoreable.
//
// A cell is the smallest unit of deck-strength evidence in this design: one candidate deck against
// one representative opponent deck, at one fixed seat, in one environment. This module is where the
// project's two hardest-won evidence rules are enforced, and neither is negotiable downstream:
//
//   1. METHOD (observed | simulated) and APPLICABILITY (native | proxy) are SEPARATE axes. Neither
//      may be inferred from the other and cells of different method are never merged row-wise.
//   2. `round_timeout` is a TOURNAMENT outcome, not a computational one. It is scoreable only behind
//      a full accepted ClockModel matching on all eight dimensions (edition, metagame region,
//      language, format, stage, round duration, timeout policy, and the model's own content hash).
//      Under SC Swiss (官方公认赛赛事守则 V1.6.0 §II) a timed-out round is 双方败北 -- a double loss --
//      so it scores 0 for the candidate AND stays in the valid-game denominator. A turn budget, a
//      command ceiling, repeated state, an illegal command or a crashed process is NONE of that.
//
// This module is PURE: no filesystem, no clock, no child processes. It reads only what it is given.
import { EnvironmentError } from "./errors.mjs";
import { environmentKey } from "./manifest.mjs";
import { finalizeSnapshot, verifySnapshot } from "./snapshot.mjs";

export const MATCHUP_KIND = "matchup";

export const MATCHUP_ERROR_CODES = Object.freeze([
  "matchup_cell_invalid",
  "matchup_provenance_invalid",
  "matchup_snapshot_invalid",
  "insufficient_matchup_coverage",
  "simulation_result_mismatch",
  "environment_identity_mismatch",
]);

const METHODS = Object.freeze(["observed", "simulated"]);
const APPLICABILITIES = Object.freeze(["native", "proxy"]);
export const SEATS = Object.freeze(["play", "draw"]);

const FULL_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*-[0-9a-f]{16}$/;
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// The eight dimensions a ClockModel must match before it may authorize a round timeout. The hash is
// the eighth and is compared separately, because a hash mismatch means "a different model entirely"
// and gets its own reason code (the brief names it) rather than being one entry in a mismatch list.
const CLOCK_DIMENSIONS = Object.freeze([
  "edition",
  "metagameRegion",
  "language",
  "formatId",
  "stage",
  "roundDurationMinutes",
  "timeoutScoring",
]);

const DECK_IDENTITY_FIELDS = Object.freeze([
  "candidateDeckSnapshotId",
  "candidateContentHash",
  "candidateGameplayHash",
  "opponentDeckSnapshotId",
  "opponentContentHash",
  "opponentGameplayHash",
]);

const GAME_ROW_FIELDS = Object.freeze([
  "seed",
  "requestedSeat",
  "actualSeat",
  "aOnPlay",
  "outcome",
  "engineTermination",
  "terminationCause",
  "turns",
  "commands",
]);

const SIMULATION_PROVENANCE_FIELDS = Object.freeze([
  "engineRevision",
  "strategyCandidate",
  "strategyOpponent",
  "capabilityRef",
  "maxCommands",
  "maxTurns",
  "planHash",
  "jobId",
]);

function fail(code, message, details = {}) {
  const rendered = message.startsWith(`${code}:`) ? message : `${code}: ${message}`;
  throw new EnvironmentError(code, rendered, details);
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

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
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

/* ------------------------------------------------------------------ *
 * Shared deterministic primitives
 *
 * These two carry NO matchup semantics. They live here because Task 11's file list is fixed at
 * three modules and both `environment/simulation.mjs` (seed schedules) and
 * `environment/report.mjs` (bootstrap resampling, weighted EV) need exactly the same
 * implementation. One copy imported twice beats two copies that can silently diverge -- this
 * project has already been bitten by a replicated hash function. `report.mjs` re-exports both so
 * the public surface reads naturally.
 * ------------------------------------------------------------------ */

// Exact coverage: field shares and every within-archetype weight set must each sum to one. The
// tolerance is for IEEE-754 addition only (5/12 + 7/12 does not always land on exactly 1.0), never
// for a missing share. A partial field is refused, NEVER renormalized.
export const WEIGHT_TOLERANCE = 1e-12;

export function assertExactCoverage(strata) {
  if (!Array.isArray(strata) || strata.length === 0) {
    fail("field_not_representative", "an environment needs at least one field stratum", {
      reason: "no_strata",
    });
  }
  let fieldSum = 0;
  for (const row of strata) {
    if (!isRecord(row) || typeof row.archetypeId !== "string" || row.archetypeId.length === 0) {
      fail("field_not_representative", "a stratum has no canonical archetype", { reason: "archetype_missing" });
    }
    if (typeof row.fieldWeight !== "number" || !Number.isFinite(row.fieldWeight) || row.fieldWeight <= 0) {
      fail("field_not_representative", "a stratum has no positive field weight", {
        reason: "field_weight_invalid",
        archetypeId: row.archetypeId,
      });
    }
    fieldSum += row.fieldWeight;
    if (!Array.isArray(row.representatives) || row.representatives.length === 0) {
      fail("missing_representative_deck", "a stratum has no representative deck", {
        archetypeId: row.archetypeId,
      });
    }
    let representativeSum = 0;
    for (const representative of row.representatives) {
      if (
        !isRecord(representative)
        || typeof representative.withinArchetypeWeight !== "number"
        || !Number.isFinite(representative.withinArchetypeWeight)
        || representative.withinArchetypeWeight <= 0
      ) {
        fail("field_not_representative", "a representative has no positive within-archetype weight", {
          reason: "representative_weight_invalid",
          archetypeId: row.archetypeId,
        });
      }
      representativeSum += representative.withinArchetypeWeight;
    }
    if (Math.abs(representativeSum - 1) > WEIGHT_TOLERANCE) {
      fail("field_not_representative", "within-archetype representative weights must sum to exactly one", {
        reason: "representative_weights_unreconciled",
        archetypeId: row.archetypeId,
        sum: representativeSum,
      });
    }
  }
  if (Math.abs(fieldSum - 1) > WEIGHT_TOLERANCE) {
    fail("field_not_representative", "field weights must sum to exactly one; shares are never renormalized", {
      reason: "field_weights_unreconciled",
      sum: fieldSum,
    });
  }
  return strata;
}

/**
 * xorshift32. A 32-bit state PRNG with a fixed, documented recurrence: the same seed produces the
 * same stream on every host and every Node version, which is what makes both the seed schedules and
 * the bootstrap intervals reproducible rather than merely random. A zero state is a fixed point of
 * the recurrence (it would emit 0 forever), so it is refused rather than silently repaired.
 */
export function createXorshift32(seed) {
  if (!Number.isSafeInteger(seed) || (seed | 0) === 0) {
    fail("report_input_invalid", "a xorshift32 seed must be a non-zero 32-bit integer", { seed });
  }
  let state = seed | 0;
  return function next() {
    state ^= state << 13;
    state |= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state |= 0;
    return state >>> 0;
  };
}

/* ------------------------------------------------------------------ *
 * environmentKey: inverted, never invented
 * ------------------------------------------------------------------ */

/**
 * A resolved environment names its identity ONLY as the Manifest's colon-delimited
 * `environmentKey`. Rather than re-deriving an identity from somewhere else (or inventing one), this
 * inverts that key and then proves the inversion by running the Manifest's own forward function over
 * the result: if `environmentKey(parsed) !== key`, the parse is refused. The timezone is the only
 * component that can contain a slash and none can contain a colon, so the split is unambiguous.
 */
export function parseEnvironmentKey(key) {
  if (typeof key !== "string" || key.length === 0) {
    fail("environment_identity_mismatch", "an environment key must be a non-empty string", { key: null });
  }
  const parts = key.split(":");
  if (parts.length !== 6) {
    fail("environment_identity_mismatch", "an environment key has exactly six components", {
      reason: "component_count",
      components: parts.length,
    });
  }
  const [edition, metagameRegion, language, timeZone, formatId, asOf] = parts;
  const identity = { edition, metagameRegion, language, formatId, timeZone, asOf };
  let rebuilt;
  try {
    rebuilt = environmentKey(identity);
  } catch (error) {
    fail("environment_identity_mismatch", "an environment key does not describe a supported identity", {
      reason: "identity_unsupported",
      cause: error instanceof EnvironmentError ? error.code : "invalid",
    });
  }
  if (rebuilt !== key) {
    fail("environment_identity_mismatch", "an environment key does not round trip through its own grammar", {
      reason: "round_trip_failed",
    });
  }
  return freezeDeep({ ...identity });
}

/** The identity a snapshot envelope carries: the parsed key minus its asOf date. */
function envelopeIdentityOf(identity) {
  return {
    edition: identity.edition,
    metagameRegion: identity.metagameRegion,
    language: identity.language,
    formatId: identity.formatId,
    timeZone: identity.timeZone,
  };
}

/* ------------------------------------------------------------------ *
 * pairing keys
 * ------------------------------------------------------------------ */

/**
 * The stable identity of one matchup cell: archetype x representative deck x seat. It is the join
 * key for a paired variant comparison and the seed-schedule identity, so it deliberately contains
 * NOTHING about the candidate deck, the plan, or the job -- baseline and variant must produce the
 * same key for the same stratum or a paired comparison is impossible.
 */
export function pairingKeyFor({ archetypeId, opponentGameplayHash, seat } = {}) {
  if (typeof archetypeId !== "string" || archetypeId.length === 0) {
    fail("matchup_cell_invalid", "a pairing key needs a canonical archetype id", { field: "archetypeId" });
  }
  if (!isFullHash(opponentGameplayHash)) {
    fail("matchup_cell_invalid", "a pairing key needs the opponent's full gameplay hash", {
      field: "opponentGameplayHash",
    });
  }
  if (!SEATS.includes(seat)) {
    fail("matchup_cell_invalid", "a pairing key needs a play or draw seat", { field: "seat", seat });
  }
  return `${archetypeId}|${opponentGameplayHash}|${seat}`;
}

/* ------------------------------------------------------------------ *
 * clock authorization
 * ------------------------------------------------------------------ */

/**
 * The eight-dimension authorization a resolved environment carries for round timeouts, or `null`
 * when it carries none. `null` is the fail-closed default: the resolver sets `clockRef` and
 * `roundTimeoutPolicy` to null whenever the clock gate did not accept a model, so an environment
 * without an accepted clock can never score a timeout.
 */
export function clockAuthorizationFor(resolved) {
  if (!isRecord(resolved)) {
    fail("matchup_cell_invalid", "a clock authorization needs a resolved environment", { field: "resolved" });
  }
  const ref = resolved.clockRef;
  const policy = resolved.roundTimeoutPolicy;
  if (ref === null || ref === undefined || policy === null || policy === undefined) return null;
  if (!isRecord(ref) || !isSafeArtifactId(ref.snapshotId) || !isFullHash(ref.contentHash)) {
    fail("matchup_cell_invalid", "a clock reference needs a safe id and its full content hash", {
      field: "clockRef",
    });
  }
  if (!isRecord(policy) || typeof policy.stage !== "string" || typeof policy.timeoutScoring !== "string"
    || typeof policy.roundDurationMinutes !== "number" || !Number.isFinite(policy.roundDurationMinutes)) {
    fail("matchup_cell_invalid", "a round timeout policy needs a stage, duration and scoring rule", {
      field: "roundTimeoutPolicy",
    });
  }
  const identity = parseEnvironmentKey(resolved.environmentKey);
  return freezeDeep({
    clockModelRef: { snapshotId: ref.snapshotId, contentHash: ref.contentHash },
    edition: identity.edition,
    metagameRegion: identity.metagameRegion,
    language: identity.language,
    formatId: identity.formatId,
    stage: policy.stage,
    roundDurationMinutes: policy.roundDurationMinutes,
    timeoutScoring: policy.timeoutScoring,
  });
}

function clockMismatch(reason, extra) {
  throw new EnvironmentError(
    "simulation_result_mismatch",
    `simulation_result_mismatch: ${reason}`,
    { reason, ...extra },
  );
}

/**
 * The gate itself. `declared` is what the CELL claims authorized its timeouts; `authorization` is
 * what the resolved environment actually holds. An absent or differing hash is `clock_model_hash`
 * (the brief names this exact discriminator); a hash that matches while a dimension does not is
 * `clock_model_mismatch`, which is a different defect -- the right model, applied to the wrong
 * tournament.
 */
export function assertRoundTimeoutAuthorized(declared, authorization) {
  if (authorization === null || authorization === undefined) {
    clockMismatch("clock_model_hash", { cause: "no_accepted_clock_model" });
  }
  if (!isRecord(declared) || !isRecord(declared.clockModelRef)) {
    clockMismatch("clock_model_hash", { cause: "clock_model_not_declared" });
  }
  if (
    declared.clockModelRef.contentHash !== authorization.clockModelRef.contentHash
    || declared.clockModelRef.snapshotId !== authorization.clockModelRef.snapshotId
  ) {
    clockMismatch("clock_model_hash", {
      cause: "clock_model_hash_differs",
      expected: authorization.clockModelRef.contentHash,
    });
  }
  const mismatches = CLOCK_DIMENSIONS.filter((key) => declared[key] !== authorization[key]);
  if (mismatches.length > 0) clockMismatch("clock_model_mismatch", { mismatches });
  return authorization;
}

/* ------------------------------------------------------------------ *
 * the scoreable cell
 * ------------------------------------------------------------------ */

function assertWindow(window, path) {
  if (
    !isRecord(window)
    || typeof window.startLocalDate !== "string" || !LOCAL_DATE_PATTERN.test(window.startLocalDate)
    || typeof window.asOf !== "string" || !LOCAL_DATE_PATTERN.test(window.asOf)
    || typeof window.timeZone !== "string" || window.timeZone.length === 0
  ) {
    fail("matchup_cell_invalid", "matchup evidence needs a start date, asOf and timezone for its window", {
      field: path,
      reason: "window_provenance_missing",
    });
  }
  return { startLocalDate: window.startLocalDate, asOf: window.asOf, timeZone: window.timeZone };
}

function assertCellContext(context) {
  if (!isRecord(context)) fail("matchup_cell_invalid", "a scoreable cell needs a context", { field: "context" });
  if (!METHODS.includes(context.method)) {
    fail("matchup_provenance_invalid", "matchup evidence must declare method observed or simulated", {
      field: "method",
      method: context.method ?? null,
    });
  }
  if (!APPLICABILITIES.includes(context.applicability)) {
    fail("matchup_provenance_invalid", "matchup evidence must declare applicability native or proxy", {
      field: "applicability",
      applicability: context.applicability ?? null,
    });
  }
  for (const field of ["formatId", "stage", "timeoutScoring", "population"]) {
    if (typeof context[field] !== "string" || context[field].length === 0) {
      fail("matchup_cell_invalid", `matchup evidence must pin ${field}`, { field, reason: `${field}_missing` });
    }
  }
  const window = assertWindow(context.window, "window");
  const floor = context.minimumCompletedGamesPerSeat;
  if (!Number.isSafeInteger(floor) || floor <= 0) {
    fail("matchup_cell_invalid", "matchup evidence needs the per-seat completed-game floor", {
      field: "minimumCompletedGamesPerSeat",
    });
  }
  const authorization = context.clock ?? null;
  if (authorization !== null) {
    if (authorization.stage !== context.stage || authorization.timeoutScoring !== context.timeoutScoring) {
      fail("matchup_cell_invalid", "the context's stage and timeout policy must match its clock authorization", {
        field: "clock",
        reason: "context_clock_inconsistent",
      });
    }
  }
  return { ...context, window, clock: authorization };
}

/**
 * Validates ONE matchup cell and returns the normalized, frozen, scoreable record -- which pins
 * every provenance field the cell itself did not carry, so a downstream reader never has to reach
 * back into an enclosing snapshot to know what it is looking at.
 */
export function validateScoreableMatchupCell(cell, rawContext) {
  const context = assertCellContext(rawContext);
  if (!isRecord(cell)) fail("matchup_cell_invalid", "a matchup cell must be an object", { field: "cell" });

  for (const field of DECK_IDENTITY_FIELDS) {
    const value = cell[field];
    const ok = field.endsWith("Hash") ? isFullHash(value) : isSafeArtifactId(value);
    if (!ok) {
      fail("matchup_cell_invalid", "a matchup cell must identify both decks exactly", {
        field,
        reason: "deck_identity_incomplete",
      });
    }
  }
  if (!SEATS.includes(cell.candidateSeat)) {
    fail("matchup_cell_invalid", "a matchup cell must pin a play or draw seat", {
      field: "candidateSeat",
      reason: "missing_seat",
    });
  }

  const counts = {};
  for (const field of ["wins", "losses", "scoredRoundTimeouts", "validGames", "sampleSize"]) {
    if (!isNonNegativeInteger(cell[field])) {
      fail("matchup_cell_invalid", `a matchup cell needs an integer ${field}`, {
        field,
        reason: "missing_outcome_counts",
      });
    }
    counts[field] = cell[field];
  }
  const unfinished = cell.unfinished ?? 0;
  const toolFailures = cell.toolFailures ?? 0;
  for (const [field, value] of [["unfinished", unfinished], ["toolFailures", toolFailures]]) {
    if (!isNonNegativeInteger(value)) {
      fail("matchup_cell_invalid", `a matchup cell needs an integer ${field}`, { field });
    }
  }

  if (counts.wins + counts.losses + counts.scoredRoundTimeouts !== counts.validGames) {
    fail("matchup_cell_invalid", "a matchup cell's outcome counts do not reconcile with its valid games", {
      reason: "outcome_counts_inconsistent",
      wins: counts.wins,
      losses: counts.losses,
      scoredRoundTimeouts: counts.scoredRoundTimeouts,
      validGames: counts.validGames,
    });
  }
  if (counts.validGames + unfinished + toolFailures !== counts.sampleSize) {
    fail("matchup_cell_invalid", "a matchup cell's sample size does not reconcile with its excluded rows", {
      reason: "sample_size_inconsistent",
      sampleSize: counts.sampleSize,
      validGames: counts.validGames,
      unfinished,
      toolFailures,
    });
  }

  // I1 (fix round 1): a cell may DECLARE winRate, but the counts are authoritative. A declared rate
  // that disagrees with wins/validGames is a corrupt cell -- it is exactly the shape that let an
  // aggregate report EV from one number while its Wilson interval came from another. Refused here,
  // and the value this function returns is always derived, never echoed.
  if (cell.winRate !== undefined) {
    if (typeof cell.winRate !== "number" || !Number.isFinite(cell.winRate)) {
      fail("matchup_cell_invalid", "a declared win rate must be a finite number", {
        field: "winRate",
        reason: "win_rate_inconsistent",
      });
    }
    if (cell.winRate !== counts.wins / counts.validGames) {
      fail("matchup_cell_invalid", "a declared win rate disagrees with the cell's own counts", {
        reason: "win_rate_inconsistent",
        declared: cell.winRate,
        derived: counts.wins / counts.validGames,
      });
    }
  }

  // round_timeout: only behind the full accepted clock model, and never claimed when unused.
  const declaredClock = cell.roundTimeout ?? null;
  if (counts.scoredRoundTimeouts > 0) {
    assertRoundTimeoutAuthorized(declaredClock, context.clock);
  } else if (declaredClock !== null) {
    fail("matchup_cell_invalid", "a cell with no scored round timeout must not claim a clock authorization", {
      reason: "round_timeout_unauthorized",
    });
  }

  // Any engine-unfinished or tool-failure row invalidates the WHOLE cell, floor or no floor. The
  // clean games are excluded from the denominator too: a biased subset is not a smaller sample, it
  // is a different measurement, and this project has already been bitten by treating it as one.
  if (unfinished > 0 || toolFailures > 0) {
    fail("insufficient_matchup_coverage", "an unfinished or tool-failure row invalidates the whole matchup cell", {
      reason: "cell_invalidated_by_unfinished_row",
      validGames: counts.validGames,
      unfinished,
      toolFailures,
    });
  }

  if (counts.validGames < context.minimumCompletedGamesPerSeat) {
    fail("insufficient_matchup_coverage", "a matchup cell is below the per-seat completed-game floor", {
      reason: "below_per_seat_floor",
      validGames: counts.validGames,
      floor: context.minimumCompletedGamesPerSeat,
    });
  }

  let games = null;
  if (context.method === "simulated") {
    if (!Array.isArray(cell.games)) {
      fail("matchup_cell_invalid", "a simulated cell must carry every per-game row", {
        reason: "simulated_rows_missing",
      });
    }
    if (cell.games.length !== counts.sampleSize) {
      fail("matchup_cell_invalid", "a simulated cell's per-game rows do not cover its sample", {
        reason: "simulated_rows_incomplete",
        rows: cell.games.length,
        sampleSize: counts.sampleSize,
      });
    }
    for (const [index, row] of cell.games.entries()) {
      if (!isRecord(row)) {
        fail("matchup_cell_invalid", "a per-game row must be an object", { reason: "simulated_rows_incomplete", index });
      }
      for (const field of GAME_ROW_FIELDS) {
        if (!Object.hasOwn(row, field)) {
          fail("matchup_cell_invalid", "a per-game row is missing a required field", {
            reason: "simulated_rows_incomplete",
            index,
            field,
          });
        }
      }
    }
    const simulation = context.simulation;
    if (!isRecord(simulation) || SIMULATION_PROVENANCE_FIELDS.some((field) => simulation[field] === undefined)) {
      fail("matchup_cell_invalid", "a simulated cell needs its engine, policy and capability provenance", {
        reason: "simulation_provenance_incomplete",
        missing: isRecord(simulation)
          ? SIMULATION_PROVENANCE_FIELDS.filter((field) => simulation[field] === undefined)
          : SIMULATION_PROVENANCE_FIELDS,
      });
    }
    games = cell.games.map((row) => ({ ...row }));
  } else if (cell.games !== undefined) {
    fail("matchup_provenance_invalid", "observed evidence never carries simulated per-game rows", {
      reason: "observed_with_simulated_rows",
    });
  }

  return freezeDeep({
    method: context.method,
    applicability: context.applicability,
    formatId: context.formatId,
    stage: context.stage,
    timeoutScoring: context.timeoutScoring,
    population: context.population,
    window: context.window,
    candidateDeckSnapshotId: cell.candidateDeckSnapshotId,
    candidateContentHash: cell.candidateContentHash,
    candidateGameplayHash: cell.candidateGameplayHash,
    opponentDeckSnapshotId: cell.opponentDeckSnapshotId,
    opponentContentHash: cell.opponentContentHash,
    opponentGameplayHash: cell.opponentGameplayHash,
    candidateSeat: cell.candidateSeat,
    wins: counts.wins,
    losses: counts.losses,
    scoredRoundTimeouts: counts.scoredRoundTimeouts,
    validGames: counts.validGames,
    sampleSize: counts.sampleSize,
    unfinished,
    toolFailures,
    // A win scores 1, a loss 0, and an accepted-clock round timeout 0 -- and the timeout stays in
    // the denominator, because 双方败北 is a real result, not a discarded game.
    winRate: counts.wins / counts.validGames,
    roundTimeout: declaredClock === null ? null : { ...declaredClock },
    minimumCompletedGamesPerSeat: context.minimumCompletedGamesPerSeat,
    ...(games === null ? {} : { games }),
  });
}

/* ------------------------------------------------------------------ *
 * the simulated MatchupSnapshot
 * ------------------------------------------------------------------ */

/**
 * Turns one validated simulated cell into a common-envelope MatchupSnapshot. Applicability is taken
 * from the RESOLVED environment (which took it from the Manifest's own official/proxy kind), never
 * from the caller: a caller that contradicts the Manifest is refused rather than believed.
 */
export function buildSimulatedMatchupSnapshot({ resolved, archetypeId, seat, cell, context, idStem } = {}) {
  if (!isRecord(resolved)) {
    fail("matchup_cell_invalid", "a simulated matchup snapshot needs a resolved environment", { field: "resolved" });
  }
  if (!isRecord(context) || context.method !== "simulated") {
    fail("matchup_provenance_invalid", "a simulated matchup snapshot cannot be built from observed evidence", {
      reason: "method_not_simulated",
      method: isRecord(context) ? context.method ?? null : null,
    });
  }
  const inherited = resolved.matchupEvidence?.applicability;
  if (!APPLICABILITIES.includes(inherited)) {
    fail("matchup_provenance_invalid", "the resolved environment declares no applicability to inherit", {
      reason: "applicability_not_inherited",
    });
  }
  if (context.applicability !== inherited) {
    fail("matchup_provenance_invalid", "applicability is inherited from the Manifest and cannot be asserted", {
      reason: "applicability_contradicts_manifest",
      inherited,
      declared: context.applicability,
    });
  }
  const identity = parseEnvironmentKey(resolved.environmentKey);
  const scored = validateScoreableMatchupCell(cell, context);
  const pairingKey = pairingKeyFor({
    archetypeId,
    opponentGameplayHash: scored.opponentGameplayHash,
    seat: scored.candidateSeat,
  });
  if (seat !== scored.candidateSeat) {
    fail("matchup_cell_invalid", "the requested seat does not match the cell's own seat", {
      field: "seat",
      seat,
      candidateSeat: scored.candidateSeat,
    });
  }
  const { games, ...cellWithoutGames } = scored;

  // NOTE: no runtime timestamp is written anywhere in this envelope. The snapshot's contentHash
  // covers everything it contains, so a generation time would make two identical measurements
  // publish as two different artifacts -- and idempotent re-publication is what makes a re-run of an
  // unchanged plan free instead of a collision.
  return finalizeSnapshot(
    {
      schemaVersion: 1,
      kind: MATCHUP_KIND,
      environment: envelopeIdentityOf(identity),
      asOf: identity.asOf,
      source: {
        provider: "opcg-go-environment",
        surface: "simulation",
        sourceRef: {
          manifestId: resolved.manifestRef.manifestId,
          jobId: context.simulation.jobId,
          pairingKey,
        },
      },
      coverage: { status: "complete", warnings: [], missingFields: [] },
      data: {
        method: "simulated",
        applicability: inherited,
        evaluationMode: resolved.evaluationMode,
        archetypeId,
        pairingKey,
        candidateSeat: scored.candidateSeat,
        formatId: scored.formatId,
        population: scored.population,
        window: scored.window,
        roundPolicy: {
          stage: scored.stage,
          timeoutScoring: scored.timeoutScoring,
          roundDurationMinutes: context.clock === null ? null : context.clock.roundDurationMinutes,
        },
        clockRef: resolved.clockRef === null ? null : { ...resolved.clockRef },
        cells: [cellWithoutGames],
        games,
        simulation: { ...context.simulation },
      },
    },
    idStem ?? `matchup-simulated-${scored.candidateSeat}`,
  );
}

/* ------------------------------------------------------------------ *
 * observed evidence
 * ------------------------------------------------------------------ */

function softCellReasons(cell, { formatId, floor, authorization }) {
  const reasons = [];
  if (!isRecord(cell)) return ["cell_not_an_object"];
  if (DECK_IDENTITY_FIELDS.some((field) => (
    field.endsWith("Hash") ? !isFullHash(cell[field]) : !isSafeArtifactId(cell[field])
  ))) {
    reasons.push("deck_hashes_incomplete");
  }
  if (!SEATS.includes(cell.candidateSeat)) reasons.push("seat_missing");
  for (const field of ["wins", "losses", "scoredRoundTimeouts", "validGames"]) {
    if (!isNonNegativeInteger(cell[field])) reasons.push("outcome_counts_missing");
  }
  if (!isNonNegativeInteger(cell.sampleSize)) reasons.push("sample_size_missing");
  if (
    isNonNegativeInteger(cell.wins) && isNonNegativeInteger(cell.losses)
    && isNonNegativeInteger(cell.scoredRoundTimeouts) && isNonNegativeInteger(cell.validGames)
  ) {
    if (cell.wins + cell.losses + cell.scoredRoundTimeouts !== cell.validGames) {
      reasons.push("outcome_counts_inconsistent");
    }
    if (cell.validGames < floor) reasons.push("below_per_seat_floor");
    if (cell.scoredRoundTimeouts > 0) {
      try {
        assertRoundTimeoutAuthorized(cell.roundTimeout ?? null, authorization);
      } catch (error) {
        reasons.push(error.details?.reason ?? "clock_model_hash");
      }
    }
  }
  if (
    isNonNegativeInteger(cell.sampleSize) && isNonNegativeInteger(cell.validGames)
    && cell.validGames + (cell.unfinished ?? 0) + (cell.toolFailures ?? 0) !== cell.sampleSize
  ) {
    reasons.push("sample_size_inconsistent");
  }
  if (typeof formatId !== "string" || formatId.length === 0) reasons.push("format_missing");
  return reasons;
}

/**
 * Observed evidence is either SCOREABLE or CALIBRATION-ONLY, and the difference is decided here, not
 * by a caller's optimism. Incompleteness is a soft label (`status: "calibration_only"` plus every
 * reason) because incomplete observed evidence is still worth keeping for calibration; a
 * structurally broken or mislabelled snapshot is a hard failure, because it is not evidence at all.
 */
export function validateObservedMatchupSnapshot(snapshot, { resolved, minimumCompletedGamesPerSeat } = {}) {
  if (!isRecord(resolved)) {
    fail("matchup_snapshot_invalid", "observed evidence needs a resolved environment to be read against", {
      field: "resolved",
    });
  }
  try {
    verifySnapshot(snapshot);
  } catch (error) {
    fail("matchup_snapshot_invalid", "observed matchup evidence failed its own hash verification", {
      cause: error instanceof EnvironmentError ? error.code : "invalid",
    });
  }
  if (snapshot.kind !== MATCHUP_KIND) {
    fail("matchup_snapshot_invalid", "this snapshot is not matchup evidence", { kind: snapshot.kind });
  }
  const data = snapshot.data;
  if (!isRecord(data)) fail("matchup_snapshot_invalid", "observed matchup evidence has no data", {});
  if (data.method !== "observed") {
    fail("matchup_provenance_invalid", "validateObservedMatchupSnapshot never reads simulated evidence", {
      reason: "method_not_observed",
      method: data.method ?? null,
    });
  }
  if (!APPLICABILITIES.includes(data.applicability)) {
    fail("matchup_provenance_invalid", "observed evidence must declare applicability native or proxy", {
      reason: "applicability_missing",
    });
  }
  const identity = parseEnvironmentKey(resolved.environmentKey);
  const envelope = envelopeIdentityOf(identity);
  for (const field of Object.keys(envelope)) {
    if (snapshot.environment?.[field] !== envelope[field]) {
      fail("environment_identity_mismatch", "observed evidence belongs to a different environment identity", {
        field,
      });
    }
  }
  if (!Array.isArray(data.cells) || data.cells.length === 0) {
    fail("matchup_snapshot_invalid", "observed matchup evidence contains no cells", {
      reason: "no_scoreable_cells",
    });
  }
  const floor = minimumCompletedGamesPerSeat ?? resolved.minimumCompletedGamesPerSeat;
  if (!Number.isSafeInteger(floor) || floor <= 0) {
    fail("matchup_snapshot_invalid", "observed evidence needs the per-seat completed-game floor", {
      field: "minimumCompletedGamesPerSeat",
    });
  }

  const authorization = clockAuthorizationFor(resolved);
  const declaredFormat = data.formatId ?? snapshot.environment.formatId;
  const reasons = new Set();
  if (declaredFormat !== identity.formatId) reasons.add("format_mismatch");
  if (typeof data.population !== "string" || data.population.length === 0) {
    reasons.add("population_provenance_missing");
  }
  let window = null;
  try {
    window = assertWindow(data.window, "window");
  } catch {
    reasons.add("window_provenance_missing");
  }
  for (const cell of data.cells) {
    for (const reason of softCellReasons(cell, { formatId: declaredFormat, floor, authorization })) {
      reasons.add(reason);
    }
  }
  // Both seats, for every opponent the evidence names: a one-sided sample is not a play/draw split.
  const seatsByOpponent = new Map();
  for (const cell of data.cells) {
    if (!isRecord(cell) || !isFullHash(cell.opponentGameplayHash) || !SEATS.includes(cell.candidateSeat)) continue;
    const seats = seatsByOpponent.get(cell.opponentGameplayHash) ?? new Set();
    seats.add(cell.candidateSeat);
    seatsByOpponent.set(cell.opponentGameplayHash, seats);
  }
  if (seatsByOpponent.size === 0) reasons.add("seat_split_incomplete");
  for (const seats of seatsByOpponent.values()) {
    if (seats.size !== SEATS.length) reasons.add("seat_split_incomplete");
  }

  if (reasons.size > 0) {
    return freezeDeep({
      status: "calibration_only",
      method: "observed",
      applicability: data.applicability,
      snapshotRef: { snapshotId: snapshot.snapshotId, contentHash: snapshot.contentHash },
      reasons: [...reasons].sort(),
      cells: [],
    });
  }

  const roundPolicy = isRecord(data.roundPolicy) ? data.roundPolicy : {};
  const cells = data.cells.map((cell) => validateScoreableMatchupCell(cell, {
    method: "observed",
    applicability: data.applicability,
    formatId: declaredFormat,
    stage: roundPolicy.stage ?? (authorization === null ? null : authorization.stage),
    timeoutScoring: roundPolicy.timeoutScoring ?? (authorization === null ? null : authorization.timeoutScoring),
    population: data.population,
    window,
    minimumCompletedGamesPerSeat: floor,
    clock: authorization,
  }));
  return freezeDeep({
    status: "scoreable",
    method: "observed",
    applicability: data.applicability,
    snapshotRef: { snapshotId: snapshot.snapshotId, contentHash: snapshot.contentHash },
    reasons: [],
    cells,
  });
}
