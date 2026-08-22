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
    // I4: an explicit event-selection policy (with an id) is mandatory input. Tests that care
    // about a specific policy override this via `options`; everything else just needs a valid
    // default so the tightened contract does not have to be repeated in every test.
    selectionPolicy: { id: "fixture-default-selection-v1" },
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

// C1: chooseEvents seeded `excluded` from the policy but never removed those keys from the
// candidate set, so the versions.length === 1 shortcut selected them anyway. An event key that
// a policy both supplies as evidence and excludes is a contradiction and must fail closed,
// never be silently counted.
test("C1: an event key that a policy both supplies and excludes is a duplicate_event, never counted", () => {
  assert.throws(
    () => build([eventA, eventB], {
      selectionPolicy: {
        id: "fixture-c1-conflicting-exclusion",
        excluded: [{ eventKey: "fixture-full-field-a", reason: "duplicate_of_b" }],
      },
    }),
    (error) => error.code === "duplicate_event",
  );
});

// C3: every input event snapshot must declare kind === "tournament_event" exactly. Before the
// fix, any hash-valid snapshot of any kind carrying a field block (via the
// evidenceBlocks.field ?? field alias) was accepted as tournament field evidence.
test("C3: event snapshot kind must be exactly tournament_event", () => {
  const base = readFixture("tournament-event-full-field-a.json");

  const marketIndex = finalizeSnapshot({ ...base, kind: "market_index" }, "fixture-c3-market-index");
  assert.throws(() => build([marketIndex]), (error) => error.code === "field_not_representative");

  const fieldKind = finalizeSnapshot({ ...base, kind: "field" }, "fixture-c3-field-kind");
  assert.throws(() => build([fieldKind]), (error) => error.code === "field_not_representative");

  const madeUp = finalizeSnapshot({ ...base, kind: "totally-made-up" }, "fixture-c3-made-up");
  assert.throws(() => build([madeUp]), (error) => error.code === "field_not_representative");
});

// I1: absent top-level coverage status must fail closed exactly like the strict block-level
// check, evidenceBlocks.results must be complete, and an event's own asOf must not be later
// than the field window's asOf.
test("I1: top-level coverage status absent fails closed instead of being accepted", () => {
  const base = readFixture("tournament-event-full-field-a.json");
  const noCoverageStatus = finalizeSnapshot({
    ...base,
    coverage: {},
  }, "fixture-i1-no-coverage-status");
  assert.throws(() => build([noCoverageStatus]), (error) => error.code === "field_not_representative");
});

test("I1: incomplete results evidence fails closed", () => {
  const base = readFixture("tournament-event-full-field-a.json");
  const incompleteResults = finalizeSnapshot({
    ...base,
    data: {
      ...base.data,
      evidenceBlocks: {
        ...base.data.evidenceBlocks,
        results: { status: "partial" },
      },
    },
  }, "fixture-i1-incomplete-results");
  assert.throws(() => build([incompleteResults]), (error) => error.code === "field_not_representative");
});

// R1 (fix round 2): every evidence block carries its own canonical
// coverage: { status, warnings, missingFields } object - the shape the field block's own
// block.coverage?.status check already reads, and the shape Task 7's normalizer emits. The
// results block must be read the same way (resultsBlock.coverage?.status), not via a flat
// resultsBlock.status. A flat shape (status without a nested coverage object) must now be
// rejected - it reads as coverage being entirely absent, so it fails closed exactly like the
// I1 rule already requires for absent/undeclared coverage elsewhere.
test("R1: results evidence must use the canonical nested coverage.status, not a flat status", () => {
  const base = readFixture("tournament-event-full-field-a.json");

  const nestedComplete = finalizeSnapshot({
    ...base,
    data: {
      ...base.data,
      evidenceBlocks: {
        ...base.data.evidenceBlocks,
        results: { coverage: { status: "complete", warnings: [], missingFields: [] } },
      },
    },
  }, "fixture-r1-results-nested-complete");
  assert.doesNotThrow(() => build([nestedComplete]));

  const nestedIncomplete = finalizeSnapshot({
    ...base,
    data: {
      ...base.data,
      evidenceBlocks: {
        ...base.data.evidenceBlocks,
        results: { coverage: { status: "partial", warnings: ["top_cut"], missingFields: [] } },
      },
    },
  }, "fixture-r1-results-nested-partial");
  assert.throws(() => build([nestedIncomplete]), (error) => error.code === "field_not_representative");

  const absentCoverage = finalizeSnapshot({
    ...base,
    data: {
      ...base.data,
      evidenceBlocks: {
        ...base.data.evidenceBlocks,
        results: {},
      },
    },
  }, "fixture-r1-results-absent-coverage");
  assert.throws(() => build([absentCoverage]), (error) => error.code === "field_not_representative");

  // The old flat shape - exactly what the pre-R1 reader accepted - must now be rejected,
  // because it has no nested coverage object at all.
  const flatShape = finalizeSnapshot({
    ...base,
    data: {
      ...base.data,
      evidenceBlocks: {
        ...base.data.evidenceBlocks,
        results: { status: "complete" },
      },
    },
  }, "fixture-r1-results-flat-shape");
  assert.throws(() => build([flatShape]), (error) => error.code === "field_not_representative");
});

test("I1: an event asOf later than the field window asOf is rejected", () => {
  const base = readFixture("tournament-event-full-field-a.json");
  const futureAsOf = finalizeSnapshot({
    ...base,
    asOf: "2026-08-21",
  }, "fixture-i1-future-asof");
  assert.throws(() => build([futureAsOf]), (error) => error.code === "field_not_representative");
});

// I3: participantCountOf/unresolvedCountOf already cross-check their aliases and fail on
// disagreement; rows/distributionRows, archetypeId/canonicalArchetypeId/canonicalId, and
// players/count/playerCount must follow the same pattern instead of resolving by silent
// precedence.
test("I3: row and block aliases fail closed on disagreement instead of resolving by precedence", () => {
  const base = readFixture("tournament-event-full-field-a.json");

  const playersVsCount = finalizeSnapshot({
    ...base,
    data: {
      ...base.data,
      evidenceBlocks: {
        ...base.data.evidenceBlocks,
        field: {
          ...base.data.evidenceBlocks.field,
          rows: [
            { archetypeId: "leader:OP16-001", players: 2, count: 99 },
            { archetypeId: "leader:OP16-080", players: 3 },
          ],
        },
      },
    },
  }, "fixture-i3-players-count");
  assert.throws(() => build([playersVsCount]), (error) => error.code === "field_not_representative");

  const rowsVsDistributionRows = finalizeSnapshot({
    ...base,
    data: {
      ...base.data,
      evidenceBlocks: {
        ...base.data.evidenceBlocks,
        field: {
          ...base.data.evidenceBlocks.field,
          distributionRows: [
            { archetypeId: "leader:OP16-001", players: 999 },
            { archetypeId: "leader:OP16-080", players: 3 },
          ],
        },
      },
    },
  }, "fixture-i3-rows-distributionrows");
  assert.throws(() => build([rowsVsDistributionRows]), (error) => error.code === "field_not_representative");

  const archetypeIdVsCanonical = finalizeSnapshot({
    ...base,
    data: {
      ...base.data,
      evidenceBlocks: {
        ...base.data.evidenceBlocks,
        field: {
          ...base.data.evidenceBlocks.field,
          rows: [
            { archetypeId: "leader:OP16-001", canonicalArchetypeId: "leader:OP16-080", players: 2 },
            { archetypeId: "leader:OP16-080", players: 3 },
          ],
        },
      },
    },
  }, "fixture-i3-archetype-alias");
  assert.throws(() => build([archetypeIdVsCanonical]), (error) => error.code === "field_not_representative");
});

// I4: the selection policy and its id are mandatory input, explicitSelection entries must be
// validated even for a single-version event key, and a selection matching no supplied candidate
// must fail closed.
test("I4: the selection policy and its id are mandatory input", () => {
  assert.throws(
    () => buildFieldSnapshot({
      events: [eventA],
      identity: scIdentity,
      window: fieldWindow,
      sourceRefs: [snapshotRef(eventA)],
    }),
    (error) => error.code === "duplicate_event",
  );
  assert.throws(
    () => buildFieldSnapshot({
      events: [eventA],
      identity: scIdentity,
      window: fieldWindow,
      sourceRefs: [snapshotRef(eventA)],
      selectionPolicy: {},
    }),
    (error) => error.code === "duplicate_event",
  );
});

test("I4: an explicit selection naming a version that was not supplied fails closed even with only one supplied version", () => {
  assert.throws(
    () => build([eventA], {
      selectionPolicy: {
        id: "fixture-i4-bogus-selection",
        selected: [{ eventKey: "fixture-full-field-a", snapshotId: "bogus-snapshot-id-that-does-not-exist" }],
      },
    }),
    (error) => error.code === "duplicate_event",
  );
});

// I5: through the buildFieldSnapshot path, event-time and window-time defects surface as
// field_not_representative, not the standalone time.mjs time_invalid code.
test("I5: time and window defects surface through buildFieldSnapshot as field_not_representative", () => {
  const base = readFixture("tournament-event-full-field-a.json");

  const unknownPrecision = finalizeSnapshot({
    ...base,
    data: {
      ...base.data,
      time: { precision: "unknown", timeZone: "Asia/Shanghai" },
    },
  }, "fixture-i5-unknown-precision");
  assert.throws(() => build([unknownPrecision]), (error) => error.code === "field_not_representative");

  const { time: _removedTime, ...dataWithoutTime } = base.data;
  const missingTime = finalizeSnapshot({
    ...base,
    data: dataWithoutTime,
  }, "fixture-i5-missing-time");
  assert.throws(() => build([missingTime]), (error) => error.code === "field_not_representative");

  assert.throws(
    () => build([eventA], { window: { ...fieldWindow, asOf: "2026-13-40" } }),
    (error) => error.code === "field_not_representative",
  );

  assert.throws(
    () => build([eventA], { window: { ...fieldWindow, startLocalDate: "2026-08-25" } }),
    (error) => error.code === "field_not_representative",
  );
});

// I7: the core rows-vs-denominator guard (classified + unresolvedParticipants !== denominator)
// was pinned by no test; the existing "denominator disagreements" test only fires the earlier
// alias-disagreement guard.
//
// A single-event undercount is not enough to isolate this guard: with only one event, the
// aggregate share-sum-to-one check (share = players / totalParticipants) is numerically
// equivalent to classified === denominator and would independently catch the same mismatch,
// so mutating the guard alone would not isolate to this test. This fixture pairs an
// undercounting event (denominator 5, rows sum 4) with a compensating overcounting event
// (denominator 7, rows sum 8) so the aggregate totals and share-sum still balance to 1 even
// though each event's own denominator disagrees with its own rows - only the per-event guard
// this test targets can catch it.
test("I7: rows summing to less than an agreeing denominator/participantCount fails the coverage-equality guard", () => {
  const baseA = readFixture("tournament-event-full-field-a.json");
  const rowsUndercount = finalizeSnapshot({
    ...baseA,
    data: {
      ...baseA.data,
      evidenceBlocks: {
        ...baseA.data.evidenceBlocks,
        field: {
          ...baseA.data.evidenceBlocks.field,
          rows: [
            { archetypeId: "leader:OP16-001", players: 2, rawArchetypeLabel: "合成红艾斯" },
            { archetypeId: "leader:OP16-080", players: 2, rawArchetypeLabel: "合成黑黄蒂奇" },
          ],
        },
      },
    },
  }, "fixture-i7-rows-undercount");

  const baseB = readFixture("tournament-event-full-field-b.json");
  const rowsOvercount = finalizeSnapshot({
    ...baseB,
    data: {
      ...baseB.data,
      evidenceBlocks: {
        ...baseB.data.evidenceBlocks,
        field: {
          ...baseB.data.evidenceBlocks.field,
          rows: [
            { archetypeId: "leader:OP16-001", players: 4, rawArchetypeLabel: "合成红艾斯" },
            { archetypeId: "leader:OP16-080", players: 4, rawArchetypeLabel: "合成黑黄蒂奇" },
          ],
        },
      },
    },
  }, "fixture-i7-rows-overcount");

  assert.throws(() => build([rowsUndercount, rowsOvercount]), (error) => error.code === "field_not_representative");
});

// I8: a classified row's archetype id must be canonical ("leader:<gameplayId>"), not merely a
// non-empty string. A raw, unmapped provider label must be treated the same as an unresolved
// mapping.
test("I8: a non-canonical archetype id (raw provider label) is rejected as unresolved_mapping", () => {
  const base = readFixture("tournament-event-full-field-a.json");
  const rawLabelRow = finalizeSnapshot({
    ...base,
    data: {
      ...base.data,
      evidenceBlocks: {
        ...base.data.evidenceBlocks,
        field: {
          ...base.data.evidenceBlocks.field,
          rows: [
            { archetypeId: "合成红艾斯", players: 2 },
            { archetypeId: "leader:OP16-080", players: 3 },
          ],
        },
      },
    },
  }, "fixture-i8-raw-label");
  assert.throws(() => build([rawLabelRow]), (error) => error.code === "unresolved_mapping");
});
