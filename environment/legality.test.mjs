import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildDeckSnapshot } from "./deck.mjs";
import { EnvironmentError } from "./errors.mjs";
import {
  buildBanlistSnapshot,
  buildCardPoolSnapshot,
  buildConstructionSnapshot,
  buildRulesSnapshot,
} from "./rules.mjs";
import { finalizeSnapshot } from "./snapshot.mjs";
import { validateDeckLegality } from "./legality.mjs";

function loadFixture(name) {
  return JSON.parse(readFileSync(
    new URL(`../tests/fixtures/environment/${name}`, import.meta.url),
  ));
}

const deckInput = loadFixture("deck-ace-op16.json");
const poolInput = loadFixture("card-pool-sc-op16.json");
const banlistInput = loadFixture("banlist-sc-op16.json");
const constructionInput = loadFixture("construction-standard.json");

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
  surface: "environment",
  sourceRef: { fixtureId: "sc-op16-contracts" },
  observedAt: "2026-08-20T19:00:00+08:00",
  capturedAt: "2026-08-20T11:00:00Z",
  captureHash: hashA,
};

function buildDeps(overrides = {}) {
  const rules = buildRulesSnapshot({
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
  });
  const pool = buildCardPoolSnapshot({
    ...poolInput,
    ...environment,
    asOf: "2026-08-20",
    source,
    cards: poolInput.cards.map((card) => ({
      ...card,
      rulesIdentityHash: rules.data.rulesIdentityHash,
    })),
  });
  const banlist = buildBanlistSnapshot({ ...banlistInput, ...environment, asOf: "2026-08-20", source });
  const construction = buildConstructionSnapshot({
    ...constructionInput,
    ...environment,
    asOf: "2026-08-20",
    source,
  });
  const deck = buildDeckSnapshot(deckInput, { asOf: "2026-08-20", source });
  return {
    deck,
    environment: { ...environment, asOf: "2026-08-20" },
    rules,
    cardPool: pool,
    banlist,
    construction,
    ...overrides,
  };
}

function expectCode(action, code, reason) {
  assert.throws(action, (error) => (
    error instanceof EnvironmentError
      && error.code === code
      && (reason === undefined || error.details.reason === reason)
  ));
}

test("the Ace OP16 fixture is legal in native SC OP16 on the inclusive effective day", () => {
  assert.deepEqual(validateDeckLegality(buildDeps()), { legal: true });
});

test("construction rejects a non-50 main deck before card checks", () => {
  const invalid = structuredClone(deckInput);
  invalid.main.pop();
  const deck = buildDeckSnapshot(invalid, { asOf: "2026-08-20", source });
  expectCode(
    () => validateDeckLegality(buildDeps({ deck })),
    "illegal_deck",
    "main_deck_size",
  );
});

test("unknown gameplay IDs fail closed as unverified card-pool entries", () => {
  const invalid = structuredClone(deckInput);
  invalid.main[0] = "SC-EXCLUSIVE-UNKNOWN";
  const deck = buildDeckSnapshot(invalid, { asOf: "2026-08-20", source });
  expectCode(
    () => validateDeckLegality(buildDeps({ deck })),
    "card_pool_unverified",
    "gameplay_id_not_in_card_pool",
  );
});

test("pool rows with changed rules identity fail without EN-to-SC inference", () => {
  const deps = buildDeps();
  const poolInputChanged = {
    ...poolInput,
    ...environment,
    asOf: "2026-08-20",
    source,
    cards: poolInput.cards.map((card) => ({
      ...card,
      rulesIdentityHash: card.gameplayId === "OP16-020"
        ? hashB
        : deps.rules.data.rulesIdentityHash,
    })),
  };
  const cardPool = buildCardPoolSnapshot(poolInputChanged);
  expectCode(
    () => validateDeckLegality({ ...deps, cardPool }),
    "card_rules_identity_mismatch",
    "rules_identity_mismatch",
  );
});

test("native identity is exact and does not mix SC with EN", () => {
  expectCode(
    () => validateDeckLegality(buildDeps({
      environment: { ...environment, edition: "EN", metagameRegion: "GLOBAL_EN", language: "en" },
    })),
    "environment_identity_mismatch",
    "snapshot_environment_mismatch",
  );
  expectCode(
    () => validateDeckLegality(buildDeps({
      environment: { ...environment, metagameRegion: "GLOBAL_EN" },
    })),
    "environment_identity_mismatch",
    "native_identity_unsupported",
  );
});

test("effective intervals are inclusive and reject cards outside their legal window", () => {
  const atStart = buildDeps({ environment: { ...environment, asOf: "2026-04-01" } });
  assert.deepEqual(validateDeckLegality(atStart), { legal: true });

  const invalid = structuredClone(poolInput);
  invalid.cards = invalid.cards.map((card) => (
    card.gameplayId === "OP16-020" ? { ...card, legalFrom: "2026-08-21" } : card
  ));
  const deps = buildDeps({
    environment: { ...environment, asOf: "2026-08-20" },
    cardPool: buildCardPoolSnapshot({
      ...invalid,
      ...environment,
      asOf: "2026-08-20",
      source,
      cards: invalid.cards.map((card) => ({
        ...card,
        rulesIdentityHash: buildDeps().rules.data.rulesIdentityHash,
      })),
    }),
  });
  expectCode(
    () => validateDeckLegality(deps),
    "card_pool_unverified",
    "card_not_legal_on_as_of",
  );
});

test("banned and restricted cards return stable illegal-deck reasons", () => {
  const bannedInput = structuredClone(deckInput);
  bannedInput.main[0] = "OP06-086";
  const bannedDeck = buildDeckSnapshot(bannedInput, { asOf: "2026-08-20", source });
  expectCode(
    () => validateDeckLegality(buildDeps({ deck: bannedDeck })),
    "illegal_deck",
    "banned_card",
  );

  const restrictedInput = structuredClone(deckInput);
  restrictedInput.main[0] = "OP16-777";
  restrictedInput.main[1] = "OP16-777";
  const restrictedDeck = buildDeckSnapshot(restrictedInput, { asOf: "2026-08-20", source });
  expectCode(
    () => validateDeckLegality(buildDeps({ deck: restrictedDeck })),
    "illegal_deck",
    "restricted_card",
  );
});

test("default copy limits are enforced deterministically", () => {
  const invalid = structuredClone(deckInput);
  invalid.main[0] = "OP16-020";
  const deck = buildDeckSnapshot(invalid, { asOf: "2026-08-20", source });
  expectCode(
    () => validateDeckLegality(buildDeps({ deck })),
    "illegal_deck",
    "copy_limit",
  );
});

test("legality rejects a verified artifact whose gameplay hash no longer matches its counts", () => {
  const valid = buildDeps().deck;
  const { snapshotId: _snapshotId, contentHash: _contentHash, ...draft } = valid;
  const tampered = finalizeSnapshot(
    {
      ...draft,
      data: { ...draft.data, gameplayHash: hashB },
    },
    "deck-tampered-gameplay",
  );
  expectCode(
    () => validateDeckLegality(buildDeps({ deck: tampered })),
    "illegal_deck",
    "gameplay_hash_mismatch",
  );
});

test("alternate-art normalization requires proof of gameplay and rules identity", () => {
  const proven = structuredClone(deckInput);
  proven.main[0] = {
    printingId: "OP16-017-alt-art",
    gameplayId: "OP16-017",
  };
  const proofContext = {
    asOf: "2026-08-20",
    source,
    identityProofs: {
      "OP16-017-alt-art": {
        gameplayId: "OP16-017",
        rulesIdentityHash: buildDeps().rules.data.rulesIdentityHash,
        sourceHash: hashA,
      },
    },
  };
  const provenDeck = buildDeckSnapshot(proven, proofContext);
  assert.deepEqual(validateDeckLegality(buildDeps({ deck: provenDeck })), { legal: true });

  const inlineOnly = structuredClone(deckInput);
  inlineOnly.main[0] = {
    printingId: "OP16-017-alt-art",
    gameplayId: "OP16-017",
    identityEvidence: {
      gameplayId: "OP16-017",
      rulesIdentityHash: buildDeps().rules.data.rulesIdentityHash,
      sourceHash: hashA,
    },
  };
  const inlineOnlyDeck = buildDeckSnapshot(inlineOnly, { asOf: "2026-08-20", source });
  expectCode(
    () => validateDeckLegality(buildDeps({ deck: inlineOnlyDeck })),
    "card_pool_unverified",
    "alternate_identity_unproven",
  );

  const sourceLessDeck = buildDeckSnapshot(proven, {
    asOf: "2026-08-20",
    source,
    identityProofs: {
      "OP16-017-alt-art": {
        gameplayId: "OP16-017",
        rulesIdentityHash: buildDeps().rules.data.rulesIdentityHash,
      },
    },
  });
  expectCode(
    () => validateDeckLegality(buildDeps({ deck: sourceLessDeck })),
    "card_pool_unverified",
    "alternate_identity_unproven",
  );
});

test("leader identity and construction colors are validated", () => {
  const missingLeader = structuredClone(deckInput);
  missingLeader.leader = "SC-UNKNOWN-LEADER";
  const deck = buildDeckSnapshot(missingLeader, { asOf: "2026-08-20", source });
  expectCode(
    () => validateDeckLegality(buildDeps({ deck })),
    "card_pool_unverified",
    "leader_not_in_card_pool",
  );

  const deps = buildDeps({
    construction: buildConstructionSnapshot({
      ...constructionInput,
      ...environment,
      asOf: "2026-08-20",
      source,
      allowedLeaderColors: ["Blue"],
    }),
  });
  expectCode(
    () => validateDeckLegality(deps),
    "illegal_deck",
    "leader_color",
  );
});

test("leader pool evidence is required and all leader colors must be allowed", () => {
  const deps = buildDeps();
  const withoutType = buildCardPoolSnapshot({
    ...poolInput,
    ...environment,
    asOf: "2026-08-20",
    source,
    cards: poolInput.cards.map((card) => {
      if (card.gameplayId !== "OP16-001") return { ...card, rulesIdentityHash: deps.rules.data.rulesIdentityHash };
      const { isLeader: _isLeader, ...leader } = card;
      return { ...leader, rulesIdentityHash: deps.rules.data.rulesIdentityHash };
    }),
  });
  expectCode(
    () => validateDeckLegality({ ...deps, cardPool: withoutType }),
    "card_pool_unverified",
    "leader_type_unverified",
  );

  const withoutColor = buildCardPoolSnapshot({
    ...poolInput,
    ...environment,
    asOf: "2026-08-20",
    source,
    cards: poolInput.cards.map((card) => {
      if (card.gameplayId !== "OP16-001") return { ...card, rulesIdentityHash: deps.rules.data.rulesIdentityHash };
      const { colors: _colors, ...leader } = card;
      return { ...leader, rulesIdentityHash: deps.rules.data.rulesIdentityHash };
    }),
  });
  expectCode(
    () => validateDeckLegality({ ...deps, cardPool: withoutColor }),
    "card_pool_unverified",
    "leader_color_unverified",
  );

  const mixedColors = buildCardPoolSnapshot({
    ...poolInput,
    ...environment,
    asOf: "2026-08-20",
    source,
    cards: poolInput.cards.map((card) => (
      card.gameplayId === "OP16-001"
        ? { ...card, colors: ["Red", "Blue"], rulesIdentityHash: deps.rules.data.rulesIdentityHash }
        : { ...card, rulesIdentityHash: deps.rules.data.rulesIdentityHash }
    )),
  });
  const redOnlyConstruction = buildConstructionSnapshot({
    ...constructionInput,
    ...environment,
    asOf: "2026-08-20",
    source,
    allowedLeaderColors: ["Red"],
  });
  expectCode(
    () => validateDeckLegality({ ...deps, cardPool: mixedColors, construction: redOnlyConstruction }),
    "illegal_deck",
    "leader_color",
  );
});

test("leader color evidence cannot be supplied by the deck artifact", () => {
  const deps = buildDeps();
  const withoutColor = buildCardPoolSnapshot({
    ...poolInput,
    ...environment,
    asOf: "2026-08-20",
    source,
    cards: poolInput.cards.map((card) => {
      if (card.gameplayId !== "OP16-001") return { ...card, rulesIdentityHash: deps.rules.data.rulesIdentityHash };
      const { colors: _colors, ...leader } = card;
      return { ...leader, rulesIdentityHash: deps.rules.data.rulesIdentityHash };
    }),
  });
  const { snapshotId: _snapshotId, contentHash: _contentHash, ...draft } = deps.deck;
  const forgedDeck = finalizeSnapshot(
    {
      ...draft,
      data: { ...draft.data, leaderColors: ["Red"] },
    },
    "deck-forged-leader-colors",
  );

  expectCode(
    () => validateDeckLegality({ ...deps, deck: forgedDeck, cardPool: withoutColor }),
    "card_pool_unverified",
    "leader_color_unverified",
  );
});

test("dependency snapshots must have their exact contract kinds before data interpretation", () => {
  const deps = buildDeps();
  const cases = [
    ["deck", "rules", "illegal_deck"],
    ["rules", "deck", "card_rules_identity_mismatch"],
    ["cardPool", "rules", "card_pool_unverified"],
    ["banlist", "rules", "illegal_deck"],
    ["construction", "rules", "illegal_deck"],
  ];
  for (const [key, replacement, code] of cases) {
    expectCode(
      () => validateDeckLegality({ ...deps, [key]: deps[replacement] }),
      code,
      "dependency_kind_mismatch",
    );
  }
});

test("a leader card cannot also appear in the main deck", () => {
  const deps = buildDeps();
  const pool = buildCardPoolSnapshot({
    ...poolInput,
    ...environment,
    asOf: "2026-08-20",
    source,
    cards: poolInput.cards.map((card) => (
      card.gameplayId === "OP16-002"
        ? { ...card, isLeader: true, colors: ["Red"], rulesIdentityHash: deps.rules.data.rulesIdentityHash }
        : { ...card, rulesIdentityHash: deps.rules.data.rulesIdentityHash }
    )),
  });
  expectCode(
    () => validateDeckLegality({ ...deps, cardPool: pool }),
    "illegal_deck",
    "leader_in_main_deck",
  );

  const sameLeader = structuredClone(deckInput);
  sameLeader.main[0] = sameLeader.leader;
  const sameLeaderDeck = buildDeckSnapshot(sameLeader, { asOf: "2026-08-20", source });
  expectCode(
    () => validateDeckLegality({ ...deps, deck: sameLeaderDeck }),
    "illegal_deck",
    "leader_in_main_deck",
  );
});

test("legality rejects hash-valid but semantically forged construction snapshots", () => {
  const deps = buildDeps();
  const invalidInput = structuredClone(deckInput);
  invalidInput.main.pop();
  const invalidDeck = buildDeckSnapshot(invalidInput, { asOf: "2026-08-20", source });
  const { snapshotId: _snapshotId, contentHash: _contentHash, ...draft } = deps.construction;
  const forgedConstruction = finalizeSnapshot(
    {
      ...draft,
      data: { ...draft.data, mainDeckSize: 49 },
    },
    "construction-forged-size",
  );

  expectCode(
    () => validateDeckLegality({ ...deps, deck: invalidDeck, construction: forgedConstruction }),
    "illegal_deck",
    "snapshot_contract_invalid",
  );
});

test("legality rejects semantically malformed edition-specific snapshots", () => {
  const deps = buildDeps();
  const cases = [
    {
      dependency: "rules",
      code: "card_rules_identity_mismatch",
      snapshot: (() => {
        const { snapshotId: _snapshotId, contentHash: _contentHash, ...draft } = deps.rules;
        return finalizeSnapshot(
          { ...draft, data: { ...draft.data, authority: null } },
          "rules-forged-authority",
        );
      })(),
    },
    {
      dependency: "cardPool",
      code: "card_pool_unverified",
      snapshot: (() => {
        const { snapshotId: _snapshotId, contentHash: _contentHash, ...draft } = deps.cardPool;
        const cards = draft.data.cards.map((card, index) => (
          index === 0
            ? (() => {
              const { releaseEvidenceRef: _releaseEvidenceRef, ...withoutEvidence } = card;
              return withoutEvidence;
            })()
            : card
        ));
        return finalizeSnapshot(
          { ...draft, data: { ...draft.data, cards } },
          "card-pool-forged-evidence",
        );
      })(),
    },
    {
      dependency: "banlist",
      code: "illegal_deck",
      snapshot: (() => {
        const { snapshotId: _snapshotId, contentHash: _contentHash, ...draft } = deps.banlist;
        const entries = draft.data.entries.map((entry, index) => (
          index === 0 ? { ...entry, status: "unknown" } : entry
        ));
        return finalizeSnapshot(
          { ...draft, data: { ...draft.data, entries } },
          "banlist-forged-status",
        );
      })(),
    },
  ];

  for (const { dependency, code, snapshot } of cases) {
    expectCode(
      () => validateDeckLegality({ ...deps, [dependency]: snapshot }),
      code,
      "snapshot_contract_invalid",
    );
  }
});

test("legality rejects stored day-precision releasedAt with a mismatched timezone", () => {
  const deps = buildDeps();
  const { snapshotId: _snapshotId, contentHash: _contentHash, ...draft } = deps.cardPool;
  const cards = draft.data.cards.map((card, index) => (
    index === 0
      ? { ...card, releasedAt: { ...card.releasedAt, timeZone: "UTC" } }
      : card
  ));
  const forgedCardPool = finalizeSnapshot(
    { ...draft, data: { ...draft.data, cards } },
    "card-pool-forged-timezone",
  );

  expectCode(
    () => validateDeckLegality({ ...deps, cardPool: forgedCardPool }),
    "card_pool_unverified",
    "snapshot_contract_invalid",
  );
});

test("active banlist rows apply to the leader at count one", () => {
  const deps = buildDeps();
  const bannedLeader = buildBanlistSnapshot({
    ...banlistInput,
    ...environment,
    asOf: "2026-08-20",
    source,
    entries: [
      ...banlistInput.entries,
      {
        gameplayId: "OP16-001",
        status: "banned",
        maxCopies: 0,
        effectiveFrom: "2026-04-01",
        effectiveUntil: null,
        authorityRef: "sc-banlist-2026-04-01",
      },
    ],
  });
  expectCode(
    () => validateDeckLegality({ ...deps, banlist: bannedLeader }),
    "illegal_deck",
    "banned_card",
  );

  const restrictedLeaderZero = buildBanlistSnapshot({
    ...banlistInput,
    ...environment,
    asOf: "2026-08-20",
    source,
    entries: [
      ...banlistInput.entries,
      {
        gameplayId: "OP16-001",
        status: "restricted",
        maxCopies: 0,
        effectiveFrom: "2026-04-01",
        effectiveUntil: null,
        authorityRef: "sc-banlist-2026-04-01",
      },
    ],
  });
  expectCode(
    () => validateDeckLegality({ ...deps, banlist: restrictedLeaderZero }),
    "illegal_deck",
    "banned_card",
  );

  const restrictedLeaderOne = buildBanlistSnapshot({
    ...banlistInput,
    ...environment,
    asOf: "2026-08-20",
    source,
    entries: [
      ...banlistInput.entries,
      {
        gameplayId: "OP16-001",
        status: "restricted",
        maxCopies: 1,
        effectiveFrom: "2026-04-01",
        effectiveUntil: null,
        authorityRef: "sc-banlist-2026-04-01",
      },
    ],
  });
  assert.deepEqual(
    validateDeckLegality({ ...deps, banlist: restrictedLeaderOne }),
    { legal: true },
  );
});
