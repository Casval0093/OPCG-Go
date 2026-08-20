import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { EnvironmentError } from "./errors.mjs";
import { sha256Canonical } from "./hash.mjs";
import { finalizeSnapshot } from "./snapshot.mjs";
import { buildDeckSnapshot, gameplayHashForDeck } from "./deck.mjs";
import {
  buildCapabilitySnapshot,
  evaluateCapabilityGate,
  verifyCapabilitySnapshot,
} from "./capability.mjs";

const limitations = JSON.parse(readFileSync(
  new URL("../data/environment-definitions/simulation-limitations-v1.json", import.meta.url),
));

const environment = {
  edition: "SC",
  metagameRegion: "CN",
  language: "zh-Hans",
  formatId: "standard-block2-op16",
  timeZone: "Asia/Shanghai",
};

function catalogRows() {
  return [
    {
      printingId: "OP16-001",
      gameplayId: "OP16-001",
      effectText: "[Activate: Main] ...",
      triggerText: null,
      hasStructuredEffects: true,
    },
    {
      printingId: "OP16-001_p2",
      gameplayId: "OP16-001",
      effectText: "[Activate: Main] ...",
      triggerText: null,
      hasStructuredEffects: true,
    },
    {
      printingId: "OP16-002",
      gameplayId: "OP16-002",
      effectText: null,
      triggerText: null,
      hasStructuredEffects: false,
    },
    {
      printingId: "OP16-003",
      gameplayId: "OP16-003",
      effectText: "[On Play] Draw 1 card.",
      triggerText: null,
      hasStructuredEffects: false,
    },
  ];
}

function capabilityInput(overrides = {}) {
  const rows = catalogRows();
  return {
    ...environment,
    asOf: "2026-08-20",
    source: {
      adapter: "fixture",
      capturedAt: "2026-08-20T00:00:00Z",
    },
    coverage: {
      status: "complete",
      warnings: [],
      missingFields: [],
    },
    engineRevision: "engine-commit-fixture",
    engineWorktreeHash: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    patchDefinitionHash: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
    policySourceHash: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
    catalogContentHash: sha256Canonical(rows),
    catalogRows: rows,
    patchCheck: { status: "passed", command: "patch_engine.py --check" },
    limitations,
    ...overrides,
  };
}

function deck(...gameplayIds) {
  return {
    kind: "deck",
    data: {
      leaderGameplayId: "OP16-001",
      mainDeckCounts: Object.fromEntries(gameplayIds.map((id) => [id, 1])),
    },
  };
}

function validDeckSnapshot() {
  return buildDeckSnapshot(
    {
      name: "Capability gate deck",
      leader: "OP16-001",
      main: Array.from({ length: 50 }, () => "OP16-002"),
    },
    {
      asOf: "2026-08-20",
      source: { adapter: "fixture", capturedAt: "2026-08-20T00:00:00Z" },
      idStem: "deck-capability-fixture",
    },
  );
}

function hashValidDeckWithoutSemanticContract() {
  return finalizeSnapshot(
    {
      schemaVersion: 1,
      kind: "deck",
      environment: { scope: "edition-neutral" },
      asOf: "2026-08-20",
      source: { adapter: "forged", capturedAt: "2026-08-20T00:00:00Z" },
      coverage: { status: "complete", warnings: [], missingFields: [] },
      data: {
        leaderGameplayId: "OP16-001",
        mainDeckCounts: { "OP16-002": 1 },
        mainDeckSize: 1,
      },
    },
    "deck-forged-capability",
  );
}

test("buildCapabilitySnapshot pins live identity and aggregates canonical gameplay coverage", () => {
  const capability = buildCapabilitySnapshot(capabilityInput());

  assert.equal(capability.kind, "simulation-capability");
  assert.deepEqual(capability.environment, environment);
  assert.equal(capability.data.engineRevision, "engine-commit-fixture");
  assert.equal(capability.data.catalogContentHash, capabilityInput().catalogContentHash);
  assert.deepEqual(capability.data.blockingLimitations.map((row) => row.code), [
    "second_player_first_turn_attack",
    "counter_and_block_policy_missing",
    "attack_target_policy_missing",
  ]);

  const ace = capability.data.gameplayCoverage.find((row) => row.gameplayId === "OP16-001");
  assert.deepEqual(ace.printingIds, ["OP16-001", "OP16-001_p2"]);
  assert.equal(ace.executable, true);
});

test("evaluateCapabilityGate returns diagnostic mode while reviewed blockers remain open", () => {
  const capability = buildCapabilitySnapshot(capabilityInput());
  assert.deepEqual(evaluateCapabilityGate(capability, [validDeckSnapshot()]), {
    mode: "diagnostic_estimate",
    officialReady: false,
    blockers: capability.data.blockingLimitations,
  });
});

test("capability snapshots fail closed on partial or structurally incomplete coverage", () => {
  assert.throws(
    () => buildCapabilitySnapshot(capabilityInput({
      coverage: { status: "partial", warnings: [], missingFields: ["catalog"] },
    })),
    (error) => error instanceof EnvironmentError && error.code === "capability_invalid",
  );
  assert.throws(
    () => buildCapabilitySnapshot(capabilityInput({
      coverage: { status: "complete", warnings: [] },
    })),
    (error) => error instanceof EnvironmentError && error.code === "capability_invalid",
  );
});

test("capability gate accepts only a real hash-valid DeckSnapshot and rechecks its gameplay identity", () => {
  const capability = buildCapabilitySnapshot(capabilityInput());
  assert.equal(evaluateCapabilityGate(capability, [validDeckSnapshot()]).officialReady, false);
  assert.throws(
    () => evaluateCapabilityGate(capability, [deck("OP16-002")]),
    /simulation_not_ready/,
  );
  assert.throws(
    () => evaluateCapabilityGate(capability, [hashValidDeckWithoutSemanticContract()]),
    (error) => error instanceof EnvironmentError && error.code === "simulation_not_ready",
  );

  const tampered = structuredClone(validDeckSnapshot());
  tampered.data.gameplayHash = gameplayHashForDeck("OP16-001", { "OP16-002": 49 });
  assert.throws(
    () => evaluateCapabilityGate(capability, [tampered]),
    (error) => error instanceof EnvironmentError && error.code === "simulation_not_ready",
  );
});

test("evaluateCapabilityGate rejects unknown and printed-only gameplay IDs", () => {
  const capability = buildCapabilitySnapshot(capabilityInput());

  assert.throws(
    () => evaluateCapabilityGate(capability, [deck("OP16-999")]),
    (error) => error instanceof EnvironmentError
      && error.code === "simulation_not_ready"
      && error.details.missing.includes("OP16-999"),
  );
  assert.throws(
    () => evaluateCapabilityGate(capability, [deck("OP16-003")]),
    /simulation_not_ready/,
  );
});

test("vanilla rows are executable only when both printed texts and structured effects are absent", () => {
  const input = capabilityInput({
    catalogRows: catalogRows().filter((row) => row.gameplayId !== "OP16-003"),
  });
  input.catalogContentHash = sha256Canonical(input.catalogRows);
  const capability = buildCapabilitySnapshot(input);
  assert.equal(evaluateCapabilityGate(capability, [deck("OP16-002")]).mode, "diagnostic_estimate");
});

test("conflicting printing evidence fails closed instead of inheriting an alternate printing", () => {
  const rows = catalogRows();
  rows.push({
    printingId: "OP16-001_p3",
    gameplayId: "OP16-001",
    effectText: "[Activate: Main] ...",
    triggerText: null,
    hasStructuredEffects: false,
  });
  assert.throws(
    () => buildCapabilitySnapshot(capabilityInput({
      catalogRows: rows,
      catalogContentHash: sha256Canonical(rows),
    })),
    (error) => error instanceof EnvironmentError && error.code === "catalog_incomplete",
  );
});

test("a closed limitation definition can produce an official capability result", () => {
  const capability = buildCapabilitySnapshot(capabilityInput({
    limitations: {
      ...limitations,
      limitations: limitations.limitations.map((row) => ({ ...row, status: "closed", blocksOfficialStrength: false })),
    },
  }));
  assert.deepEqual(evaluateCapabilityGate(capability, [deck("OP16-002")]), {
    mode: "official",
    officialReady: true,
    blockers: [],
  });
});

test("verifyCapabilitySnapshot rejects hash-valid semantic bypasses and every open blocker is diagnostic", () => {
  const capability = buildCapabilitySnapshot(capabilityInput());
  const forged = structuredClone(capability);
  delete forged.snapshotId;
  delete forged.contentHash;
  forged.data.catalogRowCount = 999;
  const hashValidForged = finalizeSnapshot(forged, "capability-forged-count");
  assert.throws(
    () => verifyCapabilitySnapshot(hashValidForged),
    (error) => error instanceof EnvironmentError && error.code === "capability_invalid",
  );

  const openButUnflagged = buildCapabilitySnapshot(capabilityInput({
    limitations: {
      ...limitations,
      limitations: limitations.limitations.map((row) => ({ ...row, blocksOfficialStrength: false })),
    },
  }));
  assert.equal(evaluateCapabilityGate(openButUnflagged, [validDeckSnapshot()]).mode, "diagnostic_estimate");
});
