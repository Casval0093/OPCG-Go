import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { finalizeSnapshot, snapshotRef } from "./snapshot.mjs";
import { buildFieldSnapshot } from "./field.mjs";

const fixtureRoot = join(process.cwd(), "tests/fixtures/environment");
const scIdentity = {
  edition: "SC",
  metagameRegion: "CN",
  language: "zh-Hans",
  formatId: "standard-block2-op16",
  timeZone: "Asia/Shanghai",
};
const fieldWindow = {
  startLocalDate: "2026-07-22",
  asOf: "2026-08-20",
  timeZone: "Asia/Shanghai",
};

function readFixture(name) {
  return JSON.parse(readFileSync(join(fixtureRoot, name), "utf8"));
}

function eventFrom(name, idStem = name.replace(/\.json$/, "")) {
  return finalizeSnapshot(readFixture(name), idStem);
}

function build(events, options = {}) {
  return buildFieldSnapshot({
    events,
    identity: scIdentity,
    window: fieldWindow,
    sourceRefs: events.map(snapshotRef),
    ...options,
  });
}

const eventA = eventFrom("tournament-event-full-field-a.json", "fixture-a");
const eventB = eventFrom("tournament-event-full-field-b.json", "fixture-b");
const topCut = eventFrom("tournament-event-top-cut.json", "fixture-top-cut");

test("buildFieldSnapshot aggregates complete full-field events by total participants", () => {
  const field = build([eventA, eventB]);

  assert.equal(field.kind, "field");
  assert.equal(field.environment.edition, "SC");
  assert.equal(field.data.totalParticipants, 12);
  assert.equal(field.data.classifiedParticipants, 12);
  assert.equal(field.data.unclassifiedParticipants, 0);
  assert.equal(field.data.coveredParticipants, 12);
  assert.deepEqual(field.data.archetypes, [
    { archetypeId: "leader:OP16-001", players: 5, share: 5 / 12 },
    { archetypeId: "leader:OP16-080", players: 7, share: 7 / 12 },
  ]);
  assert.deepEqual(field.data.selectedEvents.map(({ eventKey, participants }) => ({ eventKey, participants })), [
    { eventKey: "fixture-full-field-a", participants: 5 },
    { eventKey: "fixture-full-field-b", participants: 7 },
  ]);
  assert.deepEqual(field.data.excludedEvents, []);
  assert.equal(field.data.coverage.status, "complete");
  assert.equal(field.data.aggregationPolicyId, "participant-count-v1");
  assert.equal(field.source.provider, "opcg-go");
  assert.equal(field.source.surface, "field-aggregation");
});

test("field derivation is deterministic and carries explicit source refs and selection policy", () => {
  const selectionPolicy = {
    id: "fixture-event-selection-v1",
    excluded: [{ eventKey: "fixture-top-cut", reason: "top_cut" }],
  };
  const first = build([eventA, eventB], { selectionPolicy });
  const second = build([eventA, eventB], { selectionPolicy });

  assert.deepEqual(first, second);
  assert.equal(first.contentHash, second.contentHash);
  assert.equal(first.asOf, "2026-08-20");
  assert.equal(first.data.selectionPolicyId, "fixture-event-selection-v1");
  assert.deepEqual(first.data.excludedEvents, selectionPolicy.excluded);
  assert.deepEqual(first.source.sourceRef.eventRefs, [snapshotRef(eventA), snapshotRef(eventB)]);
});

test("top-cut and unknown-frame evidence cannot become field coverage", () => {
  assert.throws(() => build([topCut]), (error) => error.code === "field_not_representative");
  const unknown = finalizeSnapshot({
    ...readFixture("tournament-event-full-field-a.json"),
    data: {
      ...readFixture("tournament-event-full-field-a.json").data,
      evidenceBlocks: {
        ...readFixture("tournament-event-full-field-a.json").data.evidenceBlocks,
        field: {
          ...readFixture("tournament-event-full-field-a.json").data.evidenceBlocks.field,
          sampleFrame: "unknown",
        },
      },
    },
  }, "fixture-unknown");
  assert.throws(() => build([unknown]), (error) => error.code === "field_not_representative");
});

test("denominator disagreements and unresolved mappings fail closed without renormalization", () => {
  const base = readFixture("tournament-event-full-field-a.json");
  const mismatch = finalizeSnapshot({
    ...base,
    data: {
      ...base.data,
      evidenceBlocks: {
        ...base.data.evidenceBlocks,
        field: {
          ...base.data.evidenceBlocks.field,
          denominator: { value: 6, label: "6人" },
        },
      },
    },
  }, "fixture-denominator-mismatch");
  assert.throws(() => build([mismatch]), (error) => error.code === "field_not_representative");

  const unresolved = finalizeSnapshot({
    ...base,
    data: {
      ...base.data,
      evidenceBlocks: {
        ...base.data.evidenceBlocks,
        field: {
          ...base.data.evidenceBlocks.field,
          unresolvedParticipants: 1,
        },
      },
    },
  }, "fixture-unresolved");
  assert.throws(() => build([unresolved]), (error) => error.code === "unresolved_mapping");
});

test("duplicate event keys and conflicting evidence versions are never double-counted", () => {
  assert.throws(() => build([eventA, eventA]), (error) => error.code === "duplicate_event");
  const secondVersion = finalizeSnapshot({
    ...readFixture("tournament-event-full-field-a.json"),
    source: {
      ...readFixture("tournament-event-full-field-a.json").source,
      capturedAt: "2026-08-20T13:00:00Z",
    },
  }, "fixture-a-second-version");
  assert.throws(() => build([eventA, secondVersion]), (error) => error.code === "duplicate_event");
});

test("events outside the inclusive window and cross-environment events are rejected", () => {
  const base = readFixture("tournament-event-full-field-a.json");
  const afterAsOf = finalizeSnapshot({
    ...base,
    data: {
      ...base.data,
      time: { ...base.data.time, localDate: "2026-08-21" },
    },
  }, "fixture-after-as-of");
  assert.throws(() => build([afterAsOf]), (error) => error.code === "field_not_representative");

  const en = finalizeSnapshot({
    ...base,
    environment: {
      edition: "EN",
      metagameRegion: "GLOBAL_EN",
      language: "en",
      formatId: "standard-block2-op16",
      timeZone: "America/New_York",
    },
    data: {
      ...base.data,
      time: { ...base.data.time, timeZone: "America/New_York" },
    },
  }, "fixture-en");
  assert.throws(() => build([en]), (error) => error.code === "environment_identity_mismatch");
});

test("source refs are verified, ordered, and must match their immutable events", () => {
  assert.throws(
    () => build([eventA, eventB], { sourceRefs: [snapshotRef(eventB), snapshotRef(eventA)] }),
    (error) => error.code === "snapshot_ref_mismatch",
  );
  assert.throws(
    () => build([eventA], { sourceRefs: [{ snapshotId: eventA.snapshotId, contentHash: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" }] }),
    (error) => error.code === "snapshot_hash_mismatch" || error.code === "snapshot_ref_mismatch",
  );
});

test("event-selection policy preserves excluded candidates and allows one explicit version", () => {
  const secondVersion = finalizeSnapshot({
    ...readFixture("tournament-event-full-field-a.json"),
    source: {
      ...readFixture("tournament-event-full-field-a.json").source,
      capturedAt: "2026-08-20T13:00:00Z",
    },
  }, "fixture-a-second-version-selection");
  const selected = build([eventA, secondVersion], {
    selectionPolicy: {
      id: "fixture-event-selection-v2",
      selected: [{ eventKey: "fixture-full-field-a", snapshotId: eventA.snapshotId }],
      excluded: [{ eventKey: "fixture-top-cut", reason: "top_cut" }],
    },
  });
  assert.equal(selected.data.selectedEvents.length, 1);
  assert.equal(selected.data.excludedEvents.length, 2);
  assert.equal(selected.data.excludedEvents[1].reason, "not_selected_version");
});
