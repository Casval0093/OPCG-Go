import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBanlistSnapshot,
  buildCardPoolSnapshot,
  buildConstructionSnapshot,
  buildRulesSnapshot,
} from "./rules.mjs";

const hashA = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const hashB = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const environment = {
  edition: "SC",
  metagameRegion: "CN",
  language: "zh-Hans",
  formatId: "standard-block2-op16",
  timeZone: "Asia/Shanghai",
};

const source = {
  provider: "fixture",
  surface: "rules",
  sourceRef: { fixtureId: "environment-contracts" },
  observedAt: "2026-08-20T19:00:00+08:00",
  capturedAt: "2026-08-20T11:00:00Z",
  captureHash: hashA,
};

const rulesInput = {
  ...environment,
  asOf: "2026-08-20",
  source,
  authority: { name: "Bandai official rules", authorityId: "bandai-sc" },
  documentRefs: [
    { documentId: "comprehensive-rules", version: "1.2.0", sourceHash: hashB },
    { documentId: "tournament-rules", version: "1.6.0", sourceHash: hashA },
  ],
  effectiveFrom: "2026-04-01",
  effectiveUntil: null,
  sourceHashes: [hashB, hashA],
  idStem: "sc-rules-standard-block2-op16",
};

test("RulesSnapshot records authority, references, interval, and aggregate identity", () => {
  const snapshot = buildRulesSnapshot(rulesInput);

  assert.equal(snapshot.kind, "rules");
  assert.deepEqual(snapshot.environment, environment);
  assert.equal(snapshot.data.formatId, environment.formatId);
  assert.deepEqual(snapshot.data.authority, rulesInput.authority);
  assert.deepEqual(snapshot.data.documentRefs, rulesInput.documentRefs);
  assert.equal(snapshot.data.effectiveFrom, "2026-04-01");
  assert.equal(snapshot.data.effectiveUntil, null);
  assert.deepEqual(snapshot.data.sourceHashes, [hashA, hashB]);
  assert.match(snapshot.data.rulesIdentityHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(snapshot.data.documentRefs), true);
});

test("Rules identity is deterministic and changes when authoritative content changes", () => {
  const first = buildRulesSnapshot(rulesInput);
  const reordered = buildRulesSnapshot({
    ...rulesInput,
    documentRefs: [...rulesInput.documentRefs].reverse(),
    sourceHashes: [...rulesInput.sourceHashes].reverse(),
  });
  assert.equal(first.data.rulesIdentityHash, reordered.data.rulesIdentityHash);

  const changed = buildRulesSnapshot({
    ...rulesInput,
    documentRefs: rulesInput.documentRefs.map((ref) => (
      ref.documentId === "tournament-rules" ? { ...ref, version: "1.7.0" } : ref
    )),
  });
  assert.notEqual(first.data.rulesIdentityHash, changed.data.rulesIdentityHash);
});

test("edition-specific pool, banlist, and construction snapshots preserve typed rows", () => {
  const cardPool = buildCardPoolSnapshot({
    ...environment,
    asOf: "2026-08-20",
    source,
    effectiveFrom: "2026-04-01",
    effectiveUntil: null,
    cards: [
      {
        gameplayId: "OP16-002",
        rulesIdentityHash: hashA,
        releasedAt: "2026-04-01",
        legalFrom: "2026-04-01",
        legalUntil: null,
        releaseEvidenceRef: { sourceHash: hashB, sourceRef: "sc-op16-release" },
      },
    ],
    idStem: "sc-card-pool-standard-block2-op16",
  });
  assert.equal(cardPool.kind, "card_pool");
  assert.equal(cardPool.data.cards[0].gameplayId, "OP16-002");
  assert.equal(cardPool.data.cards[0].releaseEvidenceRef.sourceHash, hashB);

  const banlist = buildBanlistSnapshot({
    ...environment,
    asOf: "2026-08-20",
    source,
    effectiveFrom: "2026-04-01",
    entries: [
      {
        gameplayId: "OP06-086",
        status: "banned",
        maxCopies: 0,
        effectiveFrom: "2026-04-01",
        effectiveUntil: null,
        authorityRef: { documentId: "banlist", sourceHash: hashA },
      },
    ],
    idStem: "sc-banlist-standard-block2-op16",
  });
  assert.equal(banlist.kind, "banlist");
  assert.equal(banlist.data.entries[0].status, "banned");

  const construction = buildConstructionSnapshot({
    ...environment,
    asOf: "2026-08-20",
    source,
    effectiveFrom: "2026-04-01",
    mainDeckSize: 50,
    leaderCount: 1,
    defaultMaxCopies: 4,
    allowedLeaderColors: ["Red"],
    idStem: "opcg-standard-construction-v1",
  });
  assert.equal(construction.kind, "construction");
  assert.equal(construction.data.mainDeckSize, 50);
  assert.equal(construction.data.defaultMaxCopies, 4);
});

test("date-only releasedAt preserves day precision without inventing an instant", () => {
  const snapshot = buildCardPoolSnapshot({
    ...environment,
    timeZone: "Asia/Shanghai",
    asOf: "2026-08-20",
    source,
    effectiveFrom: "2026-04-01",
    cards: [{
      gameplayId: "OP16-002",
      rulesIdentityHash: hashA,
      releasedAt: "2026-04-01",
      legalFrom: "2026-04-01",
      legalUntil: null,
      releaseEvidenceRef: "sc-op16-release",
    }],
  });

  assert.deepEqual(snapshot.data.cards[0].releasedAt, {
    localDate: "2026-04-01",
    precision: "day",
    timeZone: "Asia/Shanghai",
  });

  const timestamp = "2026-04-01T09:30:00+08:00";
  const timestampSnapshot = buildCardPoolSnapshot({
    ...environment,
    asOf: "2026-08-20",
    source,
    effectiveFrom: "2026-04-01",
    cards: [{
      gameplayId: "OP16-002",
      rulesIdentityHash: hashA,
      releasedAt: timestamp,
      legalFrom: "2026-04-01",
      legalUntil: null,
      releaseEvidenceRef: "sc-op16-release",
    }],
  });
  assert.equal(timestampSnapshot.data.cards[0].releasedAt, timestamp);
});
