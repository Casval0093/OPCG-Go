import { EnvironmentError } from "./errors.mjs";
import { gameplayHashForDeck } from "./deck.mjs";
import { verifySnapshot } from "./snapshot.mjs";
import {
  assertNativeEnvironment,
  buildBanlistSnapshot,
  buildCardPoolSnapshot,
  buildConstructionSnapshot,
  buildRulesSnapshot,
  dateInInterval,
  dateOnly,
  FULL_HASH_PATTERN,
} from "./rules.mjs";

function fail(code, message = code, details = {}) {
  const rendered = message.startsWith(`${code}:`) ? message : `${code}: ${message}`;
  throw new EnvironmentError(code, rendered, details);
}

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredObject(value, path, code = "environment_identity_mismatch") {
  if (!isRecord(value)) fail(code, `${path} must be an object`, { path });
  return value;
}

function sameNativeIdentity(left, right) {
  return left?.edition === right?.edition
    && left?.metagameRegion === right?.metagameRegion
    && left?.language === right?.language
    && left?.formatId === right?.formatId
    && left?.timeZone === right?.timeZone;
}

function assertSnapshotEnvironment(snapshot, environment, path) {
  if (!sameNativeIdentity(snapshot.environment, environment)) {
    fail("environment_identity_mismatch", `${path} environment does not match requested native environment`, {
      reason: "snapshot_environment_mismatch",
      path,
    });
  }
}

function effectiveInterval(snapshot, data) {
  return {
    from: data?.effectiveFrom ?? null,
    until: data?.effectiveUntil ?? null,
    snapshotAsOf: snapshot.asOf,
  };
}

function assertEffective(snapshot, data, asOf, code, reason, path) {
  const interval = effectiveInterval(snapshot, data);
  if (!dateInInterval(asOf, interval.from, interval.until)) {
    fail(code, `${path} is not effective on the requested asOf date`, {
      reason,
      path,
      asOf,
      effectiveFrom: interval.from,
      effectiveUntil: interval.until,
    });
  }
}

function cardRows(cardPool) {
  const rows = cardPool.data?.cards;
  if (!Array.isArray(rows)) fail("card_pool_unverified", "card-pool snapshot has no card rows", { reason: "card_pool_rows_missing" });
  const byId = new Map();
  for (const row of rows) {
    if (!isRecord(row) || typeof row.gameplayId !== "string" || row.gameplayId.length === 0) {
      fail("card_pool_unverified", "card-pool row has no gameplay ID", { reason: "gameplay_id_missing" });
    }
    byId.set(row.gameplayId, row);
  }
  return byId;
}

function banlistRows(banlist) {
  const rows = banlist.data?.entries;
  if (!Array.isArray(rows)) fail("illegal_deck", "banlist snapshot has no entries", { reason: "banlist_rows_missing" });
  const byId = new Map();
  for (const row of rows) {
    if (!isRecord(row) || typeof row.gameplayId !== "string") continue;
    byId.set(row.gameplayId, row);
  }
  return byId;
}

function deckCounts(deck) {
  const data = deck.data;
  if (!isRecord(data) || !isRecord(data.mainDeckCounts)) {
    fail("illegal_deck", "deck snapshot has no count map", { reason: "main_deck_counts_missing" });
  }
  const counts = Object.fromEntries(Object.entries(data.mainDeckCounts).sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  )));
  for (const [gameplayId, count] of Object.entries(counts)) {
    if (typeof gameplayId !== "string" || gameplayId.length === 0 || !Number.isSafeInteger(count) || count <= 0) {
      fail("illegal_deck", "deck count map is invalid", { reason: "main_deck_counts_invalid", gameplayId, count });
    }
  }
  return counts;
}

function assertIdentityEvidence(deck, rulesIdentityHash) {
  const evidence = deck.data?.identityEvidence;
  if (!isRecord(evidence)) return;
  for (const [alias, proof] of Object.entries(evidence).sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  ))) {
    if (
      !isRecord(proof)
      || proof.proven !== true
      || typeof proof.gameplayId !== "string"
      || !FULL_HASH_PATTERN.test(proof.rulesIdentityHash ?? "")
      || !FULL_HASH_PATTERN.test(proof.sourceHash ?? "")
    ) {
      fail("card_pool_unverified", "alternate printing identity was not proven", {
        reason: "alternate_identity_unproven",
        alias,
      });
    }
    if (proof.rulesIdentityHash !== undefined && proof.rulesIdentityHash !== rulesIdentityHash) {
      fail("card_rules_identity_mismatch", "alternate printing rules identity differs from applicable rules", {
        reason: "alternate_identity_rules_mismatch",
        alias,
        expected: rulesIdentityHash,
        actual: proof.rulesIdentityHash,
      });
    }
  }
}

function assertLeaderShape(deck, construction) {
  const leader = deck.data?.leaderGameplayId;
  if (typeof leader !== "string" || leader.length === 0 || construction.data.leaderCount !== 1) {
    fail("illegal_deck", "deck must contain exactly one leader", { reason: "leader_count" });
  }
  return leader;
}

function assertLeaderPool(leader, poolRows) {
  const row = poolRows.get(leader);
  if (!row) fail("card_pool_unverified", "leader is absent from card pool", { reason: "leader_not_in_card_pool", gameplayId: leader });
  if (row.isLeader === false || row.cardType === "character" || row.cardType === "event" || row.cardType === "stage") {
    fail("illegal_deck", "leader gameplay ID is not a leader card", { reason: "leader_card_type", gameplayId: leader });
  }
  if (!(row.isLeader === true || row.cardType === "leader" || row.type === "leader")) {
    fail("card_pool_unverified", "leader type evidence is missing", { reason: "leader_type_unverified", gameplayId: leader });
  }
  return row;
}

function assertLeaderColor(leader, leaderRow, construction) {
  const allowed = construction.data.allowedLeaderColors;
  const colors = Array.isArray(leaderRow.colors)
    ? leaderRow.colors
    : (typeof leaderRow.color === "string" ? [leaderRow.color] : []);
  if (colors.length === 0) {
    fail("card_pool_unverified", "leader color evidence is missing", { reason: "leader_color_unverified", gameplayId: leader });
  }
  if (!Array.isArray(allowed) || !colors.every((color) => allowed.includes(color))) {
    fail("illegal_deck", "leader color is not allowed by construction policy", { reason: "leader_color", gameplayId: leader });
  }
}

function isLeaderRow(row) {
  return row?.isLeader === true || row?.cardType === "leader" || row?.type === "leader";
}

function assertCardRulesAndPool(ids, poolRows, rules, asOf, { mainDeck = false } = {}) {
  for (const gameplayId of ids) {
    const row = poolRows.get(gameplayId);
    if (!row) {
      fail("card_pool_unverified", "gameplay ID is absent from the edition-specific card pool", {
        reason: "gameplay_id_not_in_card_pool",
        gameplayId,
      });
    }
    if (mainDeck && isLeaderRow(row)) {
      fail("illegal_deck", "a leader card cannot also appear in the main deck", {
        reason: "leader_in_main_deck",
        gameplayId,
      });
    }
    if (!dateInInterval(asOf, row.legalFrom, row.legalUntil) || !dateInInterval(asOf, dateOnly(row.releasedAt), null)) {
      fail("card_pool_unverified", "card is not released and legal on the requested date", {
        reason: "card_not_legal_on_as_of",
        gameplayId,
        asOf,
        legalFrom: row.legalFrom,
        legalUntil: row.legalUntil,
      });
    }
    if (row.rulesIdentityHash !== rules.data.rulesIdentityHash) {
      fail("card_rules_identity_mismatch", "card rules identity differs from the applicable rules snapshot", {
        reason: "rules_identity_mismatch",
        gameplayId,
        expected: rules.data.rulesIdentityHash,
        actual: row.rulesIdentityHash,
      });
    }
  }
}

function assertBanlistAndCopies(counts, banRows, construction, asOf) {
  const ids = Object.keys(counts);
  for (const gameplayId of ids) {
    const row = banRows.get(gameplayId);
    if (!row || !dateInInterval(asOf, row.effectiveFrom, row.effectiveUntil)) continue;
    if (row.status === "banned" || row.maxCopies === 0) {
      fail("illegal_deck", "deck contains an active banned card", {
        reason: "banned_card",
        gameplayId,
        count: counts[gameplayId],
      });
    }
    if (row.status === "restricted" && counts[gameplayId] > row.maxCopies) {
      fail("illegal_deck", "deck exceeds an active restricted-card limit", {
        reason: "restricted_card",
        gameplayId,
        count: counts[gameplayId],
        maxCopies: row.maxCopies,
      });
    }
  }
  const defaultMaxCopies = construction.data.defaultMaxCopies;
  for (const gameplayId of ids) {
    const row = banRows.get(gameplayId);
    const maxCopies = row && dateInInterval(asOf, row.effectiveFrom, row.effectiveUntil)
      ? row.maxCopies
      : defaultMaxCopies;
    if (counts[gameplayId] > maxCopies) {
      fail("illegal_deck", "deck exceeds the default copy limit", {
        reason: "copy_limit",
        gameplayId,
        count: counts[gameplayId],
        maxCopies,
      });
    }
  }
}

function assertLeaderBanlist(leader, banRows, asOf) {
  const row = banRows.get(leader);
  if (!row || !dateInInterval(asOf, row.effectiveFrom, row.effectiveUntil)) return;
  if (row.status === "banned" || row.maxCopies === 0) {
    fail("illegal_deck", "deck contains an active banned card", {
      reason: "banned_card",
      gameplayId: leader,
      count: 1,
    });
  }
  if (row.status === "restricted" && 1 > row.maxCopies) {
    fail("illegal_deck", "deck exceeds an active restricted-card limit", {
      reason: "restricted_card",
      gameplayId: leader,
      count: 1,
      maxCopies: row.maxCopies,
    });
  }
}

function assertDependencyKind(snapshot, dependency, expectedKind, code) {
  if (snapshot.kind !== expectedKind) {
    fail(code, `${dependency} snapshot kind does not match its contract`, {
      reason: "dependency_kind_mismatch",
      dependency,
      expectedKind,
      actualKind: snapshot.kind,
    });
  }
}

function rebuildSemanticContract(snapshot, dependency) {
  const common = {
    ...snapshot.environment,
    asOf: snapshot.asOf,
    source: snapshot.source,
    coverage: snapshot.coverage,
  };
  const data = snapshot.data;
  if (dependency === "rules") {
    return buildRulesSnapshot({
      ...common,
      authority: data?.authority,
      documentRefs: data?.documentRefs,
      effectiveFrom: data?.effectiveFrom,
      effectiveUntil: data?.effectiveUntil,
      sourceHashes: data?.sourceHashes,
    });
  }
  if (dependency === "cardPool") {
    return buildCardPoolSnapshot({
      ...common,
      effectiveFrom: data?.effectiveFrom,
      effectiveUntil: data?.effectiveUntil,
      cards: data?.cards,
    });
  }
  if (dependency === "banlist") {
    return buildBanlistSnapshot({
      ...common,
      effectiveFrom: data?.effectiveFrom,
      effectiveUntil: data?.effectiveUntil,
      entries: data?.entries,
    });
  }
  if (dependency === "construction") {
    return buildConstructionSnapshot({
      ...common,
      effectiveFrom: data?.effectiveFrom,
      effectiveUntil: data?.effectiveUntil,
      mainDeckSize: data?.mainDeckSize,
      leaderCount: data?.leaderCount,
      defaultMaxCopies: data?.defaultMaxCopies,
      allowedLeaderColors: data?.allowedLeaderColors,
    });
  }
  return null;
}

function assertSemanticContract(snapshot, dependency, code) {
  let reconstructed;
  try {
    reconstructed = rebuildSemanticContract(snapshot, dependency);
  } catch (error) {
    fail(code, `${dependency} snapshot semantic contract is invalid`, {
      reason: "snapshot_contract_invalid",
      dependency,
      cause: error?.code ?? error?.message,
    });
  }
  if (!reconstructed || reconstructed.contentHash !== snapshot.contentHash) {
    fail(code, `${dependency} snapshot semantic contract is invalid`, {
      reason: "snapshot_contract_invalid",
      dependency,
      expectedContentHash: reconstructed?.contentHash,
      actualContentHash: snapshot.contentHash,
    });
  }
}

export function validateDeckLegality(deps) {
  requiredObject(deps, "deps");
  const environment = requiredObject(deps.environment, "environment");
  assertNativeEnvironment(environment);

  const deck = requiredObject(deps.deck ?? deps.deckSnapshot, "deck", "illegal_deck");
  const rules = requiredObject(deps.rules ?? deps.rulesSnapshot, "rules", "card_rules_identity_mismatch");
  const cardPool = requiredObject(deps.cardPool ?? deps.cardPoolSnapshot, "cardPool", "card_pool_unverified");
  const banlist = requiredObject(deps.banlist ?? deps.banlistSnapshot, "banlist", "illegal_deck");
  const construction = requiredObject(deps.construction ?? deps.constructionSnapshot, "construction", "illegal_deck");
  const rawAsOf = environment.asOf ?? deps.asOf ?? rules.asOf ?? cardPool.asOf ?? construction.asOf;
  const asOf = dateOnly(rawAsOf);
  if (!asOf || (environment.asOf !== undefined && environment.asOf !== asOf)) {
    fail("environment_identity_mismatch", "environment asOf must be a valid local date", { reason: "as_of_invalid" });
  }

  verifySnapshot(deck);
  verifySnapshot(rules);
  verifySnapshot(cardPool);
  verifySnapshot(banlist);
  verifySnapshot(construction);
  assertDependencyKind(deck, "deck", "deck", "illegal_deck");
  assertDependencyKind(rules, "rules", "rules", "card_rules_identity_mismatch");
  assertDependencyKind(cardPool, "cardPool", "card_pool", "card_pool_unverified");
  assertDependencyKind(banlist, "banlist", "banlist", "illegal_deck");
  assertDependencyKind(construction, "construction", "construction", "illegal_deck");
  assertSemanticContract(rules, "rules", "card_rules_identity_mismatch");
  assertSemanticContract(cardPool, "cardPool", "card_pool_unverified");
  assertSemanticContract(banlist, "banlist", "illegal_deck");
  assertSemanticContract(construction, "construction", "illegal_deck");
  assertSnapshotEnvironment(rules, environment, "rules");
  assertSnapshotEnvironment(cardPool, environment, "cardPool");
  assertSnapshotEnvironment(banlist, environment, "banlist");
  assertSnapshotEnvironment(construction, environment, "construction");

  if (rules.data?.formatId !== environment.formatId
    || cardPool.data?.formatId !== environment.formatId
    || banlist.data?.formatId !== environment.formatId
    || construction.data?.formatId !== environment.formatId) {
    fail("environment_identity_mismatch", "edition-specific artifacts do not share the requested format", { reason: "format_mismatch" });
  }
  assertEffective(rules, rules.data, asOf, "card_rules_identity_mismatch", "rules_not_effective_on_as_of", "rules");
  assertEffective(cardPool, cardPool.data, asOf, "card_pool_unverified", "card_pool_not_effective_on_as_of", "cardPool");
  assertEffective(banlist, banlist.data, asOf, "illegal_deck", "banlist_not_effective_on_as_of", "banlist");
  assertEffective(construction, construction.data, asOf, "illegal_deck", "construction_not_effective_on_as_of", "construction");

  const constructionData = construction.data;
  const leader = assertLeaderShape(deck, construction);
  const counts = deckCounts(deck);
  const mainSize = Object.values(counts).reduce((total, count) => total + count, 0);
  if (mainSize !== constructionData.mainDeckSize || deck.data.mainDeckSize !== mainSize) {
    fail("illegal_deck", "main deck size does not match construction policy", {
      reason: "main_deck_size",
      expected: constructionData.mainDeckSize,
      actual: mainSize,
    });
  }
  if (deck.data.gameplayHash !== gameplayHashForDeck(deck.data.leaderGameplayId, counts)) {
    fail("illegal_deck", "deck gameplay identity does not match its contents", {
      reason: "gameplay_hash_mismatch",
      gameplayHash: deck.data.gameplayHash,
    });
  }
  assertIdentityEvidence(deck, rules.data.rulesIdentityHash);
  const poolRows = cardRows(cardPool);
  const leaderRow = assertLeaderPool(leader, poolRows);
  const ids = Object.keys(counts);
  assertCardRulesAndPool([leader], poolRows, rules, asOf);
  assertCardRulesAndPool(ids, poolRows, rules, asOf, { mainDeck: true });
  const banRows = banlistRows(banlist);
  assertBanlistAndCopies(counts, banRows, construction, asOf);
  assertLeaderBanlist(leader, banRows, asOf);
  assertLeaderColor(leader, leaderRow, construction);
  return { legal: true };
}
