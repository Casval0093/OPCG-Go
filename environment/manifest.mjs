// The Environment Manifest: the design's TOP-LEVEL contract.
//
// Controller ruling (Task 6): a Manifest is not disguised as a common snapshot
// with invented source/coverage/data. It has its own `verifyManifest()` that
// validates schema, full content hash, hash-derived ID suffix, exact
// native/proxy policy, safe ID, and every reference shape -- and it is
// published through the Task 2 store's proven atomic no-clobber protocol via
// that store's injected-verifier contract, never a second durability protocol.

import { EnvironmentError } from "./errors.mjs";
import { hashProjection } from "./hash.mjs";
import { assertNativeEnvironment } from "./rules.mjs";
import { publishImmutableArtifact } from "./store.mjs";
import { assertTimeZone } from "./time.mjs";
import {
  buildAliasRecord,
  createRepository,
  derivedArtifactPath,
  isFullHash,
  isSafeArtifactId,
  manifestPath,
  parseEnvironmentSelector,
  publishAliasRecord,
  readArtifactAt,
} from "./alias.mjs";

export const MANIFEST_SCHEMA_VERSION = 1;
export const MANIFEST_KINDS = Object.freeze(["official", "proxy"]);
export const MINIMUM_GAMES_PER_SEAT_FLOOR = 200;

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CANONICAL_ARCHETYPE_ID_PATTERN = /^leader:[A-Za-z0-9][A-Za-z0-9_-]*$/;
const ID_STEM_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const WEIGHT_TOLERANCE = 1e-12;

const MANIFEST_KEYS = Object.freeze([
  "schemaVersion",
  "environmentKey",
  "kind",
  "edition",
  "metagameRegion",
  "language",
  "formatId",
  "asOf",
  "timeZone",
  "references",
  "opponents",
  "matchupPolicy",
  "latestPolicy",
]);
const REFERENCE_KEYS = Object.freeze([
  "rules",
  "cardPool",
  "banlist",
  "constructionPolicy",
  "simulationCapability",
  "field",
  "market",
]);
const MATCHUP_POLICY_KEYS = Object.freeze([
  "mode",
  "observedMatchupRefs",
  "proxyPriorRef",
  "minimumGamesPerSeat",
  "requiredFieldCoverage",
  "requiredMatchupCoverage",
  "turnOrderWeights",
  "roundPolicy",
]);
const ROUND_POLICY_KEYS = Object.freeze(["stage", "roundDurationMinutes", "timeoutScoring", "clockModelRef"]);
const LATEST_POLICY_KEYS = Object.freeze(["fieldMaxAgeDays", "marketMaxAgeDays", "marketStalenessBlocksStrength"]);
const PROXY_PRIOR_KEYS = Object.freeze(["snapshotId", "contentHash", "originEdition", "originEnvironmentKey"]);
const DECK_ENTRY_KEYS = Object.freeze(["deckSnapshotId", "contentHash", "gameplayHash", "weight"]);
const MATCHUP_MODES = Object.freeze(["simulate", "observed"]);

// Which immutable artifact kind each Manifest reference must resolve to.
export const REFERENCE_KINDS = Object.freeze({
  rules: "rules",
  cardPool: "card_pool",
  banlist: "banlist",
  constructionPolicy: "construction",
  simulationCapability: "simulation-capability",
  field: "field",
  market: "market",
});

function fail(code, message = code, details = {}) {
  const rendered = message.startsWith(`${code}:`) ? message : `${code}: ${message}`;
  throw new EnvironmentError(code, rendered, details);
}

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isValidLocalDate(value) {
  if (typeof value !== "string" || !LOCAL_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function exactKeys(value, keys, path, code = "manifest_invalid") {
  if (!isRecord(value)) fail(code, `${path} must be an object`, { path });
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(code, `${path} does not have exactly its contract fields`, {
      path,
      unexpected: actual.filter((key) => !expected.includes(key)),
      missing: expected.filter((key) => !actual.includes(key)),
    });
  }
  return value;
}

function assertRef(value, path) {
  exactKeys(value, ["snapshotId", "contentHash"], path);
  if (!isSafeArtifactId(value.snapshotId)) {
    fail("manifest_invalid", `${path}.snapshotId is not a safe immutable identifier`, { path });
  }
  if (!isFullHash(value.contentHash)) {
    fail("manifest_invalid", `${path}.contentHash must be a full sha256 hash`, { path });
  }
  return value;
}

function assertWeight(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1) {
    fail("manifest_invalid", `${path} must be a weight in (0, 1]`, { path, value });
  }
  return value;
}

/* ------------------------------------------------------------------ *
 * Identity
 * ------------------------------------------------------------------ */

function identityOf(manifest) {
  return {
    edition: manifest.edition,
    metagameRegion: manifest.metagameRegion,
    language: manifest.language,
    formatId: manifest.formatId,
    timeZone: manifest.timeZone,
  };
}

// The logical colon-delimited identity, canonical IANA timezone included. It is
// NOT a filesystem path and NOT a selector: many reviewed Manifest revisions
// share one key.
export function environmentKey(identity) {
  if (!isRecord(identity)) {
    fail("environment_identity_mismatch", "environment identity must be an object", {});
  }
  assertNativeEnvironment({
    edition: identity.edition,
    metagameRegion: identity.metagameRegion,
    language: identity.language,
    formatId: identity.formatId,
    timeZone: identity.timeZone,
  });
  try {
    assertTimeZone(identity.timeZone, "timeZone");
  } catch (error) {
    fail("environment_identity_mismatch", "environment timezone is not a canonical IANA zone", {
      timeZone: identity.timeZone,
      cause: error instanceof EnvironmentError ? error.code : "invalid",
    });
  }
  if (!isValidLocalDate(identity.asOf)) {
    fail("environment_identity_mismatch", "environment asOf must be a valid local date", {
      asOf: identity.asOf,
    });
  }
  return [
    identity.edition,
    identity.metagameRegion,
    identity.language,
    identity.timeZone,
    identity.formatId,
    identity.asOf,
  ].join(":");
}

// Separate from `environmentKey`: a filesystem-safe slug (the timezone slash
// becomes a dash) that, with the hash suffix, becomes the immutable ID. It
// never embeds "/" or ":" and never accepts a caller path.
export function manifestIdSlug(identity) {
  environmentKey(identity);
  const slug = [
    identity.edition,
    identity.metagameRegion,
    identity.language,
    identity.timeZone.replace(/\//g, "-"),
    identity.formatId,
    identity.asOf,
  ]
    .join("-")
    .normalize("NFC")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  if (!ID_STEM_PATTERN.test(slug)) {
    fail("manifest_invalid", "environment identity does not produce a safe Manifest slug", { slug });
  }
  return slug;
}

/* ------------------------------------------------------------------ *
 * Structural contract (shared by buildManifest and verifyManifest)
 * ------------------------------------------------------------------ */

function validateOpponents(draft) {
  if (!Array.isArray(draft.opponents) || draft.opponents.length === 0) {
    fail("manifest_invalid", "opponents must be a non-empty array", { path: "opponents" });
  }
  const seen = new Set();
  draft.opponents.forEach((entry, index) => {
    const path = `opponents[${index}]`;
    exactKeys(entry, ["archetypeId", "representativeDecks"], path);
    if (typeof entry.archetypeId !== "string" || !CANONICAL_ARCHETYPE_ID_PATTERN.test(entry.archetypeId)) {
      fail("manifest_invalid", `${path}.archetypeId is not a canonical leader:<gameplayId> archetype`, {
        path,
        archetypeId: entry.archetypeId,
      });
    }
    if (seen.has(entry.archetypeId)) {
      fail("manifest_invalid", "opponents contain a duplicate archetype", { archetypeId: entry.archetypeId });
    }
    seen.add(entry.archetypeId);
    if (!Array.isArray(entry.representativeDecks) || entry.representativeDecks.length === 0) {
      fail("missing_representative_deck", `${path} has no representative deck`, {
        path,
        archetypeId: entry.archetypeId,
      });
    }
    const deckIds = new Set();
    entry.representativeDecks.forEach((deck, deckIndex) => {
      const deckPath = `${path}.representativeDecks[${deckIndex}]`;
      exactKeys(deck, DECK_ENTRY_KEYS, deckPath);
      if (!isSafeArtifactId(deck.deckSnapshotId)) {
        fail("manifest_invalid", `${deckPath}.deckSnapshotId is not a safe immutable identifier`, { path: deckPath });
      }
      if (!isFullHash(deck.contentHash) || !isFullHash(deck.gameplayHash)) {
        fail("manifest_invalid", `${deckPath} needs full content and gameplay hashes`, { path: deckPath });
      }
      assertWeight(deck.weight, `${deckPath}.weight`);
      if (deckIds.has(deck.deckSnapshotId)) {
        fail("manifest_invalid", `${path} repeats one representative deck`, { path, deckSnapshotId: deck.deckSnapshotId });
      }
      deckIds.add(deck.deckSnapshotId);
    });
  });
}

function validateMatchupPolicy(draft) {
  const policy = exactKeys(draft.matchupPolicy, MATCHUP_POLICY_KEYS, "matchupPolicy");
  if (!MATCHUP_MODES.includes(policy.mode)) {
    fail("manifest_invalid", "matchupPolicy.mode must be simulate or observed", { mode: policy.mode });
  }
  if (!Array.isArray(policy.observedMatchupRefs)) {
    fail("manifest_invalid", "matchupPolicy.observedMatchupRefs must be an array", {});
  }
  policy.observedMatchupRefs.forEach((ref, index) => assertRef(ref, `matchupPolicy.observedMatchupRefs[${index}]`));
  if (policy.proxyPriorRef !== null) {
    exactKeys(policy.proxyPriorRef, PROXY_PRIOR_KEYS, "matchupPolicy.proxyPriorRef");
    if (!isSafeArtifactId(policy.proxyPriorRef.snapshotId) || !isFullHash(policy.proxyPriorRef.contentHash)) {
      fail("manifest_invalid", "matchupPolicy.proxyPriorRef needs a safe id and full hash", {});
    }
    if (typeof policy.proxyPriorRef.originEdition !== "string" || policy.proxyPriorRef.originEdition.length === 0) {
      fail("manifest_invalid", "matchupPolicy.proxyPriorRef.originEdition must be named", {});
    }
    if (
      typeof policy.proxyPriorRef.originEnvironmentKey !== "string"
      || policy.proxyPriorRef.originEnvironmentKey.length === 0
    ) {
      fail("manifest_invalid", "matchupPolicy.proxyPriorRef.originEnvironmentKey must be named", {});
    }
  }
  // The v1 policy floor lives in the hashed Manifest, never in code: a Manifest
  // may require MORE than 200 valid completed games per seat, never fewer.
  if (!Number.isSafeInteger(policy.minimumGamesPerSeat) || policy.minimumGamesPerSeat < MINIMUM_GAMES_PER_SEAT_FLOOR) {
    fail("manifest_invalid", "matchupPolicy.minimumGamesPerSeat is below the v1 floor", {
      minimumGamesPerSeat: policy.minimumGamesPerSeat,
      floor: MINIMUM_GAMES_PER_SEAT_FLOOR,
    });
  }
  for (const key of ["requiredFieldCoverage", "requiredMatchupCoverage"]) {
    if (policy[key] !== 1) {
      fail("manifest_invalid", `matchupPolicy.${key} must be complete coverage (1)`, { [key]: policy[key] });
    }
  }
  const weights = exactKeys(policy.turnOrderWeights, ["play", "draw"], "matchupPolicy.turnOrderWeights");
  for (const seat of ["play", "draw"]) {
    if (typeof weights[seat] !== "number" || !Number.isFinite(weights[seat]) || weights[seat] < 0 || weights[seat] > 1) {
      fail("manifest_invalid", `matchupPolicy.turnOrderWeights.${seat} must be within [0, 1]`, {
        seat,
        value: weights[seat],
      });
    }
  }
  const round = exactKeys(policy.roundPolicy, ROUND_POLICY_KEYS, "matchupPolicy.roundPolicy");
  if (typeof round.stage !== "string" || round.stage.length === 0) {
    fail("manifest_invalid", "matchupPolicy.roundPolicy.stage must be named", {});
  }
  if (typeof round.roundDurationMinutes !== "number" || !Number.isFinite(round.roundDurationMinutes) || round.roundDurationMinutes <= 0) {
    fail("manifest_invalid", "matchupPolicy.roundPolicy.roundDurationMinutes must be positive", {});
  }
  if (typeof round.timeoutScoring !== "string" || round.timeoutScoring.length === 0) {
    fail("manifest_invalid", "matchupPolicy.roundPolicy.timeoutScoring must be named", {});
  }
  if (round.clockModelRef !== null) assertRef(round.clockModelRef, "matchupPolicy.roundPolicy.clockModelRef");
}

function validateLatestPolicy(draft) {
  const policy = exactKeys(draft.latestPolicy, LATEST_POLICY_KEYS, "latestPolicy");
  for (const key of ["fieldMaxAgeDays", "marketMaxAgeDays"]) {
    if (typeof policy[key] !== "number" || !Number.isFinite(policy[key]) || policy[key] <= 0) {
      fail("manifest_invalid", `latestPolicy.${key} must be a positive number of days`, { [key]: policy[key] });
    }
  }
  if (typeof policy.marketStalenessBlocksStrength !== "boolean") {
    fail("manifest_invalid", "latestPolicy.marketStalenessBlocksStrength must be boolean", {});
  }
}

// Weight SUMS are checked when a Manifest is authored or published, never in
// `verifyManifest`. A Manifest whose weights cannot sum to one is unusable, so
// it must not be publishable or aliasable -- but the resolver's own plan stage
// still owns the sums for a Manifest that reached the repository some other
// way (an older builder, a hand-signed file), which is why this deliberately
// does NOT live in the read-time verifier.
export function validateWeightSums(draft) {
  const weights = draft.matchupPolicy?.turnOrderWeights;
  if (isRecord(weights) && Math.abs(weights.play + weights.draw - 1) > WEIGHT_TOLERANCE) {
    fail("manifest_invalid", "turn-order weights must sum to exactly one", {
      path: "matchupPolicy.turnOrderWeights",
      sum: weights.play + weights.draw,
    });
  }
  if (!Array.isArray(draft.opponents)) return draft;
  draft.opponents.forEach((entry, index) => {
    if (!Array.isArray(entry?.representativeDecks) || entry.representativeDecks.length === 0) return;
    const sum = entry.representativeDecks.reduce((total, deck) => total + deck.weight, 0);
    if (Math.abs(sum - 1) > WEIGHT_TOLERANCE) {
      fail("manifest_invalid", "within-archetype representative weights must sum to exactly one", {
        path: `opponents[${index}].representativeDecks`,
        archetypeId: entry.archetypeId,
        sum,
      });
    }
  });
  return draft;
}

export function validateManifestIdentity(draft) {
  if (!isRecord(draft)) fail("manifest_invalid", "Manifest must be an object", {});
  if (Object.hasOwn(draft, "manifestId") || Object.hasOwn(draft, "contentHash")) {
    fail("manifest_invalid", "a Manifest draft must not carry a derived manifestId or contentHash", {});
  }
  exactKeys(draft, MANIFEST_KEYS, "manifest");
  if (draft.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    fail("manifest_invalid", "unsupported Manifest schemaVersion", { schemaVersion: draft.schemaVersion });
  }
  if (!MANIFEST_KINDS.includes(draft.kind)) {
    fail("manifest_invalid", "Manifest kind must be official or proxy", { kind: draft.kind });
  }
  const expectedKey = environmentKey({ ...identityOf(draft), asOf: draft.asOf });
  if (draft.environmentKey !== expectedKey) {
    fail("environment_identity_mismatch", "environmentKey disagrees with the Manifest's own identity fields", {
      expected: expectedKey,
      actual: draft.environmentKey,
    });
  }
  const references = exactKeys(draft.references, REFERENCE_KEYS, "references");
  for (const key of REFERENCE_KEYS) {
    if (key === "market") continue;
    assertRef(references[key], `references.${key}`);
  }
  if (!Array.isArray(references.market)) {
    fail("manifest_invalid", "references.market must be an array", { path: "references.market" });
  }
  references.market.forEach((ref, index) => assertRef(ref, `references.market[${index}]`));
  validateOpponents(draft);
  validateMatchupPolicy(draft);
  validateLatestPolicy(draft);
  return draft;
}

// An official environment fails closed: it never borrows another edition's
// prior. A proxy must say so in its own `kind` AND name the cross-edition
// origin, so no output can be mistaken for official SC.
export function validateOfficialOrProxyPolicy(draft) {
  const prior = draft.matchupPolicy.proxyPriorRef;
  if (draft.kind === "official") {
    if (prior !== null) {
      fail("environment_identity_mismatch", "an official Manifest can never carry a cross-edition prior", {
        reason: "official_manifest_with_prior",
      });
    }
    return draft;
  }
  if (prior === null) {
    fail("environment_identity_mismatch", "a proxy Manifest requires an explicit cross-edition prior", {
      reason: "proxy_manifest_without_prior",
    });
  }
  if (prior.originEdition === draft.edition) {
    fail("environment_identity_mismatch", "a proxy prior must come from a different edition", {
      reason: "proxy_prior_same_edition",
      originEdition: prior.originEdition,
    });
  }
  return draft;
}

/* ------------------------------------------------------------------ *
 * Reference loading (shared with the resolver so both enforce one
 * contract; the resolver supplies the stage label)
 * ------------------------------------------------------------------ */

function sameNativeIdentity(left, right) {
  return left?.edition === right?.edition
    && left?.metagameRegion === right?.metagameRegion
    && left?.language === right?.language
    && left?.formatId === right?.formatId
    && left?.timeZone === right?.timeZone;
}

// Task 12 permanently labels the existing EN matrix `legacy_unverified`. Any
// artifact that declares an evidence status other than "verified" is refused
// from BOTH official and proxy Manifests -- checked wherever an artifact is
// loaded, so a Manifest built by an older builder cannot smuggle one in.
function assertNotLegacyEvidence(snapshot, path) {
  for (const [scope, holder] of [["", snapshot], ["source.", snapshot.source], ["data.", snapshot.data]]) {
    if (!isRecord(holder) || !Object.hasOwn(holder, "evidenceStatus")) continue;
    if (holder.evidenceStatus !== "verified") {
      fail("legacy_evidence_rejected", "legacy or unverified evidence can never enter an environment Manifest", {
        path,
        field: `${scope}evidenceStatus`,
        evidenceStatus: holder.evidenceStatus,
      });
    }
  }
}

export function loadReferencedArtifact(repository, ref, {
  kind,
  path,
  identity,
  absentCode = "environment_not_found",
  editionNeutral = false,
  crossEdition = false,
} = {}) {
  const target = derivedArtifactPath(repository.root, kind, ref.snapshotId);
  const result = readArtifactAt(repository, target);
  if (!result.ok) {
    if (result.reason === "absent") {
      fail(absentCode, "a referenced immutable artifact is not published in this repository", {
        path,
        kind,
        snapshotId: ref.snapshotId,
      });
    }
    const error = result.error;
    if (error instanceof EnvironmentError) {
      // The store reports the absolute file it could not verify. Spread its
      // details FIRST so the caller's logical path (references.rules, ...)
      // wins: a repository-private filesystem path is never part of the
      // machine-readable failure contract.
      fail(error.code, error.message, { ...error.details, path, kind });
    }
    fail("environment_not_found", "a referenced immutable artifact could not be read", {
      path,
      kind,
      cause: error?.code ?? "unreadable",
    });
  }
  const snapshot = result.value;
  if (snapshot.kind !== kind) {
    fail("environment_not_found", "a referenced artifact is not of the expected kind", {
      path,
      expectedKind: kind,
      actualKind: snapshot.kind,
    });
  }
  // Hash first: a reference pins a full content hash, so a differing hash is
  // the primary failure. The identifier check below then catches the residual
  // case the hash cannot see -- identical content filed under a different
  // stem, which means the repository has the artifact in the wrong place.
  if (snapshot.contentHash !== ref.contentHash) {
    fail("snapshot_hash_mismatch", "a referenced artifact does not match its pinned content hash", {
      path,
      expected: ref.contentHash,
      actual: snapshot.contentHash,
    });
  }
  if (snapshot.snapshotId !== ref.snapshotId) {
    fail("snapshot_id_collision", "a referenced artifact does not carry the identifier it is filed under", {
      path,
      expected: ref.snapshotId,
      actual: snapshot.snapshotId,
    });
  }
  assertNotLegacyEvidence(snapshot, path);
  if (editionNeutral) {
    if (snapshot.environment?.scope !== "edition-neutral") {
      fail("environment_identity_mismatch", "a deck artifact must carry edition-neutral identity", { path });
    }
  } else if (crossEdition) {
    if (snapshot.environment?.edition !== crossEdition) {
      fail("environment_identity_mismatch", "a cross-edition prior does not come from its named edition", {
        path,
        expectedEdition: crossEdition,
        actualEdition: snapshot.environment?.edition,
      });
    }
  } else if (identity && !sameNativeIdentity(snapshot.environment, identity)) {
    fail("environment_identity_mismatch", "a referenced artifact belongs to a different environment identity", {
      path,
      expected: identity.edition,
      actual: snapshot.environment?.edition,
    });
  }
  return snapshot;
}

function loadDeckReference(repository, entry, path) {
  const deck = loadReferencedArtifact(
    repository,
    { snapshotId: entry.deckSnapshotId, contentHash: entry.contentHash },
    { kind: "deck", path, editionNeutral: true, absentCode: "missing_representative_deck" },
  );
  if (deck.data?.gameplayHash !== entry.gameplayHash) {
    fail("illegal_deck", "a representative deck's pinned gameplay hash does not match its contents", {
      path,
      expected: entry.gameplayHash,
      actual: deck.data?.gameplayHash,
    });
  }
  return deck;
}

// v1 NARROWING: cross-edition borrowing is confined to the explicitly named
// `matchupPolicy.proxyPriorRef`. Every other reference -- including
// `references.field` in a proxy Manifest -- must match the Manifest's own
// native identity. The design document allows a proxy to borrow a cross-edition
// FIELD as well; widening to that needs all THREE of these sites changed
// together, or the resolver will contradict the builder:
//   1. here, the `identity` argument passed for `references.field`;
//   2. environment/resolver.mjs stage 7, which reloads the field with the same
//      identity assertion;
//   3. environment/resolver.mjs validateFieldEvidence, which requires
//      data.window.timeZone to equal the Manifest timezone.
export function validateAllReferences(draft, repository) {
  const identity = identityOf(draft);
  const references = draft.references;
  for (const key of REFERENCE_KEYS) {
    if (key === "market") continue;
    loadReferencedArtifact(repository, references[key], {
      kind: REFERENCE_KINDS[key],
      path: `references.${key}`,
      identity,
    });
  }
  references.market.forEach((ref, index) => loadReferencedArtifact(repository, ref, {
    kind: "market",
    path: `references.market[${index}]`,
    identity,
  }));
  const policy = draft.matchupPolicy;
  if (policy.roundPolicy.clockModelRef !== null) {
    loadReferencedArtifact(repository, policy.roundPolicy.clockModelRef, {
      kind: "clock-model",
      path: "matchupPolicy.roundPolicy.clockModelRef",
      identity,
    });
  }
  policy.observedMatchupRefs.forEach((ref, index) => loadReferencedArtifact(repository, ref, {
    kind: "matchup",
    path: `matchupPolicy.observedMatchupRefs[${index}]`,
    identity,
  }));
  if (policy.proxyPriorRef !== null) {
    loadReferencedArtifact(
      repository,
      { snapshotId: policy.proxyPriorRef.snapshotId, contentHash: policy.proxyPriorRef.contentHash },
      {
        kind: "matchup",
        path: "matchupPolicy.proxyPriorRef",
        crossEdition: policy.proxyPriorRef.originEdition,
      },
    );
  }
  draft.opponents.forEach((entry, index) => entry.representativeDecks.forEach((deck, deckIndex) => (
    loadDeckReference(repository, deck, `opponents[${index}].representativeDecks[${deckIndex}]`)
  )));
  return draft;
}

/* ------------------------------------------------------------------ *
 * Build, verify, publish
 * ------------------------------------------------------------------ */

function freezeDeep(value, active = new Set()) {
  if (value === null || typeof value !== "object" || active.has(value)) return value;
  active.add(value);
  try {
    for (const child of Object.values(value)) freezeDeep(child, active);
    return Object.freeze(value);
  } finally {
    active.delete(value);
  }
}

function manifestProjection(manifest) {
  return Object.fromEntries(
    Object.entries(manifest).filter(([key]) => key !== "manifestId" && key !== "contentHash"),
  );
}

export function buildManifest(draft, repository) {
  const resolvedRepository = createRepository(repository);
  validateManifestIdentity(draft);
  validateWeightSums(draft);
  validateAllReferences(draft, resolvedRepository);
  validateOfficialOrProxyPolicy(draft);
  // The immutable ID is derived only AFTER the content hash is known, and the
  // logical environmentKey stays inside the hashed payload. Two reviewed
  // revisions of one logical environment therefore get distinct IDs instead of
  // colliding or overwriting.
  let contentHash;
  try {
    contentHash = hashProjection(draft, []);
  } catch (error) {
    fail("manifest_invalid", "Manifest contains unsupported canonical data", {
      cause: error?.code ?? error?.message,
    });
  }
  return freezeDeep({
    ...structuredClone(draft),
    manifestId: `${manifestIdSlug({ ...identityOf(draft), asOf: draft.asOf })}-${contentHash.slice(7, 23)}`,
    contentHash,
  });
}

export function verifyManifest(manifest) {
  if (!isRecord(manifest)) fail("manifest_invalid", "Manifest must be an object", {});
  if (!isSafeArtifactId(manifest.manifestId)) {
    fail("manifest_invalid", "manifestId is not a safe immutable identifier", {
      manifestId: manifest.manifestId,
    });
  }
  if (!isFullHash(manifest.contentHash)) {
    fail("manifest_invalid", "contentHash must be a full sha256 hash", {});
  }
  let expectedHash;
  try {
    expectedHash = hashProjection(manifest, ["manifestId", "contentHash"]);
  } catch (error) {
    fail("manifest_invalid", "Manifest contains unsupported canonical data", {
      cause: error?.code ?? error?.message,
    });
  }
  if (manifest.contentHash !== expectedHash) {
    fail("snapshot_hash_mismatch", "Manifest content hash does not match its immutable content", {
      expected: expectedHash,
      actual: manifest.contentHash,
    });
  }
  if (!manifest.manifestId.endsWith(manifest.contentHash.slice(7, 23))) {
    fail("snapshot_hash_mismatch", "manifestId hash suffix does not match contentHash", {
      manifestId: manifest.manifestId,
    });
  }
  // A tampered Manifest re-signed with a genuine hash is indistinguishable from
  // an honest one by hashing alone, so the structural policy contract is re-run
  // on every read -- otherwise the 200-game floor or the official/proxy split
  // could be edited in place and re-signed.
  const projection = manifestProjection(manifest);
  validateManifestIdentity(projection);
  validateOfficialOrProxyPolicy(projection);
  if (manifest.manifestId !== `${manifestIdSlug({ ...identityOf(manifest), asOf: manifest.asOf })}-${manifest.contentHash.slice(7, 23)}`) {
    fail("environment_identity_mismatch", "manifestId slug does not match the Manifest's own identity", {
      manifestId: manifest.manifestId,
    });
  }
  return manifest;
}

export const MANIFEST_ARTIFACT_CONTRACT = Object.freeze({
  verify: verifyManifest,
  idKey: "manifestId",
});

export function manifestRef(manifest) {
  verifyManifest(manifest);
  return Object.freeze({ manifestId: manifest.manifestId, contentHash: manifest.contentHash });
}

export function publishManifest({ root, manifest, alias = null, updatedAt = null, io } = {}) {
  const repository = createRepository({ root, io });
  verifyManifest(manifest);
  // A Manifest whose weights cannot sum to one can never produce a scoreable
  // plan, so it must never reach the repository or an alias -- not even when it
  // was signed by something other than buildManifest.
  validateWeightSums(manifest);

  let aliasRecord = null;
  if (alias !== null && alias !== undefined) {
    const parsed = parseEnvironmentSelector(alias);
    if (parsed.mode !== "alias") {
      fail("environment_not_found", "only a registered alias selector can be published", { alias });
    }
    // An alias is a promise about WHICH environment it serves. SC/latest can
    // never point at an EN Manifest, and an official alias can never serve a
    // proxy Manifest (or the proxy provenance would disappear).
    if (parsed.edition !== manifest.edition || parsed.kind !== manifest.kind) {
      fail("environment_identity_mismatch", "alias does not match the Manifest's edition and kind", {
        alias: parsed.alias,
        aliasEdition: parsed.edition,
        aliasKind: parsed.kind,
        manifestEdition: manifest.edition,
        manifestKind: manifest.kind,
      });
    }
    aliasRecord = buildAliasRecord({
      alias: parsed.alias,
      manifestId: manifest.manifestId,
      manifestHash: manifest.contentHash,
      updatedAt,
    });
  }

  const target = manifestPath(repository.root, manifest.manifestId);
  publishImmutableArtifact(target, manifest, repository.io, MANIFEST_ARTIFACT_CONTRACT);

  // Read the immutable Manifest BACK and validate its full hash before any
  // alias may advance. A crash between these two steps leaves a valid
  // unaliased Manifest, and the retry is idempotent.
  const readback = readArtifactAt(repository, target, MANIFEST_ARTIFACT_CONTRACT);
  if (!readback.ok) {
    fail("environment_not_found", "the published Manifest could not be read back", {
      reason: readback.reason,
      cause: readback.error instanceof EnvironmentError ? readback.error.code : undefined,
    });
  }
  if (readback.value.manifestId !== manifest.manifestId || readback.value.contentHash !== manifest.contentHash) {
    fail("snapshot_id_collision", "the published Manifest does not match what was written", {});
  }

  if (aliasRecord !== null) publishAliasRecord(repository, aliasRecord);
  return Object.freeze({
    manifestRef: Object.freeze({ manifestId: manifest.manifestId, contentHash: manifest.contentHash }),
    aliasRecord,
  });
}
