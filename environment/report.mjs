// Field-weighted expected win rate, deterministic confidence, and comparison.
//
// This is the arithmetic the whole environment domain exists to produce, and four rules shape every
// line of it:
//
//   * NO RENORMALIZATION, anywhere. Field shares and within-archetype weights are multiplied
//     directly. A field that does not sum to one is `field_not_representative`, never a smaller
//     field scaled back up -- a rescaled partial field is a different population wearing the right
//     total.
//   * EV_play and EV_draw are PRIMARY. EV_overall exists only when the Manifest states explicit
//     turn-order weights, because a blended number without a stated mixture is an opinion.
//   * CONFIDENCE IS DETERMINISTIC: bootstrap seed 20260820, exactly 10000 replicates, weights held
//     fixed, resampling strictly within each `archetype x representative x seat` stratum. The
//     interval covers SAMPLING error in the measured cells and nothing else; what it excludes is
//     named in the report rather than left for a reader to assume.
//   * OBSERVED and SIMULATED never merge row-wise, and native/proxy is a separate axis again.
//
// The legacy mirrored-pair consistency and Nash routines in the repository's older EV tooling are
// NOT reachable from here, by construction: nothing in this module imports or shells to them. Their
// mirrored-pair assumption is invalid for timeout-bearing evidence, where a double loss is a real
// scored result rather than a win for somebody.
import { EnvironmentError } from "./errors.mjs";
import { hashProjection } from "./hash.mjs";
import {
  assertExactCoverage,
  assertRoundTimeoutAuthorized,
  clockAuthorizationFor,
  createXorshift32,
  pairingKeyFor,
  parseEnvironmentKey,
  SEATS,
  validateObservedMatchupSnapshot,
  validateScoreableMatchupCell,
  WEIGHT_TOLERANCE,
} from "./matchup.mjs";


export const REPORT_KIND = "environment-evaluation-report";
export const COMPARISON_KIND = "environment-variant-comparison";
export const ENVIRONMENT_COMPARISON_KIND = "environment-cross-environment-comparison";

// Pinned, not configurable. A confidence interval whose seed or replicate count can move is not
// reproducible evidence, and every number this project publishes has to be re-derivable.
export const BOOTSTRAP_SEED = 20260820;
export const BOOTSTRAP_REPLICATES = 10000;

// What a sampling interval on simulated or observed cells does NOT cover. Stated in the report
// itself so a reader cannot mistake "the sampling error of these games" for "how sure we are".
export const CONFIDENCE_EXCLUSIONS = Object.freeze([
  "field_selection_uncertainty",
  "deck_choice_uncertainty",
  "pilot_skill_uncertainty",
  "engine_fidelity_uncertainty",
  "clock_model_uncertainty",
]);

export const REPORT_ERROR_CODES = Object.freeze([
  "report_input_invalid",
  "report_pairing_invalid",
  "report_comparison_invalid",
  "field_not_representative",
  "insufficient_matchup_coverage",
  "matchup_provenance_invalid",
]);

const AGGREGATE_KEYS = Object.freeze([
  "plan",
  "results",
  "observed",
  "now",
  "executedAt",
  "runner",
  "timeoutAdjudication",
]);
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const Z_95 = 1.96;

function fail(code, message, details = {}) {
  const rendered = message.startsWith(`${code}:`) ? message : `${code}: ${message}`;
  throw new EnvironmentError(code, rendered, details);
}

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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

function assertInstant(now, field = "now") {
  // The library never reads host clock time. A caller that forgets `now` fails closed; defaulting
  // belongs at a command boundary, outside this library.
  if (typeof now !== "string" || !RFC3339_PATTERN.test(now)) {
    fail("report_input_invalid", "a report needs an explicit RFC 3339 generation instant", { field });
  }
  return now;
}

/* ------------------------------------------------------------------ *
 * exact weighted EV
 * ------------------------------------------------------------------ */

/**
 * Direct multiplication, no share normalization. `assertExactCoverage` runs INSIDE this function
 * rather than being left to a caller: an EV computed over a partial field is the exact number this
 * design exists to refuse, so it must not be reachable by forgetting a call.
 */
export function weightedSeatEv(strata, seat) {
  if (!SEATS.includes(seat)) {
    fail("report_input_invalid", "a seat is play or draw", { field: "seat", seat });
  }
  assertExactCoverage(strata);
  return strata.reduce((fieldTotal, archetype) => (
    fieldTotal + archetype.fieldWeight * archetype.representatives.reduce(
      (deckTotal, representative) => {
        const rate = representative.winRate?.[seat];
        if (typeof rate !== "number" || !Number.isFinite(rate)) {
          fail("report_input_invalid", "a representative has no finite win rate for this seat", {
            field: "winRate",
            archetypeId: archetype.archetypeId,
            seat,
          });
        }
        return deckTotal + representative.withinArchetypeWeight * rate;
      },
      0,
    )
  ), 0);
}

/**
 * The Wilson score interval. Used per cell rather than a normal approximation because it stays
 * correct at 0 and 1 -- a 200/200 cell has an upper bound of exactly 1 and a lower bound below it,
 * where the normal approximation collapses to the degenerate [1, 1].
 */
export function wilsonInterval(successes, n, z = Z_95) {
  if (!Number.isSafeInteger(n) || n <= 0) {
    fail("report_input_invalid", "a Wilson interval needs a positive integer denominator", {
      field: "n",
      reason: "denominator_invalid",
      n,
    });
  }
  if (!Number.isSafeInteger(successes) || successes < 0 || successes > n) {
    fail("report_input_invalid", "a Wilson interval needs 0 <= successes <= n", {
      field: "successes",
      reason: "successes_out_of_range",
      successes,
      n,
    });
  }
  const p = successes / n;
  const denominator = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  // Clamped to [0, 1]: the analytic bounds of a 0/n or n/n cell are exactly 0 and 1, but the
  // floating-point evaluation overshoots at small n (0/5 lands at -3.1e-17, 5/5 at 1+2.2e-16). A
  // negative probability in a published artifact is a defect even at 1e-17.
  return Object.freeze({
    lo: Math.max(0, (centre - spread) / denominator),
    hi: Math.min(1, (centre + spread) / denominator),
  });
}

/* ------------------------------------------------------------------ *
 * deterministic resampling
 * ------------------------------------------------------------------ */

/**
 * One resampled win rate for one cell: n draws with replacement from that cell's own outcome
 * multiset (`wins` ones, the rest zeros -- an accepted-clock round timeout is one of the zeros).
 *
 * A note the reviewer should not have to rediscover: for a BINARY outcome, resampling the observed
 * rows with replacement and drawing n Bernoulli(p-hat) trials are the SAME distribution, so the
 * simulated (nonparametric) and observed (parametric binomial) paths share this implementation. The
 * distinction the report labels is one of JUSTIFICATION, not arithmetic: for a simulated cell we
 * hold every row, while for an observed cell we hold only counts and a parametric model is the only
 * honest option. Row ORDER carries no information for an i.i.d. resample, which is also why this
 * reads counts rather than the row array -- a reordered result cannot move an interval.
 */
function resampleRate(next, n, wins) {
  let count = 0;
  for (let draw = 0; draw < n; draw += 1) {
    if (next() % n < wins) count += 1;
  }
  return count / n;
}

/** The 2.5th and 97.5th percentiles of a replicate distribution, by explicit index. */
function percentile95(values) {
  const sorted = Float64Array.from(values).sort();
  const loIndex = Math.floor(0.025 * sorted.length);
  const hiIndex = Math.ceil(0.975 * sorted.length) - 1;
  return Object.freeze({ lo: sorted[loIndex], hi: sorted[hiIndex] });
}

/**
 * The aggregate interval. Field and representative weights are HELD FIXED -- only the games inside
 * each stratum are resampled, so the interval answers "how much could these measured cells have
 * differed by chance", never "what if the field were different". That second question is
 * field-selection uncertainty and is explicitly excluded.
 */
function bootstrapSeatIntervals(cells, strataTemplate, turnOrderWeights) {
  const play = new Float64Array(BOOTSTRAP_REPLICATES);
  const draw = new Float64Array(BOOTSTRAP_REPLICATES);
  const overall = new Float64Array(BOOTSTRAP_REPLICATES);
  // I3 (fix round 1): the replicate count used to be a LABEL. Dropping the loop bound by one left
  // every published interval byte-identical (the discrete distribution ties adjacent order
  // statistics), so nothing could detect it. The draw counter below is the measurement: it is a
  // pure function of (replicates x per-cell sample sizes), it is recorded in the artifact, and the
  // report cross-checks it against the declared replicate count.
  let draws = 0;
  const raw = createXorshift32(BOOTSTRAP_SEED);
  const next = () => {
    draws += 1;
    return raw();
  };
  for (let replicate = 0; replicate < BOOTSTRAP_REPLICATES; replicate += 1) {
    const rates = new Map();
    for (const cell of cells) {
      rates.set(cell.key, resampleRate(next, cell.validGames, cell.wins));
    }
    const strata = strataTemplate.map((row) => ({
      archetypeId: row.archetypeId,
      fieldWeight: row.fieldWeight,
      representatives: row.representatives.map((representative) => ({
        withinArchetypeWeight: representative.withinArchetypeWeight,
        winRate: {
          play: rates.get(`${representative.pairingKeyPlay}`),
          draw: rates.get(`${representative.pairingKeyDraw}`),
        },
      })),
    }));
    play[replicate] = weightedSeatEv(strata, "play");
    draw[replicate] = weightedSeatEv(strata, "draw");
    overall[replicate] = turnOrderWeights.play * play[replicate] + turnOrderWeights.draw * draw[replicate];
  }
  return {
    play: percentile95(play),
    draw: percentile95(draw),
    overall: percentile95(overall),
    rngDraws: draws,
  };
}

/* ------------------------------------------------------------------ *
 * plan and cell assembly
 * ------------------------------------------------------------------ */

function assertTurnOrderWeights(plan) {
  const weights = plan.turnOrderWeights;
  if (
    !isRecord(weights)
    || typeof weights.play !== "number" || !Number.isFinite(weights.play)
    || typeof weights.draw !== "number" || !Number.isFinite(weights.draw)
    || Math.abs(weights.play + weights.draw - 1) > WEIGHT_TOLERANCE
  ) {
    // EV_overall is calculated ONLY from the Manifest's own explicit play/draw weights. Without
    // them there is no mixture to report, and inventing 50/50 would be a fabricated claim.
    fail("report_input_invalid", "EV_overall requires explicit Manifest turn-order weights summing to one", {
      field: "turnOrderWeights",
    });
  }
  return { play: weights.play, draw: weights.draw };
}

function assertPlan(plan) {
  if (!isRecord(plan)) {
    fail("report_input_invalid", "a report needs an expanded simulation plan", { field: "plan" });
  }
  for (const field of ["planHash", "manifestRef", "environmentKey", "strata", "candidate", "settings"]) {
    if (plan[field] === undefined || plan[field] === null) {
      fail("report_input_invalid", `a report needs the plan's ${field}`, { field });
    }
  }
  assertExactCoverage(plan.strata);
  parseEnvironmentKey(plan.environmentKey);
  return plan;
}

/** Index every scoreable cell by (archetype, representative, seat), refusing gaps and duplicates. */
function indexCells(plan, entries) {
  const byKey = new Map();
  for (const entry of entries) {
    const key = pairingKeyFor({
      archetypeId: entry.archetypeId,
      opponentGameplayHash: entry.cell.opponentGameplayHash,
      seat: entry.cell.candidateSeat,
    });
    if (byKey.has(key)) {
      // Two measurements of one stratum and seat are not more evidence, they are a contradiction.
      // Averaging them would hide whichever one is wrong.
      fail("insufficient_matchup_coverage", "two cells cover the same stratum and seat", {
        reason: "duplicate_cell",
        pairingKey: key,
      });
    }
    byKey.set(key, entry);
  }

  const required = [];
  for (const row of plan.strata) {
    for (const representative of row.representatives) {
      for (const seat of SEATS) {
        required.push({
          archetypeId: row.archetypeId,
          fieldWeight: row.fieldWeight,
          representative,
          seat,
          key: pairingKeyFor({
            archetypeId: row.archetypeId,
            opponentGameplayHash: representative.gameplayHash,
            seat,
          }),
        });
      }
    }
  }
  const missing = required.filter((slot) => !byKey.has(slot.key));
  if (missing.length > 0) {
    // No renormalization over what IS present: a missing cell is missing coverage, full stop.
    fail("insufficient_matchup_coverage", "the evidence does not cover every representative and seat", {
      reason: "incomplete_seat_coverage",
      missingCells: missing.length,
    });
  }
  const extra = [...byKey.keys()].filter((key) => !required.some((slot) => slot.key === key));
  if (extra.length > 0) {
    fail("insufficient_matchup_coverage", "the evidence covers a stratum the field does not contain", {
      reason: "unexpected_cell",
      extra: extra.length,
    });
  }
  return { byKey, required };
}

/**
 * Whether THIS cell needs a clock authorization in its validation context. A cell with no scored
 * timeout must not carry one (validateScoreableMatchupCell refuses an unused authorization), while a
 * cell with one must be checked against the environment's own accepted model.
 */
function cellNeedsClock(cell) {
  return Number.isSafeInteger(cell?.scoredRoundTimeouts) && cell.scoredRoundTimeouts > 0;
}

function seatSummary(cell) {
  return {
    wins: cell.wins,
    losses: cell.losses,
    scoredRoundTimeouts: cell.scoredRoundTimeouts,
    validGames: cell.validGames,
    sampleSize: cell.sampleSize,
    unfinished: cell.unfinished,
    toolFailures: cell.toolFailures,
    winRate: cell.winRate,
    wilson95: wilsonInterval(cell.wins, cell.validGames),
    method: cell.method,
    applicability: cell.applicability,
    population: cell.population,
    window: { ...cell.window },
    stage: cell.stage,
    timeoutScoring: cell.timeoutScoring,
    roundTimeout: cell.roundTimeout === null ? null : { ...cell.roundTimeout },
  };
}

/**
 * I2 (fix round 1): whether a round-timeout ADJUDICATOR actually ran, as opposed to whether the
 * environment merely REFERENCES an accepted clock model.
 *
 * The clock gate validates the reference. It cannot tell you that anything applied it, and before
 * this existed nothing in a report distinguished "measured zero timeouts" from "no adjudicator ever
 * ran" -- every cell simply read `scoredRoundTimeouts: 0`. Since nothing in this repository yet
 * produces a `timedOutSeeds` list, that made every official simulated report a game-resolution
 * measurement wearing a tournament-match label, which is the one direction the spec forbids.
 *
 * The mechanism chosen (of the two the review offered) is BOTH halves of the conservative one: an
 * unadjudicated simulated report gets an explicit `round_timeout_unadjudicated` blocker AND has its
 * official strength claim withheld. Adjudication that ran and found nothing is a different, valid
 * state: `applied: true` with `adjudicatedSeeds: 0`, and the claim stands.
 */
/*
 * I-4 (final fix wave): `applied` alone was a PRESENCE flag. An adjudication whose every cell was
 * `{ timedOutSeeds: [] }` set it true and minted an unqualified official claim -- you did not need
 * to forge a verdict, you needed to supply none. `evaluatedSeeds` closes that: an applied block must
 * state how many completed games the clock model actually looked at, and that total is reconciled
 * against the games this report aggregates, exactly the way `adjudicatedCells` is reconciled against
 * the cell count and `source` against the accepted clock. "The model ran and found nothing" stays a
 * first-class, expressible state -- evaluatedSeeds = every game, adjudicatedSeeds = 0.
 */
const ADJUDICATION_KEYS = Object.freeze([
  "applied", "source", "adjudicatedCells", "adjudicatedSeeds", "evaluatedSeeds",
]);

function adjudicationSummary(raw, method, { authorization, cellCount, scoredRoundTimeouts, completedGames }) {
  if (method !== "simulated") {
    // Observed evidence carries its own scored timeouts from its source population, already gated by
    // validateObservedMatchupSnapshot. There is no adjudicator in that path to have run or not run.
    return {
      applied: null,
      applicable: false,
      source: null,
      adjudicatedCells: 0,
      adjudicatedSeeds: 0,
      evaluatedSeeds: 0,
    };
  }
  if (raw === null || raw === undefined) {
    return {
      applied: false, applicable: true, source: null, adjudicatedCells: 0, adjudicatedSeeds: 0, evaluatedSeeds: 0,
    };
  }
  if (!isRecord(raw)) {
    fail("report_input_invalid", "a timeout adjudication summary must be an object", {
      field: "timeoutAdjudication",
      reason: "adjudication_summary_invalid",
    });
  }
  const unexpected = Object.keys(raw).filter((key) => !ADJUDICATION_KEYS.includes(key));
  if (unexpected.length > 0) {
    fail("report_input_invalid", "a timeout adjudication summary carries an unrecognized field", {
      field: "timeoutAdjudication",
      reason: "adjudication_summary_invalid",
      unexpected,
    });
  }
  const declaresSource = isRecord(raw.source);
  if (raw.applied !== true) {
    // A block that names a source while claiming not to have run is contradictory; a caller cannot
    // half-declare an adjudication.
    if (declaresSource) {
      fail("report_input_invalid", "a timeout adjudication names a source but does not claim to have run", {
        field: "timeoutAdjudication",
        reason: "adjudication_summary_inconsistent",
      });
    }
    return {
      applied: false, applicable: true, source: null, adjudicatedCells: 0, adjudicatedSeeds: 0, evaluatedSeeds: 0,
    };
  }

  // N1 (fix round 2): from here the block CLAIMS an adjudicator ran, which is the single field that
  // gates the official strength claim -- so it is authenticated rather than type-coerced. This is
  // the same defect shape as a declared cell.winRate with nothing cross-checking it (I1), applied to
  // the one value that decides whether a report may speak as a tournament measurement. It matters
  // most exactly where it is weakest: a caller re-reading persisted artifacts and re-aggregating
  // them, where a stale or edited block would resurrect a false official claim.
  if (!declaresSource) {
    fail("report_input_invalid", "an applied timeout adjudication must name the clock model it applied", {
      field: "timeoutAdjudication",
      reason: "adjudication_source_missing",
    });
  }
  // The same authorization the execute path uses: the referenced model, by id AND content hash, plus
  // all seven dimensions. `authorization` is null when this environment holds no accepted clock, and
  // assertRoundTimeoutAuthorized fails that closed as clock_model_hash.
  assertRoundTimeoutAuthorized(raw.source, authorization);
  if (raw.adjudicatedCells !== cellCount) {
    fail("report_input_invalid", "the adjudication does not cover the cells this report aggregates", {
      field: "adjudicatedCells",
      reason: "adjudication_cell_count_mismatch",
      declared: raw.adjudicatedCells,
      aggregated: cellCount,
    });
  }
  // Every adjudicated seed is relabelled into its cell's scoredRoundTimeouts, so the declared total
  // and the measured total are the same number by construction -- which makes them checkable.
  if (raw.adjudicatedSeeds !== scoredRoundTimeouts) {
    fail("report_input_invalid", "the adjudicated seed count disagrees with the scored round timeouts", {
      field: "adjudicatedSeeds",
      reason: "adjudication_seed_count_mismatch",
      declared: raw.adjudicatedSeeds,
      scoredRoundTimeouts,
    });
  }
  // I-4: an applied block that names no evaluated total is the pre-fix shape -- reject it outright
  // rather than defaulting it, because a default would silently restore the presence flag.
  if (!Object.hasOwn(raw, "evaluatedSeeds")) {
    fail("report_input_invalid", "an applied timeout adjudication must state how many games it evaluated", {
      field: "evaluatedSeeds",
      reason: "adjudication_evaluated_seeds_missing",
    });
  }
  if (raw.evaluatedSeeds !== completedGames) {
    fail("report_input_invalid", "the adjudication did not evaluate every completed game this report covers", {
      field: "evaluatedSeeds",
      reason: "adjudication_evaluated_seed_count_mismatch",
      declared: raw.evaluatedSeeds,
      completedGames,
    });
  }
  return {
    applied: true,
    applicable: true,
    source: { ...raw.source, clockModelRef: { ...raw.source.clockModelRef } },
    adjudicatedCells: raw.adjudicatedCells,
    adjudicatedSeeds: raw.adjudicatedSeeds,
    evaluatedSeeds: raw.evaluatedSeeds,
  };
}

/* ------------------------------------------------------------------ *
 * aggregateEnvironment
 * ------------------------------------------------------------------ */

export function aggregateEnvironment(input) {
  if (!isRecord(input)) fail("report_input_invalid", "aggregateEnvironment needs an input object", {});
  const unexpected = Object.keys(input).filter((key) => !AGGREGATE_KEYS.includes(key));
  if (unexpected.length > 0) {
    fail("report_input_invalid", "aggregateEnvironment accepts no unlisted input", {
      field: "input",
      unexpected,
    });
  }
  const now = assertInstant(input.now);
  const plan = assertPlan(input.plan);
  const turnOrderWeights = assertTurnOrderWeights(plan);

  const hasSimulated = Array.isArray(input.results) && input.results.length > 0;
  const hasObserved = Array.isArray(input.observed) && input.observed.length > 0;
  if (hasSimulated && hasObserved) {
    // Two evidence METHODS, never one table. They answer different questions about different
    // populations and a row-wise merge silently claims they do not.
    fail("matchup_provenance_invalid", "observed and simulated evidence are never merged row-wise", {
      reason: "observed_and_simulated_not_mergeable",
    });
  }
  if (!hasSimulated && !hasObserved) {
    fail("report_input_invalid", "a report needs either simulated results or observed evidence", {
      field: "results",
    });
  }

  let entries;
  let method;
  let applicability;
  let calibration = [];
  let evidence = [];
  if (hasSimulated) {
    method = "simulated";
    applicability = plan.applicability;
    // I1 (fix round 1): every simulated cell is re-validated through the SAME contract the observed
    // branch uses, with the context rebuilt from the plan rather than read out of the cell. Before
    // this, the simulated branch trusted `cell.winRate` for EV while Wilson read `cell.wins`, so a
    // cell claiming wins=150/n=200 with winRate 0.55 produced a report whose EV and interval
    // disagreed -- and `unfinished: 7` or `validGames: 10` were scored without complaint. Task 12's
    // natural flow is "re-read the published artifacts, then aggregate", so this entry point cannot
    // rely on executeSimulationPlan having validated first.
    const identity = parseEnvironmentKey(plan.environmentKey);
    const authorization = clockAuthorizationFor({
      environmentKey: plan.environmentKey,
      clockRef: plan.clockRef ?? null,
      roundTimeoutPolicy: plan.roundTimeoutPolicy ?? null,
    });
    entries = input.results.map((record) => {
      const data = record.snapshot?.data;
      if (!isRecord(data) || !Array.isArray(data.games) || !isRecord(data.simulation)) {
        fail("report_input_invalid", "a simulated result needs its published rows and provenance", {
          field: "results",
          reason: "result_record_incomplete",
        });
      }
      const cell = validateScoreableMatchupCell(
        { ...record.cell, games: data.games },
        {
          method: "simulated",
          applicability: plan.applicability,
          formatId: identity.formatId,
          stage: plan.roundTimeoutPolicy === null || plan.roundTimeoutPolicy === undefined
            ? "unclocked"
            : plan.roundTimeoutPolicy.stage,
          timeoutScoring: plan.roundTimeoutPolicy === null || plan.roundTimeoutPolicy === undefined
            ? "unscoreable"
            : plan.roundTimeoutPolicy.timeoutScoring,
          population: `simulated field of ${plan.environmentKey}`,
          window: {
            startLocalDate: identity.asOf,
            asOf: identity.asOf,
            timeZone: identity.timeZone,
          },
          minimumCompletedGamesPerSeat: plan.completedGameTarget,
          clock: cellNeedsClock(record.cell) ? authorization : null,
          simulation: data.simulation,
        },
      );
      return {
        archetypeId: record.archetypeId,
        cell,
        jobId: record.jobId,
        snapshotRef: { snapshotId: record.snapshot.snapshotId, contentHash: record.snapshot.contentHash },
      };
    });
    evidence = entries.map((entry) => ({
      jobId: entry.jobId,
      pairingKey: pairingKeyFor({
        archetypeId: entry.archetypeId,
        opponentGameplayHash: entry.cell.opponentGameplayHash,
        seat: entry.cell.candidateSeat,
      }),
      resultRef: entry.snapshotRef,
    }));
  } else {
    method = "observed";
    const readings = input.observed.map((snapshot) => validateObservedMatchupSnapshot(snapshot, {
      resolved: {
        environmentKey: plan.environmentKey,
        clockRef: plan.clockRef ?? null,
        roundTimeoutPolicy: plan.roundTimeoutPolicy ?? null,
        minimumCompletedGamesPerSeat: plan.completedGameTarget,
      },
      minimumCompletedGamesPerSeat: plan.completedGameTarget,
    }));
    const incomplete = readings.filter((reading) => reading.status !== "scoreable");
    if (incomplete.length > 0) {
      // Incomplete observed evidence stays CALIBRATION-ONLY: it is reported, and it is never scored.
      fail("insufficient_matchup_coverage", "observed evidence is incomplete and remains calibration-only", {
        reason: "observed_calibration_only",
        reasons: [...new Set(incomplete.flatMap((reading) => reading.reasons))].sort(),
      });
    }
    applicability = readings[0].applicability;
    const archetypeByGameplayHash = new Map();
    for (const row of plan.strata) {
      for (const representative of row.representatives) {
        archetypeByGameplayHash.set(representative.gameplayHash, row.archetypeId);
      }
    }
    entries = readings.flatMap((reading) => reading.cells.map((cell) => {
      const archetypeId = archetypeByGameplayHash.get(cell.opponentGameplayHash);
      if (archetypeId === undefined) {
        fail("insufficient_matchup_coverage", "observed evidence names an opponent the field does not contain", {
          reason: "unexpected_cell",
        });
      }
      return { archetypeId, cell, jobId: null, snapshotRef: reading.snapshotRef };
    }));
    calibration = readings.map((reading) => ({
      snapshotRef: reading.snapshotRef,
      status: reading.status,
      reasons: [...reading.reasons],
    }));
    evidence = [...new Map(readings.map((reading) => [reading.snapshotRef.snapshotId, {
      jobId: null,
      pairingKey: null,
      resultRef: reading.snapshotRef,
    }])).values()];
  }

  const { byKey, required } = indexCells(plan, entries);

  // The EV strata: display order is the field's own order, which the resolver already fixed.
  const evStrata = plan.strata.map((row) => ({
    archetypeId: row.archetypeId,
    fieldWeight: row.fieldWeight,
    representatives: row.representatives.map((representative) => {
      const rateFor = (seat) => byKey.get(pairingKeyFor({
        archetypeId: row.archetypeId,
        opponentGameplayHash: representative.gameplayHash,
        seat,
      })).cell.winRate;
      return {
        withinArchetypeWeight: representative.withinArchetypeWeight,
        winRate: { play: rateFor("play"), draw: rateFor("draw") },
      };
    }),
  }));
  const evPlay = weightedSeatEv(evStrata, "play");
  const evDraw = weightedSeatEv(evStrata, "draw");
  const evOverall = turnOrderWeights.play * evPlay + turnOrderWeights.draw * evDraw;

  const bootstrapCells = required.map((slot) => {
    const cell = byKey.get(slot.key).cell;
    return { key: slot.key, wins: cell.wins, validGames: cell.validGames };
  });
  const bootstrapTemplate = plan.strata.map((row) => ({
    archetypeId: row.archetypeId,
    fieldWeight: row.fieldWeight,
    representatives: row.representatives.map((representative) => ({
      withinArchetypeWeight: representative.withinArchetypeWeight,
      pairingKeyPlay: pairingKeyFor({
        archetypeId: row.archetypeId,
        opponentGameplayHash: representative.gameplayHash,
        seat: "play",
      }),
      pairingKeyDraw: pairingKeyFor({
        archetypeId: row.archetypeId,
        opponentGameplayHash: representative.gameplayHash,
        seat: "draw",
      }),
    })),
  }));
  const intervals = bootstrapSeatIntervals(bootstrapCells, bootstrapTemplate, turnOrderWeights);
  // I3 (fix round 1): the resampler COUNTS its own random draws and publishes the total as
  // `confidence.rngDraws`. That number is what makes the replicate count checkable at all -- dropping
  // the loop bound by one leaves every published interval byte-identical, because the discrete
  // replicate distribution ties adjacent order statistics, but it cannot leave the draw count alone.
  //
  // There is deliberately NO internal "draws === replicates x samples" assertion here. With a correct
  // counter and a correct loop its condition is unreachable, so no test could ever make it fire --
  // and a guard no test can kill is dead code, not defence. The check belongs where it can fail: in
  // the tests, which pin 10000 x 800 = 8,000,000 on the standard fixture and 10000 x 1200 on the
  // multi-representative one.

  const strata = plan.strata.map((row) => ({
    archetypeId: row.archetypeId,
    fieldWeight: row.fieldWeight,
    representatives: row.representatives.map((representative) => ({
      deckRef: { ...representative.deckRef },
      gameplayHash: representative.gameplayHash,
      withinArchetypeWeight: representative.withinArchetypeWeight,
      seats: Object.fromEntries(SEATS.map((seat) => [
        seat,
        seatSummary(byKey.get(pairingKeyFor({
          archetypeId: row.archetypeId,
          opponentGameplayHash: representative.gameplayHash,
          seat,
        })).cell),
      ])),
    })),
  }));

  const evaluationMode = plan.evaluationMode;
  const scoredRoundTimeouts = entries.reduce((total, entry) => total + entry.cell.scoredRoundTimeouts, 0);
  const completedGames = entries.reduce((total, entry) => total + entry.cell.validGames, 0);
  const adjudication = adjudicationSummary(input.timeoutAdjudication, method, {
    authorization: clockAuthorizationFor({
      environmentKey: plan.environmentKey,
      clockRef: plan.clockRef ?? null,
      roundTimeoutPolicy: plan.roundTimeoutPolicy ?? null,
    }),
    cellCount: entries.length,
    scoredRoundTimeouts,
    completedGames,
  });
  const blockers = (plan.blockers ?? []).map((blocker) => ({ ...blocker }));
  // An official simulated claim requires that a round-timeout adjudicator actually RAN. Without one,
  // every cell's zero is unmeasured rather than measured, so the claim is withheld and the reason is
  // written into the artifact instead of being left for a reader to infer.
  const unadjudicated = adjudication.applicable && adjudication.applied !== true;
  if (evaluationMode === "official" && unadjudicated) {
    blockers.push({
      code: "round_timeout_unadjudicated",
      reason: "no_adjudicator_applied",
      clockModelRef: plan.clockRef === null || plan.clockRef === undefined ? null : { ...plan.clockRef },
    });
  }
  const officialStrengthClaim = plan.officialStrengthClaim === true
    && evaluationMode === "official"
    && !unadjudicated;
  const draft = {
    schemaVersion: 1,
    kind: REPORT_KIND,
    requestedEnvironment: plan.requestedEnvironment,
    environmentKey: plan.environmentKey,
    manifestRef: { ...plan.manifestRef },
    planHash: plan.planHash,
    evaluationMode,
    officialStrengthClaim,
    // A diagnostic estimate never carries a tournament-strength claim, and says so in the artifact
    // rather than in a caller's memory.
    strengthClaimWithheld: !officialStrengthClaim,
    method,
    applicability,
    candidate: {
      deckRef: { ...plan.candidate.deckRef },
      gameplayHash: plan.candidate.gameplayHash,
      artifactHash: plan.candidate.artifactHash,
      displayName: plan.candidate.displayName ?? null,
      leaderGameplayId: plan.candidate.leaderGameplayId ?? null,
    },
    settings: { ...plan.settings },
    completedGameTarget: plan.completedGameTarget,
    references: Object.fromEntries(Object.entries(plan.references ?? {}).map(([key, ref]) => [key, { ...ref }])),
    capabilityRef: plan.capabilityRef === null || plan.capabilityRef === undefined
      ? null
      : { ...plan.capabilityRef },
    clockRef: plan.clockRef === null || plan.clockRef === undefined ? null : { ...plan.clockRef },
    roundTimeoutPolicy: plan.roundTimeoutPolicy === null || plan.roundTimeoutPolicy === undefined
      ? null
      : { ...plan.roundTimeoutPolicy },
    blockers,
    warnings: (plan.warnings ?? []).map((warning) => ({ ...warning })),
    timeoutAdjudication: {
      applied: adjudication.applied,
      applicable: adjudication.applicable,
      source: adjudication.source,
      adjudicatedCells: adjudication.adjudicatedCells,
      adjudicatedSeeds: adjudication.adjudicatedSeeds,
      evaluatedSeeds: adjudication.evaluatedSeeds,
      scoredRoundTimeouts,
    },
    coverage: {
      status: "complete",
      cells: entries.length,
      requiredCells: required.length,
      fieldWeightSum: plan.strata.reduce((total, row) => total + row.fieldWeight, 0),
      renormalized: false,
    },
    strata,
    ev: {
      play: evPlay,
      draw: evDraw,
      overall: evOverall,
      turnOrderWeights,
    },
    confidence: {
      label: method === "observed" ? "observedSampling95" : "simulationMonteCarlo95",
      resampling: method === "observed" ? "parametric_binomial" : "within_stratum_bootstrap",
      seed: BOOTSTRAP_SEED,
      replicates: BOOTSTRAP_REPLICATES,
      weightsResampled: false,
      // The measured cost of the resample, not a restatement of the constant above.
      rngDraws: intervals.rngDraws,
      excludes: [...CONFIDENCE_EXCLUSIONS],
      play: { ...intervals.play },
      draw: { ...intervals.draw },
      overall: { ...intervals.overall },
      // A paired tech-slot interval needs two arms over one seed schedule. Observed evidence has no
      // such source design, so it can never emit one; a simulated report gets it from
      // compareVariants, not from itself.
      paired: null,
    },
    pairedIntervalAvailable: method === "simulated",
    calibration,
    evidence,
    // Market evidence is REPORT METADATA. It never enters strata, weights, EV, confidence or
    // coverage -- a price is not a win rate and this is where that stays true.
    metadata: {
      marketRefs: (plan.marketRefs ?? []).map((ref) => ({ ...ref })),
      marketEvidenceUsedForStrength: false,
    },
  };
  // The generation time is DISPLAY metadata and sits outside the hash projection, so two identical
  // measurements taken an hour apart are one artifact rather than two.
  return freezeDeep({
    ...draft,
    contentHash: hashProjection(draft, ["contentHash", "generatedAt"]),
    generatedAt: now,
  });
}

/* ------------------------------------------------------------------ *
 * variant comparison
 * ------------------------------------------------------------------ */

function pairsByCell(outcome) {
  const cells = new Map();
  for (const record of outcome.results) {
    const key = pairingKeyFor({
      archetypeId: record.archetypeId,
      opponentGameplayHash: record.cell.opponentGameplayHash,
      seat: record.cell.candidateSeat,
    });
    const bySeed = new Map();
    for (const game of record.snapshot.data.games) {
      if (bySeed.has(game.seed)) {
        // A duplicated (pairingKey, seed) is not a pair, it is an ambiguity: joining it would pick
        // an arbitrary row and call the result reproducible.
        fail("report_pairing_invalid", "one arm repeats a (pairingKey, seed) pair", {
          reason: "duplicate_pair_key",
          pairingKey: key,
          seed: game.seed,
        });
      }
      bySeed.set(game.seed, game.outcome === "win" ? 1 : 0);
    }
    cells.set(key, { seat: record.cell.candidateSeat, bySeed });
  }
  return cells;
}

function assertComparableArms(baseline, variant) {
  if (baseline.plan.manifestRef.manifestId !== variant.plan.manifestRef.manifestId
    || baseline.plan.manifestRef.contentHash !== variant.plan.manifestRef.contentHash) {
    fail("report_pairing_invalid", "a paired comparison needs one identical Manifest on both arms", {
      reason: "manifest_mismatch",
    });
  }
  const shape = (plan) => JSON.stringify(plan.strata.map((row) => [
    row.archetypeId,
    row.fieldWeight,
    row.representatives.map((representative) => [representative.gameplayHash, representative.withinArchetypeWeight]),
  ]));
  if (shape(baseline.plan) !== shape(variant.plan)) {
    fail("report_pairing_invalid", "a paired comparison needs identical field and representative strata", {
      reason: "strata_mismatch",
    });
  }
  if (baseline.plan.candidate.gameplayHash === variant.plan.candidate.gameplayHash) {
    fail("report_pairing_invalid", "a variant comparison needs two different candidate decks", {
      reason: "identical_candidate",
    });
  }
}

/**
 * The paired tech-slot comparison. Pairs are joined on EXACT `(pairingKey, seed)` -- never on array
 * position, and never by truncating to the shorter arm. Both of those silently pair unrelated games
 * and turn common random numbers, the entire reason the two arms share a seed schedule, back into
 * independent noise.
 */
export function compareVariants(baseline, variant, { now } = {}) {
  const instant = assertInstant(now);
  for (const [label, outcome] of [["baseline", baseline], ["variant", variant]]) {
    if (!isRecord(outcome) || !isRecord(outcome.plan) || !Array.isArray(outcome.results)) {
      fail("report_pairing_invalid", `the ${label} arm is not an executed simulation plan`, {
        reason: "arm_invalid",
        arm: label,
      });
    }
  }
  assertComparableArms(baseline, variant);

  // The PAIRING is checked before either arm is aggregated. Two reasons: a structural join defect is
  // cheap to detect and should not hide behind two 10000-replicate bootstraps, and the pairing reads
  // the published per-game rows while aggregation re-validates them against their cell counts -- so
  // checking the join first keeps a truncated or duplicated row reported as the pairing defect it is
  // rather than as a row/count disagreement.
  const basePairs = pairsByCell(baseline);
  const variantPairs = pairsByCell(variant);
  if (basePairs.size !== variantPairs.size) {
    fail("report_pairing_invalid", "the two arms do not cover the same strata", { reason: "strata_mismatch" });
  }

  const cells = [];
  const discordant = { play: 0, draw: 0 };
  for (const [key, base] of basePairs) {
    const other = variantPairs.get(key);
    if (other === undefined) {
      fail("report_pairing_invalid", "a stratum is present on only one arm", {
        reason: "strata_mismatch",
        pairingKey: key,
      });
    }
    if (base.bySeed.size !== other.bySeed.size) {
      fail("report_pairing_invalid", "the two arms played a different number of games in one stratum", {
        reason: "unpaired_seed",
        pairingKey: key,
        baseline: base.bySeed.size,
        variant: other.bySeed.size,
      });
    }
    // Sorted by seed, so the pair ORDER (and therefore the bootstrap) is a function of the seeds
    // themselves rather than of either arm's row order.
    const seeds = [...base.bySeed.keys()].sort((left, right) => left - right);
    const diffs = new Int8Array(seeds.length);
    for (const [index, seed] of seeds.entries()) {
      if (!other.bySeed.has(seed)) {
        fail("report_pairing_invalid", "a seed played on one arm was not played on the other", {
          reason: "unpaired_seed",
          pairingKey: key,
          seed,
        });
      }
      const delta = other.bySeed.get(seed) - base.bySeed.get(seed);
      diffs[index] = delta;
      if (delta !== 0) discordant[base.seat] += 1;
    }
    cells.push({ key, seat: base.seat, diffs });
  }

  const baselineReport = aggregateEnvironment({ ...baseline, now: instant });
  const variantReport = aggregateEnvironment({ ...variant, now: instant });

  const template = baseline.plan.strata.map((row) => ({
    archetypeId: row.archetypeId,
    fieldWeight: row.fieldWeight,
    representatives: row.representatives.map((representative) => ({
      withinArchetypeWeight: representative.withinArchetypeWeight,
      pairingKeyPlay: pairingKeyFor({
        archetypeId: row.archetypeId,
        opponentGameplayHash: representative.gameplayHash,
        seat: "play",
      }),
      pairingKeyDraw: pairingKeyFor({
        archetypeId: row.archetypeId,
        opponentGameplayHash: representative.gameplayHash,
        seat: "draw",
      }),
    })),
  }));
  const turnOrderWeights = baselineReport.ev.turnOrderWeights;
  const play = new Float64Array(BOOTSTRAP_REPLICATES);
  const draw = new Float64Array(BOOTSTRAP_REPLICATES);
  const overall = new Float64Array(BOOTSTRAP_REPLICATES);
  let pairedDraws = 0;
  const rawNext = createXorshift32(BOOTSTRAP_SEED);
  const next = () => {
    pairedDraws += 1;
    return rawNext();
  };
  for (let replicate = 0; replicate < BOOTSTRAP_REPLICATES; replicate += 1) {
    const means = new Map();
    for (const cell of cells) {
      // The PAIR is the resampling unit: both arms' games for one seed move together, which is what
      // keeps the common random numbers doing their job inside the interval too.
      let total = 0;
      const n = cell.diffs.length;
      for (let draws = 0; draws < n; draws += 1) total += cell.diffs[next() % n];
      means.set(cell.key, total / n);
    }
    const strata = template.map((row) => ({
      archetypeId: row.archetypeId,
      fieldWeight: row.fieldWeight,
      representatives: row.representatives.map((representative) => ({
        withinArchetypeWeight: representative.withinArchetypeWeight,
        winRate: {
          play: means.get(representative.pairingKeyPlay),
          draw: means.get(representative.pairingKeyDraw),
        },
      })),
    }));
    play[replicate] = weightedSeatEv(strata, "play");
    draw[replicate] = weightedSeatEv(strata, "draw");
    overall[replicate] = turnOrderWeights.play * play[replicate] + turnOrderWeights.draw * draw[replicate];
  }

  // Counted, published as `paired.rngDraws`, and asserted in the tests -- same reasoning as the
  // aggregate resampler above: no unreachable internal assertion.
  const pairCount = cells.reduce((total, cell) => total + cell.diffs.length, 0);
  const draft = {
    schemaVersion: 1,
    kind: COMPARISON_KIND,
    baseline: baselineReport,
    variant: variantReport,
    paired: {
      join: "pairingKey_and_seed",
      pairs: pairCount,
      label: "simulationMonteCarlo95",
      seed: BOOTSTRAP_SEED,
      replicates: BOOTSTRAP_REPLICATES,
      rngDraws: pairedDraws,
      excludes: [...CONFIDENCE_EXCLUSIONS],
      discordantPairs: {
        play: discordant.play,
        draw: discordant.draw,
        overall: discordant.play + discordant.draw,
      },
      // The point estimate is the difference of the two seat EVs. That IS the weighted mean paired
      // difference MATHEMATICALLY -- the mean of per-seed differences in a cell is the difference of
      // its rates -- but the two evaluation orders are not bitwise identical: measured, they differ
      // by ~2.8e-17 (play) and ~3.2e-17 (draw) from IEEE-754 summation order. The difference of the
      // two published EVs is used because those are the numbers the report states. The bootstrap
      // supplies only the interval.
      play: { mean: variantReport.ev.play - baselineReport.ev.play, ...percentile95(play) },
      draw: { mean: variantReport.ev.draw - baselineReport.ev.draw, ...percentile95(draw) },
      overall: { mean: variantReport.ev.overall - baselineReport.ev.overall, ...percentile95(overall) },
    },
  };
  return freezeDeep({
    ...draft,
    contentHash: hashProjection(draft, ["contentHash", "generatedAt"]),
    generatedAt: instant,
  });
}

/* ------------------------------------------------------------------ *
 * cross-environment comparison
 * ------------------------------------------------------------------ */

/**
 * SC and EN side by side, and nothing more. Two environments are two POPULATIONS: there is no
 * shared denominator, no ranking across them, and no single blended score -- only each
 * environment's own report and, when both produced one, an explicitly labelled difference with no
 * confidence interval of its own (the two intervals are over different populations, so a difference
 * interval would imply a joint sampling model that does not exist). An environment whose candidate
 * is illegal stays visible as its own explicit cell rather than disappearing from the table.
 */
export function compareEnvironments(entries, { now } = {}) {
  const instant = assertInstant(now);
  if (!Array.isArray(entries) || entries.length < 2) {
    fail("report_comparison_invalid", "a cross-environment comparison needs at least two environments", {
      reason: "single_environment",
      environments: Array.isArray(entries) ? entries.length : 0,
    });
  }
  const seenManifests = new Set();
  const environments = entries.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.label !== "string" || entry.label.length === 0) {
      fail("report_comparison_invalid", "every environment needs an explicit label", {
        reason: "label_missing",
        index,
      });
    }
    if (isRecord(entry.report)) {
      const manifestId = entry.report.manifestRef.manifestId;
      if (seenManifests.has(manifestId)) {
        fail("report_comparison_invalid", "one Manifest cannot be compared against itself", {
          reason: "identical_manifest",
          manifestId,
        });
      }
      seenManifests.add(manifestId);
      return {
        label: entry.label,
        status: "reported",
        manifestRef: { ...entry.report.manifestRef },
        environmentKey: entry.report.environmentKey,
        evaluationMode: entry.report.evaluationMode,
        method: entry.report.method,
        applicability: entry.report.applicability,
        officialStrengthClaim: entry.report.officialStrengthClaim,
        report: entry.report,
        details: null,
      };
    }
    if (!isRecord(entry.failure) || typeof entry.failure.code !== "string") {
      fail("report_comparison_invalid", "an environment must supply a report or a stated failure", {
        reason: "entry_invalid",
        index,
      });
    }
    return {
      label: entry.label,
      status: entry.failure.code,
      manifestRef: isRecord(entry.failure.manifestRef) ? { ...entry.failure.manifestRef } : null,
      environmentKey: entry.failure.environmentKey ?? null,
      evaluationMode: null,
      method: null,
      applicability: null,
      officialStrengthClaim: false,
      report: null,
      details: isRecord(entry.failure.details) ? { ...entry.failure.details } : {},
    };
  });

  const reported = environments.filter((environment) => environment.report !== null);
  const difference = environments.length === 2 && reported.length === 2
    ? {
      label: `${environments[0].label} minus ${environments[1].label}`,
      play: environments[0].report.ev.play - environments[1].report.ev.play,
      draw: environments[0].report.ev.draw - environments[1].report.ev.draw,
      overall: environments[0].report.ev.overall - environments[1].report.ev.overall,
      // Two populations, so there is no joint sampling distribution to draw an interval from and no
      // denominator to state. Both stay explicitly null rather than being quietly omitted.
      confidence: null,
      denominator: null,
    }
    : null;

  const draft = {
    schemaVersion: 1,
    kind: ENVIRONMENT_COMPARISON_KIND,
    environments,
    difference,
  };
  return freezeDeep({
    ...draft,
    contentHash: hashProjection(draft, ["contentHash", "generatedAt"]),
    generatedAt: instant,
  });
}

