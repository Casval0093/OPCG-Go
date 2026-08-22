// The public environment-domain surface.
//
// Task 6 creates this barrel for Tasks 1-6 ONLY. Task 11 later extends it with
// its matchup, simulation, and report modules; nothing here anticipates them.
// Consumers import from this module rather than reaching into private files.

export { EnvironmentError } from "./errors.mjs";

// Task 1 -- canonical JSON and cross-process hashing.
export { canonicalJson } from "./canonical.mjs";
export { hashProjection, sha256Canonical } from "./hash.mjs";

// Task 2 -- common snapshot envelope and the immutable artifact store.
export { finalizeSnapshot, snapshotRef, verifySnapshot } from "./snapshot.mjs";
export {
  SNAPSHOT_ARTIFACT_CONTRACT,
  publishImmutableArtifact,
  publishMutableRecord,
  readVerifiedArtifact,
  realIo,
  recoverStaleTemps,
} from "./store.mjs";

// Task 3 -- decks, rules, and legality.
export { buildDeckSnapshot, gameplayHashForDeck } from "./deck.mjs";
export {
  NATIVE_ENVIRONMENTS,
  assertNativeEnvironment,
  buildBanlistSnapshot,
  buildCardPoolSnapshot,
  buildConstructionSnapshot,
  buildRulesSnapshot,
  dateInInterval,
  dateOnly,
} from "./rules.mjs";
export { validateDeckLegality } from "./legality.mjs";

// Task 4 -- capability and clock gates.
export {
  CAPABILITY_KIND,
  buildCapabilitySnapshot,
  evaluateCapabilityGate,
  missingExecutableGameplayIds,
  verifyCapabilitySnapshot,
} from "./capability.mjs";
export {
  CLOCK_KIND,
  buildClockSnapshot,
  evaluateClockGate,
  verifyClockSnapshot,
} from "./clock.mjs";

// Task 5 -- precision-aware time and full-field aggregation.
export { assertEventTime, assertTimeZone, eventQualifies, freshnessAgeDays, localDayEnd } from "./time.mjs";
export { AGGREGATION_POLICY_ID, buildFieldSnapshot } from "./field.mjs";

// Task 6 -- Manifest identity, alias grammar, and the fail-closed resolver.
export {
  ALIAS_CHANNEL,
  ALIAS_REGISTRY,
  DERIVED_ARTIFACT_DIRECTORIES,
  parseEnvironmentSelector,
} from "./alias.mjs";
export {
  MANIFEST_ARTIFACT_CONTRACT,
  MANIFEST_KINDS,
  MANIFEST_SCHEMA_VERSION,
  MINIMUM_GAMES_PER_SEAT_FLOOR,
  buildManifest,
  environmentKey,
  manifestRef,
  publishManifest,
  verifyManifest,
} from "./manifest.mjs";
export { RESOLVER_ERROR_CODES, RESOLVER_STAGES, resolveEnvironment, resolverErrorJson } from "./resolver.mjs";

// Task 11 -- matchup evidence, simulation orchestration, and weighted reporting.
//
// Flat named exports, matching the rest of this barrel's style (controller ruling, fix round 1). The
// Task 6 scope fence in environment/resolver.test.mjs has been converted from a negative list to a
// positive one in the same change; that conversion is the fence's own documented lifecycle ("Task 11
// extends this barrel later"), not a weakened assertion.
//
// Each name appears EXACTLY ONCE and from its owning module. The four shared numeric/identity
// primitives (WEIGHT_TOLERANCE, assertExactCoverage, createXorshift32, clockAuthorizationFor) are
// owned by matchup.mjs; report.mjs no longer re-exports them, so one binding no longer sits on two
// module faces.
//
// Task 10's job/result contract (sim/environment-contract.mjs) is deliberately NOT re-exported:
// environment/simulation.mjs IMPORTS it, and re-exporting would make environment/ depend on sim/
// depend on environment/ -- a directory cycle the Task 10 review ruled against. Import it from
// sim/environment-contract.mjs directly.
export {
  MATCHUP_ERROR_CODES,
  MATCHUP_KIND,
  SEATS,
  WEIGHT_TOLERANCE,
  assertExactCoverage,
  assertRoundTimeoutAuthorized,
  buildSimulatedMatchupSnapshot,
  clockAuthorizationFor,
  createXorshift32,
  pairingKeyFor,
  parseEnvironmentKey,
  validateObservedMatchupSnapshot,
  validateScoreableMatchupCell,
} from "./matchup.mjs";
export {
  MINIMUM_COMPLETED_GAMES_PER_SEAT,
  SIMULATION_ERROR_CODES,
  SIMULATION_PLAN_KIND,
  applyRoundTimeoutAdjudication,
  countJobResult,
  createSimulateShRunner,
  executeSimulationPlan,
  expandSimulationPlan,
  jobCacheDirectoryFor,
  jobResultPathFor,
  materializeJobFile,
  seedScheduleFor,
  validateJobResult,
} from "./simulation.mjs";
export {
  BOOTSTRAP_REPLICATES,
  BOOTSTRAP_SEED,
  COMPARISON_KIND,
  CONFIDENCE_EXCLUSIONS,
  ENVIRONMENT_COMPARISON_KIND,
  REPORT_ERROR_CODES,
  REPORT_KIND,
  aggregateEnvironment,
  compareEnvironments,
  compareVariants,
  weightedSeatEv,
  wilsonInterval,
} from "./report.mjs";
