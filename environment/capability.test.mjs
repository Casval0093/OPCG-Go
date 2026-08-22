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

function deckSnapshotFor(mainGameplayId, idStem) {
  return buildDeckSnapshot(
    {
      name: "Capability gate deck",
      leader: "OP16-001",
      main: Array.from({ length: 50 }, () => mainGameplayId),
    },
    {
      asOf: "2026-08-20",
      source: { adapter: "fixture", capturedAt: "2026-08-20T00:00:00Z" },
      idStem,
    },
  );
}

function validDeckSnapshot() {
  return deckSnapshotFor("OP16-002", "deck-capability-fixture");
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
    "trigger_activation_forced",
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
  // I1: this used to be `deck("OP16-003")`, the bare shorthand. Once deck authentication was added
  // (see "capability gate accepts only a real hash-valid DeckSnapshot..."), that bare object throws
  // on authentication before coverage is ever consulted -- so the assertion kept passing even under
  // a mutant that forces every row `executable = true`, no longer distinguishing anything about
  // printed-only cards. A real DeckSnapshot referencing OP16-003 reaches the coverage check, where
  // it must be rejected on `details.missing`, restoring the test's teeth.
  assert.throws(
    () => evaluateCapabilityGate(capability, [deckSnapshotFor("OP16-003", "deck-capability-fixture-op16-003")]),
    (error) => error instanceof EnvironmentError
      && error.code === "simulation_not_ready"
      && error.details.missing.includes("OP16-003"),
  );
});

test("I1: a row with printed text but no structured effects computes executable: false", () => {
  const capability = buildCapabilitySnapshot(capabilityInput());
  const op16003 = capability.data.gameplayCoverage.find((row) => row.gameplayId === "OP16-003");
  assert.ok(op16003, "expected OP16-003 in gameplayCoverage");
  assert.equal(op16003.hasStructuredEffects, false);
  assert.notEqual(op16003.effectText, null);
  assert.equal(op16003.executable, false);
});

test("vanilla rows are executable only when both printed texts and structured effects are absent", () => {
  const input = capabilityInput({
    catalogRows: catalogRows().filter((row) => row.gameplayId !== "OP16-003"),
  });
  input.catalogContentHash = sha256Canonical(input.catalogRows);
  const capability = buildCapabilitySnapshot(input);
  // A real hash-valid DeckSnapshot, not the bare deck() shorthand: the gate now re-authenticates
  // every deck argument's own identity (see "capability gate accepts only a real hash-valid
  // DeckSnapshot..."), which is orthogonal to what THIS test asserts (vanilla-row executability),
  // so it needs a genuinely valid deck to reach that assertion at all.
  assert.equal(evaluateCapabilityGate(capability, [validDeckSnapshot()]).mode, "diagnostic_estimate");
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
  // Same reasoning as the vanilla-row test above: this test is about limitation-closure driving
  // official mode, not deck identity, so it needs a real hash-valid DeckSnapshot to pass the
  // gate's (orthogonal) deck-authentication check.
  assert.deepEqual(evaluateCapabilityGate(capability, [validDeckSnapshot()]), {
    mode: "official",
    officialReady: true,
    blockers: [],
  });
});

test("I3: verifyCapabilitySnapshot recomputes executable from retained evidence and rejects a forged flag", () => {
  const capability = buildCapabilitySnapshot(capabilityInput());
  const forged = structuredClone(capability);
  delete forged.snapshotId;
  delete forged.contentHash;
  const op16003 = forged.data.gameplayCoverage.find((row) => row.gameplayId === "OP16-003");
  assert.equal(op16003.executable, false);
  op16003.executable = true; // lies: retained evidence still shows printed text, no structured effects
  const hashValidForged = finalizeSnapshot(forged, "capability-forged-executable");
  assert.throws(
    () => verifyCapabilitySnapshot(hashValidForged),
    (error) => error instanceof EnvironmentError && error.code === "capability_invalid",
  );
  assert.throws(
    () => evaluateCapabilityGate(hashValidForged, [deckSnapshotFor("OP16-003", "deck-capability-fixture-op16-003-forged")]),
    (error) => error instanceof EnvironmentError && error.code === "capability_invalid",
  );
});

test("I4: a forged closed status without a genuinely different reviewed definition fails verification", () => {
  const capability = buildCapabilitySnapshot(capabilityInput());
  const forged = structuredClone(capability);
  delete forged.snapshotId;
  delete forged.contentHash;
  // Flip every blocker to closed IN PLACE, i.e. without ever going through a genuinely different
  // reviewed limitations file (and therefore a genuinely different limitationDefinitionHash).
  forged.data.blockingLimitations = forged.data.blockingLimitations.map((row) => ({
    ...row,
    status: "closed",
    blocksOfficialStrength: false,
  }));
  const hashValidForged = finalizeSnapshot(forged, "capability-forged-closed");
  assert.throws(
    () => verifyCapabilitySnapshot(hashValidForged),
    (error) => error instanceof EnvironmentError && error.code === "capability_invalid",
  );
  assert.throws(
    () => evaluateCapabilityGate(hashValidForged, [validDeckSnapshot()]),
    (error) => error instanceof EnvironmentError && error.code === "capability_invalid",
  );
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

/* ------------------------------------------------------------------ *
 * I-3 (final fix wave) — the register IS the gate, so it must cover
 * every documented open defect and every anchor must resolve
 * ------------------------------------------------------------------ */

// GitHub's heading-slug rules, reduced to what this repository's headings actually use: lowercase,
// drop everything that is not a word character, a CJK character, a hyphen or a space, then replace
// EACH remaining space with a hyphen -- one per space, not one per run. That distinction is
// load-bearing: an em dash between two spaces is dropped and leaves the `--` GitHub actually
// produces, so a link in the register resolves for a human reader too, not just for this test.
function headingSlug(heading) {
  return heading
    .toLowerCase()
    .replace(/[^\w一-鿿\- ]/gu, "")
    .trim()
    .replace(/ /gu, "-");
}

function headingSlugsOf(relativePath) {
  const text = readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return new Set(
    text.split("\n")
      .filter((line) => /^#{1,6} /u.test(line))
      .map((line) => headingSlug(line.replace(/^#{1,6} /u, ""))),
  );
}

test("I-3: every reviewed limitation's evidenceLocation resolves to a real document heading", () => {
  assert.ok(limitations.limitations.length > 0);
  const slugsByPath = new Map();
  for (const row of limitations.limitations) {
    const [relativePath, anchor] = row.evidenceLocation.split("#");
    assert.ok(relativePath && anchor, `${row.code}: evidenceLocation must be <path>#<anchor>`);
    if (!slugsByPath.has(relativePath)) slugsByPath.set(relativePath, headingSlugsOf(relativePath));
    assert.ok(
      slugsByPath.get(relativePath).has(anchor),
      `${row.code}: ${row.evidenceLocation} resolves to no heading in ${relativePath}`,
    );
  }
});

test("I-3: the register carries a reviewed row for every documented open engine limitation", () => {
  // The two documents that describe this gate name five defects. They map onto these rows, and
  // `counter_and_block_policy_missing` deliberately carries two of them because the counter step
  // and the block step are one resolver branch with one fix. A defect that is documented as open
  // but has NO row is invisible to evaluateCapabilityGate — closing the recorded rows would then
  // open the gate while a real defect stands, which is the forgery this register exists to stop.
  assert.deepEqual(limitations.limitations.map((row) => row.code).sort(), [
    "attack_target_policy_missing",
    "counter_and_block_policy_missing",
    "second_player_first_turn_attack",
    "trigger_activation_forced",
  ]);
  for (const row of limitations.limitations) {
    assert.equal(row.status, "open", row.code);
    assert.equal(row.blocksOfficialStrength, true, row.code);
    assert.ok(typeof row.affectedCapability === "string" && row.affectedCapability.length > 0, row.code);
  }
  // The gate reads all four, so all four keep a real capability run diagnostic.
  const capability = buildCapabilitySnapshot(capabilityInput());
  const gate = evaluateCapabilityGate(capability, [validDeckSnapshot()]);
  assert.equal(gate.mode, "diagnostic_estimate");
  assert.deepEqual(gate.blockers.map((row) => row.code).sort(), [
    "attack_target_policy_missing",
    "counter_and_block_policy_missing",
    "second_player_first_turn_attack",
    "trigger_activation_forced",
  ]);
});
