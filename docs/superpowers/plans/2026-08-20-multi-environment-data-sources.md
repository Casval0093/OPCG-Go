# Multi-environment data sources implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add immutable SC and EN environment data contracts, normalize JiHuanShe SC observations, and evaluate one candidate or tech-slot variant independently against each validated environment without opening Android during simulation.

**Architecture:** A root `environment/` package owns canonical JSON, hashes, immutable artifacts, legality, field construction, Manifests, resolution, simulation planning, and reports. JiHuanShe remains an acquisition adapter under `tools/`; the simulator remains environment-agnostic and receives concrete fixed-seat jobs. Source refresh publishes only source snapshots, while a separate validated Manifest build may advance an Environment alias.

**Tech Stack:** Node.js 22 ESM and `node:test`; TypeScript only for code executed inside the vendored One Piece engine; Python 3 `unittest`, NumPy, and SciPy for the preserved legacy EV command; Android ADB/emulator only in the acquisition path; immutable JSON files with SHA-256, Unicode NFC, and RFC 8785 JCS semantics.

**Spec:** `docs/superpowers/specs/2026-08-20-multi-environment-data-sources-design.md`

## Global constraints

- Valid native v1 identities are exactly `SC/CN/zh-Hans` and `EN/GLOBAL_EN/en`; JP and mixed EN/JP inputs are not native v1 environments.
- Official SC fails closed. EN evidence may enter SC only through an explicitly named proxy Manifest such as `SC_WITH_EN_PRIOR`.
- `market` snapshots are metadata only and must never enter legality, matchup, EV, confidence, or deck-strength calculations.
- Normal simulation reads local immutable artifacts and must not inspect JiHuanShe state, start ADB, or launch an emulator.
- Source refresh never updates `data/environment-aliases/`; only a fully validated Manifest publication may atomically advance an alias.
- Tournament field shares require `sampleFrame: "full-field"`, explicit denominators, complete counts, and no duplicate `eventKey`; Top Cut and submitted-only samples never become field shares.
- `asOf` is an inclusive local calendar day in the Manifest IANA timezone. Date-only source values retain day precision and never acquire an invented UTC timestamp.
- Hashes use NFC followed by RFC 8785 JCS. Snapshot and Manifest references always carry both immutable ID and full `sha256:` hash; a 16-hex ID-prefix collision fails rather than overwrites.
- A DeckSnapshot has separate `gameplayHash` and artifact `contentHash`; jobs compare gameplay identity while artifact references verify full provenance.
- Environment simulation requires separate play and draw jobs with at least 200 valid completed games per seat unless the Manifest sets a higher floor.
- A computational turn or command limit is never a tournament timeout. Only an accepted ClockModel may produce `round_timeout`; engine abandonment and budget exhaustion are unfinished/tool failures.
- Known counter/block, attack-target, first-turn legality, policy, or clock-model limitations keep official tournament strength closed and permit only `diagnostic_estimate` output.
- The legacy matrix remains `EN_LEGACY_UNVERIFIED`, keeps its uncovered share, and cannot enter native or proxy Manifests.
- Raw JiHuanShe bytes remain in memory unless retention is explicitly requested. A retained raw directory is mode `0700`, files are `0600`, and tracked artifacts exclude handles, reversible handle hashes, credentials, SMS data, cookies, tokens, and entire raw standings rows.
- No GUI, database, scheduler, background service, private JiHuanShe API replay, signing reproduction, or SMS automation is added in v1.
- Tests use synthetic sanitized fixtures and temporary directories. Live capture is a separately reported manual smoke test and never runs in CI.
- Add no new runtime package for the environment layer: Node owns the canonical encoder and Python calls its fixed bridge instead of implementing a second JCS stack.
- Existing dirty-worktree files are owner-owned. Do not overwrite, stage, reformat, or absorb unrelated changes. The pre-plan tracked diff SHA-256 is `2d30cc93262b43c8fd2e94fdeb76a069ae953b5728c85b6a2585914148d2b8cc` at HEAD `47e1089abd63c4a37904c76a547d625e02c54614`.
- Every commit checkpoint below requires explicit owner authorization at execution time. Without it, stop after the GREEN verification and present the unstaged diff.

---

## File structure

### Environment domain

| File | Responsibility |
|---|---|
| `environment/errors.mjs` | Stable error codes and typed error details. |
| `environment/canonical.mjs` | NFC normalization and RFC 8785-compatible canonical UTF-8 bytes. |
| `environment/hash.mjs` | SHA-256, content/gameplay/event projections, hash-prefix IDs. |
| `environment/hash_cli.mjs` | Fixed-argument stdin/stdout bridge so Python uses the same canonical encoder. |
| `environment/snapshot.mjs` | Common snapshot envelope validation and finalization. |
| `environment/store.mjs` | Verified reads, collision-safe immutable publication, stale-temp recovery. |
| `environment/deck.mjs` | DeckSnapshot construction, gameplay hash, and current deck import. |
| `environment/rules.mjs` | RulesSnapshot authority, version, effective interval, and rules identity. |
| `environment/legality.mjs` | Card-pool, rules identity, banlist, and construction validation. |
| `environment/capability.mjs` | Engine/catalog/patch/policy capability snapshot and readiness gate. |
| `environment/clock.mjs` | Tournament clock model validation and fail-closed gate. |
| `environment/time.mjs` | Precision-aware local-day comparison and freshness calculations. |
| `environment/field.mjs` | Full-field event aggregation with duplicate/conflict rejection. |
| `environment/manifest.mjs` | Manifest identity, official/proxy rules, reference validation. |
| `environment/alias.mjs` | Atomic mutable alias records that point only to validated Manifests. |
| `environment/resolver.mjs` | Alias/direct resolution, legality/evidence/capability/clock checks. |
| `environment/matchup.mjs` | Observed/simulated matchup snapshot and scoreable-cell contracts. |
| `environment/simulation.mjs` | Concrete plan/job expansion and result validation. |
| `environment/report.mjs` | Exact EV, Wilson intervals, stratified/paired resampling, comparison. |
| `environment/index.mjs` | Public environment-domain exports only. |

### Source adapters and commands

| File | Responsibility |
|---|---|
| `tools/jihuanshe_normalize.mjs` | Pure raw-buffer to tournament/market snapshot normalization. |
| `tools/jihuanshe_lifecycle.mjs` | AVD-drive lock, process tokens, leases, ownership-aware cleanup, visible reauth. |
| `tools/jihuanshe_capture.mjs` | Existing UI navigation plus event enumeration, stable selection, CaptureResult v2. |
| `tools/jihuanshe_refresh.mjs` | Outer refresh lock, capture child, normalization, source publication, RefreshResult. |
| `tools/export_simulation_capability.mjs` | Reproducible engine/catalog/patch/policy fingerprints. |
| `tools/environment_data.mjs` | Build deck, field, rules, card-pool, capability, clock, and Manifest artifacts. |
| `tools/environment_evaluate.mjs` | Resolve, execute, aggregate, compare, and print environment reports. |
| `tools/environment_hash.py` | Python wrapper around the single Node canonical encoder. |

### Simulator adapters

| File | Responsibility |
|---|---|
| `sim/batch-runner.ts` | The only engine execution implementation; accepts concrete decks/seeds/seats. |
| `sim/environment-contract.mjs` | Strict job/raw-result validation and termination taxonomy. |
| `sim/environment-job.sim.test.ts` | Vendored-engine adapter for one environment job. |
| `sim/matchup.sim.test.ts` | Legacy direct A/B adapter over `batch-runner.ts`. |
| `scripts/simulate.sh` | Strict mutually exclusive legacy/job/harness modes. |

### Persisted data and fixtures

| Path | Content |
|---|---|
| `data/sources/sc/jihuanshe/tournaments/<snapshotId>.json` | Immutable normalized SC tournament-event source snapshots. |
| `data/sources/sc/jihuanshe/market/<snapshotId>.json` | Immutable normalized SC market source snapshots. |
| `data/sources/en/<provider>/<snapshotId>.json` | Immutable EN source snapshots, only when a provider contract is complete. |
| `data/derived/<kind>/<snapshotId>.json` | Immutable deck, field, rules, card-pool, banlist, construction, capability, clock, and matchup snapshots. |
| `data/environments/<manifestId>.json` | Immutable validated Manifests. |
| `data/environment-aliases/SC/latest.json` | Mutable SC convenience pointer. |
| `data/environment-aliases/EN/latest.json` | Mutable EN convenience pointer. |
| `data/mappings/jihuanshe/v1.json` | Only manually verified raw-label mappings; initially empty is valid. |
| `data/environment-definitions/simulation-limitations-v1.json` | Reviewed known engine/policy blockers. |
| `data/hash-vectors/environment-v1.json` | Cross-process canonical/hash golden vectors. |
| `tests/fixtures/environment/` | Synthetic Manifests, plans, results, clock cases, and fake runner. |
| `tests/fixtures/jihuanshe/` | Synthetic CaptureResult v2 inputs and expected canonical snapshots. |

The three implementation seams are kept in one ordered plan because JiHuanShe publication and simulation both depend on the same artifact and Manifest contracts. Tasks 1-6, 7-9, and 10-12 are independent reviewer gates inside that dependency chain.

---

### Task 1: Canonical JSON and cross-process hashing

**Files:**
- Create: `environment/canonical.mjs`
- Create: `environment/hash.mjs`
- Create: `environment/hash_cli.mjs`
- Create: `environment/canonical.test.mjs`
- Create: `data/hash-vectors/environment-v1.json`
- Create: `tools/environment_hash.py`
- Create: `tools/test_environment_hash.py`

**Interfaces:**
- Consumes: JSON-domain values only; `undefined`, functions, symbols, cycles, non-finite numbers, and NFC-colliding object keys are rejected.
- Produces: `canonicalJson(value): Buffer`, `sha256Canonical(value): string`, `hashProjection(value, omittedTopLevelKeys): string`, and Python `canonical_hash(value) -> str`.

- [ ] **Step 1: Add trusted golden vectors and failing Node tests**

Create `data/hash-vectors/environment-v1.json` with exact expected bytes and hashes:

```json
{
  "schemaVersion": 1,
  "vectors": [
    {
      "name": "nfc-key-order-number-normalization",
      "input": { "n": -0.0, "b": 1.0, "a": "é" },
      "canonical": "{\"a\":\"é\",\"b\":1,\"n\":0}",
      "sha256": "sha256:04b14788ee65877178c1b47da25f6a080f4d3460fce9051dbacfe223a44cf7aa"
    },
    {
      "name": "null-is-present",
      "input": { "a": null },
      "canonical": "{\"a\":null}",
      "sha256": "sha256:d091f9c83c091f79652fe8786375b3fe4ce0861a56f5bfbafedbe431877ff0e8"
    },
    {
      "name": "absent-is-not-null",
      "input": {},
      "canonical": "{}",
      "sha256": "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"
    },
    {
      "name": "exponent-boundaries",
      "input": { "small": 0.000001, "large": 1e30 },
      "canonical": "{\"large\":1e+30,\"small\":0.000001}",
      "sha256": "sha256:d9434398ef9d12d23301153f20e7d3269cef7b31835173764f5a4aeee74c0f8f"
    }
  ]
}
```

Create `environment/canonical.test.mjs` with assertions that read every vector and also reject non-finite numbers, `undefined`, cycles, and the key pair `"é"`/`"é"` after NFC normalization:

```js
test("canonical vectors match exact UTF-8 bytes and SHA-256", () => {
  for (const vector of vectors) {
    assert.equal(canonicalJson(vector.input).toString("utf8"), vector.canonical);
    assert.equal(sha256Canonical(vector.input), vector.sha256);
  }
});

test("invalid JSON-domain values and NFC key collisions fail closed", () => {
  assert.throws(() => canonicalJson({ n: Number.NaN }), /canonical_non_finite_number/);
  assert.throws(() => canonicalJson({ missing: undefined }), /canonical_unsupported_value/);
  assert.throws(() => canonicalJson({ "é": 1, "é": 2 }), /canonical_key_collision/);
  const cycle = {};
  cycle.self = cycle;
  assert.throws(() => canonicalJson(cycle), /canonical_cycle/);
});
```

- [ ] **Step 2: Run the Node test and verify RED**

Run:

```bash
node --test environment/canonical.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `environment/canonical.mjs`.

- [ ] **Step 3: Implement the single canonical encoder and hash projection**

Implement a recursive pre-walk that NFC-normalizes strings and keys, sorts keys by JavaScript UTF-16 code units, converts negative zero to zero, preserves array order, and rejects values outside the JSON domain. Serialize the pre-walked value with `JSON.stringify`, which supplies the ECMAScript number/string serialization required by JCS:

```js
export function canonicalJson(value) {
  return Buffer.from(JSON.stringify(normalize(value, new Set())), "utf8");
}

export function sha256Canonical(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function hashProjection(value, omittedTopLevelKeys) {
  const omitted = new Set(omittedTopLevelKeys);
  return sha256Canonical(Object.fromEntries(
    Object.entries(value).filter(([key]) => !omitted.has(key)),
  ));
}
```

`normalize()` must throw errors containing the four stable codes asserted above and must detect cycles by object identity on the active recursion stack.

- [ ] **Step 4: Add the fixed Python bridge and cross-process test**

`environment/hash_cli.mjs` reads at most 16 MiB from stdin, parses one JSON value, and prints exactly one object such as `{ "sha256": "sha256:04b14788ee65877178c1b47da25f6a080f4d3460fce9051dbacfe223a44cf7aa" }`. `tools/environment_hash.py` invokes it with a fixed argument array and no shell:

```python
def canonical_hash(value: object) -> str:
    payload = json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf8")
    completed = subprocess.run(
        ["node", str(REPO_ROOT / "environment" / "hash_cli.mjs")],
        input=payload,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
    )
    return json.loads(completed.stdout)["sha256"]
```

`tools/test_environment_hash.py` loads the shared vectors and asserts every Python caller receives the same expected hash. It also asserts `float("nan")` is rejected before spawning Node.

- [ ] **Step 5: Run Node and Python hashing tests and verify GREEN**

Run:

```bash
node --test environment/canonical.test.mjs
python3 -m unittest tools.test_environment_hash -v
```

Expected: both commands PASS; four vectors are checked by both processes.

- [ ] **Step 6: Create the checkpoint commit only after owner authorization**

After explicit authorization:

```bash
git add environment/canonical.mjs environment/hash.mjs environment/hash_cli.mjs environment/canonical.test.mjs data/hash-vectors/environment-v1.json tools/environment_hash.py tools/test_environment_hash.py
git commit -m "feat: add canonical environment hashing"
```

---

### Task 2: Immutable snapshot finalization and atomic storage

**Files:**
- Create: `environment/errors.mjs`
- Create: `environment/snapshot.mjs`
- Create: `environment/store.mjs`
- Create: `environment/snapshot.test.mjs`
- Create: `environment/store.test.mjs`

**Interfaces:**
- Consumes: a snapshot draft without `snapshotId` or `contentHash`, plus an explicit stable ID stem.
- Produces: `EnvironmentError`, `finalizeSnapshot(draft, idStem)`, `verifySnapshot(snapshot)`, `snapshotRef(snapshot)`, `readVerifiedArtifact(path)`, `publishImmutableArtifact(path, artifact)`, `publishMutableRecord(path, record)`, and `recoverStaleTemps(directory, now)`.

- [ ] **Step 1: Write failing envelope, collision, and crash-recovery tests**

`environment/snapshot.test.mjs` must assert:

```js
const snapshot = finalizeSnapshot(draft, "jihuanshe-tournament-2026-08-20");
assert.match(snapshot.snapshotId, /^jihuanshe-tournament-2026-08-20-[0-9a-f]{16}$/);
assert.equal(snapshot.contentHash, hashProjection(snapshot, ["snapshotId", "contentHash"]));
assert.deepEqual(snapshotRef(snapshot), {
  snapshotId: snapshot.snapshotId,
  contentHash: snapshot.contentHash,
});
assert.throws(() => verifySnapshot({ ...snapshot, asOf: "2026-08-19" }), /snapshot_hash_mismatch/);
```

`environment/store.test.mjs` uses `mkdtempSync()` and asserts: identical publication is idempotent; an existing target with another full hash returns `snapshot_id_collision`; an injected failure before rename leaves the target absent; recovery deletes only stale files matching `.<basename>.<pid>.<token>.tmp`; immutable publication never writes under `data/environment-aliases/` unless `publishMutableRecord()` is called explicitly.

- [ ] **Step 2: Run the two tests and verify RED**

Run:

```bash
node --test environment/snapshot.test.mjs environment/store.test.mjs
```

Expected: FAIL with missing `environment/snapshot.mjs` and `environment/store.mjs`.

- [ ] **Step 3: Implement stable errors and snapshot finalization**

Use a stable error object instead of parsing prose:

```js
export class EnvironmentError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "EnvironmentError";
    this.code = code;
    this.details = details;
  }
}

export function finalizeSnapshot(draft, idStem) {
  assertSnapshotDraft(draft);
  const contentHash = hashProjection(draft, []);
  return Object.freeze({
    ...structuredClone(draft),
    snapshotId: `${sanitizeIdStem(idStem)}-${contentHash.slice(7, 23)}`,
    contentHash,
  });
}
```

`verifySnapshot()` recomputes the hash excluding only the top-level `snapshotId` and `contentHash`, verifies the 16-hex suffix, and rejects an unknown `schemaVersion`, missing identity fields, malformed RFC 3339 timestamps, malformed local dates, or non-`sha256:` hashes.

- [ ] **Step 4: Implement collision-safe same-directory publication**

`publishImmutableArtifact()` performs this exact order: create same-directory temp with `wx` and mode `0600`; write canonical pretty JSON plus newline; `fsync` the file; close; if target exists, verify and return only when full hash matches; otherwise rename temp to target; `fsync` the containing directory. On any error it closes the descriptor and removes only its own temp file.

```js
export function publishImmutableArtifact(target, artifact, io = realIo) {
  const temp = join(dirname(target), `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  io.mkdir(dirname(target), { recursive: true, mode: 0o755 });
  const fd = io.open(temp, "wx", 0o600);
  try {
    io.write(fd, `${JSON.stringify(artifact, null, 2)}\n`);
    io.fsync(fd);
  } finally {
    io.close(fd);
  }
  return finishImmutablePublish({ io, temp, target, artifact });
}
```

`publishMutableRecord()` uses the same fsync/rename sequence but intentionally replaces an alias file after the caller has validated its target Manifest. `recoverStaleTemps()` accepts an injected clock and PID-liveness function and refuses unfamiliar filenames.

- [ ] **Step 5: Run snapshot and storage tests and verify GREEN**

Run:

```bash
node --test environment/snapshot.test.mjs environment/store.test.mjs
```

Expected: PASS, including injected write/fsync/rename failures and collision refusal.

- [ ] **Step 6: Create the checkpoint commit only after owner authorization**

After explicit authorization:

```bash
git add environment/errors.mjs environment/snapshot.mjs environment/store.mjs environment/snapshot.test.mjs environment/store.test.mjs
git commit -m "feat: add immutable environment artifact storage"
```

---

### Task 3: Deck, card-pool, banlist, and construction contracts

**Files:**
- Create: `environment/deck.mjs`
- Create: `environment/rules.mjs`
- Create: `environment/legality.mjs`
- Create: `environment/deck.test.mjs`
- Create: `environment/rules.test.mjs`
- Create: `environment/legality.test.mjs`
- Create: `tests/fixtures/environment/deck-ace-op16.json`
- Create: `tests/fixtures/environment/card-pool-sc-op16.json`
- Create: `tests/fixtures/environment/banlist-sc-op16.json`
- Create: `tests/fixtures/environment/construction-standard.json`

**Interfaces:**
- Consumes: current `{ name, leader, main[] }` deck files and explicit edition-specific card/rules inputs.
- Produces: `buildDeckSnapshot(input, context)`, `gameplayHashForDeck(leaderGameplayId, mainDeckCounts)`, `buildRulesSnapshot(input)`, `buildCardPoolSnapshot(input)`, `buildBanlistSnapshot(input)`, `buildConstructionSnapshot(input)`, and `validateDeckLegality(deps)`.

- [ ] **Step 1: Write failing dual-hash and legality tests**

Add assertions that metadata changes alter only artifact `contentHash`, while card-count changes alter both hashes:

```js
const first = buildDeckSnapshot(aceInput, context);
const renamed = buildDeckSnapshot({ ...aceInput, name: "Ace display rename" }, context);
assert.equal(first.data.gameplayHash, renamed.data.gameplayHash);
assert.notEqual(first.contentHash, renamed.contentHash);

const changed = structuredClone(aceInput);
changed.main[0] = "OP16-020";
assert.notEqual(
  first.data.gameplayHash,
  buildDeckSnapshot(changed, context).data.gameplayHash,
);
```

Rules tests require authority, document/version refs, edition, format, effective interval, source hashes, and one deterministic aggregate rules identity. Legality tests must cover exactly 50 main-deck cards, one leader, copy limits, restricted/banned cards, effective intervals, edition mismatch, absent gameplay IDs, rules-identity mismatch, alternate-art/language normalization only after proven identity, and an SC-exclusive/changed card with unknown identity. Construction/ban failures use `code: "illegal_deck"` with a precise `details.reason`; pool and identity failures use `card_pool_unverified` or `card_rules_identity_mismatch`.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
node --test environment/deck.test.mjs environment/rules.test.mjs environment/legality.test.mjs
```

Expected: FAIL with missing `environment/deck.mjs`.

- [ ] **Step 3: Implement DeckSnapshot normalization and gameplay identity**

Convert `main[]` to a lexicographically sorted count map and hash exactly the gameplay projection:

```js
export function gameplayHashForDeck(leaderGameplayId, mainDeckCounts) {
  return sha256Canonical({
    schemaVersion: 1,
    leaderGameplayId,
    mainDeckCounts: Object.fromEntries(
      Object.entries(mainDeckCounts).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0),
    ),
  });
}

export function buildDeckSnapshot(input, context) {
  const counts = countCards(input.main);
  const gameplayHash = gameplayHashForDeck(input.leader, counts);
  return finalizeSnapshot({
    schemaVersion: 1,
    kind: "deck",
    environment: { scope: "edition-neutral" },
    asOf: context.asOf,
    source: context.source,
    coverage: { status: "complete", warnings: [], missingFields: [] },
    data: {
      leaderGameplayId: input.leader,
      mainDeckCounts: counts,
      mainDeckSize: input.main.length,
      gameplayHash,
      displayName: input.name,
      notes: input.notes ?? input.note ?? null,
    },
  }, `deck-${input.leader}`);
}
```

`environment/snapshot.mjs` accepts `{ scope: "edition-neutral" }` only for `kind: "deck"`; every source, rules, field, market, capability, clock, matchup, and Manifest artifact still requires the native edition/metagame/language identity. The same DeckSnapshot is therefore resolvable against SC and EN without claiming legality in either.

- [ ] **Step 4: Implement edition-specific legality snapshots and validation**

Rules data contains edition, format, authority, document/version refs with source hashes, effective interval, and aggregate `rulesIdentityHash`. Card-pool rows contain `{ gameplayId, rulesIdentityHash, releasedAt, legalFrom, legalUntil, releaseEvidenceRef }`. Banlist rows contain `{ gameplayId, status: "banned" | "restricted", maxCopies, effectiveFrom, effectiveUntil, authorityRef }`. Construction data pins main size `50`, leader count `1`, default max copies `4`, allowed leader colors, and format ID.

`validateDeckLegality()` first validates the environment identity and effective dates, then the leader, main size, pool membership, rules identity, banlist, copy limits, and construction constraints. It returns `{ legal: true }` only when all checks pass; it throws the first stable `EnvironmentError` otherwise.

- [ ] **Step 5: Run the tests and verify GREEN**

Run:

```bash
node --test environment/deck.test.mjs environment/rules.test.mjs environment/legality.test.mjs
```

Expected: PASS with the current Ace fixture legal in SC OP16 and the deliberately changed/unknown fixtures rejected.

- [ ] **Step 6: Create the checkpoint commit only after owner authorization**

After explicit authorization:

```bash
git add environment/deck.mjs environment/rules.mjs environment/legality.mjs environment/deck.test.mjs environment/rules.test.mjs environment/legality.test.mjs tests/fixtures/environment/deck-ace-op16.json tests/fixtures/environment/card-pool-sc-op16.json tests/fixtures/environment/banlist-sc-op16.json tests/fixtures/environment/construction-standard.json
git commit -m "feat: add deck and environment legality contracts"
```

---

### Task 4: Simulation-capability and tournament-clock gates

**Files:**
- Create: `environment/capability.mjs`
- Create: `environment/clock.mjs`
- Create: `environment/capability.test.mjs`
- Create: `environment/clock.test.mjs`
- Create: `tools/export_simulation_capability.mjs`
- Create: `tools/export_simulation_capability.test.mjs`
- Create: `data/environment-definitions/simulation-limitations-v1.json`
- Modify: `sim/catalog.dump.test.ts`

**Interfaces:**
- Consumes: live engine revision, engine worktree hash, local patch-definition hash, policy-source hash, full catalog rows, and a reviewed limitations definition.
- Produces: `buildCapabilitySnapshot(input)`, `evaluateCapabilityGate(snapshot, decks)`, `buildClockSnapshot(input)`, `evaluateClockGate(snapshot, environment)`, and CLI `node tools/export_simulation_capability.mjs --out PATH`.

- [ ] **Step 1: Add failing capability and clock tests**

Capability tests inject a complete catalog and the reviewed blocker file, then assert:

```js
const capability = buildCapabilitySnapshot(input);
assert.equal(capability.data.engineRevision, "engine-commit-fixture");
assert.equal(capability.data.catalogContentHash, input.catalogContentHash);
assert.deepEqual(capability.data.blockingLimitations.map((row) => row.code), [
  "second_player_first_turn_attack",
  "counter_and_block_policy_missing",
  "attack_target_policy_missing",
]);
assert.deepEqual(
  evaluateCapabilityGate(capability, [encodedDeck]),
  { mode: "diagnostic_estimate", officialReady: false, blockers: capability.data.blockingLimitations },
);
assert.throws(
  () => evaluateCapabilityGate(capability, [deckWithUnencodedCard]),
  /simulation_not_ready/,
);
```

Clock tests assert that `null`, draft, wrong edition/format, wrong stage, stale calibration, and rejected calibration all yield `clock_model_unavailable`. A non-null snapshot must pin input features, exact simulation events, calibration dataset IDs/hashes/population/dates, elapsed-time labels, algorithm version, parameters, classification threshold, deterministic inference procedure, held-out metrics, acceptance policy, and effective interval. Only an `accepted` model whose edition, format, Swiss stage, 30-minute duration, effective interval, and rules reference match may authorize `round_timeout`.

- [ ] **Step 2: Run capability and clock tests and verify RED**

Run:

```bash
node --test environment/capability.test.mjs environment/clock.test.mjs tools/export_simulation_capability.test.mjs
```

Expected: FAIL with missing capability modules and exporter.

- [ ] **Step 3: Implement capability and clock snapshot gates**

Use explicit gate results rather than a boolean:

```js
export function evaluateCapabilityGate(snapshot, deckSnapshots) {
  verifySnapshot(snapshot);
  const missing = missingExecutableGameplayIds(snapshot, deckSnapshots);
  if (missing.length > 0) {
    throw new EnvironmentError("simulation_not_ready", "Deck contains unsupported cards", { missing });
  }
  const blockers = snapshot.data.blockingLimitations.filter((row) => row.status === "open");
  return blockers.length === 0
    ? { mode: "official", officialReady: true, blockers: [] }
    : { mode: "diagnostic_estimate", officialReady: false, blockers };
}

export function evaluateClockGate(snapshot, identity) {
  if (!snapshot || snapshot.data.acceptance !== "accepted") {
    throw new EnvironmentError("clock_model_unavailable", "No accepted tournament clock model");
  }
  assertClockApplicability(snapshot, identity);
  return { roundTimeoutPolicy: snapshot.data.roundTimeoutPolicy };
}
```

`simulation-limitations-v1.json` records each current blocker with evidence location, affected capability, `status: "open"`, and `blocksOfficialStrength: true`. Closing a blocker requires a reviewed file change and therefore a new capability hash.

- [ ] **Step 4: Implement the reproducible live capability exporter**

Extend the catalog dump with printed effect/trigger fields and executable-effect presence. `tools/export_simulation_capability.mjs` uses fixed `spawnSync()` argument arrays to collect:

- `git -C vendor/tcg-engines rev-parse HEAD` as `engineRevision`;
- a sorted manifest of every cached, modified, and untracked non-ignored gameplay source under the vendored engine, hashed by relative path and bytes as `engineWorktreeHash`; this includes grafted card files that plain `git diff HEAD` omits;
- hashes of `tools/patch_engine.py`, `tools/graft_cards.py`, `data/card-corrections.json`, tracked `cards/OP15/` and `cards/OP16/` source manifests, the relevant engine bot-strategy sources, and the generated catalog;
- `tools/patch_engine.py --check` success;
- the reviewed limitation definition.

The exporter rejects a missing vendor tree, failed patch check, incomplete catalog, or unreadable policy source. Its tests inject a fake command runner and assert the production code never enables a shell.

- [ ] **Step 5: Run unit tests and verify GREEN, then run the live exporter smoke check**

Run:

```bash
node --test environment/capability.test.mjs environment/clock.test.mjs tools/export_simulation_capability.test.mjs
node tools/export_simulation_capability.mjs --out /private/tmp/opcg-capability-snapshot.json
```

Expected: tests PASS. The live command either publishes one verified capability snapshot to the explicit temporary path or fails with a stable `vendor_missing`, `engine_patch_mismatch`, or `catalog_incomplete` code; it must never emit a ready snapshot from partial inputs.

- [ ] **Step 6: Create the checkpoint commit only after owner authorization**

After explicit authorization:

```bash
git add environment/capability.mjs environment/clock.mjs environment/capability.test.mjs environment/clock.test.mjs tools/export_simulation_capability.mjs tools/export_simulation_capability.test.mjs data/environment-definitions/simulation-limitations-v1.json sim/catalog.dump.test.ts
git commit -m "feat: add capability and clock readiness gates"
```

---

### Task 5: Precision-aware full-field snapshot builder

**Files:**
- Create: `environment/time.mjs`
- Create: `environment/field.mjs`
- Create: `environment/time.test.mjs`
- Create: `environment/field.test.mjs`
- Create: `tests/fixtures/environment/tournament-event-full-field-a.json`
- Create: `tests/fixtures/environment/tournament-event-full-field-b.json`
- Create: `tests/fixtures/environment/tournament-event-top-cut.json`

**Interfaces:**
- Consumes: an explicit ordered list of verified tournament snapshot refs and an injected `now`.
- Produces: `localDayEnd(asOf, timeZone)`, `eventQualifies(event, window)`, `freshnessAgeDays(value, now)`, and `buildFieldSnapshot({ events, identity, window, sourceRefs })`.

- [ ] **Step 1: Write failing time-boundary and field-coverage tests**

Time tests cover a date-only Shanghai event, a timestamped event with an original offset, the inclusive `asOf` day boundary, the day before/after the window, and a fixed injected clock. They assert no date-only fixture contains a synthetic `T00:00:00Z` value.

Field tests aggregate two events by participant count:

```js
const field = buildFieldSnapshot({
  events: [eventA, eventB],
  identity: scIdentity,
  window: { startLocalDate: "2026-07-22", asOf: "2026-08-20" },
  sourceRefs: [snapshotRef(eventA), snapshotRef(eventB)],
});
assert.equal(field.data.totalParticipants, 12);
assert.deepEqual(field.data.archetypes, [
  { archetypeId: "leader:OP16-001", players: 5, share: 5 / 12 },
  { archetypeId: "leader:OP16-080", players: 7, share: 7 / 12 },
]);
assert.equal(field.data.coveredParticipants, 12);
```

Separate cases must reject Top Cut, `sampleFrame: "unknown"`, counts not equal to the denominator, unresolved mappings, duplicate `eventKey`, two evidence versions for one event without explicit selection, an event after `asOf`, and SC/EN identity mismatch.

- [ ] **Step 2: Run field tests and verify RED**

Run:

```bash
node --test environment/time.test.mjs environment/field.test.mjs
```

Expected: FAIL with missing `environment/time.mjs` and `environment/field.mjs`.

- [ ] **Step 3: Implement local-day comparison without invented instants**

Represent day precision as data and compare local dates lexicographically only after validating the Manifest timezone and event timezone relationship. Timestamp precision uses its real offset and UTC instant. `eventQualifies()` requires a completed event, an end not later than the inclusive local `asOf` boundary, and overlap with the selected window.

```js
export function eventQualifies(event, window) {
  if (event.status !== "completed") return false;
  if (event.time.precision === "day") {
    return event.time.localDate >= window.startLocalDate
      && event.time.localDate <= window.asOf;
  }
  return timestampOverlapsLocalWindow(event.time, window);
}
```

- [ ] **Step 4: Implement exact participant-count aggregation**

`buildFieldSnapshot()` verifies every source snapshot/hash, validates identity and event selection, and sums integer players. Its input includes an explicit event-selection policy plus `{ eventKey, reason }` records for every excluded candidate event. It requires `coveredParticipants === totalParticipants`, then stores exact counts plus derived shares. It checks that the derived shares sum to one within `1e-12` but never divides by a partial total and never repairs missing coverage.

The FieldSnapshot records each selected `{ eventKey, eventEvidenceHash, snapshotRef, participants }`, every excluded event/reason, inclusive window bounds/timezone, the policy ID `participant-count-v1`, the exact classified/unclassified totals, and coverage status.

- [ ] **Step 5: Run field tests and verify GREEN**

Run:

```bash
node --test environment/time.test.mjs environment/field.test.mjs
```

Expected: PASS; every partial, duplicate, top-cut, cross-region, and out-of-window fixture fails with its asserted stable code.

- [ ] **Step 6: Create the checkpoint commit only after owner authorization**

After explicit authorization:

```bash
git add environment/time.mjs environment/field.mjs environment/time.test.mjs environment/field.test.mjs tests/fixtures/environment/tournament-event-full-field-a.json tests/fixtures/environment/tournament-event-full-field-b.json tests/fixtures/environment/tournament-event-top-cut.json
git commit -m "feat: build complete environment field snapshots"
```

---

### Task 6: Manifest, alias, and fail-closed environment resolver

**Files:**
- Create: `environment/manifest.mjs`
- Create: `environment/alias.mjs`
- Create: `environment/resolver.mjs`
- Create: `environment/index.mjs`
- Create: `environment/manifest.test.mjs`
- Create: `environment/resolver.test.mjs`
- Create: `tools/environment_data.mjs`
- Create: `tools/environment_data.test.mjs`
- Create: `tests/fixtures/environment/manifest-sc-official.json`
- Create: `tests/fixtures/environment/manifest-sc-with-en-prior.json`

**Interfaces:**
- Consumes: verified snapshot refs, a candidate DeckSnapshot ref, alias or immutable `manifestId`, injected clock, and explicit diagnostic permission.
- Produces: `environmentKey(identity)`, `buildManifest(draft, repository)`, `publishManifest({ root, manifest, alias })`, `resolveEnvironment(input, repository)`, and data CLI subcommands `build-deck`, `build-field`, `build-manifest`, and `resolve`.

`resolveEnvironment()` returns this concrete boundary for later simulation tasks:

```js
{
  schemaVersion: 1,
  requestedEnvironment: "SC/latest",
  environmentKey: "SC:CN:zh-Hans:Asia/Shanghai:standard-block2-op16:2026-08-20",
  manifestRef: { manifestId, contentHash },
  candidateDeckRef: { snapshotId, contentHash },
  candidateGameplayHash: "sha256:04b14788ee65877178c1b47da25f6a080f4d3460fce9051dbacfe223a44cf7aa",
  evaluationMode: "official" | "diagnostic_estimate" | "proxy",
  strata: [{
    archetypeId: "leader:OP16-001",
    fieldWeight: 0.25,
    representatives: [{ deckRef, gameplayHash, withinArchetypeWeight: 1 }]
  }],
  turnOrderWeights: { play: 0.5, draw: 0.5 },
  minimumCompletedGamesPerSeat: 200,
  matchupEvidence: { method: "simulated" | "observed", applicability: "native" | "proxy", refs: [] },
  capabilityRef,
  clockRef,
  marketRefs: []
}
```

- [ ] **Step 1: Write failing Manifest identity, alias, and resolver tests**

Tests must assert:

- `environmentKey` includes edition, metagame region, language, canonical timezone, format, and `asOf`;
- two Manifest revisions for the same logical key receive different hash-derived `manifestId` values;
- every reference is `{ snapshotId, contentHash }` and is reverified;
- direct resolution accepts only alias or immutable `manifestId`, never `environmentKey` alone;
- `SC/latest` cannot point to an EN Manifest;
- official SC rejects an EN matchup prior, while `SC_WITH_EN_PRIOR` requires `kind: "proxy"` and a named cross-edition prior;
- legacy evidence cannot enter official or proxy Manifests;
- simulation mode rejects a sample floor below 200 valid completed games per seat, while observed mode requires scoreable immutable matchup refs and emits no simulation jobs;
- stale `latest` fails while an explicit valid historical Manifest still resolves;
- default `latest` freshness is field 30 days and market 7 days, with market staleness nonblocking for strength;
- market failure/staleness does not block strength and market refs never enter `strata`;
- illegal candidate, incomplete field, bad representative weights, missing observed cell counts, capability blockers, and missing clock produce their precise failure or diagnostic mode.

- [ ] **Step 2: Run Manifest and resolver tests and verify RED**

Run:

```bash
node --test environment/manifest.test.mjs environment/resolver.test.mjs tools/environment_data.test.mjs
```

Expected: FAIL with missing Manifest and resolver modules.

- [ ] **Step 3: Implement immutable Manifest identity and validated alias publication**

Manifest content hashing excludes only `manifestId` and `contentHash`; the logical `environmentKey` remains inside the hashed payload. Derive the immutable ID only after hashing:

```js
export function buildManifest(draft, repository) {
  validateManifestIdentity(draft);
  validateAllReferences(draft, repository);
  validateOfficialOrProxyPolicy(draft);
  const contentHash = hashProjection(draft, []);
  return Object.freeze({
    ...structuredClone(draft),
    manifestId: `${draft.environmentKey}-${contentHash.slice(7, 23)}`,
    contentHash,
  });
}
```

`publishManifest()` publishes the immutable Manifest first. Only after reading it back and validating the full hash may it atomically write `{ schemaVersion: 1, alias, manifestId, manifestHash, updatedAt }`. A crash between those steps leaves a valid unaliased Manifest and is idempotently recoverable.

- [ ] **Step 4: Implement resolver validation in one fixed order**

Resolve in this order so failures remain deterministic: selector and alias; Manifest hash; native identity combination; `asOf` and freshness; rules/card-pool/banlist/construction refs; candidate and representative DeckSnapshots; field completeness; observed/proxy evidence contract; capability gate; clock gate; exact strata and turn-order weights.

The resolver may return `diagnostic_estimate` when `allowDiagnostic: true` and capability or clock is not accepted. It returns no scoreable plan when diagnostics are false. In observed mode it validates exact candidate/opponent artifact and gameplay hashes, play/draw counts, wins/losses/scored timeouts, population/window provenance, and round/timeout policy, then emits no jobs. It never mutates or publishes any artifact.

Resolver failures serialize as `{ status: "error", code, stage, path, details }` with safe details. The stable code set includes `environment_not_found`, `snapshot_hash_mismatch`, `snapshot_id_collision`, `environment_identity_mismatch`, `stale_latest`, `field_not_representative`, `duplicate_event`, `unresolved_mapping`, `illegal_deck`, `card_pool_unverified`, `card_rules_identity_mismatch`, `simulation_not_ready`, `simulation_result_mismatch`, `missing_representative_deck`, `insufficient_matchup_coverage`, and `clock_model_unavailable`.

- [ ] **Step 5: Add the data CLI and verify GREEN**

The CLI prints exactly one sanitized JSON result with stable code and exit `0` on success or `1` on failure. It receives explicit file paths and a `--now` value in tests; production defaults `--now` only at the command boundary.

Run:

```bash
node --test environment/manifest.test.mjs environment/resolver.test.mjs tools/environment_data.test.mjs
```

Expected: PASS, including Manifest/alias crash recovery, SC/EN isolation, explicit proxy acceptance, and no-clock diagnostic behavior.

- [ ] **Step 6: Create the checkpoint commit only after owner authorization**

After explicit authorization:

```bash
git add environment/manifest.mjs environment/alias.mjs environment/resolver.mjs environment/index.mjs environment/manifest.test.mjs environment/resolver.test.mjs tools/environment_data.mjs tools/environment_data.test.mjs tests/fixtures/environment/manifest-sc-official.json tests/fixtures/environment/manifest-sc-with-en-prior.json
git commit -m "feat: resolve immutable regional environments"
```

---

### Task 7: Pure JiHuanShe tournament and market normalization

**Files:**
- Create: `tools/jihuanshe_normalize.mjs`
- Create: `tools/jihuanshe_normalize.test.mjs`
- Create: `data/mappings/jihuanshe/v1.json`
- Create: `tests/fixtures/jihuanshe/mappings-fixture-v1.json`
- Create: `tests/fixtures/jihuanshe/capture/tournament-full-field-v2.json`
- Create: `tests/fixtures/jihuanshe/capture/tournament-top-cut-v2.json`
- Create: `tests/fixtures/jihuanshe/capture/tournament-ambiguous-v2.json`
- Create: `tests/fixtures/jihuanshe/capture/market-visible-viewport-v2.json`
- Create: `tests/fixtures/jihuanshe/expected/tournament-full-field.snapshot-v1.json`
- Create: `tests/fixtures/jihuanshe/expected/market-visible-viewport.snapshot-v1.json`

**Interfaces:**
- Consumes: exact raw CaptureResult bytes plus explicit mapping, format, edition identity, parser version, and timezone.
- Produces: `normalizeJiHuanSheCapture(rawBytes, context): Snapshot[]`, `normalizeTournamentCapture(envelope, context)`, `normalizeMarketCapture(envelope, context)`, and `buildTournamentEvidenceProjection(snapshot)`.

- [ ] **Step 1: Add byte-stable sanitized fixtures and failing normalizer tests**

The tournament fixture uses only synthetic participant tokens and this typed CaptureResult v2 shape:

```json
{
  "schemaVersion": 2,
  "source": "JiHuanShe Android visible UI",
  "status": "ok",
  "surface": "tournament",
  "capturedAt": "2026-08-20T12:00:00Z",
  "sourceRef": {
    "providerEventId": "fixture-event-001",
    "sanitizedRoute": "app:tournament-detail"
  },
  "data": {
    "identity": {
      "title": "合成赛事一",
      "game": "航海王简中",
      "status": "已结束",
      "startLabel": "2026-08-18",
      "participantCountLabel": "4人",
      "formatLabel": "标准赛"
    },
    "results": {
      "activeTab": "赛果",
      "rows": [
        { "providerRowId": "r1", "rank": 1, "record": "3-0-0", "score": 9, "joinToken": "synthetic-entrant-1", "rawArchetypeLabel": "合成红艾斯" },
        { "providerRowId": "r2", "rank": 2, "record": "2-1-0", "score": 6, "joinToken": "synthetic-entrant-2", "rawArchetypeLabel": "合成黑黄蒂奇" },
        { "providerRowId": "r3", "rank": 3, "record": "1-2-0", "score": 3, "joinToken": "synthetic-entrant-3", "rawArchetypeLabel": "合成红艾斯" },
        { "providerRowId": "r4", "rank": 4, "record": "0-3-0", "score": 0, "joinToken": "synthetic-entrant-4", "rawArchetypeLabel": "合成黑黄蒂奇" }
      ]
    },
    "decks": {
      "activeTab": "卡组",
      "distributionRows": [
        { "rawArchetypeLabel": "合成红艾斯", "count": 2, "percentageLabel": "50%" },
        { "rawArchetypeLabel": "合成黑黄蒂奇", "count": 2, "percentageLabel": "50%" }
      ],
      "entrantRows": [
        { "providerRowId": "d1", "joinToken": "synthetic-entrant-1", "rawArchetypeLabel": "合成红艾斯" },
        { "providerRowId": "d2", "joinToken": "synthetic-entrant-2", "rawArchetypeLabel": "合成黑黄蒂奇" },
        { "providerRowId": "d3", "joinToken": "synthetic-entrant-3", "rawArchetypeLabel": "合成红艾斯" },
        { "providerRowId": "d4", "joinToken": "synthetic-entrant-4", "rawArchetypeLabel": "合成黑黄蒂奇" }
      ],
      "sampleFrameLabel": "全部参赛卡组"
    }
  },
  "lifecycle": { "launchMode": "headless", "startedByInvocation": true }
}
```

`mappings-fixture-v1.json` maps exactly `合成红艾斯 -> { archetypeId: "leader:OP16-001", leaderGameplayId: "OP16-001" }` and `合成黑黄蒂奇 -> { archetypeId: "leader:OP16-080", leaderGameplayId: "OP16-080" }`. Production `data/mappings/jihuanshe/v1.json` starts with `{ "schemaVersion": 1, "mappingVersion": "jihuanshe-mapping-v1", "entries": {} }`; real labels are added only after human verification.

Tests assert the exact expected snapshot bytes, `captureHash` over the original file bytes, day precision, separate `results`/`field` blocks, full-field proof, event evidence hash, unknown-label coverage, Top Cut refusal, ambiguous event identity, percentage rounding, market `visible-viewport` scope, and absence of `synthetic-entrant-1` from canonical output.

- [ ] **Step 2: Run the normalizer test and verify RED**

Run:

```bash
node --test tools/jihuanshe_normalize.test.mjs
```

Expected: FAIL with missing `tools/jihuanshe_normalize.mjs`.

- [ ] **Step 3: Implement raw-byte parsing, typed evidence, and privacy projection**

Calculate `captureHash` before JSON parsing:

```js
export function normalizeJiHuanSheCapture(rawBytes, context) {
  if (!Buffer.isBuffer(rawBytes)) {
    throw new EnvironmentError("capture_bytes_required", "Normalizer requires the exact raw Buffer");
  }
  const captureHash = `sha256:${createHash("sha256").update(rawBytes).digest("hex")}`;
  const envelope = parseCaptureResult(rawBytes);
  if (envelope.surface === "tournament-batch") {
    return envelope.data.events.map((event) => normalizeTournamentCapture(
      { ...envelope, surface: "tournament", data: event },
      { ...context, captureHash },
    ));
  }
  if (envelope.surface === "tournament") {
    return [normalizeTournamentCapture(envelope, { ...context, captureHash })];
  }
  return [normalizeMarketCapture(envelope, { ...context, captureHash })];
}
```

The batch wrapper and equivalent one-event envelope must normalize to the same tournament snapshot identity and evidence hash; only their acquisition `contentHash` may differ when the raw envelope provenance differs.

Use `joinToken` only inside the transformation to prove a one-to-one entrant join. Canonical rows replace it with deterministic event-local ordinals; they never store the token, its hash, a participant name, or the entire raw row. Preserve only typed `rawArchetypeLabel`, `rawDeckLabel`, `rawCardLabel`, and market labels allowed by the spec.

- [ ] **Step 4: Implement full-field proof and exact event evidence hashing**

Default `sampleFrame` to `unknown`. Promote to `full-field` only after all six approved checks pass. Convert displayed percentages to integer scaled units based on their printed decimal precision and compare against `count / denominator` within half a displayed unit.

Build `eventEvidenceHash` from the exact spec projection: identity fields; stable sanitized source identity; complete normalized `data`; coverage/warnings/missing fields; parser/mapping versions; provider `observedAt` or the stable capture-fallback marker. Sort results by rank/provider row ID, field rows by canonical ID/raw label, and unordered warnings lexicographically. Exclude the acquisition-only fields listed in the spec.

Repeated acquisition time with the same evidence must produce the same evidence hash and a different ordinary content hash. A changed count, mapping version, warning, or provider-stated observation time must change the evidence hash.

`normalizeMarketCapture()` stores canonical base gameplay ID only when mapping proves it, plus printing ID, language, condition, grade, currency `CNY`, observed/previous price, typed raw card/provider labels, provider observation time or capture fallback, visible query/filter/sort labels, visible row count, `scope: "visible-viewport"`, and `paginationComplete: false`. Alternate printings never become new gameplay IDs, and an unmapped printing remains canonical-null rather than guessed.

- [ ] **Step 5: Run the normalizer test and verify GREEN**

Run:

```bash
node --test tools/jihuanshe_normalize.test.mjs
```

Expected: PASS for valid tournament and market fixtures; Top Cut, unknown frame, ambiguous identity, mapping gaps, privacy sentinels, and UI drift remain non-publishing failures.

- [ ] **Step 6: Create the checkpoint commit only after owner authorization**

After explicit authorization:

```bash
git add tools/jihuanshe_normalize.mjs tools/jihuanshe_normalize.test.mjs data/mappings/jihuanshe/v1.json tests/fixtures/jihuanshe
git commit -m "feat: normalize JiHuanShe source captures"
```

---

### Task 8: Exact-process AVD lifecycle and stable tournament selection

**Files:**
- Create: `tools/jihuanshe_lifecycle.mjs`
- Create: `tools/jihuanshe_lifecycle.test.mjs`
- Modify: `tools/jihuanshe_capture.mjs`
- Modify: `tools/jihuanshe_capture.test.mjs`
- Test unchanged: `tools/jihuanshe_reader.test.mjs`

**Interfaces:**
- Consumes: fixed AVD `JiHuanShe_SC`, fixed serial `emulator-5554`, injected process/ADB runners in tests, and a stable event selection key.
- Produces: `withAvdDriveLock(options, callback)`, `inspectOwnedAvd(options)`, `startOwnedAvd(options)`, `cleanupOwnedLease(lease, options)`, `recoverAbandonedCapture(metadata, options)`, `reauthOwnedAvd(options)`, `enumerateCompletedTournaments(items)`, `selectionKeyForTournament(item)`, `selectTournamentByKey(items, key)`, and `captureJiHuanShe(options)`.

- [ ] **Step 1: Write failing lifecycle lease and ownership tests**

Lock metadata has this exact shape and is written atomically before UI navigation:

```json
{
  "schemaVersion": 1,
  "kind": "avd-drive",
  "owner": { "pid": 4242, "processStartToken": "fixture-owner-start" },
  "createdAt": "2026-08-20T12:00:00Z",
  "lease": {
    "avd": "JiHuanShe_SC",
    "serial": "emulator-5554",
    "pid": 5252,
    "processStartToken": "fixture-emulator-start",
    "launchMode": "headless",
    "startedByInvocation": true
  }
}
```

Tests cover PID reuse, token mismatch, foreign AVD, ambiguous host processes, active owner, stale owner with verified lease, stale owner with unverifiable lease, `SIGINT`/`SIGTERM`, and all five states: offline, headless-existing, headless-started, visible-existing, visible-started. They assert that only `startedByInvocation: true` is cleaned during capture and cleanup completes before the AVD lock release event.

- [ ] **Step 2: Write failing event enumeration and CaptureResult v2 tests**

Tests must prove:

- completed events are enumerated rather than reduced to the newest one;
- `providerEventId` from the visible navigator route is preferred;
- fallback key uses provider, title, start label, organizer, and location fields that are actually present;
- two visible events with the same fallback identity fail `event_identity_ambiguous`;
- `--event-key` selects exactly one event and verifies that identity again on the detail page;
- `--cleanup-started` cleans only an invocation-started AVD while still holding the lock;
- stdout is exactly one CaptureResult JSON object on success and every failure;
- exit codes are `0`, `2` for `reauth_required`, and `1` otherwise.

- [ ] **Step 3: Run lifecycle and capture tests and verify RED**

Run:

```bash
node --test tools/jihuanshe_lifecycle.test.mjs tools/jihuanshe_capture.test.mjs
```

Expected: lifecycle module missing and new CaptureResult/event-selection assertions failing.

- [ ] **Step 4: Extract lock/lease ownership from the capture adapter**

Use `/bin/ps` through a fixed argument array to obtain `{ pid, lstart, command }`; the exact token is a SHA-256 of the PID plus full start-time string. Match a host emulator only when its token, `-avd JiHuanShe_SC`, `-port 5554`, and ADB-reported AVD name all agree. Recheck the token immediately before signaling.

`recoverAbandonedCapture()` may clean a lease only after the lock owner is dead, the caller has atomically acquired `avd-drive`, and the process token still matches. A mismatch fails `lease_recovery_refused` and leaves the process untouched.

- [ ] **Step 5: Add typed event enumeration and capture-by-key**

Extend the DOM extraction to retain only `providerEventId` or sanitized route identity, title, start label, status, organizer/location labels when visible, and safe hit rectangle. Add scroll-to-load enumeration until the set of stable keys is unchanged across two reads and the page reports no additional visible items; enforce a configurable hard item ceiling as a failure, not a partial success.

Keep `collect tournaments` as a backwards-compatible newest-event diagnostic and add `list tournaments` plus `collect tournament --event-key KEY` for operator inspection. The refresh path uses one `collect tournament-batch --as-of DATE --window-days DAYS --cleanup-started` child: it enumerates stable event identities, captures every selected event while holding one `avd-drive` lock, cleans an invocation-started AVD once, then emits one CaptureResult. It never depends on newest-only selection and never releases the AVD lock between selected events.

- [ ] **Step 6: Run lifecycle, capture, and reader regression tests and verify GREEN**

Run:

```bash
node --test tools/jihuanshe_lifecycle.test.mjs tools/jihuanshe_capture.test.mjs tools/jihuanshe_reader.test.mjs
```

Expected: PASS; the unchanged reader remains acquisition-only, and every foreign/mismatched process case proves no signal or ADB kill was sent.

- [ ] **Step 7: Create the checkpoint commit only after owner authorization**

After explicit authorization:

```bash
git add tools/jihuanshe_lifecycle.mjs tools/jihuanshe_lifecycle.test.mjs tools/jihuanshe_capture.mjs tools/jihuanshe_capture.test.mjs
git commit -m "feat: harden JiHuanShe AVD lifecycle"
```

---

### Task 9: Headless source refresh and visible one-time reauthentication

**Files:**
- Create: `tools/jihuanshe_refresh.mjs`
- Create: `tools/jihuanshe_refresh.test.mjs`
- Modify: `docs/jihuanshe-reader.md`

**Interfaces:**
- Consumes: capture child command, normalizer, environment snapshot validator/store, mapping file, explicit date window or event keys, and optional raw-retention directory.
- Produces: `refreshJiHuanShe(options)`, `reauthJiHuanShe(options)`, `statusJiHuanShe(options)`, `formatRefreshResult(result)`, and `refreshExitCode(result)`.

- [ ] **Step 1: Write failing two-lock, result-contract, and privacy tests**

The one stdout object has this shape:

```json
{
  "schemaVersion": 1,
  "source": "jihuanshe",
  "operation": "refresh",
  "status": "ok",
  "stage": "complete",
  "code": "ok",
  "lifecycle": {
    "stateBefore": "offline",
    "startedByInvocation": true,
    "launchMode": "headless",
    "cleanedUp": true
  },
  "published": { "snapshotIds": ["jihuanshe-tournament-fixture-04b14788ee658771"] },
  "warnings": []
}
```

Tests inject a fake child and assert the outer `refresh-publication` lock is acquired before spawn; the child independently acquires `avd-drive`; outer never stops an emulator; the child cleans its own lease before returning; raw bytes, participant sentinels, child stderr, and credentials never appear in RefreshResult; refresh never writes `data/environment-aliases/`; market publication failure does not roll back a valid tournament snapshot or fabricate strength data.

Stages are exactly `lock`, `capture`, `normalize`, `validate`, `publish_snapshot`, and `cleanup`. Stable failure codes are `lock_busy`, `reauth_required`, `ui_contract_changed`, `unsupported_capture_schema`, `event_identity_ambiguous`, `normalization_failed`, `snapshot_validation_failed`, `snapshot_publish_failed`, `cleanup_failed`, and `event_conflict`. Exit is `0` only for success, `2` only for reauth, and `1` for every other code.

- [ ] **Step 2: Run refresh tests and verify RED**

Run:

```bash
node --test tools/jihuanshe_refresh.test.mjs
```

Expected: FAIL with missing `tools/jihuanshe_refresh.mjs`.

- [ ] **Step 3: Implement capture-child orchestration and source publication**

Spawn Node directly with argument arrays and capture stdout as a `Buffer` with a 16 MiB ceiling. Hash and normalize the exact bytes, validate the candidate snapshot, then search existing tournament snapshots by `eventKey` and `eventEvidenceHash`:

```js
export async function refreshJiHuanShe(options, deps = realDeps) {
  return deps.withRefreshLock(options, async () => {
    const raw = await deps.captureChild(options);
    const snapshots = normalizeJiHuanSheCapture(raw, options.normalization);
    const published = [];
    const warnings = [];
    for (const snapshot of snapshots) {
      const existing = deps.findTournamentEvidence(snapshot);
      if (existing.sameEvidence) {
        published.push(existing.snapshotId);
        warnings.push("observation_reused");
        continue;
      }
      deps.publishSourceSnapshot(snapshot);
      published.push(snapshot.snapshotId);
      if (existing.conflict) warnings.push(`event_conflict:${snapshot.data.eventKey}`);
    }
    return warnings.some((warning) => warning.startsWith("event_conflict:"))
      ? conflictResult(published, warnings)
      : success(published, warnings);
  });
}
```

For tournament windows, `captureChild()` invokes the single batch command from Task 8 so one child owns enumeration, all selected captures, and invocation-owned cleanup under one AVD lock. If a child exits without a valid CaptureResult, the outer process first proves the recorded lock owner dead, reacquires `avd-drive`, revalidates the persisted emulator process token, and may clean only that exact lease; it never performs cleanup after a normal child result.

A conflict publishes the new immutable source snapshot beside the prior version, returns status `error`, code `event_conflict`, exit `1`, and includes the newly published ID plus sanitized event key in RefreshResult. It never overwrites either version or advances an Environment alias; a later field build must select one evidence version explicitly.

- [ ] **Step 4: Implement restrictive optional raw retention**

When `--retain-raw DIRECTORY` is present, reject symlinks, create the explicit directory as `0700`, create a unique file with `wx` as `0600`, write and fsync the exact bytes, and return only a sanitized retention status without printing the raw path if it contains sensitive components. Without the flag, no raw file operation occurs.

- [ ] **Step 5: Implement visible reauthentication under the same AVD lock**

`reauth` acquires `avd-drive` or returns `lock_busy`. For a verified headless fixed AVD it rechecks the exact process token, stops only that process, starts `JiHuanShe_SC` visibly without `-no-window`, launches the official login screen, and waits until `classifyHomeUi()` returns `ready`. The owner enters the SMS code directly in the emulator. If reauth started the visible AVD, it stops that exact process after successful login while still holding the lock; the next refresh therefore returns to headless operation. An already visible owner-started AVD is attached and left running.

- [ ] **Step 6: Run refresh/lifecycle tests and verify GREEN**

Run:

```bash
node --test tools/jihuanshe_refresh.test.mjs tools/jihuanshe_lifecycle.test.mjs tools/jihuanshe_capture.test.mjs tools/jihuanshe_normalize.test.mjs
```

Expected: PASS, including child crash recovery, lock contention, exact-process cleanup, reauth success, restrictive permissions, parser drift, idempotent reuse, and alias-path zero writes.

- [ ] **Step 7: Run the manual command-path smoke without invalidating login**

Run status first:

```bash
node tools/jihuanshe_refresh.mjs status
node tools/jihuanshe_refresh.mjs refresh market
node tools/jihuanshe_refresh.mjs refresh tournaments --as-of 2026-08-20 --window-days 30
```

Expected: status and refresh each print one sanitized JSON object. A valid session uses no visible emulator. If the session naturally returns exit `2`, run `node tools/jihuanshe_refresh.mjs reauth`, enter the SMS code once in the visible official login flow, and rerun refresh. Do not log out merely to force this branch.

- [ ] **Step 8: Create the checkpoint commit only after owner authorization**

After explicit authorization:

```bash
git add tools/jihuanshe_refresh.mjs tools/jihuanshe_refresh.test.mjs docs/jihuanshe-reader.md
git commit -m "feat: add headless JiHuanShe source refresh"
```

---

### Task 10: Fixed-seat simulation batch and strict environment job adapter

**Files:**
- Create: `sim/batch-runner.ts`
- Create: `sim/batch-runner.test.ts`
- Create: `sim/environment-contract.mjs`
- Create: `sim/environment-contract.test.mjs`
- Create: `sim/environment-job.sim.test.ts`
- Create: `tests/fixtures/environment/minimal-job-play.json`
- Create: `tests/fixtures/environment/minimal-job-draw.json`
- Modify: `sim/matchup.sim.test.ts`
- Modify: `scripts/simulate.sh`

**Interfaces:**
- Consumes: one concrete immutable job with materialized deck inputs, fixed seat, exact seed schedule, policy names, engine revision, and computational limits.
- Produces: `runBatch(spec): RawGameResult[]`, `classifyTermination(input)`, `validateEnvironmentJob(job)`, `validateRawJobResult(job, result)`, and a raw job-result file at an explicit temporary path.

```ts
export interface BatchSpec {
  candidate: EngineDeckInput;
  opponent: EngineDeckInput;
  fixedSeat: "play" | "draw" | "alternate";
  seeds: readonly number[];
  strategyCandidate: StrategyName;
  strategyOpponent: StrategyName;
  maxCommands: number;
  maxTurns: number;
}

export interface RawGameResult {
  seed: number;
  requestedSeat: "play" | "draw";
  actualSeat: "north" | "south";
  aOnPlay: boolean;
  outcome: "win" | "loss" | "unfinished" | "tool_failure";
  engineTermination: string;
  terminationCause: string;
  turns: number;
  commands: number;
}
```

- [ ] **Step 1: Write failing job validation and termination-priority tests**

`sim/environment-contract.test.mjs` asserts that a job requires exactly one fixed seat (`play` or `draw`), unique explicit integer seeds, positive completed-game target, both deck artifact/gameplay hashes, plan hash, job ID, strategies, engine revision, and limits. Invalid `--first banana` must produce `invalid_first_player` rather than alternate.

Termination tests lock this order:

```js
assert.deepEqual(classifyTermination({
  engineTermination: "illegal-command",
  winner: null,
  turns: 99,
  maxTurns: 40,
}), { outcome: "tool_failure", terminationCause: "illegal-command" });

assert.deepEqual(classifyTermination({
  engineTermination: "rules-win",
  winner: "candidate",
  turns: 41,
  maxTurns: 40,
}), { outcome: "unfinished", terminationCause: "turn_budget_exhausted" });

assert.deepEqual(classifyTermination({
  engineTermination: "rules-win",
  winner: "candidate",
  turns: 9,
  maxTurns: 40,
}), { outcome: "win", terminationCause: "rules-win" });
```

No simulation test may produce `round_timeout`; that outcome is accepted only from a separately validated clock adapter in Task 11.

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```bash
node --test sim/environment-contract.test.mjs
```

Expected: FAIL with missing `sim/environment-contract.mjs`.

- [ ] **Step 3: Implement strict job validation and termination classification**

Derive `planHash` over the plan without `planHash` and derived `jobId`. Derive `jobId` over `{ planHash, candidate artifact/gameplay hashes, opponent artifact/gameplay hashes, fixedSeat, seeds, strategies, completedGameTarget, engineRevision, maxCommands, maxTurns }`. Validation recomputes both and rejects any mismatch.

`classifyTermination()` checks non-`rules-win` engine termination first, then computational limits, then the winner. Map repeated state and command ceilings to `unfinished`, illegal command/invalid state/process failures to `tool_failure`, and retain the exact engine cause.

- [ ] **Step 4: Extract the engine batch implementation without changing direct A/B behavior**

Move deck loading, strategy selection, `config()`, `playOne()`, and summary primitives from `sim/matchup.sim.test.ts` into `sim/batch-runner.ts`. `runBatch()` does not read environment variables and does not write files. It assigns north for `play`, south for `draw`, alternates only for the legacy adapter, and records actual `aOnPlay` from final engine state.

The legacy adapter keeps the current CLI and `sim/results/last-run.json`, but labels its post-hoc turn threshold `legacy_turn_budget_proxy` instead of a calibrated round timeout. The environment adapter refuses alternate seats and emits per-game raw data only.

- [ ] **Step 5: Add strict shell modes and environment adapter**

`scripts/simulate.sh` adds:

```text
--job PATH --out PATH
--harness-tests
--max-commands INTEGER
```

`--job` is mutually exclusive with `--a`, `--b`, `--compare`, `--games`, `--seed`, `--first`, and strategy overrides. Before job mode, unset every ambient legacy `SIM_DECK_*`, `SIM_COMPARE`, `SIM_FIRST`, `SIM_GAMES`, `SIM_SEED`, and `SIM_STRATEGY*` value, then set only `SIM_ENV_JOB` and `SIM_OUT`. Copy `batch-runner.ts`, `environment-contract.mjs`, and `environment-job.sim.test.ts` into the vendored engine test directory and run exactly that adapter.

- [ ] **Step 6: Run pure tests, shell syntax, and vendored harness tests to verify GREEN**

Run:

```bash
node --test sim/environment-contract.test.mjs
bash -n scripts/simulate.sh
./scripts/simulate.sh --harness-tests
```

Expected: PASS. Harness tests prove fixed play/draw, actual-seat validation, unique seeds, termination precedence, and unchanged direct A/B summaries. If the vendor tree is absent, the third command must fail with the existing explicit bootstrap instruction; do not treat that as a passing harness test.

- [ ] **Step 7: Run one real fixed-seat smoke job**

Run:

```bash
./scripts/simulate.sh --job tests/fixtures/environment/minimal-job-play.json --out /private/tmp/opcg-minimal-job-play.raw.json
```

Expected: the raw result echoes the job ID, plan hash, input hashes, fixed play seat, exact seeds, engine/policy settings, and per-game termination fields. Every game's `aOnPlay` is true; otherwise the command fails `simulation_result_mismatch`.

- [ ] **Step 8: Create the checkpoint commit only after owner authorization**

After explicit authorization:

```bash
git add sim/batch-runner.ts sim/batch-runner.test.ts sim/environment-contract.mjs sim/environment-contract.test.mjs sim/environment-job.sim.test.ts sim/matchup.sim.test.ts scripts/simulate.sh tests/fixtures/environment/minimal-job-play.json tests/fixtures/environment/minimal-job-draw.json
git commit -m "feat: add fixed-seat environment simulation jobs"
```

---

### Task 11: Environment orchestration, exact EV, confidence, and comparison

**Files:**
- Create: `environment/matchup.mjs`
- Create: `environment/simulation.mjs`
- Create: `environment/report.mjs`
- Create: `environment/matchup.test.mjs`
- Create: `environment/simulation.test.mjs`
- Create: `environment/report.test.mjs`
- Create: `tools/environment_evaluate.mjs`
- Create: `tools/environment_evaluate.test.mjs`
- Create: `tests/fixtures/environment/minimal-resolved-plan.json`
- Create: `tests/fixtures/environment/minimal-valid-results.json`
- Create: `tests/fixtures/environment/accepted-clock-timeout-results.json`
- Create: `tests/fixtures/environment/incomplete-field-plan.json`
- Create: `tests/fixtures/environment/base-variant-paired-results.json`
- Create: `tests/fixtures/environment/fake-simulation-runner.mjs`

**Interfaces:**
- Consumes: a resolved evaluation, candidate/variant DeckSnapshots, explicit simulation settings, and either the real or injected runner.
- Produces: `validateScoreableMatchupCell()`, `buildSimulatedMatchupSnapshot()`, `validateObservedMatchupSnapshot()`, `expandSimulationPlan()`, `executeSimulationPlan()`, `validateJobResult()`, `aggregateEnvironment()`, `compareVariants()`, `compareEnvironments()`, and CLI `evaluate`/`compare` commands.

- [ ] **Step 1: Write failing plan/job/result integrity tests**

Tests assert deterministic expansion into exactly two jobs per representative deck, one play and one draw; a minimum target of 200 valid completed games per seat; job-specific immutable deck materialization; common seed schedules across baseline/variant; and job IDs that change when any immutable input or setting changes.

Result validation rejects missing/duplicate seeds, seat drift, wrong plan/job/input/engine hash, partial JSON, stale result, legacy `sim/results/last-run.json`, arena results, and a different existing content hash at the job path.

```js
const base = expandSimulationPlan(resolved, baseDeck, settings);
const variant = expandSimulationPlan(resolved, variantDeck, settings);
for (const key of base.jobs.map((job) => job.pairingKey)) {
  assert.deepEqual(jobByKey(base, key).seeds, jobByKey(variant, key).seeds);
}
assert.notEqual(base.planHash, variant.planHash);
```

The seed schedule derives only from the explicit comparison seed and stable `archetype × representative × seat` stratum identity, never candidate hash, plan hash, or job ID.

- [ ] **Step 2: Write failing EV, timeout, coverage, and confidence tests**

Matchup-contract tests require both provenance axes (`method: observed | simulated`, `applicability: native | proxy`) and exact candidate/opponent snapshot, content, and gameplay hashes. Every scoreable cell must pin play/draw seat, wins, losses, scored round timeouts, valid-game count with exact arithmetic consistency, format, stage, timeout policy, population/window provenance, and sample size. Simulated cells additionally require every per-game row plus engine/policy/capability hashes; observed cells without exact deck hashes, counts, or seat split remain calibration-only.

Report tests require field weights and each within-archetype representative weight set to sum to exactly one within `1e-12`. A partial field returns `field_not_representative`; no normalization is attempted.

For valid outcomes, `win = 1`, `loss = 0`, and an accepted-clock `round_timeout = 0` under SC Swiss double-loss policy. Unfinished/tool failure is excluded from the rate denominator; any such row invalidates that result cell even when other rows meet the numeric floor, so a clean replacement job is required after the cause is fixed. A timeout fixture without the accepted ClockModel hash fails `simulation_result_mismatch` with `details.reason: "clock_model_hash"`.

Confidence tests pin bootstrap seed `20260820` and `10000` replicates. Single-deck simulation reports resample within each `archetype × representative × seat` stratum while holding field and representative weights fixed. Observed scoreable counts use pinned parametric binomial resampling per cell and label the interval `observedSampling95`; they cannot emit a paired tech-slot interval without a genuine paired source design. Variant simulation reports join pairs by exact `(pairingKey, seed)` and resample pairs together; array position and shortest-length truncation are forbidden.

- [ ] **Step 3: Run orchestration/report tests and verify RED**

Run:

```bash
node --test environment/matchup.test.mjs environment/simulation.test.mjs environment/report.test.mjs tools/environment_evaluate.test.mjs
```

Expected: FAIL with missing simulation/report modules.

- [ ] **Step 4: Implement concrete plan/job expansion and verified publication**

`expandSimulationPlan()` validates the resolved input and creates fixed strata/jobs. Materialize each deck from its DeckSnapshot into a job-private JSON file under `.cache/environment-jobs/<planHash>/`; caller paths are never authoritative.

`executeSimulationPlan()` runs `scripts/simulate.sh --job JOB --out RAW_TEMP`, validates the raw output, converts each seat result to a `method: "simulated"` MatchupSnapshot with native/proxy applicability inherited from the Manifest, and publishes atomically only to:

```text
sim/results/environments/<manifestId>/<jobId>.json
```

The final result excludes runtime timestamps from its hash projection and echoes the full immutable/settings fields plus every game's seed, requested/actual seat, outcome, engine termination, termination cause, turns, and commands. Observed snapshots enter through `validateObservedMatchupSnapshot()` and are never merged row-wise with simulated snapshots.

- [ ] **Step 5: Implement exact weighted reporting and deterministic resampling**

Use direct multiplication without share normalization:

```js
export function weightedSeatEv(strata, seat) {
  assertExactCoverage(strata);
  return strata.reduce((fieldTotal, archetype) => (
    fieldTotal + archetype.fieldWeight * archetype.representatives.reduce(
      (deckTotal, representative) => (
        deckTotal + representative.withinArchetypeWeight * representative.winRate[seat]
      ),
      0,
    )
  ), 0);
}
```

Report `EV_play` and `EV_draw` first. Calculate `EV_overall` only from explicit Manifest play/draw weights. Implement Wilson 95% intervals per cell and deterministic xorshift32 sampling initialized from the pinned seed for aggregate intervals. Label them `simulationMonteCarlo95` or `observedSampling95` and explicitly exclude field-selection, deck-choice, pilot, engine, and clock uncertainty.

Timeout-bearing environment evidence never calls legacy mirrored-pair consistency or Nash functions.

Finalize every report with a canonical `contentHash` and record requested alias, logical environment key, resolved Manifest ID/full hash, all source refs/hashes, official/proxy/diagnostic status, candidate/opponent artifact and gameplay hashes, engine/policy/settings, coverage, method/applicability, capability blockers, clock status, bootstrap settings, and play/draw/overall values. A runtime generation timestamp is display metadata outside the hash projection.

- [ ] **Step 6: Implement variant and cross-environment comparison**

`compareVariants()` requires identical Manifest/field/representative/seat strata, exact paired seeds, and records a paired interval. `compareEnvironments()` aligns separate SC and EN reports side by side, retains both Manifest IDs/status labels, and may show `SC minus EN`; it never calculates a blended score. An illegal candidate remains an explicit `illegal_deck` cell.

- [ ] **Step 7: Run offline fake-runner tests and verify GREEN**

Run:

```bash
node --test environment/matchup.test.mjs environment/simulation.test.mjs environment/report.test.mjs tools/environment_evaluate.test.mjs
node tools/environment_evaluate.mjs evaluate --plan tests/fixtures/environment/minimal-resolved-plan.json --runner tests/fixtures/environment/fake-simulation-runner.mjs --results-root /private/tmp/opcg-environment-results
```

Expected: all tests PASS. The CLI prints one report that pins Manifest/source/deck/engine/seed/settings hashes, exposes separate play/draw results, and is labelled `diagnostic_estimate` when the fixture lacks an accepted official capability or clock.

- [ ] **Step 8: Create the checkpoint commit only after owner authorization**

After explicit authorization:

```bash
git add environment/matchup.mjs environment/simulation.mjs environment/report.mjs environment/matchup.test.mjs environment/simulation.test.mjs environment/report.test.mjs tools/environment_evaluate.mjs tools/environment_evaluate.test.mjs tests/fixtures/environment/minimal-resolved-plan.json tests/fixtures/environment/minimal-valid-results.json tests/fixtures/environment/accepted-clock-timeout-results.json tests/fixtures/environment/incomplete-field-plan.json tests/fixtures/environment/base-variant-paired-results.json tests/fixtures/environment/fake-simulation-runner.mjs
git commit -m "feat: report environment-weighted simulations"
```

---

### Task 12: Legacy EN boundary, documentation, and offline end-to-end acceptance

**Files:**
- Create: `tools/test_ev_analysis.py`
- Create: `tests/fixtures/environment/end-to-end-sc/`
- Create: `tests/fixtures/environment/end-to-end-en/`
- Create: `tests/environment-e2e.test.mjs`
- Modify: `tools/ev_analysis.py`
- Modify: `data/op16-matchup-matrix.json`
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/charter.md`
- Modify: `docs/simulation.md`
- Modify: `docs/jihuanshe-reader.md`
- Create: `docs/environment-data.md`

**Interfaces:**
- Consumes: the existing legacy matrix, synthetic SC/EN full-contract fixtures, and all prior modules.
- Produces: explicitly labelled legacy output, a no-Android end-to-end contract test, operator documentation, and no native EN alias unless complete real EN field evidence exists.

- [ ] **Step 1: Write a failing regression for the legacy command**

`tools/test_ev_analysis.py` imports `load()` and `field_ev()` and asserts this exact legacy result within `1e-6`: `Nami=55.22451013704836`, `Luffy=46.310318269339675`, `Enel=48.71719334012913`, `Rosinante=46.57283950617284`, `Teach=52.82052327556915`, and `Hancock=49.154094461433914`. It separately invokes the default command with `--no-nash` and requires these machine-readable labels in stdout or an adjacent JSON mode:

```json
{
  "evidenceStatus": "legacy_unverified",
  "sourceEdition": "EN",
  "applicability": "historical_only",
  "coveredFieldPct": 88.29,
  "unmodelledFieldPct": 11.71,
  "environmentEligible": false
}
```

The test asserts the artifact cannot be loaded by `buildManifest()` as native or proxy evidence.

- [ ] **Step 2: Run the legacy test and verify RED**

Run:

```bash
./.venv/bin/python -m unittest tools.test_ev_analysis -v
```

Expected: FAIL because the current command says only `renormalized` and lacks the required provenance fields.

- [ ] **Step 3: Add provenance without changing legacy mathematics**

Add `_meta.evidence_status`, `_meta.source_edition`, `_meta.applicability`, and `_meta.environment_eligible` to the matrix. Update `ev_analysis.py` to print the labels before the existing consistency, normalized EV, sensitivity, and optional Nash paths. Do not route environment data through `field_ev()`, `check_consistency()`, or `nash()`.

- [ ] **Step 4: Add synthetic end-to-end SC and EN fixture environments**

Create two clearly marked `fixture_only: true` full-contract datasets. The e2e test runs:

```text
raw SC fixture -> JiHuanShe normalization -> FieldSnapshot -> SC Manifest
synthetic EN event fixture -> FieldSnapshot -> EN Manifest
both Manifests -> candidate resolution -> fake fixed-seat results -> two reports -> side-by-side comparison
```

It asserts zero imports or child processes reference ADB, JiHuanShe capture, or Android; hashes are stable on a second run; SC and EN weights differ; outputs stay separate; and the comparison contains no blended score.

- [ ] **Step 5: Document the live EN evidence boundary and operator commands**

`docs/environment-data.md` records that the currently checked public Limitless tournament page may declare the full event participant count while its statistics/decklist rows cover only a smaller submitted or successful subset. Such data normalizes as `top-cut`/subset evidence, not `full-field`; no production EN Manifest or `EN/latest` alias is created until a reproducible source supplies complete participant-count field rows.

Update project docs to distinguish empirical field, empirical matchup, simulated, proxy, market, and legacy evidence; preserve SC as the objective; explain `refresh`, `reauth`, environment build/evaluate/compare commands; state that market prices never affect strength; and list the capability/clock blockers that force diagnostic output.

- [ ] **Step 6: Run the complete automated validation matrix and verify GREEN**

Run:

```bash
node --test environment/*.test.mjs
node --test tools/jihuanshe_reader.test.mjs tools/jihuanshe_capture.test.mjs tools/jihuanshe_lifecycle.test.mjs tools/jihuanshe_normalize.test.mjs tools/jihuanshe_refresh.test.mjs tools/export_simulation_capability.test.mjs tools/environment_data.test.mjs tools/environment_evaluate.test.mjs
node --test sim/environment-contract.test.mjs tests/environment-e2e.test.mjs
python3 -m unittest discover -s tools -p 'test_*.py' -v
bash -n scripts/simulate.sh
./scripts/simulate.sh --harness-tests
git diff --check
```

Expected: every listed test/check PASS. Report the vendored harness separately from pure Node/Python tests, and never describe a fixture-only EN run as current live EN evidence.

- [ ] **Step 7: Run proportional live acceptance**

With the existing owner session, run one headless SC refresh and build source snapshots only. Inspect the sanitized snapshot coverage and event-selection evidence before building a FieldSnapshot. Build and alias `SC/latest` only when source, full-field, mapping, identity, legality, reference, and freshness validation pass. The Manifest must pin the actual capability and nullable clock state; open capability or clock gates make evaluation `diagnostic_estimate` but do not masquerade as official strength. Preserve all valid snapshots and report every blocking code. Do not create `EN/latest` from Limitless subset statistics or the legacy matrix.

- [ ] **Step 8: Create the checkpoint commit only after owner authorization**

After explicit authorization:

```bash
git add tools/test_ev_analysis.py tools/ev_analysis.py data/op16-matchup-matrix.json tests/fixtures/environment/end-to-end-sc tests/fixtures/environment/end-to-end-en tests/environment-e2e.test.mjs README.md CLAUDE.md docs/charter.md docs/simulation.md docs/jihuanshe-reader.md docs/environment-data.md
git commit -m "docs: complete multi-environment evidence migration"
```

---

## Execution order and review gates

1. Tasks 1-2 establish immutable identity and storage. No other task may invent its own hashing or file publication.
2. Tasks 3-6 establish legal, capability-aware, clock-aware Environment resolution. Review this gate before connecting any live source.
3. Tasks 7-9 add JiHuanShe normalization and refresh. Normalizer and lifecycle can be implemented by separate workers after Task 2; refresh integrates them only after both reviews pass.
4. Task 10 changes the simulator seam and requires its own compatibility review before environment orchestration consumes it.
5. Task 11 adds scoring and confidence. Review mathematical coverage and provenance independently from engine execution.
6. Task 12 closes legacy/docs/e2e and performs final validation. Live source evidence remains separate from automated fixture acceptance.

At every gate, review security boundaries, generated/ignored files, dependency changes, raw-data leakage, hash projections, result-path uniqueness, and unrelated dirty-worktree changes before proceeding.
