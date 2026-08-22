import { EnvironmentError } from "./errors.mjs";
import { sha256Canonical } from "./hash.mjs";
import { finalizeSnapshot } from "./snapshot.mjs";

const FULL_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

function fail(code, message = code, details = {}) {
  const rendered = message.startsWith(`${code}:`) ? message : `${code}: ${message}`;
  throw new EnvironmentError(code, rendered, details);
}

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function trustedIdentityProof(value) {
  if (!isRecord(value)) return null;
  const gameplayId = value.gameplayId;
  const rulesIdentityHash = value.rulesIdentityHash;
  const sourceHash = value.sourceHash;
  if (
    typeof gameplayId !== "string"
    || gameplayId.length === 0
    || typeof rulesIdentityHash !== "string"
    || !FULL_HASH_PATTERN.test(rulesIdentityHash)
    || typeof sourceHash !== "string"
    || !FULL_HASH_PATTERN.test(sourceHash)
  ) return null;
  return {
    gameplayId,
    rulesIdentityHash,
    sourceHash,
  };
}

function contextProof(context, alias) {
  const registries = [
    context.identityProofs,
    context.cardIdentityEvidence,
    context.printingIdentity,
  ];
  for (const registry of registries) {
    if (!isRecord(registry) || !Object.hasOwn(registry, alias)) continue;
    const proof = trustedIdentityProof(registry[alias]);
    if (proof) return proof;
  }
  return null;
}

function normalizeReference(reference, context, evidenceByAlias) {
  if (typeof reference === "string" && reference.length > 0) {
    const proof = contextProof(context, reference);
    if (proof) {
      evidenceByAlias[reference] = { ...proof, proven: true };
      return proof.gameplayId;
    }
    return reference;
  }

  if (!isRecord(reference)) {
    fail("deck_invalid", "deck card references must be non-empty strings or objects", {
      reference,
    });
  }

  const gameplayId = reference.gameplayId;
  const alias = reference.printingId
    ?? reference.printId
    ?? reference.cardId
    ?? reference.id;
  if (typeof gameplayId === "string" && gameplayId.length > 0) {
    if (typeof alias !== "string" || alias.length === 0 || alias === gameplayId) return gameplayId;
    const proof = contextProof(context, alias);
    if (proof?.gameplayId === gameplayId) {
      evidenceByAlias[alias] = { ...proof, proven: true };
      return gameplayId;
    }
    evidenceByAlias[alias] = { gameplayId, proven: false };
    return alias;
  }
  if (typeof alias === "string" && alias.length > 0) {
    const proof = contextProof(context, alias);
    if (proof) {
      evidenceByAlias[alias] = { ...proof, proven: true };
      return proof.gameplayId;
    }
    return alias;
  }
  fail("deck_invalid", "deck card reference has no gameplay or printing identity", { reference });
}

function countCards(main, context, evidenceByAlias) {
  if (!Array.isArray(main)) fail("deck_invalid", "main must be an array", { path: "main" });
  const counts = Object.create(null);
  for (const reference of main) {
    const gameplayId = normalizeReference(reference, context, evidenceByAlias);
    counts[gameplayId] = (counts[gameplayId] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  )));
}

export function gameplayHashForDeck(leaderGameplayId, mainDeckCounts) {
  if (typeof leaderGameplayId !== "string" || leaderGameplayId.length === 0) {
    fail("deck_invalid", "leaderGameplayId must be a non-empty string", { leaderGameplayId });
  }
  if (!isRecord(mainDeckCounts)) {
    fail("deck_invalid", "mainDeckCounts must be an object", { mainDeckCounts });
  }
  const sortedCounts = {};
  for (const [gameplayId, count] of Object.entries(mainDeckCounts).sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  ))) {
    if (typeof gameplayId !== "string" || gameplayId.length === 0) {
      fail("deck_invalid", "mainDeckCounts contains an empty gameplay ID", { gameplayId });
    }
    if (!Number.isSafeInteger(count) || count <= 0) {
      fail("deck_invalid", "mainDeckCounts values must be positive safe integers", {
        gameplayId,
        count,
      });
    }
    sortedCounts[gameplayId] = count;
  }
  return sha256Canonical({
    schemaVersion: 1,
    leaderGameplayId,
    mainDeckCounts: sortedCounts,
  });
}

export function buildDeckSnapshot(input, context = {}) {
  if (!isRecord(input)) fail("deck_invalid", "deck input must be an object");
  if (!isRecord(context)) fail("deck_invalid", "deck context must be an object", { context });
  const mergedContext = {
    ...(isRecord(input.context) ? input.context : {}),
    ...context,
  };
  const leaderEvidence = {};
  const leaderGameplayId = normalizeReference(input.leader, mergedContext, leaderEvidence);
  const identityEvidence = { ...leaderEvidence };
  const mainDeckCounts = countCards(input.main, mergedContext, identityEvidence);
  const gameplayHash = gameplayHashForDeck(leaderGameplayId, mainDeckCounts);
  const source = mergedContext.source ?? input.source;
  const asOf = mergedContext.asOf ?? input.asOf;
  const data = {
    leaderGameplayId,
    mainDeckCounts,
    mainDeckSize: input.main.length,
    gameplayHash,
    displayName: input.name ?? null,
    notes: input.notes ?? input.note ?? null,
  };
  if (Object.keys(identityEvidence).length > 0) data.identityEvidence = identityEvidence;

  return finalizeSnapshot(
    {
      schemaVersion: 1,
      kind: "deck",
      environment: { scope: "edition-neutral" },
      asOf,
      source,
      coverage: mergedContext.coverage ?? input.coverage ?? {
        status: "complete",
        warnings: [],
        missingFields: [],
      },
      data,
    },
    mergedContext.idStem ?? input.idStem ?? `deck-${leaderGameplayId}`,
  );
}
