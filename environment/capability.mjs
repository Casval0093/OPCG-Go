import { EnvironmentError } from "./errors.mjs";
import { sha256Canonical } from "./hash.mjs";
import { assertNativeEnvironment, FULL_HASH_PATTERN } from "./rules.mjs";
import { finalizeSnapshot, verifySnapshot } from "./snapshot.mjs";

const CAPABILITY_KIND = "simulation-capability";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fail(code, message = code, details = {}) {
  const rendered = message.startsWith(`${code}:`) ? message : `${code}: ${message}`;
  throw new EnvironmentError(code, rendered, details);
}

function requiredString(value, path, code = "capability_invalid") {
  if (typeof value !== "string" || value.length === 0) {
    fail(code, `${path} must be a non-empty string`, { path, value });
  }
  return value;
}

function fullHash(value, path, code = "capability_invalid") {
  if (typeof value !== "string" || !FULL_HASH_PATTERN.test(value)) {
    fail(code, `${path} must be a full sha256 hash`, { path, value });
  }
  return value;
}

function localDate(value, path) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    fail("capability_invalid", `${path} must be a local calendar date`, { path, value });
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    fail("capability_invalid", `${path} must be a valid local calendar date`, { path, value });
  }
  return value;
}

function environmentFromInput(input) {
  const candidate = isRecord(input.environment) ? input.environment : input;
  const environment = {
    edition: candidate.edition,
    metagameRegion: candidate.metagameRegion,
    language: candidate.language,
    formatId: candidate.formatId,
    timeZone: candidate.timeZone,
  };
  try {
    assertNativeEnvironment(environment);
  } catch (error) {
    if (error instanceof EnvironmentError) throw error;
    fail("environment_identity_mismatch", "capability environment is not native v1", {
      cause: error?.message,
    });
  }
  return environment;
}

function normalizeText(value, path) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    fail("catalog_incomplete", `${path} must be a string or null`, { path, value });
  }
  return value;
}

function structuredEffectsEvidence(row, path) {
  const fields = [
    ["hasStructuredEffects", row.hasStructuredEffects],
    ["hasExecutableEffects", row.hasExecutableEffects],
    ["hasEffects", row.hasEffects],
    ["structuredExecutableEffects", row.structuredExecutableEffects],
  ];
  const explicit = fields.filter(([key, value]) => Object.hasOwn(row, key) && value !== undefined);
  if (explicit.length > 0) {
    for (const [key, value] of explicit) {
      if (typeof value !== "boolean") {
        fail("catalog_incomplete", `${path}.${key} must be boolean`, {
          path: `${path}.${key}`,
          value,
        });
      }
    }
    const values = new Set(explicit.map(([, value]) => value));
    if (values.size !== 1) {
      fail("catalog_incomplete", `${path} has conflicting structured executable-effect evidence`, {
        path,
        evidence: Object.fromEntries(explicit),
      });
    }
    return explicit[0][1];
  }
  for (const key of ["effects", "structuredEffects", "executableEffects"]) {
    if (Object.hasOwn(row, key) && row[key] !== undefined) return row[key] !== null && row[key] !== false;
  }
  fail("catalog_incomplete", `${path} has no structured executable-effect evidence`, { path });
}

function normalizeCatalogRow(row, index) {
  if (!isRecord(row)) fail("catalog_incomplete", "catalog row must be an object", { index });
  const path = `catalogRows[${index}]`;
  const printingId = row.printingId ?? row.id;
  const gameplayId = row.gameplayId ?? row.canonicalId;
  requiredString(printingId, `${path}.printingId`, "catalog_incomplete");
  requiredString(gameplayId, `${path}.gameplayId`, "catalog_incomplete");
  const effectText = normalizeText(row.effectText ?? row.effect, `${path}.effectText`);
  const triggerText = normalizeText(row.triggerText ?? row.trigger, `${path}.triggerText`);
  const hasStructuredEffects = structuredEffectsEvidence(row, path);
  const executable = hasStructuredEffects || (effectText === null && triggerText === null);
  return {
    printingId,
    gameplayId,
    effectText,
    triggerText,
    hasStructuredEffects,
    executable,
  };
}

function evidenceKey(row) {
  return JSON.stringify({
    effectText: row.effectText,
    triggerText: row.triggerText,
    hasStructuredEffects: row.hasStructuredEffects,
    executable: row.executable,
  });
}

function normalizeCatalogRows(inputRows) {
  if (!Array.isArray(inputRows) || inputRows.length === 0) {
    fail("catalog_incomplete", "live catalog rows must be a non-empty array", {
      reason: "catalog_rows_missing",
    });
  }
  const rows = inputRows.map(normalizeCatalogRow);
  const printingIds = new Set();
  for (const row of rows) {
    if (printingIds.has(row.printingId)) {
      fail("catalog_incomplete", "catalog contains duplicate printing IDs", {
        reason: "duplicate_printing_id",
        printingId: row.printingId,
      });
    }
    printingIds.add(row.printingId);
  }

  const groups = new Map();
  for (const row of rows) {
    const group = groups.get(row.gameplayId) ?? [];
    group.push(row);
    groups.set(row.gameplayId, group);
  }
  const gameplayCoverage = [...groups.entries()].sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  )).map(([gameplayId, printings]) => {
    const expectedEvidence = evidenceKey(printings[0]);
    if (printings.some((row) => evidenceKey(row) !== expectedEvidence)) {
      fail("catalog_incomplete", "printings sharing a gameplay ID disagree on execution evidence", {
        reason: "conflicting_printing_evidence",
        gameplayId,
        printingIds: printings.map((row) => row.printingId).sort(),
      });
    }
    const representative = printings[0];
    return {
      gameplayId,
      printingIds: printings.map((row) => row.printingId).sort(),
      effectText: representative.effectText,
      triggerText: representative.triggerText,
      hasStructuredEffects: representative.hasStructuredEffects,
      structuredExecutableEffects: representative.hasStructuredEffects,
      executable: representative.executable,
    };
  });
  return {
    rows: [...rows].sort((left, right) => left.printingId < right.printingId ? -1 : left.printingId > right.printingId ? 1 : 0),
    gameplayCoverage,
  };
}

function limitationRows(definition, fallback) {
  if (definition === undefined || definition === null) {
    if (fallback === undefined) fail("capability_invalid", "reviewed limitations definition is required");
    definition = { schemaVersion: 1, definitionId: "inline-limitations", limitations: fallback };
  }
  if (Array.isArray(definition)) {
    definition = { schemaVersion: 1, definitionId: "inline-limitations", limitations: definition };
  }
  if (!isRecord(definition) || definition.schemaVersion !== 1) {
    fail("capability_invalid", "reviewed limitations definition has an unsupported schema", {
      reason: "limitations_schema",
    });
  }
  const definitionId = requiredString(definition.definitionId, "limitations.definitionId");
  const rows = definition.limitations ?? definition.blockers;
  if (!Array.isArray(rows)) fail("capability_invalid", "limitations must be an array");
  const seen = new Set();
  const normalized = rows.map((row, index) => {
    if (!isRecord(row)) fail("capability_invalid", "limitation row must be an object", { index });
    const code = requiredString(row.code, `limitations[${index}].code`);
    if (seen.has(code)) fail("capability_invalid", "limitation codes must be unique", { code });
    seen.add(code);
    const status = row.status;
    if (status !== "open" && status !== "closed") {
      fail("capability_invalid", "limitation status must be open or closed", { code, status });
    }
    requiredString(row.evidenceLocation, `limitations[${index}].evidenceLocation`);
    requiredString(row.affectedCapability, `limitations[${index}].affectedCapability`);
    if (typeof row.blocksOfficialStrength !== "boolean") {
      fail("capability_invalid", "limitation blocksOfficialStrength must be boolean", { code });
    }
    return {
      code,
      evidenceLocation: row.evidenceLocation,
      affectedCapability: row.affectedCapability,
      status,
      blocksOfficialStrength: row.blocksOfficialStrength,
    };
  });
  return {
    definitionId,
    definitionHash: sha256Canonical(definition),
    rows: normalized,
  };
}

function inputCatalogRows(input) {
  if (Array.isArray(input.catalogRows)) return input.catalogRows;
  if (Array.isArray(input.rows)) return input.rows;
  if (isRecord(input.catalog) && Array.isArray(input.catalog.rows)) return input.catalog.rows;
  return null;
}

function normalizeHashInput(input, names, path) {
  const value = names.map((name) => input[name]).find((candidate) => candidate !== undefined);
  return fullHash(value, path);
}

export function buildCapabilitySnapshot(input) {
  if (!isRecord(input)) fail("capability_invalid", "capability input must be an object");
  const environment = environmentFromInput(input);
  const asOf = localDate(input.asOf ?? input.environment?.asOf, "asOf");
  if (!isRecord(input.source)) fail("capability_invalid", "source must be an object", { path: "source" });
  const coverage = input.coverage ?? { status: "complete", warnings: [], missingFields: [] };
  if (!isRecord(coverage)) fail("capability_invalid", "coverage must be an object", { path: "coverage" });

  const catalogInputRows = inputCatalogRows(input);
  const catalogHash = normalizeHashInput(input, ["catalogContentHash", "catalogHash"], "catalogContentHash");
  const normalizedCatalog = normalizeCatalogRows(catalogInputRows);
  const expectedCatalogHash = sha256Canonical(catalogInputRows);
  if (catalogHash !== expectedCatalogHash) {
    fail("catalog_incomplete", "catalogContentHash does not match the supplied live catalog", {
      reason: "catalog_hash_mismatch",
      expectedCatalogHash,
      catalogContentHash: catalogHash,
    });
  }

  const limitations = limitationRows(input.limitations ?? input.reviewedLimitations, input.blockingLimitations);
  const patchDefinitionHash = normalizeHashInput(
    input,
    ["patchDefinitionHash", "localPatchDefinitionHash", "localPatchHash"],
    "patchDefinitionHash",
  );
  const policySourceHash = normalizeHashInput(input, ["policySourceHash", "policyHash"], "policySourceHash");
  const engineWorktreeHash = fullHash(input.engineWorktreeHash, "engineWorktreeHash");
  const engineRevision = requiredString(input.engineRevision, "engineRevision");
  const patchCheck = input.patchCheck;
  if (!isRecord(patchCheck) || patchCheck.status !== "passed") {
    fail("engine_patch_mismatch", "engine patch check did not pass", { reason: "patch_check_failed" });
  }

  return finalizeSnapshot(
    {
      schemaVersion: 1,
      kind: CAPABILITY_KIND,
      environment,
      asOf,
      source: input.source,
      coverage,
      data: {
        engineRevision,
        engineWorktreeHash,
        patchDefinitionHash,
        policySourceHash,
        catalogContentHash: catalogHash,
        catalogRowCount: normalizedCatalog.rows.length,
        gameplayIdCount: normalizedCatalog.gameplayCoverage.length,
        gameplayCoverage: normalizedCatalog.gameplayCoverage,
        blockingLimitations: limitations.rows,
        limitationDefinitionId: limitations.definitionId,
        limitationDefinitionHash: limitations.definitionHash,
        patchCheck: { ...patchCheck },
      },
    },
    input.idStem ?? `simulation-capability-${environment.edition.toLowerCase()}-${environment.formatId}`,
  );
}

function capabilityCoverage(snapshot) {
  try {
    verifySnapshot(snapshot);
  } catch (error) {
    throw error;
  }
  if (!isRecord(snapshot) || snapshot.kind !== CAPABILITY_KIND || !isRecord(snapshot.data)) {
    fail("capability_invalid", "snapshot is not a simulation capability snapshot");
  }
  const rows = snapshot.data.gameplayCoverage;
  if (!Array.isArray(rows)) fail("capability_invalid", "capability gameplay coverage is missing");
  const byId = new Map();
  for (const row of rows) {
    if (!isRecord(row) || typeof row.gameplayId !== "string" || typeof row.executable !== "boolean") {
      fail("capability_invalid", "capability gameplay coverage row is invalid");
    }
    if (byId.has(row.gameplayId)) fail("capability_invalid", "capability gameplay coverage is duplicated", { gameplayId: row.gameplayId });
    byId.set(row.gameplayId, row);
  }
  return byId;
}

function deckGameplayIds(deck, index) {
  if (!isRecord(deck)) {
    fail("simulation_not_ready", "deck snapshot is missing", { deckIndex: index, missing: [] });
  }
  const data = isRecord(deck.data) ? deck.data : deck;
  const ids = [];
  if (typeof data.leaderGameplayId === "string") ids.push(data.leaderGameplayId);
  if (isRecord(data.mainDeckCounts)) ids.push(...Object.keys(data.mainDeckCounts));
  if (Array.isArray(data.gameplayIds)) ids.push(...data.gameplayIds);
  if (ids.length === 0) {
    fail("simulation_not_ready", "deck snapshot has no gameplay IDs", { deckIndex: index, missing: [] });
  }
  return ids;
}

export function missingExecutableGameplayIds(snapshot, deckSnapshots) {
  const coverage = capabilityCoverage(snapshot);
  if (!Array.isArray(deckSnapshots)) {
    fail("simulation_not_ready", "deck snapshots must be an array", { missing: [] });
  }
  const ids = new Set();
  deckSnapshots.forEach((deck, index) => {
    for (const gameplayId of deckGameplayIds(deck, index)) {
      if (typeof gameplayId !== "string" || gameplayId.length === 0 || !coverage.get(gameplayId)?.executable) {
        ids.add(gameplayId || `<deck-${index}>`);
      }
    }
  });
  return [...ids].sort();
}

export function evaluateCapabilityGate(snapshot, deckSnapshots) {
  const missing = missingExecutableGameplayIds(snapshot, deckSnapshots);
  if (missing.length > 0) {
    fail("simulation_not_ready", "deck contains unsupported cards", { missing });
  }
  const blockers = snapshot.data.blockingLimitations.filter((row) => (
    row.status === "open" && row.blocksOfficialStrength === true
  ));
  return blockers.length === 0
    ? { mode: "official", officialReady: true, blockers: [] }
    : { mode: "diagnostic_estimate", officialReady: false, blockers };
}

export function verifyCapabilitySnapshot(snapshot) {
  capabilityCoverage(snapshot);
  return snapshot;
}

export { CAPABILITY_KIND };
