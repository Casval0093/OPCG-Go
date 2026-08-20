# Multi-environment data sources and JiHuanShe SC integration

**Status:** Owner-approved written specification, 2026-08-20
**Scope:** OPCG-Go v1 environment data model, JiHuanShe SC ingestion, and environment-weighted simulation
**Primary objective:** Evaluate the same candidate deck or tech-slot variant independently against the real field composition of multiple regional environments

## Summary

OPCG-Go will treat Simplified Chinese (SC) and English-language (EN) metagames as separate, versioned environments. JiHuanShe becomes the SC-native source adapter for tournament and market observations. Existing EN sources become parallel adapters under the same provider-neutral contracts.

The selected architecture is:

```text
source capture -> normalized immutable snapshot -> Environment Manifest
               -> environment resolver -> simulation plan -> environment strength report
```

The game engine remains environment-agnostic. It receives concrete deck-vs-deck match configurations exactly as it does today. A new orchestration layer resolves an environment, validates legality and evidence coverage, expands the candidate deck into matchup jobs, and weights the results against that environment's field composition.

Official SC evaluation is fail-closed. It never silently substitutes EN field or matchup evidence. When an EN prior is intentionally used, the run belongs to a distinct proxy environment such as `SC_WITH_EN_PRIOR`, and every result carries that provenance.

## Goals

1. Ingest JiHuanShe tournament standings, deck distribution, and market prices without requiring a manually opened emulator during normal operation.
2. Normalize SC and EN observations into the same provider-neutral evidence contracts without erasing their regional identity.
3. Make every environment and simulation result reproducible through immutable IDs, timestamps, source references, and content hashes.
4. Evaluate one candidate deck or tech-slot variant separately in SC and EN by combining environment-native field shares with environment-legal simulated matchups.
5. Preserve the project's evidence boundary: empirical field observations, empirical matchup observations, simulated outcomes, and market prices remain distinguishable.
6. Keep field-weighted EV diagnostic. It informs tech-slot tuning, field forecasting, and structural tripwires; it does not automatically choose the owner's archetype.

## Non-goals for v1

- A graphical environment browser or dashboard.
- A local database or event store.
- A background scheduler or operating-system service.
- Fully automatic SMS authentication or any authentication bypass.
- Direct replay of JiHuanShe private APIs, request signing, cookies, tokens, or app-private storage.
- Deriving strength from card price.
- Inferring field share from Top Cut frequency.
- A global cross-region score that blends SC and EN.
- Automatically ranking every possible deck in an environment.
- Adding regional branches to the One Piece rules engine or `MatchConfig`. Engine fidelity fixes remain a separate prerequisite and are enforced here through a simulation-capability gate.
- Claiming that a score is calibrated tournament strength while known engine, policy, or clock-model blockers remain.

## Accepted decisions

| Decision | Resolution |
|---|---|
| Architecture | Layered immutable snapshots plus `Environment Manifest` |
| Official SC fallback | Fail closed when required SC evidence is incomplete |
| EN borrowing | Only through an explicitly named proxy environment such as `SC_WITH_EN_PRIOR` |
| Versioning | Immutable environment snapshots keyed by edition, format, and `asOf`; mutable `latest` aliases are convenience pointers only |
| Market data | Independent information dimension; excluded from strength calculations |
| Runtime dependency | Simulation reads local validated snapshots and never starts the emulator |
| Reauthentication | Open the fixed AVD visibly only after `reauth_required`; the owner enters the SMS code |
| Simulation engine | Remains environment-agnostic and unchanged |
| Cross-environment output | Side-by-side reports, never a silently blended score |
| v1 deliverable | Evaluate one candidate deck or variant independently in SC and EN |
| Engine limitations | Produce only a labelled diagnostic estimate until the pinned engine/policy capability snapshot passes the official-report gate |

## Current-state constraints

- `tools/jihuanshe_capture.mjs` already owns the fixed `JiHuanShe_SC` AVD lifecycle, performs exact visible SC navigation, and emits a raw JSON envelope.
- `tools/jihuanshe_reader.mjs` is the lower-level visible UI/WebView reader.
- The JiHuanShe capture is an acquisition result, not canonical project data. Tournament content is still raw text and labels.
- `tools/ev_analysis.py` currently consumes `data/op16-matchup-matrix.json`, whose metadata is free text and whose matchup and share evidence are EN-derived.
- The simulation harness accepts concrete deck A/deck B inputs and does not validate an environment's release, rotation, or banlist.
- Existing simulation results do not pin an environment or its source snapshots.
- SC and EN identity currently exists in documentation and filenames, not in an enforced contract.
- Known simulation defects include second-player first-turn attack legality, no counter/block decisions, and no attack-target choice. They directly block a calibrated official strength claim until fixed or otherwise closed by a reviewed capability snapshot.

These constraints require a normalization and environment layer. Adding a single `region` field to the current matrix would leave source provenance, missing coverage, legality, and reproducibility unresolved.

## Terminology

### Edition, metagame region, and language

- `edition` identifies the release/rules/card-pool family: initially `SC` or `EN`.
- `metagameRegion` identifies the player population whose field is being measured: initially `CN` or `GLOBAL_EN`.
- `language` identifies source/display language and does not by itself determine legality.

The valid v1 native combinations are `SC/CN/zh-Hans` and `EN/GLOBAL_EN/en`. JP is outside v1. A source that combines EN and JP populations without separable denominators is proxy or legacy evidence, not a native EN field.

Card text obtained in English may support an SC card only when an edition-specific card-pool snapshot proves the same gameplay identity and rules text. Unknown SC-exclusive or changed content fails legality resolution rather than inheriting EN semantics.

### Environment

An immutable description of the format that can be simulated: edition, metagame region, language, rules, legal pool, banlist, field evidence, representative decks, matchup policy, and an `asOf` date plus timezone.

### Evidence kind

One of:

- `field`: what decks entered representative events;
- `results`: standings and records;
- `matchup`: observed or simulated deck-vs-deck outcomes;
- `market`: price observations;
- `rules`: authoritative gameplay and tournament rules;
- `card_pool`: release and legality facts.

Evidence kinds cannot substitute for each other. In particular, `results` cannot become `field`, and `market` cannot become `matchup`.

### Official and proxy environments

- An `official` environment contains only evidence permitted by its own policy and edition.
- A `proxy` environment intentionally borrows evidence from another edition. Its ID and output labels must expose that fact.
- `SC_WITH_EN_PRIOR` is a proxy, never an alias for official `SC`.

`Official` describes the evaluation environment, not the authority of every provider. A native JiHuanShe field snapshot can participate in an official SC environment while still being labelled as app-visible community data rather than Bandai-published data.

## Component architecture

### 1. Source capture adapters

Adapters acquire what a provider renders or publishes. The JiHuanShe adapter remains responsible for:

- starting or attaching to the fixed Android AVD;
- selecting One Piece Simplified Chinese through visible UI semantics;
- capturing tournament or market surfaces;
- returning the raw capture envelope;
- reporting authentication and navigation failures.

It does not classify archetypes, calculate shares, decide freshness, or select simulation opponents.

EN adapters follow the same boundary even when their acquisition mechanism is HTTP rather than Android UI automation.

### 2. Provider normalizers

A provider normalizer converts one raw capture into immutable provider-neutral source snapshots. The JiHuanShe normalizer is a pure transformation after capture. It must be testable from saved, sanitized fixtures without an emulator.

Responsibilities:

- parse event, standings, deck distribution, and price observations;
- map provider card and archetype labels to canonical OPCG-Go IDs;
- retain only typed raw archetype, deck, card, and market labels beside canonical IDs;
- classify evidence coverage;
- report unresolved mappings and missing fields;
- attach source, parser, mapping, and capture provenance;
- calculate a deterministic content hash.

It does not aggregate multiple events, choose an environment, or calculate strength.

### 3. Field snapshot builder

The field builder combines an explicit list of eligible `field` evidence blocks from tournament-event snapshots into a derived immutable `FieldSnapshot`. It rejects duplicate event keys and conflicting evidence versions before aggregation. v1 uses participant-count aggregation:

```text
share(archetype) = total players on archetype across selected events
                   / total participants across selected events
```

There is no recency decay in v1. Event selection and the environment `asOf` date provide the time boundary. Adding a weighting policy later requires a new policy identifier and therefore a new snapshot hash.

### 4. Environment Manifest

The Manifest references immutable source and derived snapshots. It contains environment policy but no copied mutable observations. It identifies:

- edition, metagame region, language, format, timezone, and `asOf`;
- rules, card pool, banlist, construction-policy, and simulation-capability snapshots;
- one field snapshot;
- optional market snapshots;
- archetype-to-representative-deck mappings;
- permissible matchup evidence mode and explicit observed/calibration/proxy references;
- minimum simulation sample and coverage requirements;
- turn-order weighting;
- freshness requirements used by `latest` aliases;
- official or proxy status and any cross-edition prior.

### 5. Environment resolver

The resolver turns an alias or immutable `manifestId` plus a candidate deck into a concrete simulation plan. It validates all references and fails before simulation if the plan is not trustworthy.

The resolved plan contains only concrete values: immutable Manifest ID and hash, candidate deck hashes, legal opponent deck hashes, field weights, matchup jobs, seeds, game counts, and reporting policy.

### 6. Simulation and EV consumers

The existing simulator runs the concrete jobs. A report builder consumes the completed jobs and their provenance, then calculates field-weighted results. The underlying engine neither reads the Manifest nor knows whether a job came from SC or EN.

## Data contracts

### Common snapshot envelope

Every normalized source or derived snapshot has this conceptual envelope:

```json
{
  "schemaVersion": 1,
  "snapshotId": "provider-kind-date-hash-prefix",
  "kind": "tournament_event",
  "environment": {
    "edition": "SC",
    "metagameRegion": "CN",
    "language": "zh-Hans",
    "formatId": "standard-block2-op16",
    "timeZone": "Asia/Shanghai"
  },
  "asOf": "2026-08-20",
  "source": {
    "provider": "jihuanshe",
    "surface": "tournament",
    "sourceRef": {
      "providerEventId": "example-event-2026-08-20",
      "sanitizedRoute": "app:tournament-detail"
    },
    "observedAt": "2026-08-20T19:00:00+08:00",
    "capturedAt": "2026-08-20T12:00:00Z",
    "captureHash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    "captureHashScope": "exact-raw-envelope-bytes",
    "parserVersion": "jihuanshe-normalizer-v1",
    "mappingVersion": "jihuanshe-mapping-v1"
  },
  "coverage": {
    "status": "complete",
    "warnings": [],
    "missingFields": []
  },
  "data": {
    "eventKey": "jihuanshe-example-event-2026-08-20",
    "evidenceBlocks": {
      "results": { "status": "complete" },
      "field": { "sampleFrame": "full-field" }
    }
  },
  "contentHash": "sha256:0000000000000000000000000000000000000000000000000000000000000000"
}
```

`captureHash` hashes the exact unsanitized raw acquisition-envelope bytes; only the hash enters tracked data. `sourceRef` uses a stable provider event ID or a sanitized source URI/route with sensitive query values removed. Internal app surfaces without a stable URL use provider surface plus event identity.

`contentHash` is the SHA-256 of a canonical serialization that excludes both `snapshotId` and `contentHash`. Strings are normalized to Unicode NFC and then serialized with RFC 8785 JSON Canonicalization Scheme (JCS), which fixes object ordering and numeric forms including `1` versus `1.0`, negative zero, and exponent notation. Arrays preserve semantic order, timestamps use RFC 3339, and omitted remains distinct from `null`. Parser and mapping versions are inside the hashed payload. Node and Python consumers must pass the same cross-language golden vectors rather than implementing divergent ad hoc encoders.

The hash is calculated first, then its first 16 hexadecimal characters are used in `snapshotId`; references always retain the full hash. Publishing a different full hash under an existing prefix-derived ID fails with `snapshot_id_collision` rather than overwriting. Any parser, mapping, coverage, source-observation, or data change produces a new immutable snapshot.

Source/derived snapshot IDs include provider or derivation kind, evidence kind, event/date identity, and hash prefix. A logical `environmentKey` includes edition, metagame region, language, canonical timezone, format, and `asOf`. The immutable `manifestId` appends the first 16 hexadecimal characters of the Manifest content hash; the full hash pins rules, card pool, policy, and all references. Direct resolution accepts an alias or `manifestId`, never the non-unique logical key by itself.

### Time semantics

- Tournament time is a precision-bearing value. When the provider supplies a timestamp, `eventStartedAt` and optional `eventEndedAt` retain its original offset and IANA timezone and may also carry normalized UTC. When JiHuanShe supplies only `YYYY-MM-DD`, the snapshot stores `{localDate, precision: "day", timeZone}` and does not invent a midnight or UTC instant.
- `observedAt` describes the provider's stated effective/update time. When the provider gives no such time, it equals `capturedAt` and the lower precision is recorded.
- `capturedAt` is the UTC instant at which OPCG-Go acquired the surface.
- Manifest `asOf` is a local calendar date interpreted through the Manifest `timeZone`; the inclusion boundary is inclusive through 23:59:59.999 of that date.
- Completed tournament events qualify only when their precision-aware local interval overlaps the inclusive selected window and ends no later than the Manifest `asOf` day boundary. A day-precision event is compared as that whole local day.
- Field freshness uses the newest included event time. Market freshness uses provider `observedAt`, falling back to `capturedAt` only when explicitly marked.
- Resolver freshness calculations receive an explicit `now` value; production injects the current clock and tests inject a fixed clock.

### Tournament-event snapshot

A normalized tournament capture produces one `tournament_event` container with shared event identity and separate typed evidence blocks. The `results` block contains standings and records. The `field` block contains entrant archetype counts. Consumers must select a block explicitly; a results block can never be passed to the field builder.

The container includes:

- provider event ID when available, otherwise a deterministic event key derived from provider, event name, start time, organizer, and location fields that are actually present; if those fields cannot distinguish visible events, normalization fails with `event_identity_ambiguous` rather than merging them;
- event name, precision-bearing event date/timestamp, timezone, normalized UTC only when the source precision permits it, status, and raw format label;
- declared participant count and its provider label;
- a `results` block with rank, record, canonical archetype ID, optional canonical deck reference, and typed raw archetype/deck labels;
- a `field` block with deck-distribution counts, `sampleFrame`, denominator evidence, unresolved labels, and coverage;
- evidence-specific warnings and missing fields.

`sampleFrame` defaults to `unknown`. A JiHuanShe field block may be promoted to `full-field` only when all of these checks pass:

1. the page supplies a total entrant/participant count or a complete standings range with an equivalent denominator;
2. the captured field rows are explicitly described as all entrants, or every entrant in the complete standings can be joined in memory to exactly one field/deck row;
3. archetype counts equal the participant denominator;
4. each displayed percentage agrees with `count / denominator` within half of its least-significant displayed unit, and the aggregate agrees with 100% within the sum of those per-row rounding bounds;
5. no duplicate participant, rank, or provider event row remains;
6. the page is not labelled Top Cut, elimination-only, submitted-only, or another subset.

Failure of any check leaves `sampleFrame: unknown` unless the page positively identifies a narrower `top-cut` frame. The normalizer never infers `full-field` merely because a chart displays 100%.

Repeated captures of the same event share one `eventKey`. Each candidate container also has an `eventEvidenceHash`. It is `sha256:` plus the SHA-256 of the same NFC plus RFC 8785 JCS serialization used for `contentHash`, but over exactly this projection:

- snapshot `schemaVersion`, `kind`, `edition`, `metagameRegion`, `language`, `timeZone`, and `format`;
- the stable source identity `{provider, surface, providerEventId, sanitizedRoute}` from `sourceRef`, omitting absent optional members;
- the entire normalized tournament `data` container, including `eventKey`, event identity and time precision, participant evidence, and both typed evidence blocks;
- `coverage` and evidence-specific warnings/missing fields;
- `parserVersion` and `mappingVersion`;
- provider-stated `observedAt` with `observedAtSource: "provider"`; when no provider time exists, only the stable marker `observedAtSource: "capture_fallback"` is included and the copied `capturedAt` value is not.

Before this projection is serialized, results rows are sorted by rank then provider row ID, field rows by canonical archetype ID then raw label, and otherwise unordered warning/missing-field lists lexicographically; arrays whose order is itself provider evidence retain that semantic order. The projection excludes `snapshotId`, `contentHash`, `eventEvidenceHash`, `captureHash`, `capturedAt`, local raw-capture paths, transport headers, retry/lifecycle metadata, and other acquisition-only fields. A stable sanitized route is evidence identity and is included; volatile query values and authentication material are not permitted in `sourceRef` in the first place.

Its ordinary `contentHash` intentionally differs when `capturedAt` or raw-capture provenance differs. Before publishing a candidate, refresh searches existing snapshots by event key and evidence hash: when both match, it discards the new observation candidate and returns the original snapshot ID; it does not require the two content hashes to match. Thus a later acquisition time with identical evidence reuses the original snapshot, while any projected evidence change creates a conflicting immutable version that cannot advance an alias until explicitly reviewed. A field snapshot may select only one version for an event key, so both versions can never be counted together.

Tracked canonical snapshots exclude participant phone numbers, login data, authentication state, handles, and entire raw standings rows. Handles may be used transiently in memory to join blocks, then are replaced by event-local ordinals that are not hashes of the handle. The only tracked raw labels are explicitly named fields such as `rawArchetypeLabel` and `rawDeckLabel`.

### Archetype and card mapping

Provider labels are resolved through versioned mapping registries. A normalized row retains both the canonical ID and original provider label. A new provider label is never guessed from a substring or silently folded into `Other`.

When a label cannot be resolved:

- the row remains present with `canonicalId: null` and its raw label;
- coverage records the unresolved count;
- the row is excluded from derived archetype totals;
- official field coverage is incomplete, so an official strength score is withheld.

Market card identities use the engine's canonical base card ID plus explicit printing, language, condition, and grading attributes where available. Alternate printings do not create new gameplay identities.

### Field snapshot

A `FieldSnapshot` records:

- the exact tournament-event snapshot IDs, hashes, event keys, and selected `field` block versions used;
- aggregation policy ID (`participant-count-v1`);
- inclusive event-window start/end timestamps and timezone;
- explicit event-selection policy and any excluded event IDs with reasons;
- total participants;
- classified and unclassified participant counts;
- player count and share for each canonical archetype;
- coverage status.

Only events marked `full-field` with a known participant denominator can contribute. Top Cut and unknown-frame events remain useful `results` evidence but cannot contribute to field share.

The builder rejects repeated event keys, conflicting versions of one event, duplicate participants, or count/denominator disagreement. The first JiHuanShe acquisition path must support listing eligible completed events and capturing a selected stable event identity; repeatedly capturing only the newest event is insufficient for a multi-event field.

Shares always use total participants as the denominator. Known shares are not silently renormalized around unclassified rows. An official v1 score requires complete classified coverage.

### Matchup snapshot

A matchup snapshot records two independent provenance axes:

- `method`: `observed` for empirical games from a named population and provider, or `simulated` for OPCG-Go games with engine revision, policy, configuration, seed, game count, deck hashes, and turn order;
- `applicability`: `native` when the evidence belongs to the evaluated edition, or `proxy` when a proxy Manifest intentionally applies cross-edition evidence.

Proxy status never erases whether the underlying evidence was observed or simulated.

Every scoreable matchup cell contains:

- candidate and opponent deck snapshot/content/gameplay hashes;
- candidate seat (`play` or `draw`);
- wins, losses, scored round timeouts, and valid-game count with exact arithmetic consistency;
- format, stage, timeout policy, population, event/window, and source provenance;
- sample size and evidence method/applicability.

Simulated cells additionally retain per-game rows, engine/policy/capability hashes, seeds, actual seat, and termination cause. Observed cells may retain aggregate outcome counts, but v1 scoring accepts them only when they identify exact candidate and opponent gameplay hashes, split play/draw, expose outcome denominators, and match the Manifest round/timeout policy. Archetype-only matrices, cells without sample counts, or cells without seat splits are calibration evidence only.

Observed and simulated cells are never merged without retaining method-specific rows. A proxy prior must satisfy the same scoreable-cell contract, record its origin edition/environment, and be referenced only by a proxy Manifest. Existing EN ladder data remains empirical calibration evidence; it does not silently replace simulations of a specific candidate or tech-slot variant.

### Market snapshot

A market snapshot records canonical card and printing identity, currency, observed price, previous price when shown, condition/grade, provider label, and capture time. It also records query/filter/sort state, row count, and coverage scope.

The current UIAutomator acquisition is `scope: visible-viewport` with `paginationComplete: false`; it must not be labelled a complete market. A future acquisition may use `scope: complete-query` only after it deterministically traverses every row/page for the recorded query and verifies the total.

Market data is optional in a Manifest and never blocks or changes a strength result.

### Deck snapshot

A `DeckSnapshot` is environment-neutral and contains:

- canonical leader gameplay ID;
- a sorted map of canonical base gameplay card ID to copy count;
- exactly 50 main-deck cards after copy expansion;
- a `gameplayHash` over schema version, leader, and sorted counts;
- an artifact `contentHash` using the common snapshot rule, therefore covering `gameplayHash` and every other immutable field except `snapshotId`/`contentHash`, including optional display name and notes.

Alternate-art and language printings normalize to the same gameplay card ID only when their rules identity is proven equal. Array order, display name, and notes cannot change `gameplayHash`, although changing stored metadata produces a new artifact `contentHash`. Manifest references validate `{snapshotId, contentHash}`; simulation jobs and common-random-number comparisons use `gameplayHash`. Legality remains an environment-resolver decision rather than a property asserted by the deck itself.

### Card-pool, banlist, and construction snapshots

An edition-specific `CardPoolSnapshot` records format, effective interval, permitted gameplay card IDs, release/source evidence, and a rules-identity hash for every permitted card. A `BanlistSnapshot` records banned/restricted IDs, effective interval, and authority. A construction-policy snapshot records deck size, leader rules, copy limits, colour restrictions, and any format-specific constraints.

The resolver requires an exact applicable version for the Manifest `asOf`. A card present only in EN data is not assumed to be SC-legal or rules-identical. Unknown SC-exclusive content, changed text, or unresolved release parity returns `card_pool_unverified` or `card_rules_identity_mismatch`.

### Simulation-capability snapshot

A `SimulationCapabilitySnapshot` pins engine revision, local patch hash, strategy/policy revision, card catalog hash, executable-effect coverage for every deck card, known rules/policy limitations, and calibration status. It is generated from live engine inputs, not the known-stale `sim/catalog.json` flags.

Every candidate and representative deck must be `simulation_ready`: every non-vanilla effect is executable under the pinned engine, every required ruling identity matches, and no known engine/policy defect invalidates the requested measurement. The current known first-turn attack, counter/block, and attack-target limitations keep official environment-strength status closed until repaired and verified.

A caller may explicitly request a diagnostic run while the capability gate is closed. Such output is named `diagnostic_estimate`, lists every blocking capability, and cannot be published or aliased as an official environment-strength result.

### Clock-model snapshot

A non-null `ClockModelSnapshot` is immutable and records:

- applicable edition, format, tournament stage, round duration, and rules snapshot;
- input features and the exact simulation events they consume;
- calibration dataset IDs/hashes, population, dates, and observed elapsed-time outcome labels;
- model/algorithm version, parameters, classification threshold, and deterministic inference procedure;
- held-out calibration/error metrics and an acceptance policy;
- content hash and effective interval.

Only an accepted model applicable to the Manifest may classify a normally progressing simulated game as `round_timeout`. A computational turn/command ceiling is not a clock-model feature unless the calibrated contract explicitly proves that mapping. With `clockModelRef: null`, v1 tests and reports exercise only the fail-closed diagnostic path; no synthetic fixture may imply that the current turn budget represents 30 minutes.

### Environment Manifest

A Manifest has the following conceptual form:

```json
{
  "schemaVersion": 1,
  "environmentKey": "SC-CN-zhHans-Asia-Shanghai-standard-block2-op16-2026-08-20",
  "manifestId": "SC-CN-zhHans-Asia-Shanghai-standard-block2-op16-2026-08-20-0000000000000000",
  "kind": "official",
  "edition": "SC",
  "metagameRegion": "CN",
  "language": "zh-Hans",
  "formatId": "standard-block2-op16",
  "asOf": "2026-08-20",
  "timeZone": "Asia/Shanghai",
  "references": {
    "rules": {
      "snapshotId": "sc-comprehensive-rules-1.2.0",
      "contentHash": "sha256:1111111111111111111111111111111111111111111111111111111111111111"
    },
    "cardPool": {
      "snapshotId": "sc-standard-block2-op16",
      "contentHash": "sha256:2222222222222222222222222222222222222222222222222222222222222222"
    },
    "banlist": {
      "snapshotId": "sc-banlist-2026-04-01",
      "contentHash": "sha256:3333333333333333333333333333333333333333333333333333333333333333"
    },
    "constructionPolicy": {
      "snapshotId": "opcg-standard-construction-v1",
      "contentHash": "sha256:6666666666666666666666666666666666666666666666666666666666666666"
    },
    "simulationCapability": {
      "snapshotId": "engine-capability-example",
      "contentHash": "sha256:7777777777777777777777777777777777777777777777777777777777777777"
    },
    "field": {
      "snapshotId": "sc-field-op16-2026-08-20-example",
      "contentHash": "sha256:4444444444444444444444444444444444444444444444444444444444444444"
    },
    "market": []
  },
  "opponents": [
    {
      "archetypeId": "ace-op16",
      "representativeDecks": [
        {
          "deckSnapshotId": "ace-op16-reference",
          "contentHash": "sha256:5555555555555555555555555555555555555555555555555555555555555555",
          "gameplayHash": "sha256:8888888888888888888888888888888888888888888888888888888888888888",
          "weight": 1.0
        }
      ]
    }
  ],
  "matchupPolicy": {
    "mode": "simulate",
    "observedMatchupRefs": [],
    "proxyPriorRef": null,
    "minimumGamesPerSeat": 200,
    "requiredFieldCoverage": 1.0,
    "requiredMatchupCoverage": 1.0,
    "turnOrderWeights": { "play": 0.5, "draw": 0.5 },
    "roundPolicy": {
      "stage": "swiss",
      "roundDurationMinutes": 30,
      "timeoutScoring": "double-loss",
      "clockModelRef": null
    }
  },
  "latestPolicy": {
    "fieldMaxAgeDays": 30,
    "marketMaxAgeDays": 7,
    "marketStalenessBlocksStrength": false
  },
  "contentHash": "sha256:0000000000000000000000000000000000000000000000000000000000000000"
}
```

Manifest hashing uses the same canonical JSON rules as snapshots, excludes `manifestId` and `contentHash`, and includes `environmentKey`. `manifestId` is constructed only after the full hash is known. This permits multiple reviewed revisions for one logical environment key and date without collision or overwrite.

The v1 policy floor is 200 valid completed games per seat for every required matchup. A Manifest may require more but not less. Changing the floor or freshness defaults requires a new policy version and therefore a new Manifest hash; the values are never hidden in code.

The v1 modes are `simulate` and `observed`. For `mode: simulate`, `observedMatchupRefs` are calibration evidence only and never replace candidate-specific simulations. For `mode: observed`, a native immutable matchup reference satisfying the scoreable-cell contract is required and no simulation jobs are generated. `proxyPriorRef` must be `null` in an official environment and must be an explicit `{snapshotId, contentHash}` reference in a proxy environment; the referenced cells must also pass the scoreable-cell contract.

Tournament round and timeout policy belong to the environment. A computational turn budget is not a clock model. When `clockModelRef` is `null`, the report must state that real-time tournament timeout is uncalibrated and cannot claim full tournament-match strength.

Each opponent entry maps one archetype to one or more representative deck snapshots. Multiple lists require explicit within-archetype weights that sum to 1. Equal weighting is never inferred.

An official SC Manifest permits SC field evidence and environment-legal simulation. It cannot reference an EN field or EN matchup prior. A proxy Manifest may do so only with `kind: proxy`, an explicit prior reference, and an ID that cannot be mistaken for official SC.

## Storage layout

```text
.cache/jihuanshe/raw/                         optional local raw captures; ignored
data/mappings/jihuanshe/                     versioned label mappings
data/sources/sc/jihuanshe/tournaments/       normalized SC event snapshots
data/sources/sc/jihuanshe/market/            normalized SC market snapshots
data/sources/en/<provider>/                   normalized EN source snapshots
data/derived/fields/                          immutable derived field snapshots
data/environments/                            immutable Environment Manifests
data/environment-aliases/                     small mutable alias pointers
sim/results/environments/                     environment-pinned simulation reports
```

Normalized snapshots intended to serve as project evidence are reviewable repository data. Refresh keeps raw capture data in memory by default and does not echo it on failure. An explicit `--retain-raw` diagnostic option may write it under `.cache/jihuanshe/raw/` with a `0700` directory and `0600` file mode. Retained raw data is local, is never referenced as a tracked artifact, and is deleted manually after diagnosis; no automatic retention is assumed.

## Data flow

### Refreshing SC data

1. The owner or a future scheduler explicitly invokes an SC refresh command.
2. The outer layer acquires a `refresh-publication` transaction lock.
3. The capture subprocess independently acquires the existing `avd-drive` lock before touching Android. The two lock names are distinct; lock order is always refresh then AVD, so the outer process never self-deadlocks the capture child.
4. Capture records the initial lifecycle state as `offline`, `headless-existing`, or `visible-existing`. If offline, it starts the fixed AVD headlessly and atomically records an exact-process lifecycle lease in the AVD-lock metadata before navigation. The lease contains AVD name, serial, PID, process-start token, launch mode, and `startedByInvocation: true`.
5. It captures the requested surface through `tools/jihuanshe_capture.mjs`, performs invocation-owned emulator cleanup while still holding `avd-drive`, releases that lock, and only then returns a machine-readable result to the outer refresh process. The outer process never stops the emulator after a normal child return. If the child exits without a result, the outer process first proves the lock owner dead, reacquires `avd-drive`, reads and revalidates the persisted process-start token, and may then clean only that leased process.
6. The normalizer converts the returned raw envelope into candidate snapshots in memory while the outer refresh-publication lock remains held.
7. Contract, edition, metagame-region, language, mapping, coverage, deduplication, and hash validation run.
8. Valid snapshots are published atomically.
9. The outer process releases the refresh-publication lock after publication or failure reporting. A pre-existing emulator is always left alone.

Simulation is not part of this flow. A failed or offline refresh cannot interrupt a simulation against an already selected immutable environment.

Source snapshot publication uses a temporary file in the destination directory, write and file `fsync`, atomic rename, then directory `fsync`. Publishing an already-existing identical ID/hash is idempotent. A different full hash under the same prefix-derived ID fails. Source refresh does not modify an environment alias because no new Manifest exists yet. The next refresh removes stale temporary files left by a crash before retrying; it never infers success from their presence.

Every refresh writes exactly one sanitized JSON result to stdout:

```json
{
  "schemaVersion": 1,
  "status": "ok",
  "stage": "complete",
  "code": "ok",
  "lifecycle": {
    "stateBefore": "offline",
    "startedByInvocation": true,
    "launchMode": "headless",
    "cleanedUp": true
  },
  "published": {
    "snapshotIds": []
  },
  "warnings": []
}
```

Failure uses the same envelope with `status: error`, a stable `stage` and `code`, and safe structured `details`; raw capture text is never printed. Stages are `lock`, `capture`, `normalize`, `validate`, `publish_snapshot`, and `cleanup`. Stable refresh codes include `lock_busy`, `reauth_required`, `ui_contract_changed`, `unsupported_capture_schema`, `event_identity_ambiguous`, `normalization_failed`, `snapshot_validation_failed`, `snapshot_publish_failed`, and `cleanup_failed`. Exit code 0 means success, 2 means `reauth_required`, and 1 means another failure. Publication fields state exactly what, if anything, completed before failure.

### Reauthentication

Normal refresh uses the persistent AVD login in headless mode. If the capture returns `reauth_required`:

1. no snapshot or alias is changed;
2. an explicit `reauth` command first acquires the same `avd-drive` lock and fails with `lock_busy` rather than interrupting a capture;
3. it enters a lifecycle state machine for `offline`, `headless-existing`, `visible-existing`, or `visible-started`;
4. because invoking `reauth` explicitly authorizes the transition, it may stop only the verified fixed `JiHuanShe_SC` headless instance after rechecking its process-start token under the lock, before starting the same AVD visibly; it never stops another AVD or an unverified process;
5. it opens the official login flow and the owner enters the phone number and SMS code in the app;
6. the command verifies that the authenticated home state is visible;
7. the visible emulator can be closed, and later refreshes return to headless operation.

The system does not store the phone number or SMS code and does not read, export, or replay session tokens.

### Building an environment

1. Select normalized full-field events for a format and `asOf` boundary.
2. Build and validate an immutable field snapshot.
3. Select rules, card pool, banlist, construction, simulation-capability, market, and representative deck snapshots.
4. Create an immutable Manifest whose references include the expected hashes.
5. Validate the complete Manifest.
6. Atomically point `SC/latest` or `EN/latest` at it when freshness and completeness policy pass. Environment alias publication uses `{alias, manifestId, manifestHash, updatedAt}` with same-directory temp write, `fsync`, rename, and directory `fsync`; it is separate from source refresh.

Explicit historical `manifestId` values remain valid for reproduction. Freshness is enforced when resolving `latest`, not used to invalidate history.

## Environment resolution and failure policy

The resolver performs these checks in order:

1. resolve an alias to one immutable `manifestId`, or validate a directly supplied `manifestId` and full hash;
2. verify the Manifest hash and every referenced snapshot hash;
3. verify the allowed edition/metagame-region/language combination, format, time boundary, and evidence-kind compatibility;
4. apply `latest` freshness policy when an alias was used;
5. validate candidate and representative deck hashes against card pool, rules identity, rotation, construction policy, and banlist;
6. validate every used card and known engine/policy limitation against the pinned simulation-capability snapshot;
7. verify complete full-field coverage, unique event keys, and canonical archetype mapping;
8. verify representative-deck coverage and within-archetype weights;
9. verify native or proxy matchup references, completed-game floor, required matchup coverage, round policy, and clock-model status;
10. emit a fully concrete simulation plan or a clearly diagnostic plan when the caller explicitly permits the closed capability gate.

Stable machine-readable failures should distinguish at least:

- `environment_not_found`;
- `snapshot_hash_mismatch`;
- `snapshot_id_collision`;
- `environment_identity_mismatch`;
- `stale_latest`;
- `field_not_representative`;
- `duplicate_event`;
- `unresolved_mapping`;
- `illegal_deck`;
- `card_pool_unverified`;
- `card_rules_identity_mismatch`;
- `simulation_not_ready`;
- `simulation_result_mismatch`;
- `missing_representative_deck`;
- `insufficient_matchup_coverage`;
- `clock_model_unavailable`.

Resolver errors use `{status, code, stage, path, details}` with safe details and a non-zero exit. Alias resolution accepts an explicit `now` for deterministic freshness tests. Warnings never substitute for a required input. When a warning affects the official score, the score is withheld instead of calculated from a silently reduced denominator.

## Simulation and EV integration

### Invocation boundary

Environment-aware evaluation adds a new orchestration path that requires an explicit `manifestId` or alias. Existing direct A/B simulation remains available for low-level matchup work.

The environment path must not default to SC or EN when no environment is supplied. For backward compatibility, the current no-argument `tools/ev_analysis.py` legacy path remains available, but its output must prominently identify `evidenceStatus: legacy_unverified` and `sourceEdition: EN`; it cannot publish an Environment Manifest. Explicit matrix paths retain their matrix provenance. A regression test locks this compatibility behavior.

### Simulation plan

For `mode: simulate`, each field archetype is expanded from every explicitly weighted representative list into two fixed-seat candidate-vs-opponent jobs: candidate on play and candidate on draw. Each job independently reaches the completed-game floor. Jobs use common simulation settings and include:

- candidate and opponent deck snapshot IDs, artifact content hashes, and gameplay hashes;
- environment and Manifest hashes;
- engine and policy revision;
- seat assignment for play/draw control;
- seed schedule, completed-game target, computational turn budget, and strategy;
- field and within-archetype weights.

The existing seat-based play/draw mechanism remains authoritative. `MatchConfig.firstPlayer` is not used as an environment control. The adapter validates every stored game's actual `aOnPlay` value against the requested fixed-seat job; an invalid `--first` value or any seat drift fails instead of falling back to alternating seats.

Baseline and tech-slot variant runs use an identical seed schedule for every `archetype × representative deck × seat` stratum. This preserves the existing common-random-number pairing and is required for variant deltas and paired confidence resampling.

Before launch, the plan validates the pinned simulation-capability snapshot and every candidate/opponent card. Legal but unencoded, rules-mismatched, or capability-blocked decks return `simulation_not_ready`; they are never simulated as weakened vanilla substitutes.

### Job and result interface

The resolved plan has its own `planHash`. Each concrete job derives a `jobId` from the plan hash, candidate/opponent artifact and gameplay hashes, fixed seat, seed schedule, strategy, completed-game target, engine revision, and computational limits.

The runner materializes immutable job-specific deck inputs from the referenced snapshots and never treats a mutable caller path as authoritative. Environment results are written atomically to a job-unique path under `sim/results/environments/<manifestId>/<jobId>.json`; the legacy `sim/results/last-run.json` may still serve direct A/B mode but is never consumed by environment aggregation.

A result echoes `jobId`, `planHash`, every input/content/gameplay hash, engine/policy revision, requested settings, actual settings, and per-game seed, seat, outcome, and termination cause. Before aggregation, the orchestrator validates the echoed values, fixed-seat invariant, completed-game count, unique output path, and result content hash. A stale, concurrent, partial, or mismatched result fails with `simulation_result_mismatch`.

### Strength calculation

For archetype `a` with field share `s_a`, representative deck `d` with within-archetype weight `w_ad`, and simulated candidate win rate `WR_ad`:

```text
EV_play = sum_a s_a * sum_d w_ad * WR_play_ad
EV_draw = sum_a s_a * sum_d w_ad * WR_draw_ad
```

The report presents `EV_play` and `EV_draw` as primary results. An overall diagnostic may be calculated only from the Manifest's explicit turn-order weights:

```text
EV_overall = play_weight * EV_play + draw_weight * EV_draw
```

A `round_timeout` produced by a calibrated tournament-clock model is scored according to the Manifest. For the accepted SC Swiss policy it is a loss for both players and therefore a candidate loss. Valid win rates include wins, losses, and scored `round_timeout` outcomes rather than decided games only.

`turn_budget_exhausted`, repeated-state give-up, `illegal-command`, invalid state, command ceiling, process failure, and every other non-normal engine termination are `unfinished` or `tool_failure`, never `round_timeout`. Classification checks the termination cause before any budget comparison. Such outcomes do not enter the win-rate denominator and invalidate the affected matchup cell until their cause is fixed and the completed-game floor is met.

When no calibrated clock model exists, the report may calculate a labelled game-resolution diagnostic from normally completed games, but must emit `clock_model_unavailable` for full tournament-match strength. A computational turn budget is never presented as 30 elapsed minutes.

No score is emitted until field share, representative-deck, and completed matchup coverage are all 100% under the Manifest policy. Missing shares are not renormalized.

The environment path does not call the existing `field_ev()` normalization unchanged: it first requires shares to sum to 1 under the complete-field contract and then applies the weights without renormalization. Timeout-bearing simulated matrices also bypass the legacy mirrored-zero-sum consistency check and Nash solver, because double-loss outcomes allow opposing win rates to sum to less than 100%. The candidate-side weighted formula above remains valid.

### Confidence and reproducibility

Each matchup reports win/loss/round-timeout/unfinished/tool-failure counts, games by seat, and a Wilson 95% interval over valid scored outcomes. The aggregate report derives a `simulationMonteCarlo95` interval by resampling within each fixed `archetype × representative deck × seat` stratum while holding Manifest field and representative-deck weights fixed. Variant deltas resample common-seed pairs together. The bootstrap seed and replicate count are pinned, so regeneration is reproducible.

When a proxy or native observed mode satisfies the scoreable-cell contract, it uses the same fixed strata and weights but derives `observedSampling95` from a pinned parametric binomial resampling of each cell's explicit counts. It cannot produce a paired tech-slot interval unless the source exposes a genuine paired design.

This interval describes simulation Monte Carlo error only. It does not claim to include uncertainty in event selection, field shares, representative-deck choice, pilot population, engine bias, or clock calibration.

Every report records:

- requested alias, logical environment key, resolved immutable Manifest ID, and full Manifest hash;
- Manifest and source snapshot hashes;
- official or proxy status;
- candidate and opponent deck hashes;
- engine, policy, simulation, and reporting configuration;
- field and matchup coverage;
- empirical, simulated, and proxy evidence labels;
- simulation-capability status and blocking limitations;
- tournament-clock calibration status;
- play, draw, and explicitly weighted overall results;
- report content hash.

### Cross-environment comparison

The same candidate deck can be resolved and evaluated once per environment. The comparison view aligns SC and EN outputs side by side and may show their difference, but it does not combine them into a single ranking or population.

If a candidate is illegal in one environment, that environment reports `illegal_deck`; it is not removed from the comparison denominator.

## Reliability and operational behavior

- Captures and alias publication are serialized and atomic.
- A failed candidate snapshot never replaces the last valid alias.
- Parser or UI drift is reported as a source failure and preserves the last good snapshot.
- A capture started by the refresh layer is cleaned up on success, error, `SIGINT`, and `SIGTERM` paths to the extent supported by the existing AVD lifecycle.
- Market failure does not block tournament normalization or strength evaluation.
- Tournament failure does not manufacture a field from market or historical Top Cut data.
- Historical explicit Manifests remain reproducible when newer data arrives.
- A normal simulation neither checks JiHuanShe online state nor starts Android.

## Security and privacy boundary

- Read only data rendered to the authenticated owner through JiHuanShe's visible UI or WebView.
- Do not inspect cookies, local/session storage, request headers, app-private files, SMS data, or authentication tokens.
- Do not reproduce private signing or crypto interceptors found through static analysis.
- Do not persist phone numbers, SMS codes, credentials, or session material in repository data, logs, fixtures, or reports.
- Sanitize saved test fixtures and omit participant handles, reversible handle hashes, and entire raw result rows from tracked canonical field data.
- Keep raw captures in memory by default. Explicitly retained raw captures stay local with restrictive permissions and are treated as potentially containing public handles and submitted deck information.
- Record source provenance without claiming that app-visible data is official publisher data.

## Compatibility and migration

### Existing JiHuanShe tools

The capture and reader remain low-level acquisition utilities. The new refresh/normalization layer composes them rather than moving environment logic into them. Existing `collect market`, `collect tournaments`, `status`, `start`, and `stop` diagnostics remain useful.

### Existing simulation

Current `scripts/simulate.sh --a A.json --b B.json` and comparison modes remain available. Environment evaluation is additive and produces concrete jobs for the existing harness. The underlying engine interface remains unchanged.

### Existing EV matrix

`data/op16-matchup-matrix.json` is not silently relabelled as SC. A one-time adapter may emit an EN empirical snapshot only when it can assert source population, format, dates, share denominator, and matchup semantics. Any unresolved requirement yields `evidenceStatus: legacy_unverified`; that artifact may support historical inspection but cannot enter an official environment or serve as a proxy prior.

The current file lacks enough structured share-date/denominator and per-cell sample metadata to pass that gate, so its initial classification is `EN_LEGACY_UNVERIFIED`. Its applicability is not called `proxy`: `proxy` is reserved for evidence intentionally applied across editions. Its `unmodelled_field` share is preserved and cannot be renormalized away.

The environment-aware EV path requires an explicit environment. The legacy direct-matrix path remains for reproducibility, including its current no-argument entry point, but every output is labelled with its evidence limitations.

A native EN v1 Manifest requires a reproducible normalized EN field source, such as a checked Limitless acquisition with event dates and participant denominators, plus edition-legal representative decks. If that acquisition is not complete, v1 may demonstrate the EN contract with sanitized fixtures and expose the current data only as `EN_LEGACY_UNVERIFIED`; it must not claim a live native EN result.

### Documentation

Implementation must update README and project context so that:

- SC remains the project objective;
- SC and EN field data are no longer described as interchangeable;
- empirical, proxy, and simulated evidence remain visibly distinct;
- the JiHuanShe reader is described as acquisition, not canonical field data;
- environment-aware commands and reauthentication behavior are discoverable.

## Testing strategy

Implementation follows test-driven development. Required coverage includes:

### Contract and normalizer tests

- valid SC tournament and market fixture normalization;
- cross-language golden deterministic snapshot IDs and RFC 8785 hashes, including key order, Unicode NFC, omitted versus `null`, `1`/`1.0`, negative zero, exponent notation, and hash-prefix collision rejection;
- exact SC game/language preservation;
- separate typed `results` and `field` evidence blocks;
- unknown archetype and card labels;
- missing participant counts;
- positive `full-field` proof, denominator/percentage consistency, and Top Cut/unknown rejection;
- repeated event-key idempotence and conflicting-version rejection;
- ambiguous fallback event identity rejection;
- date-only JiHuanShe events retain day precision and use local-day inclusion without invented UTC;
- market `visible-viewport` coverage rather than false completeness;
- sanitized fixtures with no authentication material;
- no participant handle, reversible handle hash, or entire raw row in tracked output;
- parser/UI drift producing a non-publishing failure.

### Refresh and lifecycle tests

- distinct refresh-publication and AVD-drive locks with fixed ordering;
- exact-process lease returned on every capture failure path;
- abnormal capture-child exit recovers only the persisted leased process after stale-owner and process-token verification;
- standalone capture cannot enter between refresh capture cleanup and AVD-lock release;
- offline, headless-existing, headless-started, visible-existing, and visible-started state transitions;
- cleanup stops only the invocation-owned process;
- `reauth` transition from a verified running headless fixed AVD;
- `reauth` returns `lock_busy` while another capture holds the AVD lock;
- stable `RefreshResult` stage/code/exit-code contract without raw capture leakage;
- crash before or after source-snapshot publication, stale-temp recovery, and idempotent retry without changing an Environment alias;
- same-directory atomic rename and collision refusal.

### Field builder and resolver tests

- participant-count aggregation over multiple full-field events;
- total-participant denominator and no silent renormalization;
- duplicate event-key refusal and explicit evidence-version selection;
- immutable `{snapshotId, contentHash}` reference and hash validation;
- multiple Manifest revisions for one environment key receive distinct hash-derived IDs;
- crash between validated Manifest publication and Environment-alias publication, followed by idempotent recovery;
- DeckSnapshot artifact `contentHash` versus `gameplayHash` semantics;
- valid edition/metagame-region/language combinations and JP exclusion in v1;
- injected-clock, timezone, inclusive `asOf`, and freshness-boundary behavior;
- stale `latest` versus valid explicit historical Manifest behavior;
- SC/EN source isolation;
- explicit proxy acceptance and official-SC proxy rejection;
- edition-specific card-pool, rules-identity, construction, and banlist checks;
- simulation-capability gate for legal but unencoded or policy-blocked cards;
- ClockModelSnapshot applicability validation and null-model fail-closed behavior;
- native observed/proxy scoreable-cell validation, including exact deck hashes, seat split, counts, and timeout policy;
- representative deck and within-archetype weight validation;
- market failure not blocking strength;
- every stable failure code.

### Simulation orchestration and report tests

- deterministic expansion of one candidate into environment matchup jobs;
- two fixed-seat jobs, actual `aOnPlay` validation, and completed-game floor per seat;
- invalid `--first` rejected instead of silently alternating;
- common seed schedules and paired resampling for baseline/variant comparisons;
- a prevalidated `round_timeout` cell counted according to policy without treating turn budget as elapsed time;
- late tool failure, repeated-state give-up, command ceiling, and turn-budget exhaustion never classified as round timeout;
- timeout-bearing simulation data rejected by legacy zero-sum consistency and Nash paths;
- exact field and within-archetype weighting;
- environment path refuses incomplete shares before the existing normalization behavior;
- score withheld for incomplete field, deck, or matchup coverage;
- official score withheld while simulation capability or clock calibration is blocked;
- SC and EN side-by-side output without blending;
- environment, deck, engine, seed, and source provenance in results;
- job-specific immutable deck inputs, echoed plan/input hashes, atomic unique result paths, and stale-result rejection;
- deterministic stratified and paired confidence regeneration;
- preserved no-argument legacy EV behavior with `legacy_unverified` labelling.

### End-to-end fixture test

A sanitized SC fixture flows through normalization, field building, Manifest resolution, deterministic small matchup results, and the final strength report without Android or network access.

### Live smoke test

Live JiHuanShe capture is manual and excluded from CI. It verifies headless refresh with the current valid session. The visible `reauth` flow is exercised when the session naturally expires; otherwise its window-launch and navigation path is checked without logging out or invalidating the owner's session. Live results are reported separately from automated tests.

## Delivery phases

### Phase 1: Contracts and immutable environment foundation

- add versioned snapshot and Manifest contracts;
- add deterministic hashing and validation;
- add DeckSnapshot, edition-specific legality, and SimulationCapabilitySnapshot contracts;
- add field builder and environment resolver;
- add sanitized fixtures and fail-closed tests.

### Phase 2: JiHuanShe normalization and refresh lifecycle

- add pure tournament and market normalizers after the existing capture;
- add canonical mapping registries;
- add completed-event enumeration and capture by stable event identity;
- add typed full-field proof and duplicate-event rejection;
- publish validated SC snapshots atomically;
- add high-level headless refresh and visible `reauth` commands;
- add stable refresh results, two-lock ordering, lifecycle leases, and ownership-aware cleanup.

### Phase 3: Environment-aware simulation and reporting

- add explicit environment orchestration above the existing simulator;
- validate legal candidate and representative decks;
- enforce engine/policy capability and clock-calibration gates;
- emit fixed-seat play/draw matchup jobs, common-seed variant pairs, and field-weighted reports;
- separate round timeout from unfinished/tool failure and keep timeout-bearing data out of Nash;
- add SC/EN side-by-side comparison and explicit proxy labelling.

### Phase 4: Legacy EN migration and documentation

- classify the existing matrix as `EN_LEGACY_UNVERIFIED` unless a checked adapter can prove every missing contract field;
- add or reuse a reproducible normalized EN field source rather than treating the legacy matrix as native EN;
- create native EN and SC Manifests only when their evidence is complete;
- update README, charter/context, and operator documentation;
- run all task-relevant Node, Python, simulation, and documentation validations.

Each phase lands only after its own contract tests pass. A later phase cannot weaken an earlier fail-closed boundary.

## v1 acceptance criteria

1. A valid persisted JiHuanShe login can refresh selected SC tournament and market snapshots without opening a visible emulator.
2. An expired login returns `reauth_required`; a visible `reauth` command allows the owner to enter the SMS code once and then return to headless operation.
3. Normal simulation runs entirely from local validated snapshots and never starts Android.
4. A candidate deck that is legal and simulation-ready in both environments can produce separate SC and EN play/draw reports; an environment where it is illegal or unsupported returns the specific failure instead.
5. Every report pins the immutable environment, inputs, decks, engine, simulation settings, coverage, and hashes.
6. Native SC fails closed on incomplete, duplicate, non-full-field, or mismatched SC evidence.
7. Any EN prior used for SC appears only in an explicitly named proxy environment and result.
8. Top Cut data never produces field share.
9. Market prices remain available as independent metadata and never affect strength.
10. Existing direct A/B simulation continues to work.
11. The existing no-argument EV command remains reproducible but is visibly labelled `legacy_unverified` and cannot feed a native or proxy environment.
12. Known engine/policy or clock-model blockers yield `diagnostic_estimate` or no score, never an unqualified tournament-strength claim.
13. Native EN is published only from reproducible normalized EN evidence. Without it, the current matrix is available only as an `EN_LEGACY_UNVERIFIED` historical report and no Environment Manifest is generated; a proxy environment requires a separate validated cross-edition prior and can never be synthesized from that legacy artifact.

## Deferred extensions

- scheduled refresh after the command path is proven reliable;
- an environment and market UI;
- automatic environment-internal ranking of many candidate decks;
- richer event-selection and recency-weighting policies;
- a local event database if immutable JSON snapshots become operationally limiting;
- participant-level local analysis under a separate privacy policy;
- additional regional editions through new source adapters.

These extensions must reuse the same immutable contracts and cannot weaken region isolation or provenance requirements.
