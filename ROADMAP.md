# OPCG-Go roadmap

**As of:** 2026-08-21 · **Base:** `origin/main` @ `119cfe4` (PR #34, squash).
**Audience:** Ping, for sequencing the team. This is a forward plan, not a status rewrite of the
charter and not an implementation spec.

Read this file first. Detail lives in:

| File | Answers |
|---|---|
| [`docs/roadmap/horizon.md`](docs/roadmap/horizon.md) | Now / next / later, milestones, phase boundaries |
| [`docs/roadmap/path.md`](docs/roadmap/path.md) | Blockers, prerequisites, critical path, what waits on what |
| [`docs/roadmap/risk.md`](docs/roadmap/risk.md) | Assumptions, unknowns, failure modes, kill criteria |

Empirical competitive numbers stay in `docs/research-findings.md`. Simulated numbers stay in
`docs/simulation.md`. Do not mix them. Hard-won engine facts stay in `CLAUDE.md` — do not re-derive
them here.

---

## How to use this

1. Treat **Locked** and **Held** as constraints, not suggestions.
2. Pick work from **Now** that is unblocked. Do not start the **After #32** list until Ping
   releases that PR.
3. When a milestone lands, move the row; do not silently reopen a locked decision to make the
   table tidier.

---

## Locked — do not reopen

These are already decided. The roadmap sequences *around* them.

| Decision | Source |
|---|---|
| Format: SC Standard, Block 2+, Bo1, Swiss + top cut, 30-minute rounds. No sideboard in Constructed. | Charter; Ping 2026-08-17 |
| Banlist and rotation match EN/JP. That is legal-pool parity, not metagame parity. | Charter |
| Engine: fork `TheCardGoat/tcg-engines` (MIT). MOOgiwara rejected. | Charter; `docs/engine-audit.md` |
| Effect encoding: the existing compositional DSL. Park a clause rather than invent a verb. | Charter; `cards/ENCODING.md` |
| Objective: field-weighted expected match win rate vs the real SC field, split by play/draw. | Charter |
| That objective is **diagnostic, not selective.** It does not pick the archetype. | Ping 2026-08-17; `CLAUDE.md` |
| Chosen decks: **Ace (`OP16-001`) primary, Mihawk (`OP14-020`) secondary.** Owner preference. | Charter; research §4 |
| Tripwire is **qualitative**: a structural deficiency is decisional; a points gap is not. | Ping 2026-08-17 |
| Acquisition budget: **no ceiling** (2026-08-19). Cost is not a slot tiebreak. | `CLAUDE.md` (later than the charter's "TBD") |
| No event yet, so **no list-freeze deadline**. Build the engine properly. | Charter, answered 2026-08-17 |
| Policy-quality order: ladder → puzzles → rules/counters → Phase 2 remeasure → **meta calibration** → (deferred) oracle → (deferred) human. Steps 1–4 are done. | `CLAUDE.md` |
| Spend on a Tier-3 search lever only after measured policy quality is no longer the binding constraint. Lever **A–D is undecided**. | Audit; Ping 2026-08-19 |
| `patch_engine.py` is permanent. The `orderCards` fix stays local. Do not file issues on external repos. | `CLAUDE.md`; `docs/upstream/README.md` |
| SC-native field data is a **manual transcription** from the 集换社 iOS app. There is no scraper to build. | Ping 2026-08-19 |
| Singleton parked primitives stay parked. Next scoped primitives, in this order: `giveDonSourcePlayer` then `attachedDonTargetFilter`. | `CLAUDE.md`; `data/parked-clauses.json` |
| Attack-target selection was deferred (2026-08-19). Blocking and `[Trigger]` declining are open surfaces by decision, not oversights. | Fidelity plan; `docs/simulation.md` |
| Do not calibrate on ST01. Do not use `mihawk-green-proxy` to measure play/draw. Quote `ace-op16` −2.50 pts for that split. | `CLAUDE.md`; Phase 2 |
| **Now #1 (first meta calibration) is locked** — field, lists, scoring, sample. See the Now section. Do not hold it for 集换社. | Ping, grill 2026-08-21 |

---

## Reconciled status — README vs the tree

The README status table is the public snapshot. Several of its rows are **stale relative to
`CLAUDE.md` and `main` @ `119cfe4`**. This roadmap uses the tree, not the stale rows. The README
itself is outside this PR's file lock and is not updated here.

| README row (as written) | Tree on 2026-08-21 | Roadmap treats as |
|---|---|---|
| Engine audit **done** | Still done. Options A–D remain the undecided search lever. | Done. Do not re-audit. |
| Competitive research **done** | OP16 EN field + 213k-game ladder matrix are banked. SC-native *field* data is not. SC-native *rules* are (`data/rulings-sc.json`). | Research track done as an EN proxy. Charter's "corrected by SC-native sources" half is still open. |
| "OP15/16 *shells* generated, effects outstanding" / "OP15–OP17 absent from the engine" | **Stale.** PR #11 encoded both sets. 119 imported = 119 definitions each. Unencoded-and-unparked = 0. Ten parked clauses remain in `data/parked-clauses.json`. | Published-set encoding is complete. OP17 is unpublished, not missing. |
| Simulation harness **working** | True. Real Block 2+ decks complete. Phase 0–2 of the fidelity plan are done. No cross-deck meta calibration has been run. | Harness done. Calibration is the next policy-quality step. |
| Search AI **not started**; Tier-3 lever needs re-deciding | True. Cheap policy is `valueRanked` + a parameterised counter policy. Full-strength ISMCTS remains ~100× out of reach. | Not started. Do not pick A–D until calibration says the heuristic distorts matchups. |
| Ace primary, Mihawk secondary | Locked. | Locked. |

Charter Phase 1 ("current SC OP16, research-driven, no engine, deadline ~2026-08-23") described the
*research* track. The engine track was always parallel. Phase 1's research deliverable exists;
its date is a rotation date, not a list-freeze, because there is no event. Charter Phase 2
("engine + search AI as reusable infrastructure") is **half-done**: the engine and harness exist;
search AI does not.

---

## Held — PR #32

**PR #32** (`claude/mutation-operators-widened`, head `50b8522`) is **held**. Ping owns it locally.

- Do not merge, rebase, review-implement, or assign work onto that branch.
- Do not treat its 74.3% / 9,237-mutant figures as project record until Ping releases it.
- Standing pre-OP15 detectability figure on `main` remains the five-operator sweep: **62.3%**
  (4,307 mutants, 2,685 killed, 177 cards where no mutant died). Widening the instrument changes
  what the rate means; that is why #32 exists as its own branch.
- The OP15/OP16 mutation gate is already red on `main` for a known reason (committed `runs/OP15.jsonl`
  / `runs/OP16.jsonl` predate the operator widening). **Do not "fix" those records from an
  unrelated branch.**

Mentioned here only as a constraint. The pickup that becomes legal *after* Ping releases it is
at the bottom of this file.

---

## Charter-aligned stages

Sequence is the charter's, not a new one:

```
current SC OP16  →  engine + policy infrastructure  →  OP17 and later rotations
     (now)                    (now / next)                      (later)
```

| Stage | Charter meaning | State @ `119cfe4` | Horizon |
|---|---|---|---|
| Current SC OP16 | Field the Ace list; tech slots vs the real field | Research done (EN proxy). Ace list exists (`sim/decks/ace-op16.json`). No event. SC shares missing. | **Now** — finish the inputs the OP16 list still lacks |
| Engine + policy infrastructure | Forked engine, encodings, a play policy worth trusting, validation layers 1→3 | Engine + OP15/OP16 encodings + harness + policy *floor* exist. Layer 3 (meta calibration) has not been run. Search AI not started. Pre-OP15 encodings are not print-confirmed. | **Now / next** — calibrate and close the policy gaps that make slot measurements lie |
| OP17 and later rotations | Import → encode → rebuild Ace (and recheck Mihawk) → slot EV vs the new field | Bandai has not published OP17 (EN 2026-08-28, SC ~2026-08-23). `setBasePower` unblocks `OP17-005`. | **Later** — starts the day the official list is importable |

Done on `main` and not to be re-opened as work: engine audit; OP16 competitive research (EN);
OP15/OP16 encoding (PR #11); `setBasePower` and timed base-power replacement (#26, #31, #34);
Phase 0–2 of `docs/plans/engine-fidelity-and-derived-counter-policy.md`; policy ladder and
puzzle suite; 48 pre-OP15 *data* corrections; whole-trait matching (#30).

---

## Now / next / later

Full tables: [`docs/roadmap/horizon.md`](docs/roadmap/horizon.md).

### Now — unblocked on current `main`

Work a crew can start **without** #32 and **without** the official OP17 list.

#### Now #1 — first meta calibration (locked, Ping 2026-08-21)

It stays Now #1. Do not hold it for 集换社 or any other SC share table. This run is a
**measurement, not a gate**: a miss does not block Now #2–#5, does not pick a search lever, and
does not flip Ace.

| Lock | Decision |
|---|---|
| Field | Ace vs **Nami, G/B Luffy, Enel, and Teach**. Those four only. |
| Ace list | Freeze current `sim/decks/ace-op16.json` (the engine-buildable proxy). **Not** a Limitless Ace list. |
| Opponent lists | Freeze the **Limitless modal** lists for those four. Snapshot them before the run. Do not fetch live Limitless on the day of the run. |
| Sample | **400 paired games** per matchup. |
| Headline number | **Blended** sim WR vs the matching cell in the EN ladder matrix. |
| Play/draw | Record separately. Do not substitute either seat for the blended comparison. |
| Timeouts | **Drop timed-out games entirely.** Do not fold them in as double losses. Do not report a timeout rate. |
| Where results go | Simulation track only (`docs/simulation.md`, `sim/results/`). **Do not** write sim numbers into `docs/research-findings.md`. |

Full milestone text: [`docs/roadmap/horizon.md`](docs/roadmap/horizon.md) § N1.

| Pick | What | Why it is Now | Do not |
|---|---|---|---|
| **2. Scoped primitives** | `giveDonSourcePlayer` (10 OP15 clauses), then `attachedDonTargetFilter` (7). | The two remaining primitives that can be scoped from real cases. Not on the OP17 critical path. | Leave the other parked primitives parked. |
| **3. Catalog leftovers that bias play** | Ten missing `[Trigger]`s, **7 Standard-legal** (text **and** encoding together); `OP13-084` (correction + encoding + tests, now unblocked by `setBasePower`); EB04's 31 missing cards if a sim deck needs them. | Encoding-audit remaining order, items 4–6. A missing Trigger silently skips; text-only is a regression. | Do not add Trigger *text* without the encoding. |
| **4. Print-confirm the cards that will actually be simulated** | Read DSL against printed text + SC rulings for `sim/decks/ace-op16.json` and the four frozen Limitless modal lists from Now #1. | Pre-OP15 is encoded but not print-confirmed. The green suite is self-consistency. Mutation kill rate is detectability, not fidelity. | Do not launch an unbounded 1,771-card reread. Do not quote the suite as a conformance baseline. |
| **5. Research watch (not implementation)** | Recheck OP17 spoilers for Mihawk support. Watch Bandai for the official OP17 list. | CLAUDE.md next-action #1. Absence from spoilers is not absence from the set. | Do not encode OP17 from spoilers. Do not flip §4 to "Mihawk viable" without support. Do not hold Now #1 for this. |

Ping-owned, not crew-owned: 集换社 share pie + top-cut lists, pasted into the research track.
That paste weights later slot EV. **It does not gate Now #1.** Until it lands, every
share-weighted number stays an EN proxy and must be labelled as one.

### Next — first rotation, and anything gated on a release

| Pick | Gate | What |
|---|---|---|
| Official OP17 import | Bandai publishes the list | `python3 tools/import_cards.py --set OP17 --refresh`; diff against research §5; treat every spoiler row as provisional until then |
| Ace OP17 list | Official list + import | Skeleton = OP16 Red Ace; first slot `OP17-005` Newgate (the thesis); 1–2 `OP17-016` Rakuyo is the first slot question, not a locked include |
| Encode OP17 | Import exists | Same batch discipline as OP15/OP16. Park what will not fit. |
| Encode `OP17-005` | Import + existing `setBasePower` | The On Play is a buff (Leader 5000 → 8000). Do not re-reject it. |
| SC OP17 list-parity | Ping / official SC list | Open charter question: is SC OP17 the same list as JP/EN? |
| **After #32 pickup** | **Ping releases #32** | See below. Not assigned now. |
| Fidelity-plan Phase 3 | Calibration + honesty about attack-target bias | Derive counter *feature* weights. Size against Phase 2 numbers, not pre-Phase-1. A near-zero "keep a body" weight is the missing attack-target, not evidence the feature is worthless. |
| Policy surfaces, if calibration says the floor is the lie | Ping reopens them | Attack-target selection (deferred). Prompt `selectCards` / `selectTargets` first-N (policy-proposals B1). Blocking. Event-counter targeting before `useEventCounters` is flipped. |

### Later — after the first official OP17 cycle

- Decide the Tier-3 lever (audit C now / B next / A only if calibration proves distortion). Do not
  decide it in the abstract.
- Oracle agreement and human benchmark (policy-quality steps 6–7, already deferred).
- Continuous rotation: each new set is import → encode → park → mutation-check → slot EV vs the
  *then* field. The tripwire is re-read at each rotation, not on a points gap.
- Arena Swiss runner, clock, decision-corpus retrieval — only if a human/LLM play loop is the
  thing being measured. An LLM is not the runtime policy at tech-slot sample sizes
  (`docs/policy-proposals.md`).
- Unbounded pre-OP15 print-confirmation remains later, not now.

---

## After #32 is released — next implementation crew

**Do not start this list from `claude/mutation-operators-widened`.** Wait until Ping has released
#32 onto `main` (or otherwise declared the branch the project record). Then, from *that* `main`:

1. **Treat the widened-instrument pre-OP15 sweep as the new detectability baseline.** Stop quoting
   62.3% as current. The two rates are not comparable; #32 exists so they stay in different boxes.
2. **Re-sweep OP15/OP16 under the widened operators**, on a fresh `--set` path, into
   `runs/OP15.jsonl` / `runs/OP16.jsonl`. Those files are stale on today's `main` (old instrument;
   #32 deliberately left them). This is the legitimate moment to turn the red gate into a current
   measurement — not a silent rewrite from an unrelated branch.
3. **Update `CLAUDE.md` figures** if the released PR did not (the held PR said it did not).
4. **Triage the new survivor surface the five-operator triage never saw**, in particular
   condition-object deletion (large unprotected surface on the held PR) and the still-unmoved
   `zone: "field"` → `"character"` class (C1/C2 Leader-exclusion, rulings #979/#993). Do not
   re-triage the 177 fully-vacuous cards already in `docs/mutation-triage.md`.
5. **Only then** consider fixture repairs, starting with cards that sit on a chosen deck or the
   calibration field. `OP14-020` Mihawk killed 1 of 6 under the old instrument and is on no
   worklist — it is in-scope for *test* repair after the new records exist, not for a re-encode.

This list is infrastructure for encoding *detectability*. It is not the charter critical path.
Do not let it displace meta calibration or the OP17 watch.

---

## Critical path (one screen)

The simulator's job is **tech-slot EV on a locked Ace list**, not deck selection.

```
official OP17 list ──► import ──► encode ──► Ace OP17 list ──► slot A/B vs a field
       │                                              ▲                │
       │                                              │                ▼
Bandai date                                    setBasePower         ΔEV = Σ share × ΔWR
(SC ~08-23 / EN 08-28)                         already on main         │
                                                                       ▼
SC shares (集换社, Ping) ── or EN proxy, labelled ──► weighting
policy that can use a conditional card ──► whether ΔWR is real
meta calibration ──► whether sim WRs match the ladder at all
print-faithful encodings of the cards in those games ──► whether the bias is silent
```

**Today the binding constraints on a *slot* number are policy honesty and missing OP17
data, not throughput and not an encoding backlog in published sets.** Now #1 is not one of
those waits: it runs on the frozen EN lists below, without 集换社.

What is waiting on what is tabulated in [`docs/roadmap/path.md`](docs/roadmap/path.md).

---

## Kill / tripwire (short)

Escalate Ace (or the engine track) only on **mechanism**, never on "N points behind Nami."

| Fire | Do not fire |
|---|---|
| Ace's 8000-or-more Rush gate does not turn on against the real field | Ace is N points behind the EV table |
| The core loop is answered by something ubiquitous | A weak policy reports every tech card is bad (that is a broken instrument) |
| A key piece is banned or rotated | OP17 date slips (wait; do not invent the set) |
| Calibration shows the heuristic cannot use the conditional cards the slots are made of | #32 stays held (work around it; do not merge it) |
| Meta calibration is impossible because encodings of the *field* are fiction | Green suite / mutation % quoted as print fidelity |

Full failure modes: [`docs/roadmap/risk.md`](docs/roadmap/risk.md).
