# Risk — assumptions, unknowns, failure modes, kill criteria

Parent: [`ROADMAP.md`](../../ROADMAP.md). Dated 2026-08-21 against `origin/main` @ `119cfe4`.

This file is the tripwire and the list of ways a clean-looking number becomes fiction. It does
not reopen locked decisions. It does not assign work on held #32.

## Assumptions the plan is already making

If one of these is false, the horizon still holds but the *meaning* of a slot number changes.
Say so in the write-up; do not silently "correct" toward the decks the EV table likes.

| Assumption | Why we are carrying it | If it fails |
|---|---|---|
| SC legal pool = EN/JP (banlist + Block 2+) | Ping, 2026-08-17 | Re-read every share-weighted number. The engine is still usable; the field is not |
| SC OP17 list = JP/EN OP17 list | **Not assumed.** Charter leaves it open | Import both; do not encode the wrong list |
| EN Limitless shares + EN ladder matrix are a usable proxy for an SC 店赛 | Locked ground-truth *backbone*. Correction half is unfinished | Weighting is wrong, not the matchup engine. Label every Σ share figure EN until 集换社 lands |
| Ladder bias correction is population/skill only, not Bo1-ness | Target event is Bo1 / 30 minutes — format-matched | Double-counting pushes analysis toward attrition decks the clock punishes |
| Ace remains the locked primary even at 0.87% field share | Owner preference + pilotability + clock | Only the qualitative tripwire moves this |
| `valueRanked` + the counter policy is a floor, not a ceiling | Phase 2: partial order, 6.5 pt gap over 600 games | Calibration (N1) is how we find out whether the floor is good enough for a 1–3 pt slot |
| Parked clauses will not sit on the Ace OP17 list, or will be caveated | `data/parked-clauses.json` is the registry | A `coverage: partial` card in a reported WR is a specific, knowable lie |
| Official OP17 text will still contain `OP17-005`'s On Play as a buff | Re-added 2026-08-17 from Limitless; spoiler-stage | Diff after import. Do not revive the 08-16 rejection by reasoning |
| Cost is outside the objective (no acquisition ceiling) | Ping 2026-08-19, later than the charter's "TBD" | Cost still must not sneak back in as a slot tiebreak unless Ping says so |
| No event means no *competitive* list-freeze | Charter, answered 2026-08-17 | If an event appears, re-read the 30-minute clock and Bo1 variance *before* freezing a list for it. **N1 is a different freeze:** snapshot `ace-op16.json` and the four Limitless modal lists so the run is repeatable. That is not an event lock. |

## Unknowns that are allowed to stay unknown

| Unknown | Owner | Do not "resolve" it by |
|---|---|---|
| When Bandai actually publishes OP17 | Bandai (SC ~2026-08-23, EN 2026-08-28, today 2026-08-21) | Encoding from spoilers; treating a date slip as a project failure |
| SC OP17 exclusive content | Official SC list | Assuming banlist parity answers it |
| What the SC field actually is | Ping + 集换社 (manual paste) | Building a scraper; pretending 213k EN games are a Chinese 店赛 |
| Whether #32's 74.3% / 9,237 figures become project record | Ping (held PR) | Merging, rebasing, or implementing on `claude/mutation-operators-widened` |
| Whether heuristic play *distorts* matchup WRs | N1 calibration | Picking audit A–D in the abstract |
| Absolute policy skill | Oracle / human, both deferred | Reading the ladder or a plausible play/draw split as a skill test |
| Turns-to-minutes (clock vs a 30-minute round) | Unmeasured | Treating `SIM_TURN_BUDGET` timeouts as a real-world timeout rate. **N1 does not report a timeout rate:** timed-out games are dropped, not scored. |
| Whether SC and EN printed text diverge on a card that matters | Rulings corpus is SC; importer is EN Bandai mirror | Authoring OP17 from variant text or an aggregator |
| How `OP14-020` Mihawk's five surviving mutants would move under the widened instrument | #32 not released; card was never on a worklist | Re-encoding Mihawk "to be safe" |

## Failure modes (the number looks clean; the measurement is broken)

These are the project's recurring class. A green suite, a 0.00-pt null test, or a tidy ΔWR can
all be this.

### 1. Unconfirmed pre-OP15 encodings

**Fact:** 1,771 pre-OP15 cards are encoded upstream. Their DSL has not been read against printed
text except where a *data* bug forced it (`OP06-054`). OP01–OP08 and EB01–EB03 have
essentially no real card tests (stub `assert.ok(true)`). The green suite is self-consistency
between encodings and tests authored from the same text.

**What goes wrong:** a slot or calibration WR is computed on cards that do not do what they
print. Same-direction text+encode errors are invisible to data-audit, mutation sweep, and the
suite.

**Mitigation already chosen:** Now #2 print-confirms the five frozen lists (Ace, Nami,
G/B Luffy, Enel, Teach) **before** Now #1. A firing miss blocks that matchup until parked
or fixed. Cosmetic or variant-text-only misses do not. The rest of the 1,771-card catalog
stays Later. Mutation sweep (on `main`: 62.3% detectability) is the instrument for "would
a test notice," not for "is it right."

**Do not:** quote 6,118 passing tests as a conformance baseline; call the suite doubled
coverage (1,594 of those tests are `assert.ok(true)`).

### 2. Self-consistency-only tests, including our own

**Fact:** this project's most frequent defect is a test that cannot fail.
`tools/mutation_check.py` exists for it. OP15/OP16 were authored with that loop and killed
542/542 under the then-operators, with the caveat that 31 cards produce zero mutants.

**What goes wrong:** a "verified" encoding batch is a batch whose tests agree with themselves.

**Mitigation:** mutation-check every new card; when a data correction turns a test red, suspect
the fixture first (`OP06-054`, `EB03-008`). After #32 is released, do not treat the new kill
rate as fidelity either.

### 3. Missing SC field data

**Fact:** shares and the matchup matrix are EN. Legal-pool parity does not make the metagames
identical. 集换社 has the pie and the top-cut lists; they are app-only; Ping pastes.

**What goes wrong:** `Σ share × ΔWR` is computed against the wrong field. A Rakuyo slot that
breaks even on EN aggro share can be a tax or a steal on the SC field.

**Mitigation:** label every share-weighted number EN until the paste exists. Do not invent
SC shares. Do not build a scraper. **Do not hold N1 for the paste** — Ping locked the first
calibration to the EN ladder cells and the four frozen lists.

### 4. Undecided search-AI lever, used as if it were decided

**Fact:** audit options A–D are open. Full-strength ISMCTS is ~100× out of reach. Charter
Phase 2 named search AI; `main` has a cheap policy and an arena, not a search.

**What goes wrong:** a crew "starts the search work" and spends the rotation on a throughput
lever. Throughput buys precision on whatever policy you already have. A policy that cannot
use `OP17-005`'s discount or Rakuyo's K.O. will report those slots dead with tight CIs.

**Mitigation:** Now #2, then N1. Pick A–D only if calibration shows *distortion*, not noise.
An LLM is not the runtime policy at tech-slot sample sizes (`docs/policy-proposals.md`).

### 5. OP17 date slip (or spoiler churn)

**Fact:** every OP17 row in research §5 is provisional. The 08-16 failure was a spoiler-stage
source changing under us plus a conservative-sounding reasoning error, not "trusted a bad
source."

**What goes wrong:** the team encodes a spoiler text, or treats a slipped date as a reason to
freeze a weak OP16 list, or re-rejects `OP17-005`.

**Mitigation:** import after Bandai publishes; diff §5; stay on Now if the date moves. Absence
from spoilers is not absence from the set (Mihawk).

### 6. #32 held, treated as either invisible or as someone else's merge job

**Fact:** #32 is the only open PR. Head `50b8522` on `claude/mutation-operators-widened`.
Ping owns it. `main`'s OP15/OP16 mutation records are stale vs the widened operators, so the
gate is red for a known reason.

**What goes wrong (two directions):**

- A crew merges or rebases it "to help" and fights a 31-commit (and growing) drift, or
  implements on the held branch.
- A crew blocks N2/N1/N3 on "waiting for the re-sweep," which those milestones do not need.

**Mitigation:** work around it. Quote 62.3% while it is held. After Ping releases it, run the
After-#32 pickup from *that* `main`. Do not "fix" `runs/OP15.jsonl` from an unrelated branch.

### 7. Policy surfaces that look like decisions and are not

Known, measured, do not re-diagnose:

| Surface | What the bot actually does | How a slot number lies |
|---|---|---|
| Attack target | Every `declareAttack` hits the defending leader (`targetIds[0]`) | Battle-based removal never happens. "Keep a body" weights go to zero |
| Character / event targeting prompts | First N options / empty selection | Removal and Event counters do nothing useful |
| Blocking | Never | Defensive gap Phase 2 called the largest remaining one |
| `[Trigger]` | Always fires | Life cards with Trigger never become hand counters |
| `orderCards` | Identity order (legal) | Top-deck ordering is not a policy |
| `valueRanked` big-body bonus | Printed power ≥ 5000, by decision | Sequencing defect; do not reweight without a ladder re-run |
| Hand-card power reads | Printed, by measurement (0/1968 disagree) | Reopens the day a hand modifier exists |

Ping deferred attack targets. Blocking and Trigger decline are decisions. Flipping
`useEventCounters` without a targeting policy spends the card for zero power.

### 8. Mixing the two bodies of evidence

Sim figures live in `docs/simulation.md` and `sim/results/`. Research figures are empirical
human games. A calibration *comparison* may sit next to both; a blended "Ace is 52%" must not.

### 9. Instrument changes mistaken for policy changes

Already paid for: feeding real randomness to puzzle batch 1; quoting suite size with
`bench/throughput.test.ts` copied in; quoting play/draw from the illegal-second-player-attack
era; quoting 8.5 pts after Phase 2 retired it; comparing mutation rates across operator sets.

**Mitigation:** name the instrument beside the number (puzzle count, games, seeds, counter
knobs, operator generation). Phase 3 sized against Phase 2, not against memory.

## Kill criteria

Two layers. Do not use the engine-track stops to flip the deck, or the deck tripwire to stop
building infrastructure.

### Deck tripwire (Ace / Mihawk) — qualitative, Ping's call

Escalate to "abandon Ace despite preference" only when the **plan is broken at the mechanism
level**:

| Fire | Example |
|---|---|
| Enablers do not turn on against the real field | 8000-or-more Rush bodies do not exist in the lists Ace actually faces, and OP17 does not supply them |
| Core loop is answered by something ubiquitous | A field-defining card makes the Rush swing illegal or irrelevant every game |
| A key piece is banned or rotated | `OP16-001` or the Newgate package leaves Standard |

| Do not fire |
|---|
| Ace is N points behind Nami / Teach / Big Mom on `ev_analysis.py` |
| A weak policy reports Rakuyo and `OP17-005` are both bad |
| Mihawk stays without OP17 support (he is already secondary) |
| EN shares stay tiny (0.87% / 1.02%) — accepted knowingly |

Pilotability still dominates a theoretical EV edge. Ping is building his first competitive
deck. Bot-weak ≠ novice-weak; do not keep a bad policy on the grounds that Ping is new.

### Engine-track stops — the measurement is not fit for a slot decision

Stop *shipping slot recommendations* (keep building) when:

| Fire | What to do instead |
|---|---|
| N1 cannot be run because the opposing field's encodings will not finish games | Fix legality / parked clauses on *those* lists; do not invent WRs |
| N1 runs and the miss is explained by a blind surface the slot depends on (no character targets for a removal tech, no Event-counter targeting, etc.) | Do not publish ΔEV. Name the surface. Ping decides whether to reopen it |
| Now #2 finds a **firing** miss on a unique effect-text card on one of the five lists | Park or fix that encoding. **Block that matchup.** Do not run it dirty. Cosmetic / variant-text-only misses do not block. |
| A crew starts Now #1 on a matchup Now #2 has not cleared | Stop. Print-confirm the five lists, then calibrate. |
| Official OP17 text contradicts the thesis (`OP17-005` missing, not a buff, or Ace-incompatible) | Re-read research §5 from the official list. Do not preserve the spoiler thesis by reasoning |
| A crew starts audit A/B/C/D or an LLM runtime policy without a distortion result from N1 | Stop that crew. Throughput and model calls are not the path |
| Someone merges or implements on #32 while it is held | Revert to `main` @ the last released SHA. The After-#32 list is not a license |
| Sim numbers are copied into `docs/research-findings.md` or the charter EV table | Remove them. The split is load-bearing |
| Trigger *text* is added without an encoding | That is a regression (Life card goes to resolution with no block). Land both or neither |
| `useEventCounters` flipped "to get more defence" | Revert. The second prompt still grants nothing |

Stop *the engine track itself* only if Ping so decides. There is no event deadline. A slipped
OP17 date is not a kill.

## Risks that look like schedule and are not

| Looks like | Is actually |
|---|---|
| "We have two days until SC OP17" | There is no event. The date is a publish date. Now work continues if it slips |
| "The mutation gate is red, the repo is broken" | Known stale OP15/OP16 records vs widened operators. Do not fix from the side |
| "6118 tests, encodings are fine" | Self-consistency. Pre-OP15 semantics are unverified |
| "Search AI is charter Phase 2, we are late" | Engine half of Phase 2 landed. Search is gated on N1 |
| "#32 is the only open PR, it must be next" | It is held. Next on `main` is Now #2 then Now #1 |

## What this file is not

It is not a license to reopen: deck choice, engine choice, objective function, no-sideboard
maths, local-only `orderCards`, the standing no-upstream-issues rule, the "no 集换社
scraper" call, or the **Now #1 / Now #2 locks** (five frozen lists; print-confirm then calibrate; Limitless
+ SC rulings, no aggregators; firing miss blocks that matchup; 400 paired games; blended WR
vs the ladder cell; play/draw recorded separately; timeouts dropped; results stay in the
simulation track). If a risk seems to demand one of those, it demands a write-up to Ping,
not a quiet reversal.
