# Environment data: evidence classes, commands, and boundaries

The one rule this whole layer exists to enforce:

> **Every number carries the class of evidence it came from, and classes never mix.**
> An SC empirical field share, an EN proxy, a simulated win rate, a market price and the legacy
> EV matrix are five different kinds of claim. The layer refuses to blend them, and refuses to
> present one as another.

The objective is unchanged: **field the highest-EV deck in the Simplified Chinese (简中) Standard
Block 2+ format.** SC is the target environment. Everything else — EN shares, EN ladder matchups,
the legacy matrix — is at best a proxy, is labelled as one, and cannot become SC by being copied
into an SC-shaped file.

## The six evidence classes

| Class | What it is | Where it lives | May set field share? | May score strength? |
|---|---|---|---|---|
| **Empirical field** | Real participant counts and archetype rows from a completed event | `tournament_event` → `field` snapshots | **Yes**, when the frame is `full-field` | No — it is the *weights*, not the win rates |
| **Empirical matchup** | Real recorded results between two decks | `matchup` snapshots, `matchupPolicy.mode: "observed"` | No | Yes, when every cell is scoreable |
| **Simulated** | Engine games under a fixed seed schedule | `environment-raw-job-result` → report | No | Yes, but see *strength claims* below |
| **Proxy** | Another edition's matchup evidence, borrowed explicitly | `matchupPolicy.proxyPriorRef` only | **No** | Only in a Manifest whose `kind` is `proxy` |
| **Market** | Prices and indices | `market` snapshots | No | **Never** — metadata only |
| **Legacy** | `data/op16-matchup-matrix.json` | that file alone | **No** | **No** |

Two structural facts behind the table:

- **A proxy borrows matchups, never a field.** v1 confines cross-edition borrowing to the named
  `matchupPolicy.proxyPriorRef`. Every other reference in a proxy Manifest — including
  `references.field` — must match the Manifest's own native identity. Widening that needs three
  sites changed together and is documented in `environment/manifest.mjs`.
- **Market evidence is inert by construction, not by convention.** It reaches the report only as
  `metadata.marketRefs`, alongside `marketEvidenceUsedForStrength: false`.
  `tests/environment-e2e.test.mjs` proves the inertness: it runs the whole pipeline twice against
  two different market fixtures and asserts every EV, confidence, stratum and coverage value is
  identical while the Manifest hash and the market refs both change.

  Three facts about the two market warnings, because the obvious reading of them is wrong:
  1. **`market_unavailable` is unconditional.** `environment/resolver.mjs` pushes it from the catch
     around the market load and never consults `marketStalenessBlocksStrength`. An unreadable or
     absent market artifact is always a warning, whatever the Manifest says.
  2. **`marketStalenessBlocksStrength` does not turn `market_stale` into a blocker — it REFUSES the
     run.** With the flag set, stale market evidence raises `stale_latest` and **no report is
     produced at all**. A blocker-bearing `diagnostic_estimate` is not what happens.
  3. **Neither warning is reachable when resolving by `--manifest-id`.** The whole market check sits
     behind `if (selector.mode !== "alias") return;`, because freshness is an ALIAS policy: an
     explicit historical Manifest stays reproducible forever. Resolve by alias if you want the
     market staleness signal.

## Strength claims: what the pipeline can and cannot say today

A report carries `evaluationMode` (`official` | `diagnostic_estimate` | `proxy`) **and,
separately**, `officialStrengthClaim` with `strengthClaimWithheld`. They are not the same thing, and
today the second is always the conservative one.

**`proxy` is the third value and it is easy to miss.** `environment/resolver.mjs` emits it for a
Manifest whose `kind` is `proxy` and which was not otherwise degraded. Code that branches on
`evaluationMode !== "diagnostic_estimate"` therefore mis-classifies every proxy report as official.
Test `officialStrengthClaim` for the claim, and `evaluationMode === "official"` — never its
negation — for the mode.

**Nothing in this repository produces an unqualified official tournament-strength claim.** Two
independent gates stand in the way, and both are honest reflections of the engine's state:

1. **The clock gate, which REFUSES before it degrades.** A round-timeout claim needs an *accepted,
   effective* ClockModel for the environment's stage and round length. **Nothing here infers a
   ClockModel yet** — there is no clock-model builder wired to real elapsed-time data — so a real
   environment has no accepted model and the gate closes. Without `--allow-diagnostic` that is a
   hard `clock_model_unavailable` failure and **there is no report**; only WITH the flag does the
   run continue as a `diagnostic_estimate` carrying blocker `clock_model_unavailable`. The gate has
   two closed states and they report different reasons: `clock_model_absent` when
   `roundPolicy.clockModelRef` is null, `clock_gate_closed` when a real model's effective interval
   has expired. This matters because a timed-out round in this format is a **double loss**, not a
   draw, so an unmodelled clock is a missing outcome class rather than a rounding error.
2. **The round-timeout adjudication.** Even *with* an accepted ClockModel — `evaluationMode` then
   reads `official` — the claim is still withheld, because no adjudicator has actually run over the
   games. `blockers` then carries `round_timeout_unadjudicated`, and the report records
   `timeoutAdjudication: { applied: false, applicable: true }`. An unadjudicated zero is unmeasured,
   not measured, and the artifact says so instead of leaving a reader to infer it.

   **The two blockers are mutually exclusive, not alternatives.** `round_timeout_unadjudicated` is
   pushed only when `evaluationMode === "official"`, and an environment whose clock gate closed is
   never `official`. So a `diagnostic_estimate` carries `clock_model_unavailable` and can never
   also carry `round_timeout_unadjudicated`; a report carrying the second is in `official` mode by
   construction.

   **An adjudication must have EVALUATED the games, not merely been supplied.** Every adjudicated
   cell states `evaluatedSeeds`, the number of completed games the clock model actually looked at,
   and the orchestrator reconciles it against the games that cell really played while
   `aggregateEnvironment` reconciles the total against the games the report aggregates — the same
   treatment `adjudicatedCells` and the clock reference already get. "The model ran and found no
   timeouts" stays expressible (`evaluatedSeeds` = every game, `adjudicatedSeeds` = 0); a block of
   empty cells does not, and is refused with
   `round_timeout_adjudication_unevaluated` /
   `round_timeout_evaluated_seed_count_mismatch`.

**The capability gate** is the third source of diagnostic output. `evaluateCapabilityGate` reads the
reviewed-limitation list on the capability snapshot; **any limitation still `status: "open"` degrades
the run to `diagnostic_estimate`** (and, without `--allow-diagnostic`, refuses it outright with
`simulation_not_ready`).

**The register, not the prose, is the gate — and the two must agree row for row.**
`data/environment-definitions/simulation-limitations-v1.json` carries **four** reviewed rows for the
five defects `docs/simulation.md` documents. **Three are open and one is closed**, so the gate is
still closed:

| Row | Status | Covers |
|---|---|---|
| `second_player_first_turn_attack` | **closed** | the second player could illegally attack on their own first turn. Fixed by Phase 1 Task 1.1 (patch `battle: neither player may attack on their own first turn`), asserted per row by `neither player may attack on their own first turn` in `sim/puzzles.test.ts` |
| `counter_and_block_policy_missing` | open | one row, two defects, because the counter step and the block step are one resolver branch. **The counter half is fixed** (Phase 1 Task 1.2 gave the defender a real counter policy); **the block half is still true and now deliberate** (Task 1.3 — "blocking has no waste-free rule"). The row stays open on the block half alone |
| `trigger_activation_forced` | open | the resolver always activates a `[Trigger]` instead of choosing |
| `attack_target_policy_missing` | open | the bot cannot choose an attack target; every attack hits the leader |

**Half a fix does not close a row.** `counter_and_block_policy_missing` is the case that makes the
point: it is tempting to read "the bot now counters" as closing it, and doing so would hand an
`official` claim to a simulator that still never blocks. A row closes when every defect it covers is
gone, not when the most visible one is.

A closed row is **closed in place, never deleted**. The register keeps reading as the full list of
defects this gate has ever been asked about, `blockingLimitations` on the capability snapshot retains
all four, and `evaluateCapabilityGate` is the only thing that narrows them to the open subset.

Every row carries a resolvable `evidenceLocation` (a `docs/…#heading` anchor, checked by a test in
`environment/capability.test.mjs`), and closing all four is what opens the gate. A defect documented
as open with NO row would be invisible to `evaluateCapabilityGate`, so closing the recorded rows
would reach `official` while a real defect stands — do not describe a limitation as gated unless it
has a row.

### Who may close a row

Ratified 2026-08-22 as-is: four reviewed rows, three open (`counter_and_block_policy_missing`,
`trigger_activation_forced`, `attack_target_policy_missing`), one closed in place
(`second_player_first_turn_attack`). The capability gate stays closed.

- A closure that leaves **zero open rows** (the gate would open to `official`) needs Ping's
  sign-off. Do not implement that closure without it.
- A closure that leaves the **gate still closed** (at least one row remains open) may be
  implementer-made. Record evidence on the row (`evidenceLocation` and the closing change).
- Half a fix still does not close a row. Closed rows stay in place, never deleted.
- M-1, M-2, M-3, and M-5 stay deferred and documented. None of them touches a published number.

> **`blocksOfficialStrength` is descriptive metadata, NOT a gate — do not "fix" the code to make it
> one.** `environment/capability.mjs` filters on `status === "open"` alone and says why: a hash-valid
> snapshot with every limitation's flag flipped to `false` would otherwise slip into `official` while
> every limitation is still genuinely open. Measured: `{status: "open", blocksOfficialStrength:
> false}` still yields `diagnostic_estimate`, still reports `officialStrengthClaim: false`, and still
> refuses with `simulation_not_ready` absent `--allow-diagnostic`. The flag records *why* a
> limitation matters; `status` decides whether it binds. It therefore stays `true` on the **closed**
> row as well — it describes the defect class ("this is the kind of limitation that withholds an
> official claim while it stands"), not the current gate state, and keeping it invariant leaves
> `status` as the single degree of freedom, so the flag can never be mistaken for the switch.

Confidence intervals are equally explicit about what they do **not** cover —
`confidence.excludes` lists `field_selection_uncertainty`, `deck_choice_uncertainty`,
`pilot_skill_uncertainty`, `engine_fidelity_uncertainty` and `clock_model_uncertainty`. The interval
is sampling noise around a fixed seed schedule and nothing more.

## Cross-environment comparison

`compareEnvironments` returns exactly two things: each environment's own untouched report, and one
labelled `difference` in `play` / `draw` / `overall`. Its `confidence` and `denominator` are
`null` **on purpose** — two environments are two populations, so there is no joint sampling
distribution to draw an interval from and no shared denominator to state. There is no pooled EV, no
combined population and no cross-population ranking, and `tests/environment-e2e.test.mjs` asserts
the comparison's key set exactly so one cannot be added quietly.

## Commands

### Refresh SC source snapshots (headless)

```bash
# Read-only: AVD state, whether a refresh is in progress, how many snapshots exist.
node tools/jihuanshe_refresh.mjs status --root /path/to/scratch

# Publish immutable source snapshots. Headless: nothing in this path can open a window.
node tools/jihuanshe_refresh.mjs refresh tournaments --as-of 2026-08-20 --window-days 30 --root /path/to/scratch
node tools/jihuanshe_refresh.mjs refresh market --root /path/to/scratch

# Visible, owner-driven, one-time. The SMS code is typed into the emulator, never passed here.
node tools/jihuanshe_refresh.mjs reauth
```

**Routine refresh is headless; a visible emulator appears only for owner-driven reauthentication.**
An expired session ends a refresh with code `reauth_required` and exit `2` — it never opens a window
to fix itself. Full surface, locking model and privacy contract: `docs/jihuanshe-reader.md`.

> **Always pass `--root`.** `--root` defaults to *this checkout*, and `data/sources/` is **not**
> gitignored. A bare `refresh` therefore publishes tracked-looking files into the working tree and
> dirties it. Use a scratch root for anything exploratory; use the checkout only when the intent is
> genuinely to commit the snapshots.

> **A non-publishable provider event id is redacted at birth, so the id, the filename and the body
> agree.** A phone-number-shaped provider event id — or one outside the safe short-identifier
> charset — is replaced by a fixed `redacted` marker in the snapshot id stem, in the on-disk
> filename and in `source.sourceRef.providerEventId`, and the event key falls back to the
> identity-derived key so the event still dedupes against later captures of itself. The raw id is
> never hashed, encoded or stored, so the redaction is irreversible by construction rather than by
> cost. What remains is a fixed marker plus the snapshot's own 16-hex content hash.

> **The snapshot body is value-screened, not only key-screened.** The normalizer scans every
> free-text provider label — title, organizer, location, format and status labels, `sanitizedRoute`,
> and the market surface's card and query labels — for phone numbers, e-mail addresses, WeChat/QQ
> handles, `Authorization`/`Bearer`/token-like strings and over-long blobs, redacts the offending
> SPAN in place, and records `sensitive_value_redacted:<field>:<shape>` in the snapshot's
> `coverage.warnings`. It keeps the surrounding text and never fails the capture. It is **not** a
> personal-name detector, so free text is still free text: read what you are about to commit.

### Build and resolve an environment

```bash
node tools/environment_data.mjs build-deck     --root R --input deck.json
node tools/environment_data.mjs build-field    --root R --input events.json
node tools/environment_data.mjs build-manifest --root R --input manifest-draft.json [--alias SC/latest] [--now RFC3339]
node tools/environment_data.mjs resolve        --root R --selector SC/latest \
    --candidate-deck-id ID --candidate-deck-hash sha256:... [--allow-diagnostic] [--now RFC3339]
```

Every invocation prints exactly one sanitized JSON object on stdout and exits 0 or 1. No absolute
filesystem path ever reaches the output. `resolve` also accepts `--manifest-id` with
`--content-hash` instead of an alias, which is how a specific immutable revision is addressed rather
than "whatever the alias points at now".

### Evaluate and compare

```bash
node tools/environment_evaluate.mjs evaluate --plan PLAN[#KEY] --runner RUNNER \
    --results-root R --cache-root C [--now RFC3339]

node tools/environment_evaluate.mjs compare --mode variants     --plan SCENARIO --runner RUNNER ...
node tools/environment_evaluate.mjs compare --mode environments --plan A --plan B --runner RUNNER ...
```

`--plan` is always explicit: there is no default environment, no default edition and no default
alias anywhere in that command. `--mode variants` is the tech-slot A/B — one scenario carrying a
base arm and a variant arm over one seed schedule, which is the only design that yields a paired
interval. `--mode environments` is the side-by-side above.

## The legacy EV matrix: permanently legacy

`data/op16-matchup-matrix.json` predates this layer. It mixes **tournament** share data with
**ladder** matchup data, is EN, and its share denominator, matchup population and dates were never
reconciled to one another. It is therefore labelled, permanently and in the artifact itself:

```json
{ "evidence_status": "legacy_unverified", "source_edition": "EN",
  "applicability": "historical_only", "environment_eligible": false }
```

`python3 tools/ev_analysis.py` announces that before it prints a single number:

```
legacy-provenance: {"applicability": "historical_only", "coveredFieldPct": 88.29,
 "environmentEligible": false, "evidenceStatus": "legacy_unverified",
 "sourceEdition": "EN", "unmodelledFieldPct": 11.71}
```

Three things about it are load-bearing:

- **Coverage is 88.29%, and the other 11.71% is not modelled at all.** Both numbers are printed
  together, on one line, so the covered share can never be read as the whole field. The EV table's
  shares are renormalized *within* the covered part only.
- **The six EV values are frozen.** Relabelling provenance must not perturb the mathematics, so
  `tools/test_ev_analysis.py` pins `Nami 55.22451013704836`, `Luffy 46.310318269339675`,
  `Enel 48.71719334012913`, `Rosinante 46.57283950617284`, `Teach 52.82052327556915` and
  `Hancock 49.154094461433914` to 1e-6.
- **It can never become an Environment.** `buildManifest` refuses any artifact whose
  `evidenceStatus` is anything other than `verified`, in the artifact, its `source` or its `data`,
  for **both** `official` and `proxy` Manifests (`legacy_evidence_rejected`) — including through
  `matchupPolicy.proxyPriorRef`, the one seam that permits cross-edition borrowing at all. The
  command itself also refuses to run when **any of the four labels** is weakened: all of
  `evidence_status`, `source_edition`, `applicability` and `environment_eligible` are pinned in
  `PINNED_META_VALUES`, so relabelling this EN artifact as SC, or as currently applicable, exits
  non-zero instead of printing the weakened value. "Permanently legacy" is therefore enforced in two
  places rather than asserted in prose.

The tooling's job is unchanged from the 2026-08-17 decision: it does **not** pick the deck. It is
for tech-slot optimisation, field forecasting, and the tripwire.

## The live EN evidence boundary

No production EN Manifest exists and no `EN/latest` alias exists, deliberately.

A public Limitless tournament page **may declare the full event participant count while its
statistics and decklist rows cover only a smaller submitted or successful subset** — the entrants
who registered a list, or who finished, rather than everyone who played. If the denominator and the
rows describe different populations, the rows are a subset and the shares computed from them are
not field shares. That normalizes as **`top-cut` / subset evidence, not `full-field`**.

The consequence is a rule, not a preference:

- Top Cut pages, participant-count/decklist mismatches, unknown sample frames, incomplete archetype
  mappings, and Limitless subset statistics may be **retained as incomplete source evidence** and
  inspected.
- None of them may produce native EN field shares, an EN Manifest, or `EN/latest`.
- An EN Manifest waits for a reproducible source that supplies **complete participant-count field
  rows** — the denominator and the rows describing the same population.

`tests/fixtures/environment/end-to-end-en/` contains a **synthetic** EN event, marked
`fixture_only: true`. It exists to prove that a second environment stays separate from SC in the
code. It is not Limitless data, it is not any live EN source, and it can never justify an EN
Manifest. **A fixture-only EN run is not current live EN evidence and must never be reported as
one.**

## What is verified offline, and what is not

`node --test tests/environment-e2e.test.mjs` runs the entire chain with no device, no emulator, no
ADB and no network:

```
raw synthetic SC capture bytes -> normalizer -> FieldSnapshot -> SC Manifest -> resolve
                              -> plan -> injected fake runner -> report
synthetic EN event fixture     -> FieldSnapshot -> EN Manifest -> ... -> report
both reports                   -> one side-by-side comparison
```

It also enforces the acquisition boundary two independent ways: it walks the transitive import graph
and refuses any module that is, or imports, an acquisition module (or names ADB / an emulator /
Android), and it installs a loader hook that substitutes a **poisoned** `node:child_process` for
every repository module, so any attempt to start any process throws. Exactly one module in the graph
imports `node:child_process` at all — `environment/simulation.mjs`, which holds the real
`scripts/simulate.sh` runner — and the test asserts that by name.

**What that does not establish.** An offline fixture run proves the *contract*: identity, hashing,
weighting, separation, refusal. It says nothing about the real SC field, and a green E2E is not a
measurement of anything in the metagame. Live acquisition is a separate, owner-gated step.

## Fixed: an absent clock reference used to produce no report at all

A Manifest whose `matchupPolicy.roundPolicy.clockModelRef` was `null` resolved under
`--allow-diagnostic` and then produced **no report at all**: `environment/resolver.mjs`'s
`unavailable("clock_model_absent")` passed no `cause` while its three siblings all did, so the
blocker carried `cause: undefined`, `aggregateEnvironment` spread it into the payload it hashes, and
canonical hashing correctly rejected `undefined` (`canonical_unsupported_value`).

**Fixed** by supplying `"clock_model_ref_null"`. Both closed-clock paths now produce a
blocker-bearing `diagnostic_estimate`, and they are distinguishable: an absent reference reports
`reason: "clock_model_absent"`, while a real model whose effective interval has closed reports
`reason: "clock_gate_closed"`. Regression test: *"an ABSENT clock reference still produces a report,
and its blocker carries a cause"* in `tests/environment-e2e.test.mjs`, which asserts the report
exists and that the blocker's `cause` key is present and not `undefined`. Reverting the one-line fix
turns it red.
