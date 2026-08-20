import assert from "node:assert/strict";
import test from "node:test";

import { EnvironmentError } from "./errors.mjs";
import { finalizeSnapshot } from "./snapshot.mjs";
import {
  buildClockSnapshot,
  evaluateClockGate,
  verifyClockSnapshot,
} from "./clock.mjs";

const environment = {
  edition: "SC",
  metagameRegion: "CN",
  language: "zh-Hans",
  formatId: "standard-block2-op16",
  timeZone: "Asia/Shanghai",
};

const rulesSnapshotRef = {
  snapshotId: "sc-rules-1-2-0-aaaaaaaaaaaaaaaa",
  contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

function clockInput(overrides = {}) {
  return {
    ...environment,
    asOf: "2026-08-20",
    source: {
      adapter: "clock-fixture",
      capturedAt: "2026-08-20T00:00:00Z",
    },
    coverage: {
      status: "complete",
      warnings: [],
      missingFields: [],
    },
    rulesSnapshotRef,
    tournamentStage: "swiss",
    roundDurationMinutes: 30,
    inputFeatures: [
      { name: "turnCount", type: "integer", source: "simulation.turn_end" },
      { name: "commandCount", type: "integer", source: "simulation.command" },
    ],
    simulationEvents: [
      { name: "turn_end", fields: ["turnNumber", "elapsedMs"] },
      { name: "normal_end", fields: ["winner"] },
    ],
    calibrationDatasets: [
      {
        datasetId: "sc-clock-calibration-2026-08",
        contentHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        population: "SC Swiss simulation/replay sample",
        dateFrom: "2026-08-01",
        dateUntil: "2026-08-15",
        elapsedTimeLabels: ["elapsed_ms", "normal_end_elapsed_ms"],
      },
    ],
    algorithm: {
      version: "clock-logistic-v1",
      parameters: { intercept: -1.2, turnCount: 0.08, commandCount: 0.01 },
      classificationThreshold: 0.5,
      deterministicInference: "sorted feature names; IEEE-754 float64; no random seed",
    },
    heldOutMetrics: {
      sampleCount: 1000,
      brierScore: 0.12,
      calibrationError: 0.03,
    },
    acceptancePolicy: {
      required: true,
      maxBrierScore: 0.2,
      maxCalibrationError: 0.1,
    },
    acceptance: "accepted",
    effectiveFrom: "2026-08-20",
    effectiveUntil: "2026-09-20",
    roundTimeoutPolicy: {
      stage: "swiss",
      roundDurationMinutes: 30,
      timeoutScoring: "double-loss",
      rulesSnapshotRef,
    },
    ...overrides,
  };
}

function applicableIdentity(overrides = {}) {
  return {
    ...environment,
    asOf: "2026-08-20",
    tournamentStage: "swiss",
    roundDurationMinutes: 30,
    rulesSnapshotRef,
    ...overrides,
  };
}

function hashValidClockWithoutSemanticContract() {
  return finalizeSnapshot(
    {
      schemaVersion: 1,
      kind: "clock-model",
      environment,
      asOf: "2026-08-20",
      source: { adapter: "forged", capturedAt: "2026-08-20T00:00:00Z" },
      coverage: { status: "complete", warnings: [], missingFields: [] },
      data: { acceptance: "accepted" },
    },
    "clock-forged-semantic",
  );
}

test("buildClockSnapshot pins all model inputs and exact timeout policy", () => {
  const snapshot = buildClockSnapshot(clockInput());
  assert.equal(snapshot.kind, "clock-model");
  assert.deepEqual(snapshot.environment, environment);
  assert.deepEqual(snapshot.data.rulesSnapshotRef, rulesSnapshotRef);
  assert.deepEqual(snapshot.data.inputFeatures, clockInput().inputFeatures);
  assert.deepEqual(snapshot.data.simulationEvents, clockInput().simulationEvents);
  assert.deepEqual(snapshot.data.calibrationDatasets, clockInput().calibrationDatasets);
  assert.deepEqual(snapshot.data.algorithm, clockInput().algorithm);
  assert.deepEqual(snapshot.data.heldOutMetrics, clockInput().heldOutMetrics);
  assert.deepEqual(snapshot.data.acceptancePolicy, clockInput().acceptancePolicy);
  assert.deepEqual(snapshot.data.roundTimeoutPolicy, clockInput().roundTimeoutPolicy);
  assert.equal(snapshot.data.effectiveFrom, "2026-08-20");
  assert.equal(snapshot.data.effectiveUntil, "2026-09-20");
});

test("only an accepted applicable Swiss 30-minute model authorizes round_timeout", () => {
  const snapshot = buildClockSnapshot(clockInput());
  assert.deepEqual(evaluateClockGate(snapshot, applicableIdentity(), { now: "2026-08-21T00:00:00Z" }), {
    roundTimeoutPolicy: clockInput().roundTimeoutPolicy,
  });
});

test("null, draft, rejected, semantic bypass, and missing contract fields fail closed", () => {
  const accepted = buildClockSnapshot(clockInput());
  const draft = {
    kind: "clock-model",
    data: { acceptance: "draft" },
  };
  const rejected = buildClockSnapshot(clockInput({ acceptance: "rejected" }));
  const malformed = structuredClone(accepted);
  delete malformed.snapshotId;
  delete malformed.contentHash;
  delete malformed.data.algorithm;
  const hashValidMalformed = finalizeSnapshot(malformed, "clock-forged-missing-algorithm");
  const cases = [null, draft, rejected, hashValidClockWithoutSemanticContract(), hashValidMalformed];
  for (const snapshot of cases) {
    assert.throws(
      () => evaluateClockGate(snapshot, applicableIdentity(), { now: "2026-08-21T00:00:00Z" }),
      (error) => error instanceof EnvironmentError && error.code === "clock_model_unavailable",
    );
  }
  assert.throws(
    () => verifyClockSnapshot(hashValidClockWithoutSemanticContract()),
    (error) => error instanceof EnvironmentError && error.code === "clock_model_unavailable",
  );
  assert.equal(accepted.data.acceptance, "accepted");
});

test("edition, region, language, format, timezone, stage, duration, rules, and interval must match", () => {
  const snapshot = buildClockSnapshot(clockInput());
  const mismatches = [
    { edition: "EN", metagameRegion: "GLOBAL_EN", language: "en" },
    { metagameRegion: "GLOBAL_EN" },
    { language: "en" },
    { formatId: "standard-block1" },
    { timeZone: "UTC" },
    { tournamentStage: "top-cut" },
    { roundDurationMinutes: 25 },
    { rulesSnapshotRef: { ...rulesSnapshotRef, snapshotId: "other-rules-aaaaaaaaaaaaaaaa" } },
    { asOf: "2026-08-19" },
  ];
  for (const mismatch of mismatches) {
    assert.throws(
      () => evaluateClockGate(snapshot, applicableIdentity(mismatch), { now: "2026-08-21T00:00:00Z" }),
      (error) => error instanceof EnvironmentError && error.code === "clock_model_unavailable",
    );
  }
  for (const now of ["2026-08-19T23:59:59Z", "2026-09-21T00:00:00Z"]) {
    assert.throws(
      () => evaluateClockGate(snapshot, applicableIdentity(), { now }),
      (error) => error instanceof EnvironmentError && error.code === "clock_model_unavailable",
    );
  }
});

test("computational budgets and engine terminations never become round_timeout", () => {
  assert.throws(
    () => buildClockSnapshot(clockInput({ computationalTurnBudget: 40 })),
    (error) => error instanceof EnvironmentError && error.code === "clock_model_invalid",
  );
  const snapshot = buildClockSnapshot(clockInput());
  assert.throws(
    () => evaluateClockGate(
      snapshot,
      applicableIdentity({ terminationCause: "turn_budget_exhausted" }),
      { now: "2026-08-21T00:00:00Z" },
    ),
    (error) => error instanceof EnvironmentError && error.code === "clock_model_unavailable",
  );
});
