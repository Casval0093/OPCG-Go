import assert from "node:assert/strict";
import test from "node:test";

import { hashProjection } from "./hash.mjs";
import {
  finalizeSnapshot,
  snapshotRef,
  verifySnapshot,
} from "./snapshot.mjs";

const draft = {
  schemaVersion: 1,
  kind: "tournament_event",
  environment: {
    edition: "SC",
    metagameRegion: "CN",
    language: "zh-Hans",
    formatId: "standard-block2-op16",
    timeZone: "Asia/Shanghai",
  },
  asOf: "2026-08-20",
  source: {
    provider: "jihuanshe",
    surface: "tournament",
    sourceRef: { providerEventId: "example-event-2026-08-20" },
    observedAt: "2026-08-20T19:00:00+08:00",
    capturedAt: "2026-08-20T12:00:00Z",
    captureHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  },
  coverage: { status: "complete", warnings: [], missingFields: [] },
  data: { eventKey: "jihuanshe-example-event-2026-08-20" },
};

test("finalizeSnapshot creates an immutable hash-addressed envelope", () => {
  const snapshot = finalizeSnapshot(draft, "jihuanshe-tournament-2026-08-20");

  assert.match(snapshot.snapshotId, /^jihuanshe-tournament-2026-08-20-[0-9a-f]{16}$/);
  assert.equal(snapshot.contentHash, hashProjection(snapshot, ["snapshotId", "contentHash"]));
  assert.deepEqual(snapshotRef(snapshot), {
    snapshotId: snapshot.snapshotId,
    contentHash: snapshot.contentHash,
  });
  assert.notEqual(snapshot, draft);
  assert.equal(Object.isFrozen(snapshot), true);
});

test("verification fails closed when immutable content or identity is changed", () => {
  const snapshot = finalizeSnapshot(draft, "jihuanshe-tournament-2026-08-20");

  assert.throws(
    () => verifySnapshot({ ...snapshot, asOf: "2026-08-19" }),
    /snapshot_hash_mismatch/,
  );
  assert.throws(
    () => verifySnapshot({ ...snapshot, schemaVersion: 99 }),
    /snapshot_schema_unsupported/,
  );
  assert.throws(
    () => verifySnapshot({ ...snapshot, source: { ...snapshot.source, capturedAt: "not-a-time" } }),
    /snapshot_timestamp_invalid/,
  );
  assert.throws(
    () => verifySnapshot({ ...snapshot, asOf: "2026-02-30" }),
    /snapshot_date_invalid/,
  );
  assert.throws(
    () => verifySnapshot({ ...snapshot, source: { ...snapshot.source, captureHash: "deadbeef" } }),
    /snapshot_hash_invalid/,
  );
});

test("ordinary format and seat fields remain ordinary strings", () => {
  const snapshot = finalizeSnapshot(
    {
      ...draft,
      data: { ...draft.data, format: "standard", seat: "play" },
    },
    "jihuanshe-tournament-2026-08-20",
  );

  assert.equal(verifySnapshot(snapshot), snapshot);
});

test("nested localDate values are validated as local calendar dates", () => {
  assert.throws(
    () => finalizeSnapshot(
      {
        ...draft,
        data: { ...draft.data, event: { localDate: "2026-02-30" } },
      },
      "jihuanshe-tournament-2026-08-20",
    ),
    /snapshot_date_invalid/,
  );
});

test("edition-neutral identity is reserved for deck snapshots", () => {
  const deck = finalizeSnapshot(
    {
      ...draft,
      kind: "deck",
      environment: { scope: "edition-neutral" },
      data: {
        leaderGameplayId: "OP16-001",
        mainDeckCounts: { "OP16-002": 50 },
        mainDeckSize: 50,
        gameplayHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      },
    },
    "deck-OP16-001",
  );

  assert.deepEqual(deck.environment, { scope: "edition-neutral" });
  assert.equal(verifySnapshot(deck), deck);
});

test("edition-neutral identity cannot escape the deck kind or carry native fields", () => {
  assert.throws(
    () => finalizeSnapshot(
      {
        ...draft,
        environment: { scope: "edition-neutral" },
      },
      "rules-neutral",
    ),
    (error) => error.code === "environment_identity_mismatch",
  );

  assert.throws(
    () => finalizeSnapshot(
      {
        ...draft,
        kind: "deck",
        environment: { scope: "edition-neutral", edition: "SC" },
      },
      "deck-invalid-neutral",
    ),
    (error) => error.code === "environment_identity_mismatch",
  );
});

test("non-neutral snapshots require an exact native v1 tuple and decks must stay neutral", () => {
  for (const environment of [
    { ...draft.environment, edition: "JP", metagameRegion: "JP", language: "ja" },
    { ...draft.environment, edition: "SC", metagameRegion: "GLOBAL_EN", language: "en" },
    { ...draft.environment, edition: "EN", metagameRegion: "CN", language: "zh-Hans" },
  ]) {
    assert.throws(
      () => finalizeSnapshot({ ...draft, environment }, "invalid-native-tuple"),
      (error) => error.code === "environment_identity_mismatch",
    );
  }

  assert.throws(
    () => finalizeSnapshot(
      { ...draft, kind: "deck" },
      "native-deck-forbidden",
    ),
    (error) => error.code === "environment_identity_mismatch",
  );
});

test("day-precision *At values use an exact typed local-date structure", () => {
  const value = {
    ...draft,
    data: {
      ...draft.data,
      releasedAt: {
        localDate: "2026-08-20",
        precision: "day",
        timeZone: "Asia/Shanghai",
      },
    },
  };
  const snapshot = finalizeSnapshot(value, "day-precision");
  assert.equal(verifySnapshot(snapshot), snapshot);

  assert.throws(
    () => finalizeSnapshot(
      {
        ...draft,
        data: {
          ...draft.data,
          releasedAt: { localDate: "2026-08-20", precision: "day" },
        },
      },
      "day-precision-missing-zone",
    ),
    (error) => error.code === "snapshot_timestamp_invalid",
  );
});

test("day precision is restricted to approved semantic temporal keys", () => {
  const dayValue = {
    localDate: "2026-08-20",
    precision: "day",
    timeZone: "Asia/Shanghai",
  };

  assert.throws(
    () => finalizeSnapshot(
      {
        ...draft,
        source: { ...draft.source, capturedAt: dayValue },
      },
      "day-captured-at-forbidden",
    ),
    (error) => error.code === "snapshot_timestamp_invalid",
  );

  assert.throws(
    () => finalizeSnapshot(
      {
        ...draft,
        data: { ...draft.data, updatedAt: dayValue },
      },
      "day-updated-at-forbidden",
    ),
    (error) => error.code === "snapshot_timestamp_invalid",
  );
});
