# Horizon — now / next / later

Parent: [`ROADMAP.md`](../../ROADMAP.md). Dated 2026-08-21 against `origin/main` @ `119cfe4`.

This file is the phase map. It does not assign the held #32 branch, and it does not reopen locked
decisions listed in the parent.

## Phase boundaries

The charter has two named phases. This roadmap keeps that sequence and names where `main` actually
sits, so a crew does not restart Phase 1 or treat search AI as already chosen.

```
Charter Phase 1                    Charter Phase 2                         Rotation loop
current SC OP16                    engine + search-AI infrastructure       OP17, then every set after
research-driven                    reusable, no event deadline             import → encode → slot EV
     │                                      │                                     │
     ▼                                      ▼                                     ▼
NOW: finish OP16 inputs            NOW/NEXT: policy that can              LATER: starts when Bandai
(EN research is done;              measure a 1–2 card swap                publishes OP17
SC field still open)               without lying
```

| Boundary | Crossed when | Not crossed when |
|---|---|---|
| Phase 1 → Phase 2 | The research track can name the OP16 field and the Ace plan. **Already crossed** as an EN proxy. | SC-native shares arrive. Those correct the *weights*, they do not reopen deck choice. |
| Infrastructure → first rotation | Official OP17 list is importable and the Ace OP17 list is a 50-card legal deck in the engine. | Spoilers look complete. Spoilers are provisional (research §5). |
| First rotation → continuous | One full OP17 cycle has been encoded, mutation-checked, and used for a slot question against a labelled field. | The search-AI lever is picked. That is a later infrastructure decision, gated on calibration. |

Milestone names below are checkable. They are not calendar estimates.

## Already reached (do not rebuild)

Recorded so the next crew does not restart a finished stage.

| Milestone | Evidence on `main` |
|---|---|
| Engine chosen and audited | `docs/engine-audit.md` — fork tcg-engines; MOOgiwara rejected |
| OP16 competitive picture (EN) | `docs/research-findings.md` — field, 213k-game matrix, EV table, Ace/Mihawk notes |
| OP15/OP16 in the engine and encoded | PR #11. 119 = 119 definitions per set. Unencoded-and-unparked = 0 |
| `setBasePower` + timed base-power replacement | #26, #31, #34 (`119cfe4`). `OP17-005`'s On Play is expressible |
| Simulation harness on real Block 2+ decks | `docs/simulation.md`. 400/400 `rules-win` class results exist |
| Policy *floor* measured | Ladder (partial order after Phase 1), puzzle suite, Phase 2 remeasure |
| Fidelity plan Phase 0–2 | Ace is affordable; first-turn attack ban; bot counters; baseline re-measured once |
| Pre-OP15 *card data* corrected | 48 rows in `data/card-corrections.json`, second-sourced to Bandai |
| Trait matching is whole-trait exact | #30 |
| Arena can record a game | `docs/arena.md` — decision log + `replayMatch`. No live model call yet |

`#34` is **done**. Do not treat timed `setBasePowerFrom` / `copyPower` / `swapBasePower` as open.

## Now

**Window:** from `119cfe4` until the official OP17 list is importable, plus any work that does not
need that list. Today is 2026-08-21; Bandai's published dates are SC ~2026-08-23 and EN 2026-08-28.
A slip does not move these rows to Later — it only delays the Next gate.

**Constraint in force the whole window:** PR #32 is held. Nothing in Now may merge, rebase, or
implement on `claude/mutation-operators-widened`.

### Milestone N1 — first meta calibration (locked, Ping 2026-08-21)

**Pick for a policy/sim crew. Stays Now #1. Do not hold it for 集换社 / SC shares.**

This is charter validation layer 3: the first cross-deck sims, compared to the EN ladder
matrix. Mirror-only history is not calibration. The first run is a **measurement, not a
gate**. A miss does not block N2–N5, does not pick audit A–D, and does not flip Ace.

| Lock | Decision |
|---|---|
| Field | Ace vs **Nami, G/B Luffy, Enel, and Teach**. Those four only. |
| Ace list | Freeze current `sim/decks/ace-op16.json` — the engine-buildable proxy. **Not** a Limitless Ace list. |
| Opponent lists | Freeze the **Limitless modal** lists for those four leaders. Snapshot them before the run. Do not use live Limitless on the day of the run. |
| Sample | **400 paired games** per matchup. |
| Headline | **Blended** sim WR against the matching cell in `data/op16-matchup-matrix.json`. |
| Play/draw | Record separately. Do not replace the blended comparison with one seat. |
| Timeouts | **Drop timed-out games entirely.** Do not score them as double losses on this run. Do not report a timeout rate. |
| Write-up | Simulation track only (`docs/simulation.md`, `sim/results/`). **Do not** write sim numbers into `docs/research-findings.md`. |

A large miss that names its mechanism (noise vs policy-blindness vs encoding fiction) is a
valid result. That miss is what later *informs* audit options A–D — it does not decide them
on this run.

Do not: calibrate on ST01; use `mihawk-green-proxy` as a fifth opponent or as the play/draw
instrument; fetch a fresh Limitless list on run day; swap in a Limitless Ace list; hold the
run for 集换社; treat `random` as a control for attack-target choice (it uses the same helper).

### Milestone N2 — The two scopable primitives are built, or explicitly re-parked with a new reason

**Pick for an encoding/DSL crew that should not touch calibration.**

Order is locked: **`giveDonSourcePlayer` (10 clauses, all OP15) then `attachedDonTargetFilter`
(7).** See `data/parked-clauses.json`. Neither blocks OP17.

- Same batch discipline as OP15/OP16 (`docs/plans/BATCH-AGENT-BRIEF.md`, `cards/ENCODING.md`).
- Mutation-check every newly encoded card (`tools/mutation_check.py --set OP15`).
- Leave the remaining parked primitives parked. They are singletons (or the two-card
  `returnDonStateRestriction`). OP17 will add more singletons; it will not make them scopable.

### Milestone N3 — Catalog leftovers that silently change play are closed or scoped out

**Pick for a catalog crew.** From `docs/encoding-audit.md` remaining order (items 3–6),
item 3 (trait matching) is already done.

| Leftover | Why it is Now | Done looks like |
|---|---|---|
| Ten missing `[Trigger]`s (7 Standard-legal) | Text without encoding routes the card to resolution with no block. Text+encoding+tests in one batch. Prefer the 7 legal ones. | Each card has printed trigger, encoded trigger, and a mutation-checked test |
| `OP13-084` | The suspected wrong encoding. `setBasePower` unblocked it. Text fix + replace the fabricated `[On Play]` + new tests, together. | Do not "fix the existing test" (`docs/mutation-triage.md`) |
| EB04's 31 missing cards | Largest competitive catalog hole. Only if a calibration or Ace/Mihawk list would play them. | Import/define what the field needs; do not boil the 445-card ocean |

`ST10`–`ST36` absences stay out of Now. No current sim deck draws on them.

### Milestone N4 — Print-confirm the *simulated* cards, not the catalog

**Pick for a fidelity crew.** This is the start of encoding-semantics work, which the encoding
audit never did (it compared data-to-data and text-to-text).

Scope, on purpose:

- Ace list: the same frozen `sim/decks/ace-op16.json` N1 uses.
- Opponent lists: the same four frozen Limitless modal lists N1 uses (Nami, G/B Luffy, Enel,
  Teach). Not a live fetch, and not a different “field representative” stand-in.
- Any parked clause on those lists, surfaced as a caveat rather than silently played
  (`data/parked-clauses.json`: `coverage: partial` is the dangerous state).

Method: printed text (base printing, not variant) + SC rulings (`tools/parse_rulings.py --card`)
against the DSL body. One card whose text and encoding are wrong in the same direction is
invisible to the green suite and to the mutation sweep.

Out of Now: a 1,771-card reread; "fixing" OP01–OP08 / EB01–EB03 stub tests as a programme
(those 1,129 files are `assert.ok(true)` — a later project, not a Now milestone).

### Milestone N5 — Research watch, not a build

No implementation. Recheck OP17 spoilers for Mihawk / Cross Guild / Seven Warlords support.
If support appears, research §4 flips and Mihawk becomes viable — that is a research edit, not
an engine one. Watch Bandai's official list so Next can start the same day it is published.

Ping-only: paste 集换社 share pie + top-cut lists (event size and date included). There is no
scraper to write.

## Next

**Window:** from official OP17 importability through the first Ace slot question against a
labelled field. #32 follow-on sits here *only after Ping releases it*.

### Milestone X1 — Official OP17 is in `data/` and diffed

- `python3 tools/import_cards.py --set OP17 --refresh`
- Diff against `docs/research-findings.md` §5. Every current OP17 row is spoiler-stage.
- Record whether SC OP17 equals JP/EN (charter open question). Do not assume parity from
  banlist/rotation parity.

If the date slips: stay on Now. Do not encode from spoilers.

### Milestone X2 — Ace OP17 is a legal 50-card list in the engine

Skeleton: OP16 Red Ace. First slot-in: `OP17-005` Edward Newgate (12000, −4 cost vs a 10000+
board, Rush from Ace, On Play sets Ace's Leader base 5000 → 8000 through the opponent's next
End Phase). That is the thesis. Do not re-reject the On Play.

Second: 1–2 `OP17-016` Rakuyo is Ping's anti-aggro instinct and the first *question*, not a
locked include. Removal and the Newgate discount want opposite fields; there is no sideboard,
so the question is `Σ share × ΔWR` across the whole field.

Mihawk OP17 list is only in scope if N5 found support.

### Milestone X3 — OP17 encoded under the same gate as OP15/OP16

Generator → graft → per-card tests → full suite → `mutation_check.py`. Park what will not fit.
`setBasePower` already exists; do not reach for `setPower` on a "base power becomes N" clause.

### Milestone X4 — First real tech-slot A/B on the Ace OP17 list

The unit is a card slot, not a leader row. Common random numbers; timeouts are double losses;
report play/draw split. Weight with SC shares if Ping has pasted them, otherwise EN proxy,
labelled.

This milestone is only as trustworthy as N1 (calibration), N4 (print-confirm), and the policy's
ability to *use* `OP17-005`'s discount and Rakuyo's K.O. A policy that cannot use a conditional
card will report that every tech card is bad, and that looks like a clean answer.

### Milestone X5 — After #32, and only after #32

See `ROADMAP.md` "After #32 is released". Not assigned now. When it becomes legal:

- Widened-instrument pre-OP15 figures become the detectability record.
- Re-sweep OP15/OP16 (`--set`, `--fresh`) so the corpus is one instrument.
- Update `CLAUDE.md` if the released PR did not.
- Triage *new* survivors (condition-delete; `zone: "field"` → `"character"`). Do not re-triage
  `docs/mutation-triage.md`.

### Milestone X6 — Fidelity-plan Phase 3, if still the right instrument

Derive counter *feature* weights (not a card list). Size 15 × 2 × 200 against Phase 2's longer
games, not the pre-Phase-1 hour. Held-out ladder must beat the neutral policy or the derivation
failed — that is the result, not a table to ship.

Revisit attack-target selection *before* trusting a near-zero "keep a body" weight. Ping
deferred the target change; reopening it is his call.

## Later

**Window:** after the first official OP17 slot cycle, or when a Now/Next measurement proves the
cheap policy is the lie.

| Milestone | Prerequisite | Note |
|---|---|---|
| Pick audit lever A / B / C / D | N1 (or a later calibration) shows heuristic play *distorts* matchup WRs, not merely adds noise | Recommendation in the audit was C now, B next, A only if needed. Re-derive cost from the current engine before committing; Phase 1 collapsed the realism ratio and doubled game length |
| Policy-proposals B2 (LLM referee on ~200 positions) | Branching factor is already measured (`docs/arena.md`) | Grades the cheap policy. An LLM is not the runtime policy at 12k-game slot sizes |
| Oracle agreement (deep search on a sample) | A lever that can actually run offline | Dissolves "ISMCTS is 100× out of reach" for *grading*, not for playing every game |
| Human benchmark (Ping, 10–20 games) | A bot that is supposed to be the opponent | If a first-time pilot crushes it, stop measuring and fix play |
| Arena Swiss / clock / corpus retrieval | A human or LLM play loop is the thing under test | `docs/arena.md` "What is not done" |
| Unbounded pre-OP15 print-confirmation | N4 showed the field-relevant slice is clean enough that the long tail matters | OP01–OP08 and EB01–EB03 have stub tests; that programme is Later |
| Next set after OP17 | Official list | Same loop as X1–X4. Re-read the tripwire. Do not freeze a list between rotations unless an event appears |

## What a crew should pick this week (without #32, without official OP17)

In this order, matching `CLAUDE.md`:

1. **Meta calibration (N1)** — locked as specified above. Do not wait on 集换社.
2. **`giveDonSourcePlayer` then `attachedDonTargetFilter` (N2)** — if the crew is an encoding
   crew, not a sim crew.
3. **N3 leftovers that a planned N1 deck would actually play** — Triggers / `OP13-084` / EB04
   only as needed, not as a catalog completion project.
4. **N4 print-confirm** of those same lists, in parallel with N1 if two crews exist.
5. **N5 watch** — anyone, continuously, until Bandai publishes.

Do not pick: search AI; merging #32; encoding OP17 from spoilers; reweighting `valueRanked`'s
+100 printed-power bonus; flipping `useEventCounters`; writing a 集换社 scraper; filing
upstream issues.
