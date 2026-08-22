import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildDeckSnapshot,
  gameplayHashForDeck,
} from "./deck.mjs";

const fixture = JSON.parse(readFileSync(
  new URL("../tests/fixtures/environment/deck-ace-op16.json", import.meta.url),
));

const source = {
  provider: "fixture",
  surface: "deck",
  sourceRef: { fixtureId: "deck-ace-op16" },
  observedAt: "2026-08-20T19:00:00+08:00",
  capturedAt: "2026-08-20T11:00:00Z",
  captureHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

const context = {
  asOf: "2026-08-20",
  source,
};

test("DeckSnapshot normalizes counts and keeps the gameplay hash order-independent", () => {
  const snapshot = buildDeckSnapshot(fixture, context);

  assert.deepEqual(snapshot.environment, { scope: "edition-neutral" });
  assert.equal(snapshot.data.leaderGameplayId, "OP16-001");
  assert.equal(snapshot.data.mainDeckSize, 50);
  assert.equal(
    Object.values(snapshot.data.mainDeckCounts).reduce((total, count) => total + count, 0),
    50,
  );
  assert.deepEqual(
    Object.keys(snapshot.data.mainDeckCounts),
    [...Object.keys(snapshot.data.mainDeckCounts)].sort(),
  );

  const reordered = buildDeckSnapshot(
    { ...fixture, main: [...fixture.main].reverse() },
    context,
  );
  assert.equal(snapshot.data.gameplayHash, reordered.data.gameplayHash);
  assert.notEqual(snapshot, reordered);
});

test("DeckSnapshot separates display metadata from gameplay identity", () => {
  const first = buildDeckSnapshot(fixture, context);
  const renamed = buildDeckSnapshot({ ...fixture, name: "Ace display rename" }, context);

  assert.equal(first.data.gameplayHash, renamed.data.gameplayHash);
  assert.notEqual(first.contentHash, renamed.contentHash);

  const changed = structuredClone(fixture);
  changed.main[0] = "OP16-020";
  const changedSnapshot = buildDeckSnapshot(changed, context);
  assert.notEqual(first.data.gameplayHash, changedSnapshot.data.gameplayHash);
  assert.notEqual(first.contentHash, changedSnapshot.contentHash);
});

test("gameplayHashForDeck uses the shared canonical encoder and sorted counts", () => {
  const counts = { "OP16-020": 4, "OP16-002": 2 };
  const reversed = { "OP16-002": 2, "OP16-020": 4 };

  assert.match(gameplayHashForDeck("OP16-001", counts), /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    gameplayHashForDeck("OP16-001", counts),
    gameplayHashForDeck("OP16-001", reversed),
  );
});

test("DeckSnapshot is deeply immutable after finalization", () => {
  const snapshot = buildDeckSnapshot(fixture, context);

  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.data), true);
  assert.equal(Object.isFrozen(snapshot.data.mainDeckCounts), true);
  assert.throws(() => {
    snapshot.data.mainDeckCounts["OP16-002"] = 99;
  }, TypeError);
});
