import { EnvironmentError } from "./errors.mjs";
import { finalizeSnapshot, snapshotRef, verifySnapshot } from "./snapshot.mjs";
import { assertNativeEnvironment } from "./rules.mjs";
import { eventQualifies } from "./time.mjs";
import { sha256Canonical } from "./hash.mjs";

const FULL_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const AGGREGATION_POLICY_ID = "participant-count-v1";
// v1 canonical archetype-id grammar (I8): "leader:<gameplayId>", e.g. "leader:OP16-001". A
// classified row whose archetype id does not match this shape was never actually resolved to a
// real card mapping, even though it may look like a non-empty string (e.g. a raw, unmapped
// provider label such as "合成红艾斯").
const CANONICAL_ARCHETYPE_ID_PATTERN = /^leader:[A-Za-z0-9][A-Za-z0-9_-]*$/;

function fail(code, message = code, details = {}) {
  const rendered = message.startsWith(`${code}:`) ? message : `${code}: ${message}`;
  throw new EnvironmentError(code, rendered, details);
}

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredString(value, path, code = "field_not_representative") {
  if (typeof value !== "string" || value.length === 0) fail(code, `${path} must be a non-empty string`, { path, value });
  return value;
}

function assertFullHash(value, path) {
  if (typeof value !== "string" || !FULL_HASH_PATTERN.test(value)) {
    fail("snapshot_hash_invalid", `${path} must be a full sha256 hash`, { path, value });
  }
  return value;
}

// I3: cross-checks alias candidates the same way participantCountOf/unresolvedCountOf already
// do - every alias that is actually present must agree, or the block is self-contradictory and
// fails closed rather than being resolved by silent precedence. Canonical hashing (never ad hoc
// JSON.stringify, per this module's own hashing rule) gives a structural, order-sensitive
// comparison so array/object aliases such as rows vs distributionRows are compared by content,
// not by reference.
function agreeingCandidates(candidates, label) {
  const present = candidates.filter((value) => value !== undefined && value !== null);
  if (present.length <= 1) return present[0];
  let canonicalForms;
  try {
    canonicalForms = present.map((value) => sha256Canonical(value));
  } catch (error) {
    fail("field_not_representative", `${label} aliases could not be compared`, {
      cause: error?.code ?? error?.message,
    });
  }
  if (new Set(canonicalForms).size !== 1) {
    fail("field_not_representative", `${label} aliases disagree`, { values: present });
  }
  return present[0];
}

function assertCanonicalArchetypeId(archetypeId, index) {
  if (!CANONICAL_ARCHETYPE_ID_PATTERN.test(archetypeId)) {
    fail("unresolved_mapping", "field row archetype id is not in canonical leader:<gameplayId> form", {
      index,
      archetypeId,
    });
  }
}

function eventData(event) {
  if (!isRecord(event?.data)) fail("field_not_representative", "event snapshot data is required");
  return event.data;
}

function eventKeyOf(event) {
  return requiredString(eventData(event).eventKey, "data.eventKey");
}

function eventEvidenceHashOf(event) {
  const data = eventData(event);
  const hash = data.eventEvidenceHash
    ?? data.evidenceBlocks?.field?.eventEvidenceHash
    ?? data.field?.eventEvidenceHash;
  return assertFullHash(hash, `data.eventEvidenceHash`);
}

function fieldBlockOf(event) {
  const data = eventData(event);
  const block = data.evidenceBlocks?.field ?? data.field;
  if (!isRecord(block)) {
    fail("field_not_representative", "event does not contain a typed field evidence block");
  }
  return block;
}

function participantCountOf(data, block) {
  const denominator = isRecord(block.denominator) ? block.denominator.value : block.denominator;
  const participantCount = isRecord(data.participantCount) ? data.participantCount.value : data.participantCount;
  const declaredParticipantCount = isRecord(data.declaredParticipantCount)
    ? data.declaredParticipantCount.value
    : data.declaredParticipantCount;
  const candidates = [
    denominator,
    participantCount,
    declaredParticipantCount,
  ];
  const values = candidates.filter((value) => value !== undefined && value !== null);
  if (values.length === 0) fail("field_not_representative", "field denominator is required");
  if (!values.every((value) => Number.isSafeInteger(value) && value > 0)) {
    fail("field_not_representative", "field denominator must be a positive integer", { values });
  }
  if (new Set(values).size !== 1) {
    fail("field_not_representative", "field denominators disagree", { values });
  }
  return values[0];
}

function rowsOf(block) {
  const rows = agreeingCandidates([block.rows, block.distributionRows], "field distribution rows");
  if (!Array.isArray(rows) || rows.length === 0) {
    fail("field_not_representative", "field distribution rows are required");
  }
  return rows;
}

function unresolvedCountOf(block) {
  const candidates = [
    block.unresolvedParticipants,
    block.unclassifiedParticipants,
    block.unresolvedCount,
  ].filter((value) => value !== undefined && value !== null);
  if (candidates.length === 0) return 0;
  if (!candidates.every((value) => Number.isSafeInteger(value) && value >= 0)) {
    fail("field_not_representative", "unclassified participant count must be a non-negative integer", { candidates });
  }
  if (new Set(candidates).size !== 1) {
    fail("field_not_representative", "unclassified participant counts disagree", { candidates });
  }
  return candidates[0];
}

function normalizeRows(block) {
  const result = [];
  const seen = new Set();
  for (const [index, row] of rowsOf(block).entries()) {
    if (!isRecord(row)) fail("field_not_representative", "field rows must be objects", { index });
    const archetypeId = agreeingCandidates(
      [row.archetypeId, row.canonicalArchetypeId, row.canonicalId],
      `field row [${index}] archetype id`,
    );
    if (typeof archetypeId !== "string" || archetypeId.length === 0) {
      fail("unresolved_mapping", "field row has no resolved canonical archetype", { index, row });
    }
    assertCanonicalArchetypeId(archetypeId, index);
    const players = agreeingCandidates(
      [row.players, row.count, row.playerCount],
      `field row [${index}] players`,
    );
    if (!Number.isSafeInteger(players) || players <= 0) {
      fail("field_not_representative", "field row players must be a positive integer", { index, players });
    }
    if (seen.has(archetypeId)) {
      fail("field_not_representative", "field contains duplicate canonical archetype rows", { archetypeId });
    }
    seen.add(archetypeId);
    result.push({ archetypeId, players });
  }
  return result;
}

function validateFieldEvidence(event) {
  // I1: absent/undeclared top-level coverage status must fail closed, exactly like the strict
  // block-level check below - not just an explicitly non-"complete" status.
  if (event.coverage?.status !== "complete") {
    fail("field_not_representative", "event snapshot coverage is incomplete", { eventKey: eventKeyOf(event) });
  }
  const data = eventData(event);
  const resultsBlock = data.evidenceBlocks?.results;
  // R1: every evidence block carries its own canonical coverage: { status, warnings,
  // missingFields } object - the same shape the field block's own block.coverage?.status check
  // below already reads, and the shape Task 7's normalizer emits. A flat resultsBlock.status
  // (no nested coverage object) reads as coverage being entirely absent and fails closed, the
  // same as any other absent/undeclared coverage in this module.
  if (!isRecord(resultsBlock) || resultsBlock.coverage?.status !== "complete") {
    fail("field_not_representative", "event results evidence must be complete", {
      eventKey: eventKeyOf(event),
      status: resultsBlock?.coverage?.status,
    });
  }
  const block = fieldBlockOf(event);
  if (block.sampleFrame !== "full-field") {
    fail("field_not_representative", "only full-field evidence can contribute to field shares", {
      eventKey: eventKeyOf(event),
      sampleFrame: block.sampleFrame,
    });
  }
  if (block.coverage?.status !== "complete") {
    fail("field_not_representative", "field evidence coverage is incomplete", {
      eventKey: eventKeyOf(event),
      status: block.coverage?.status,
    });
  }
  const denominator = participantCountOf(data, block);
  const rows = normalizeRows(block);
  const unresolvedParticipants = unresolvedCountOf(block);
  if (unresolvedParticipants > 0) {
    fail("unresolved_mapping", "field contains unresolved participant mappings", {
      eventKey: eventKeyOf(event),
      unresolvedParticipants,
    });
  }
  const classified = rows.reduce((sum, row) => sum + row.players, 0);
  if (classified + unresolvedParticipants !== denominator) {
    fail("field_not_representative", "field rows do not equal participant denominator", {
      eventKey: eventKeyOf(event),
      classified,
      unresolvedParticipants,
      denominator,
    });
  }
  return {
    denominator,
    rows,
    classified,
    unresolvedParticipants,
  };
}

function selectionPolicyOf(input) {
  // I4: the brief requires the input to include an explicit event-selection policy - it is
  // mandatory, not a convenience default. Neither the policy object nor its id may be silently
  // synthesized.
  const policy = input.selectionPolicy ?? input.eventSelection;
  if (!isRecord(policy)) {
    fail("duplicate_event", "an explicit event-selection policy object is required");
  }
  const id = policy.id ?? policy.policyId;
  requiredString(id, "selectionPolicy.id", "duplicate_event");
  const excluded = policy.excluded ?? policy.excludedEvents ?? input.excludedEvents ?? [];
  if (!Array.isArray(excluded)) fail("field_not_representative", "excluded events must be an array");
  const normalizedExcluded = excluded.map((entry, index) => {
    if (!isRecord(entry)) fail("field_not_representative", "excluded event records must be objects", { index });
    return {
      eventKey: requiredString(entry.eventKey, `excludedEvents[${index}].eventKey`),
      reason: requiredString(entry.reason, `excludedEvents[${index}].reason`),
      ...(entry.snapshotRef === undefined ? {} : { snapshotRef: entry.snapshotRef }),
    };
  });
  const selected = policy.selected ?? policy.selectedVersions ?? [];
  if (!Array.isArray(selected) && !isRecord(selected)) {
    fail("duplicate_event", "selected event versions must be an array or object");
  }
  return { id, excluded: normalizedExcluded, selected };
}

function explicitSelection(policy, eventKey) {
  if (Array.isArray(policy.selected)) return policy.selected.filter((entry) => entry?.eventKey === eventKey);
  if (isRecord(policy.selected) && Object.hasOwn(policy.selected, eventKey)) {
    const value = policy.selected[eventKey];
    return Array.isArray(value) ? value : [value];
  }
  return [];
}

function selectionMatches(entry, event, sourceRef, eventEvidenceHash) {
  if (!isRecord(entry)) return false;
  return (
    (entry.eventEvidenceHash === undefined || entry.eventEvidenceHash === eventEvidenceHash)
    && (entry.snapshotId === undefined || entry.snapshotId === sourceRef.snapshotId)
    && (entry.contentHash === undefined || entry.contentHash === sourceRef.contentHash)
    && (entry.snapshotRef === undefined || (
      entry.snapshotRef.snapshotId === sourceRef.snapshotId
      && entry.snapshotRef.contentHash === sourceRef.contentHash
    ))
  );
}

function verifySourceRefs(events, sourceRefs) {
  if (!Array.isArray(sourceRefs) || sourceRefs.length !== events.length) {
    fail("snapshot_ref_mismatch", "sourceRefs must be an ordered ref for every event snapshot", {
      events: events.length,
      sourceRefs: sourceRefs?.length,
    });
  }
  return sourceRefs.map((ref, index) => {
    const event = events[index];
    verifySnapshot(event);
    // C3: every input event snapshot must actually be tournament evidence. Without this, any
    // hash-valid snapshot of any kind carrying a field block (via the evidenceBlocks.field ??
    // field alias) could pass as tournament field evidence.
    if (event.kind !== "tournament_event") {
      fail("field_not_representative", "event snapshot kind must be tournament_event", {
        index,
        kind: event.kind,
      });
    }
    const expected = snapshotRef(event);
    if (!isRecord(ref)) fail("snapshot_ref_mismatch", "source ref must be an object", { index });
    assertFullHash(ref.contentHash, `sourceRefs[${index}].contentHash`);
    if (ref.snapshotId !== expected.snapshotId || ref.contentHash !== expected.contentHash) {
      fail("snapshot_ref_mismatch", "source ref does not identify its event snapshot", {
        index,
        expected,
        actual: ref,
      });
    }
    return { snapshotId: ref.snapshotId, contentHash: ref.contentHash };
  });
}

function assertIdentityMatch(event, identity) {
  for (const key of ["edition", "metagameRegion", "language", "formatId", "timeZone"]) {
    if (event.environment?.[key] !== identity[key]) {
      fail("environment_identity_mismatch", `event environment differs from field identity at ${key}`, {
        key,
        expected: identity[key],
        actual: event.environment?.[key],
      });
    }
  }
}

function chooseEvents(events, sourceRefs, policy) {
  const entries = events.map((event, index) => ({
    event,
    index,
    eventKey: eventKeyOf(event),
    eventEvidenceHash: eventEvidenceHashOf(event),
    sourceRef: sourceRefs[index],
  }));
  const byEventKey = new Map();
  for (const entry of entries) {
    const list = byEventKey.get(entry.eventKey) ?? [];
    list.push(entry);
    byEventKey.set(entry.eventKey, list);
  }
  // C1: an event key the policy declares excluded must never also be selected, even when only
  // one version of it was supplied. Supplying evidence for a key while also excluding it is a
  // contradiction in the input and fails closed rather than the exclusion being silently
  // ignored.
  const excludedEventKeys = new Set(policy.excluded.map((entry) => entry.eventKey));
  const excluded = [...policy.excluded];
  const selected = [];
  for (const [eventKey, versions] of byEventKey) {
    if (excludedEventKeys.has(eventKey)) {
      fail("duplicate_event", "event key is both supplied as evidence and excluded by the selection policy", {
        eventKey,
      });
    }
    const choices = explicitSelection(policy, eventKey);
    if (versions.length === 1) {
      // I4: explicitSelection must be validated even when only one version of a key exists - a
      // selection that names a version other than the one actually supplied is a contradiction,
      // not something to silently ignore because there was "nothing to choose between".
      if (choices.length > 0) {
        if (choices.length !== 1) {
          fail("duplicate_event", "explicit selection for a single-version event key must name exactly one selection", {
            eventKey,
          });
        }
        const matches = versions.filter((entry) => selectionMatches(
          choices[0], entry.event, entry.sourceRef, entry.eventEvidenceHash,
        ));
        if (matches.length !== 1) {
          fail("duplicate_event", "explicit event version selection does not match the supplied event", {
            eventKey,
            selection: choices[0],
          });
        }
      }
      selected.push(versions[0]);
      continue;
    }
    if (choices.length !== 1) {
      fail("duplicate_event", "one event key has multiple evidence versions without explicit selection", {
        eventKey,
        versions: versions.map(({ sourceRef, eventEvidenceHash }) => ({ sourceRef, eventEvidenceHash })),
      });
    }
    const chosen = versions.filter((entry) => selectionMatches(
      choices[0], entry.event, entry.sourceRef, entry.eventEvidenceHash,
    ));
    if (chosen.length !== 1) {
      fail("duplicate_event", "explicit event version selection is ambiguous or unmatched", {
        eventKey,
        selection: choices[0],
      });
    }
    selected.push(chosen[0]);
    for (const version of versions) {
      if (version !== chosen[0]) {
        excluded.push({
          eventKey,
          reason: "not_selected_version",
          snapshotRef: version.sourceRef,
          eventEvidenceHash: version.eventEvidenceHash,
        });
      }
    }
  }
  selected.sort((left, right) => left.index - right.index);
  return { selected, excluded };
}

// I5: time and window defects are only meaningful to buildFieldSnapshot as "this cannot become
// field evidence". The standalone time.mjs utilities keep their own time_invalid code for
// direct misuse (per the controller ruling), but through this path they are remapped to
// field_not_representative. Identity/timezone mismatches are a distinct failure mode and are
// left to propagate unchanged.
function mapTimeErrors(fn) {
  try {
    return fn();
  } catch (error) {
    if (error instanceof EnvironmentError && error.code === "time_invalid") {
      fail("field_not_representative", "event time evidence is invalid for field aggregation", {
        cause: error.code,
        causeMessage: error.message,
        ...error.details,
      });
    }
    throw error;
  }
}

export function buildFieldSnapshot({ events, identity, window, sourceRefs, selectionPolicy, eventSelection, excludedEvents } = {}) {
  if (!Array.isArray(events) || events.length === 0) fail("field_not_representative", "events must be a non-empty ordered array");
  if (!isRecord(identity)) fail("environment_identity_mismatch", "field identity must be an object");
  const nativeIdentity = assertNativeEnvironment({ ...identity });
  if (!isRecord(window)) fail("field_not_representative", "field window must be an object");
  if (window.timeZone !== nativeIdentity.timeZone) {
    fail("environment_identity_mismatch", "field window timezone differs from identity", {
      identityTimeZone: nativeIdentity.timeZone,
      windowTimeZone: window.timeZone,
    });
  }
  const sourceRefsVerified = verifySourceRefs(events, sourceRefs);
  const policy = selectionPolicyOf({ selectionPolicy: selectionPolicy ?? eventSelection, excludedEvents });
  const { selected, excluded } = chooseEvents(events, sourceRefsVerified, policy);

  const archetypePlayers = new Map();
  const selectedEvents = [];
  let totalParticipants = 0;
  let classifiedParticipants = 0;
  let unclassifiedParticipants = 0;
  for (const entry of selected) {
    const event = entry.event;
    assertIdentityMatch(event, nativeIdentity);
    // I1: an event cannot contribute evidence dated after the field window's own reporting
    // cutoff.
    if (event.asOf > window.asOf) {
      fail("field_not_representative", "event asOf is later than the field window asOf", {
        eventKey: entry.eventKey,
        eventAsOf: event.asOf,
        windowAsOf: window.asOf,
      });
    }
    if (!mapTimeErrors(() => eventQualifies(event, window))) {
      fail("field_not_representative", "event is outside the selected completed-event window", {
        eventKey: entry.eventKey,
      });
    }
    const evidence = validateFieldEvidence(event);
    totalParticipants += evidence.denominator;
    classifiedParticipants += evidence.classified;
    unclassifiedParticipants += evidence.unresolvedParticipants;
    for (const row of evidence.rows) {
      archetypePlayers.set(
        row.archetypeId,
        (archetypePlayers.get(row.archetypeId) ?? 0) + row.players,
      );
    }
    selectedEvents.push({
      eventKey: entry.eventKey,
      eventEvidenceHash: entry.eventEvidenceHash,
      snapshotRef: entry.sourceRef,
      participants: evidence.denominator,
    });
  }

  // I6: no aggregate-level "coveredParticipants === totalParticipants" guard here. Every
  // selected event already passed validateFieldEvidence's per-event rows-vs-denominator check
  // above, and unresolvedParticipants is provably 0 there too (the standalone
  // unresolved_mapping check above throws first whenever it would be positive) - so
  // classifiedParticipants === totalParticipants is an arithmetic identity by the time this sum
  // runs. A copy of that check here was unreachable from any external input (mutation-verified:
  // neutering it turns zero tests red) and was deleted rather than kept as a vacuous guard. See
  // task-5-report.md, "Fix round 1", for the full mutation-check transcript.
  const coveredParticipants = classifiedParticipants + unclassifiedParticipants;
  const archetypes = [...archetypePlayers.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([archetypeId, players]) => ({
      archetypeId,
      players,
      share: players / totalParticipants,
    }));
  const shareSum = archetypes.reduce((sum, row) => sum + row.share, 0);
  if (Math.abs(shareSum - 1) > 1e-12) {
    fail("field_not_representative", "field shares do not sum to one", { shareSum });
  }

  const normalizedExcluded = excluded.map((entry) => ({
    eventKey: entry.eventKey,
    reason: entry.reason,
    ...(entry.snapshotRef === undefined ? {} : { snapshotRef: entry.snapshotRef }),
    ...(entry.eventEvidenceHash === undefined ? {} : { eventEvidenceHash: entry.eventEvidenceHash }),
  }));
  return finalizeSnapshot(
    {
      schemaVersion: 1,
      kind: "field",
      environment: nativeIdentity,
      asOf: window.asOf,
      source: {
        provider: "opcg-go",
        surface: "field-aggregation",
        sourceRef: {
          policyId: policy.id,
          eventRefs: selectedEvents.map((entry) => entry.snapshotRef),
          eventEvidenceRefs: selectedEvents.map(({ eventKey, eventEvidenceHash }) => ({ eventKey, eventEvidenceHash })),
        },
      },
      coverage: {
        status: "complete",
        warnings: [],
        missingFields: [],
      },
      data: {
        aggregationPolicyId: AGGREGATION_POLICY_ID,
        selectionPolicyId: policy.id,
        window: {
          startLocalDate: window.startLocalDate,
          asOf: window.asOf,
          timeZone: window.timeZone,
        },
        selectedEvents,
        excludedEvents: normalizedExcluded,
        totalParticipants,
        classifiedParticipants,
        unclassifiedParticipants,
        coveredParticipants,
        archetypes,
        coverage: {
          status: "complete",
          totalParticipants,
          classifiedParticipants,
          unclassifiedParticipants,
          coveredParticipants,
        },
      },
    },
    `field-${nativeIdentity.edition.toLowerCase()}-${window.startLocalDate}-${window.asOf}`,
  );
}

export { AGGREGATION_POLICY_ID };
