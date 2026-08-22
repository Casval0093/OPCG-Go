import { EnvironmentError } from "./errors.mjs";
import { assertNativeEnvironment, dateInInterval, FULL_HASH_PATTERN } from "./rules.mjs";
import { finalizeSnapshot, verifySnapshot } from "./snapshot.mjs";

const CLOCK_KIND = "clock-model";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ACCEPTANCE_VALUES = new Set(["accepted", "draft", "rejected"]);

// A tournament clock model may authorize `round_timeout` -- but a computational ceiling or an
// engine/search termination is a DIFFERENT thing that must never be confused with it (CLAUDE.md:
// "computational ceilings and engine terminations are never round_timeout"). Rejecting these key
// names at build time makes it structurally impossible to even construct a clock model that folds
// a computational budget into itself, rather than trusting every caller to leave the field out.
const FORBIDDEN_COMPUTATIONAL_KEYS = [
  "computationalTurnBudget",
  "turnBudget",
  "computationalCeiling",
  "engineTermination",
  "terminationCause",
];

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fail(code, message = code, details = {}) {
  const rendered = message.startsWith(`${code}:`) ? message : `${code}: ${message}`;
  throw new EnvironmentError(code, rendered, details);
}

function requiredString(value, path, code) {
  if (typeof value !== "string" || value.length === 0) {
    fail(code, `${path} must be a non-empty string`, { path, value });
  }
  return value;
}

function requiredNumber(value, path, code) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(code, `${path} must be a finite number`, { path, value });
  }
  return value;
}

function requiredBoolean(value, path, code) {
  if (typeof value !== "boolean") fail(code, `${path} must be a boolean`, { path, value });
  return value;
}

function fullHash(value, path, code) {
  if (typeof value !== "string" || !FULL_HASH_PATTERN.test(value)) {
    fail(code, `${path} must be a full sha256 hash`, { path, value });
  }
  return value;
}

function localDate(value, path, code) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    fail(code, `${path} must be a local calendar date`, { path, value });
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    fail(code, `${path} must be a valid local calendar date`, { path, value });
  }
  return value;
}

function nonEmptyArray(value, path, code) {
  if (!Array.isArray(value) || value.length === 0) {
    fail(code, `${path} must be a non-empty array`, { path });
  }
  return value;
}

function normalizeRulesRef(ref, path, code) {
  if (!isRecord(ref)) fail(code, `${path} must be an object`, { path });
  requiredString(ref.snapshotId, `${path}.snapshotId`, code);
  fullHash(ref.contentHash, `${path}.contentHash`, code);
  return ref;
}

function normalizeInputFeatures(value, code) {
  nonEmptyArray(value, "inputFeatures", code);
  value.forEach((feature, index) => {
    if (!isRecord(feature)) fail(code, `inputFeatures[${index}] must be an object`, { index });
    requiredString(feature.name, `inputFeatures[${index}].name`, code);
    requiredString(feature.type, `inputFeatures[${index}].type`, code);
    requiredString(feature.source, `inputFeatures[${index}].source`, code);
  });
  return value;
}

function normalizeSimulationEvents(value, code) {
  nonEmptyArray(value, "simulationEvents", code);
  value.forEach((event, index) => {
    if (!isRecord(event)) fail(code, `simulationEvents[${index}] must be an object`, { index });
    requiredString(event.name, `simulationEvents[${index}].name`, code);
    nonEmptyArray(event.fields, `simulationEvents[${index}].fields`, code);
    event.fields.forEach((field, fieldIndex) => (
      requiredString(field, `simulationEvents[${index}].fields[${fieldIndex}]`, code)
    ));
  });
  return value;
}

function normalizeCalibrationDatasets(value, code) {
  nonEmptyArray(value, "calibrationDatasets", code);
  value.forEach((dataset, index) => {
    const path = `calibrationDatasets[${index}]`;
    if (!isRecord(dataset)) fail(code, `${path} must be an object`, { index });
    requiredString(dataset.datasetId, `${path}.datasetId`, code);
    fullHash(dataset.contentHash, `${path}.contentHash`, code);
    requiredString(dataset.population, `${path}.population`, code);
    localDate(dataset.dateFrom, `${path}.dateFrom`, code);
    localDate(dataset.dateUntil, `${path}.dateUntil`, code);
    if (dataset.dateFrom > dataset.dateUntil) {
      fail(code, `${path} date range is reversed`, {
        path,
        dateFrom: dataset.dateFrom,
        dateUntil: dataset.dateUntil,
      });
    }
    nonEmptyArray(dataset.elapsedTimeLabels, `${path}.elapsedTimeLabels`, code);
    dataset.elapsedTimeLabels.forEach((label, labelIndex) => (
      requiredString(label, `${path}.elapsedTimeLabels[${labelIndex}]`, code)
    ));
  });
  return value;
}

function normalizeAlgorithm(value, code) {
  if (!isRecord(value)) fail(code, "algorithm must be an object", { path: "algorithm" });
  requiredString(value.version, "algorithm.version", code);
  if (!isRecord(value.parameters)) {
    fail(code, "algorithm.parameters must be an object", { path: "algorithm.parameters" });
  }
  const threshold = requiredNumber(value.classificationThreshold, "algorithm.classificationThreshold", code);
  if (threshold < 0 || threshold > 1) {
    fail(code, "algorithm.classificationThreshold must be between 0 and 1", { threshold });
  }
  requiredString(value.deterministicInference, "algorithm.deterministicInference", code);
  return value;
}

function normalizeHeldOutMetrics(value, code) {
  if (!isRecord(value)) fail(code, "heldOutMetrics must be an object", { path: "heldOutMetrics" });
  const sampleCount = value.sampleCount;
  if (!Number.isSafeInteger(sampleCount) || sampleCount <= 0) {
    fail(code, "heldOutMetrics.sampleCount must be a positive integer", { sampleCount });
  }
  requiredNumber(value.brierScore, "heldOutMetrics.brierScore", code);
  requiredNumber(value.calibrationError, "heldOutMetrics.calibrationError", code);
  return value;
}

function normalizeAcceptancePolicy(value, code) {
  if (!isRecord(value)) fail(code, "acceptancePolicy must be an object", { path: "acceptancePolicy" });
  requiredBoolean(value.required, "acceptancePolicy.required", code);
  requiredNumber(value.maxBrierScore, "acceptancePolicy.maxBrierScore", code);
  requiredNumber(value.maxCalibrationError, "acceptancePolicy.maxCalibrationError", code);
  return value;
}

// I6: the top-level FORBIDDEN_COMPUTATIONAL_KEYS scan in buildClockSnapshot only ever looked at
// `input` itself, so a computational ceiling smuggled inside roundTimeoutPolicy (or nested deeper
// still) rode straight through into the returned policy. This recurses through the whole value.
function assertNoForbiddenComputationalKeysDeep(value, code, path) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenComputationalKeysDeep(item, code, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const key of FORBIDDEN_COMPUTATIONAL_KEYS) {
    if (Object.hasOwn(value, key)) {
      fail(code, "a clock model can never be defined by a computational budget or engine termination", {
        reason: "computational_ceiling_forbidden",
        key,
        path,
      });
    }
  }
  for (const [key, child] of Object.entries(value)) {
    assertNoForbiddenComputationalKeysDeep(child, code, `${path}.${key}`);
  }
}

function normalizeRoundTimeoutPolicy(value, code) {
  if (!isRecord(value)) fail(code, "roundTimeoutPolicy must be an object", { path: "roundTimeoutPolicy" });
  assertNoForbiddenComputationalKeysDeep(value, code, "roundTimeoutPolicy");
  requiredString(value.stage, "roundTimeoutPolicy.stage", code);
  requiredNumber(value.roundDurationMinutes, "roundTimeoutPolicy.roundDurationMinutes", code);
  requiredString(value.timeoutScoring, "roundTimeoutPolicy.timeoutScoring", code);
  normalizeRulesRef(value.rulesSnapshotRef, "roundTimeoutPolicy.rulesSnapshotRef", code);
  return value;
}

// I6: the policy actually RETURNED to the caller must be provably consistent with the model's own
// matched dimensions -- otherwise a model matched on "swiss / 30 minutes" could hand back a
// top-cut / 45-minute / extra-turns policy: exactly the Swiss-double-loss-vs-elimination confusion
// CLAUDE.md records as a hard-won fact (a timed-out Swiss round is a double loss; extra turns and
// the Life-deck-janken tiebreak apply only in finals/elimination, never Swiss).
function assertRoundTimeoutPolicyConsistency(data, code) {
  const policy = data.roundTimeoutPolicy;
  if (policy.stage !== data.tournamentStage) {
    fail(code, "roundTimeoutPolicy.stage does not match the model's own tournamentStage", {
      policyStage: policy.stage,
      tournamentStage: data.tournamentStage,
    });
  }
  if (policy.roundDurationMinutes !== data.roundDurationMinutes) {
    fail(code, "roundTimeoutPolicy.roundDurationMinutes does not match the model's own roundDurationMinutes", {
      policyDuration: policy.roundDurationMinutes,
      modelDuration: data.roundDurationMinutes,
    });
  }
  if (policy.stage === "swiss" && policy.timeoutScoring !== "double-loss") {
    fail(code, "a Swiss roundTimeoutPolicy must score a timeout as a double loss, never extra turns or a tiebreak", {
      timeoutScoring: policy.timeoutScoring,
    });
  }
}

// Shared between build time (`clock_model_invalid`) and verify time (`clock_model_unavailable`):
// the same structural contract, reported under whichever code fits the moment. This guarantees a
// snapshot that builds cleanly always re-verifies cleanly, and a snapshot that's missing a required
// field is rejected the same way whether it was hand-forged or produced by buildClockSnapshot.
function assertClockSemanticContract(data, code) {
  if (!isRecord(data)) fail(code, "clock model data is missing", { path: "data" });
  requiredString(data.tournamentStage, "tournamentStage", code);
  const duration = requiredNumber(data.roundDurationMinutes, "roundDurationMinutes", code);
  if (duration <= 0) fail(code, "roundDurationMinutes must be positive", { roundDurationMinutes: duration });
  normalizeRulesRef(data.rulesSnapshotRef, "rulesSnapshotRef", code);
  normalizeInputFeatures(data.inputFeatures, code);
  normalizeSimulationEvents(data.simulationEvents, code);
  normalizeCalibrationDatasets(data.calibrationDatasets, code);
  normalizeAlgorithm(data.algorithm, code);
  normalizeHeldOutMetrics(data.heldOutMetrics, code);
  normalizeAcceptancePolicy(data.acceptancePolicy, code);
  localDate(data.effectiveFrom, "effectiveFrom", code);
  if (data.effectiveUntil !== null) localDate(data.effectiveUntil, "effectiveUntil", code);
  if (data.effectiveFrom !== null && data.effectiveUntil !== null && data.effectiveFrom > data.effectiveUntil) {
    fail(code, "effective interval is reversed", {
      effectiveFrom: data.effectiveFrom,
      effectiveUntil: data.effectiveUntil,
    });
  }
  normalizeRoundTimeoutPolicy(data.roundTimeoutPolicy, code);
  assertRoundTimeoutPolicyConsistency(data, code);
  if (!ACCEPTANCE_VALUES.has(data.acceptance)) {
    fail(code, "acceptance must be accepted, draft, or rejected", { acceptance: data.acceptance });
  }
  return data;
}

export function buildClockSnapshot(input) {
  if (!isRecord(input)) fail("clock_model_invalid", "clock input must be an object");
  for (const key of FORBIDDEN_COMPUTATIONAL_KEYS) {
    if (Object.hasOwn(input, key)) {
      fail(
        "clock_model_invalid",
        "a clock model can never be defined by a computational budget or engine termination",
        { reason: "computational_ceiling_forbidden", key },
      );
    }
  }
  const environment = assertNativeEnvironment({
    edition: input.edition,
    metagameRegion: input.metagameRegion,
    language: input.language,
    formatId: input.formatId,
    timeZone: input.timeZone,
  });
  const asOf = localDate(input.asOf, "asOf", "clock_model_invalid");
  if (!isRecord(input.source)) fail("clock_model_invalid", "source must be an object", { path: "source" });
  const coverage = input.coverage ?? { status: "complete", warnings: [], missingFields: [] };
  if (!isRecord(coverage)) fail("clock_model_invalid", "coverage must be an object", { path: "coverage" });

  const data = {
    tournamentStage: requiredString(input.tournamentStage, "tournamentStage", "clock_model_invalid"),
    roundDurationMinutes: requiredNumber(input.roundDurationMinutes, "roundDurationMinutes", "clock_model_invalid"),
    rulesSnapshotRef: normalizeRulesRef(input.rulesSnapshotRef, "rulesSnapshotRef", "clock_model_invalid"),
    inputFeatures: normalizeInputFeatures(input.inputFeatures, "clock_model_invalid"),
    simulationEvents: normalizeSimulationEvents(input.simulationEvents, "clock_model_invalid"),
    calibrationDatasets: normalizeCalibrationDatasets(input.calibrationDatasets, "clock_model_invalid"),
    algorithm: normalizeAlgorithm(input.algorithm, "clock_model_invalid"),
    heldOutMetrics: normalizeHeldOutMetrics(input.heldOutMetrics, "clock_model_invalid"),
    acceptancePolicy: normalizeAcceptancePolicy(input.acceptancePolicy, "clock_model_invalid"),
    acceptance: input.acceptance,
    effectiveFrom: localDate(input.effectiveFrom, "effectiveFrom", "clock_model_invalid"),
    effectiveUntil: input.effectiveUntil === null || input.effectiveUntil === undefined
      ? null
      : localDate(input.effectiveUntil, "effectiveUntil", "clock_model_invalid"),
    roundTimeoutPolicy: normalizeRoundTimeoutPolicy(input.roundTimeoutPolicy, "clock_model_invalid"),
  };
  if (data.roundDurationMinutes <= 0) {
    fail("clock_model_invalid", "roundDurationMinutes must be positive", {
      roundDurationMinutes: data.roundDurationMinutes,
    });
  }
  if (!ACCEPTANCE_VALUES.has(data.acceptance)) {
    fail("clock_model_invalid", "acceptance must be accepted, draft, or rejected", {
      acceptance: data.acceptance,
    });
  }
  if (data.effectiveUntil !== null && data.effectiveFrom > data.effectiveUntil) {
    fail("clock_model_invalid", "effective interval is reversed", {
      effectiveFrom: data.effectiveFrom,
      effectiveUntil: data.effectiveUntil,
    });
  }
  assertRoundTimeoutPolicyConsistency(data, "clock_model_invalid");

  return finalizeSnapshot(
    {
      schemaVersion: 1,
      kind: CLOCK_KIND,
      environment,
      asOf,
      source: input.source,
      coverage,
      data,
    },
    input.idStem ?? `clock-model-${environment.edition.toLowerCase()}-${data.tournamentStage}`,
  );
}

export function verifyClockSnapshot(snapshot) {
  if (!isRecord(snapshot)) fail("clock_model_unavailable", "clock model snapshot is missing");
  try {
    verifySnapshot(snapshot);
  } catch (error) {
    fail("clock_model_unavailable", "clock model snapshot failed hash verification", {
      cause: error instanceof EnvironmentError ? error.code : String(error?.message ?? error),
    });
  }
  if (snapshot.kind !== CLOCK_KIND) {
    fail("clock_model_unavailable", "snapshot is not a clock model snapshot", { kind: snapshot.kind });
  }
  assertClockSemanticContract(snapshot.data, "clock_model_unavailable");
  if (snapshot.data.acceptance !== "accepted") {
    fail("clock_model_unavailable", "clock model is not accepted", { acceptance: snapshot.data.acceptance });
  }
  return snapshot;
}

function assertFieldsMatch(identity, snapshot) {
  const environment = snapshot.environment;
  const data = snapshot.data;
  const mismatches = [];
  for (const key of ["edition", "metagameRegion", "language", "formatId", "timeZone"]) {
    if (identity[key] !== environment[key]) mismatches.push(key);
  }
  if (identity.asOf !== snapshot.asOf) mismatches.push("asOf");
  if (identity.tournamentStage !== data.tournamentStage) mismatches.push("tournamentStage");
  if (identity.roundDurationMinutes !== data.roundDurationMinutes) mismatches.push("roundDurationMinutes");
  const identityRef = identity.rulesSnapshotRef;
  if (
    !isRecord(identityRef)
    || identityRef.snapshotId !== data.rulesSnapshotRef.snapshotId
    || identityRef.contentHash !== data.rulesSnapshotRef.contentHash
  ) {
    mismatches.push("rulesSnapshotRef");
  }
  if (mismatches.length > 0) {
    fail("clock_model_unavailable", "clock model does not match the scored identity", { mismatches });
  }
}

function assertClockApplicability(snapshot, identity, options) {
  if (!isRecord(identity)) fail("clock_model_unavailable", "clock identity context is missing");
  // An engine/search termination (turn-budget exhaustion, computational ceiling) is never a genuine
  // tournament timeout: it disqualifies round_timeout authorization outright, independent of
  // whether every other field would otherwise line up.
  if (identity.terminationCause !== undefined && identity.terminationCause !== null) {
    fail("clock_model_unavailable", "an engine or computational termination can never authorize round_timeout", {
      terminationCause: identity.terminationCause,
    });
  }
  assertFieldsMatch(identity, snapshot);
  // I5: this library must never read host-clock time itself. `new Date().toISOString()` is a UTC
  // instant, and a native SC (Asia/Shanghai) model near local midnight has a UTC calendar date one
  // day behind the local one -- silently defaulting here authorized round_timeout using an interval
  // check keyed to the WRONG day, ignoring the identity's own (already-matched) asOf entirely. `now`
  // must be supplied explicitly by the caller; any host-time defaulting belongs at a CLI boundary
  // outside this library, never inside it.
  if (!isRecord(options) || typeof options.now !== "string" || options.now.length === 0) {
    fail("clock_model_unavailable", "clock gate requires an explicit now; the library never reads host clock time", {
      reason: "now_not_provided",
    });
  }
  const { now } = options;
  if (!dateInInterval(now, snapshot.data.effectiveFrom, snapshot.data.effectiveUntil)) {
    fail("clock_model_unavailable", "clock model is not effective at the given time", {
      now,
      effectiveFrom: snapshot.data.effectiveFrom,
      effectiveUntil: snapshot.data.effectiveUntil,
    });
  }
}

export function evaluateClockGate(snapshot, identity, options = {}) {
  verifyClockSnapshot(snapshot);
  assertClockApplicability(snapshot, identity, options);
  return { roundTimeoutPolicy: snapshot.data.roundTimeoutPolicy };
}

export { CLOCK_KIND };
