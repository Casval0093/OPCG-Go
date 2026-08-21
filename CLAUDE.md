# OPCG-Go — Context for Claude Code

Read this first. It is the handoff from the session that scoped this project.

## What this is

Competitive deck research and simulation for the **One Piece Card Game, Simplified Chinese (简中) format**.
Owner: Ping Han. Goal: determine and field the highest-EV deck in the SC format, continuously, across
set rotations.

Two tracks run in parallel:

- **Research track** — mine real tournament + ladder data, compute field-weighted EV, recommend a deck. *Working today.*
- **Engine track** — fork a rules engine, add search AI, simulate matchups for formats that have no
  data yet. *Status 2026-08-18:* OP15/OP16 **encoded** (PR #11) and grafted; simulation harness works
  end to end on Block 2+ decks; an arena for human/LLM play exists (`docs/arena.md`). Remaining: a
  play policy worth trusting, and OP17 once Bandai publishes it.

## Ground truth: what is real vs what is not

**Every competitive number in `docs/research-findings.md` and `docs/charter.md` is empirical** —
real human games from Limitless and an EN ladder. No simulated figure has ever been mixed into
them, and none should be without saying so explicitly.

**Simulation started working on 2026-08-17** and its output lives only in `docs/simulation.md` and
`sim/results/`. So far that is mirror matches used to validate the harness — 400-game ST01 and
Mihawk mirrors — plus the prompt diagnostic. **No matchup between two different decks has been
simulated** as of that date — the reason given then was that OP15/OP16 were shells, and **that reason
expired on 2026-08-18 when PR #11 encoded them.** A cross-deck matchup is now buildable and simply has
not been run. Keep the two bodies of evidence clearly separated when writing anything.

## Locked decisions

| Branch | Decision |
|---|---|
| Format | Simplified Chinese, Standard, Block 2+ |
| Meta ground truth | Limitless EN/JP as statistical backbone, corrected by SC-native sources |
| Engine base | Fork `TheCardGoat/tcg-engines` (MIT). MOOgiwara rejected (AGPL, 30% MVP, no card logic) |
| Effect encoding | Adopt that repo's existing compositional DSL; LLM-author gaps with generated tests |
| Objective function | Field-weighted expected match win rate vs the real SC field, split by play/draw |
| Validation | 3 layers: per-card assertion tests → Comprehensive Rules conformance → meta calibration |
| Budget | **No ceiling.** Cost is out of the objective function. |
| Chosen archetypes | **Ace (`OP16-001`) primary, Mihawk (`OP14-020`) secondary** — owner preference, see caveat below |
| Role of the EV tooling | **Not deck selection.** Ping accepted this 2026-08-17. See below. |

## Hard-won facts — do not re-derive these

- **An OPTCG deck is 50 cards** + 1 leader + 10 DON!!. (An earlier draft said 51. It was wrong.)
- **A timed-out round is a DOUBLE LOSS, not a draw** — 官方公认赛赛事守则 V1.6.0 §II: *"该对战结果
  为双方败北"*. Failing to close inside 30 minutes is a loss on your record. Extra turns (+3 / +2)
  and the Life→deck→猜拳 tiebreak apply **only in finals and elimination**, never in Swiss.
  The simulator scores `win | loss | timeout` for this reason. See `docs/simulation.md`.
- **`MatchConfig.firstPlayer` is silently discarded by the engine.** It sets the initial
  `activeSeat` only; the 猜拳 setup roll (Comprehensive Rules 5-2-1) overwrites it, and
  `runBotMatch` consumes that command from its prompt queue before any strategy sees it. Forcing
  it both ways gives byte-identical results, and **north led all 120 test games**. Control turn
  order by **seat assignment** instead — north leads, so seat the deck north to put it on the play.
- **The engine's bot could not resolve `orderCards` prompts — FIXED 2026-08-17, do not re-diagnose.**
  It abandoned **88% of games** on a Block 2+ deck with `illegal-command` at turn 2. Cause:
  `resolveBotPromptCommand` branches on four of six `ChoiceKind`s and falls through to a single
  `optionId`, which cannot express an ordering. `orderCards` failed **17/17**; every other kind
  passed, including `chooseOption`. The ~8-line fix is `tools/patch_engine.py`, re-applied by
  `scripts/bootstrap.sh` since `vendor/` is gitignored. A/B: 3/20 games completed → **20/20**.
  Engine suite unchanged at 2632. The bug is upstream's (tcg-engines is MIT), but **Ping decided
  2026-08-17 NOT to send it upstream** — `docs/plans/encode-op15-op16.md`. `tools/patch_engine.py`
  is therefore permanent, not a stopgap. See `docs/simulation.md`.
- **A search that reveals to HAND was gated on open CHARACTER slots — FIXED 2026-08-18, do not
  re-diagnose, and it is NOT a trait-filter bug.** `effectSearchSelection` in the engine's
  `effects/resolution.ts` rejected a selection when
  `selectedIds.filter(cardType === "character").length > openCharacterSlots`, applying that test to
  **every** search regardless of `revealDestination`. Adding a card to your hand needs no board slot,
  so with a full character area (0 open slots) the engine refused every Character the prompt had
  just offered. The two halves disagreed: prompt creation in `effects/actions.ts` folds
  `openCharacterSlots` into `destinationCapacity` **only** when `revealDestination === "character"`.
  Surfaced on `OP16-118` Portgas.D.Ace as an `illegal-command` abort whose prompt offered five
  [Whitebeard Pirates] bodies and refused four. **The trait filter was never wrong** — the prompt's
  own `eligibleIds` was correct and every refused card was in it; all 104 trait/name filters across
  `cards/OP15` + `cards/OP16` resolve to real catalog values, so there is no
  "Whitebeard Piratess"-class typo in the encodings. **That clears the filter *values* only.
  The trait *matching semantics* were a separate defect — fixed 2026-08-21 (whole-trait equality,
  the two `... match whole traits, never substrings` patches); see the trait-matching fact below.** Blast radius was **171 of the 185 encodings
  with a `search` action** (every one that reveals to hand), and only 19 are OP15/OP16 — the other
  152 are upstream's own cards. Fix is the
  `resolution: search-to-hand must not require open character slots` patch; A/B on the 10-game Ace
  mirror with the arena's masking retry disabled: **`illegal-command=1` → `rules-win=10`**. Engine
  suite 3370 pass / 0 fail. **Sent upstream as a draft PR 2026-08-19 on Ping's authorisation** —
  <https://github.com/TheCardGoat/tcg-engines/pull/216>. That does not reopen the `orderCards`
  decision: Ping's 2026-08-17 "stays local" call stands for that one, and `patch_engine.py` remains
  permanent regardless of whether #216 merges.
- **The suite is 6111 pass / 0 fail as of 2026-08-20, and every older figure in this
  file differs for a knowable reason. Re-derive rather than quoting.** On the tree that merges
  Phase 1 + Phase 2 + `setBasePower`: **6078 → 6111, +33**, all of it OP15/OP16, which alone went
  **738 → 771** (measured, not inferred). Phase 1 added NO vitest tests — its counter-policy
  coverage lives in `tools/mutation_check_engine.py` — so the suite was 6078 both before and after
  it. **File counts are as unstable as skip counts and for the same reason** — measured on a CLEAN
  tree with nothing copied into `tests/cards/`: **3665 files / 6078 pass / 2 skipped**, and with
  `bench/throughput.test.ts` copied in, 3666 / 6079. So Phase 1's "3666 files / 6079 tests" is the
  bench-inclusive pair. Quote the PASS count.
  **The recurring off-by-one is `bench/throughput.test.ts`.** It is not in the suite; copying it
  into `tests/cards/` as this file's own command does adds exactly one test. That is where the
  **6079** in Phase 1's note and in the old `scripts/bootstrap.sh` comment comes from: 6078 card
  tests plus the bench. So **6111 without the bench, 6112 with it** — check which tree you are
  looking at before treating a one-test gap as a regression.
  **The SKIPPED count is not a stable expectation and should not be pinned.** The 4 skipped FILES are
  this repo's env-gated harnesses (`puzzles`, `matchup.sim`, `catalog.dump`, `prompt-diag`), and
  `scripts/simulate.sh` is what copies them into the tree — so a freshly bootstrapped tree has none
  of them and reports 0 skipped, while a tree where simulate.sh has run reports however many tests
  those files currently hold. It moved 10 → 13 purely because Phase 1 added three tests to
  `sim/puzzles.test.ts`. Count the PASSES.
  Historical figures in `docs/` are left as they were written.
- **Upstream never ran ~2000 of its own per-card tests; we now do — FIXED 2026-08-19, quote 6078.**
  `packages/engine/vite.config.ts` sets `test.include` to `tests/cards/**` plus four named files —
  **not** `src/cards/**`, where **2065** test files live. Only 26 of their basenames appear under
  `tests/cards/` at all, leaving **1972 with no running counterpart**. Pristine arithmetic confirms
  the include list accounts for everything that ran: **1384 + 4 = 1388**, exactly the file count a
  stock `vp test run` reports. **This is why the search-to-hand bug survived** —
  `OP12-086` Koala's own test file is one of the 1972.
  **Patch 3 in `tools/patch_engine.py` turns them all on: 1601 → 3666 files, 3370 → 6078 tests,
  0 failures, 89s → 87s.** +2065 files and +2708 tests for no measurable wall clock (`isolate: false`,
  and transform/import dominate). Nothing needed fixing; they were only unwired. Measured twice — by
  hand-editing the include, then through `patch_engine.py` — identically.
  **THE "BASELINE ROUGHLY DOUBLED" READING IS WITHDRAWN — corrected 2026-08-19 by the mutation
  sweep.** The file and test counts are right; the conformance reading was not. **1594 of those
  2065 files assert nothing**: each is a lone `validateCardAbility(card)` call, and upstream
  stubbed that function's body out to `void card; assert.ok(true);` with every real check
  commented out (`src/cards/card-behavior-harness.ts`). So **1594 of the ~6078 tests (26%) are
  `assert.ok(true)`**. The real gain from the `vite.config: run the per-card tests under src/cards`
  patch is **470 files / ~913 engine-driven cases
  covering ~397 card ids `tests/cards/**` never tested** — genuine, and it does include
  `OP12-086` Koala, so the search-to-hand explanation above still stands. But behaviour-bearing
  cases went **~3369 → ~4282, +27%, not double.** Quote 6078 as suite SIZE; never as an encoding
  conformance baseline. Also: **zero substantive `src/cards` tests exist for OP01–OP08 or
  EB01–EB03** — every one of those 1129 files is the stub — and **2 cards have no runnable test
  at all** (`PRB02-006_p2`, `ST04-003`) because the stub is their only coverage. The harness is
  upstream's own code and `tools/patch_engine.py` does not touch it; per the standing rule this
  stays a local record.
  **"Nothing needed fixing" is a statement about *wiring*, not about correctness — those 6078
  tests and the encodings they check were authored from the same printed text, so a green suite
  proves self-consistency, not fidelity. `OP06-054` is the proof; see the audit fact below.**
  **An interim version of this note carried an OP12-only sample (+100 files / +132 tests) and warned
  that a bulk enable "may surface pre-existing failures elsewhere". The full enable has been run and
  nothing fails, so that caveat is VOID — do not reinstate it.**
  **Measurement hygiene, learned the hard way: measure upstream facts in a CLEAN upstream clone,
  never in `vendor/`.** An earlier version said 1953 orphaned / overlap 45 / `1600 + 4 = 1604`; those
  were measured in our own tree, whose `tests/cards/` carries ~212 grafted OP15/OP16 files, and they
  were wrong for upstream — they briefly shipped in the PR body before being corrected.
  Upstream issue <https://github.com/TheCardGoat/tcg-engines/issues/217> still cites only the OP12
  sample and repeats the caveat this note just voided. **That will not be corrected and it is not a
  loose end — see the standing rule below. Do not raise it.**
- **STANDING RULE — no issues on external repos, and do not ask (Ping, 2026-08-19).**
  Verbatim: *"本项目外部库不要发issue，未来也不要再问我"*. File nothing new on upstream or any other
  third-party repository, and **never surface it as a question, a "still outstanding" line, or a next
  action.** This retires a question that had been re-raised three turns running (whether to post the
  full-enable evidence to #217); the answer is no, permanently. Existing `#216` (PR) and `#217`
  (issue) **stay open and untouched** — that was decided separately 2026-08-19 and this does not
  reopen it. Upstream defects still get recorded locally in `docs/upstream/` and here; the local
  record is the deliverable, and carrying the fix in `tools/patch_engine.py` is the sanctioned
  mechanism. Treat any outward-facing action on third-party property as requiring an explicit,
  unprompted instruction from Ping — never propose one.
- **The first player takes 1 DON!! on their first turn, not 2 — FIXED 2026-08-19 by the
  `state: first player places 1 DON!! on their first turn, not 2` patch.**
  `finalizeBeginTurnRefresh` placed `Math.min(2, donDeckCount)` every DON!! Phase with no first-turn
  exception, so the leading player opened on **2** active DON!!. The rule is 2 per DON!! Phase
  **except the first player's first turn, which is 1** — first-player compensation, and the pair of
  the skipped first draw that this engine *does* implement (`skipFirstTurnDraw`, Comprehensive Rules
  6-3-1). Only half the compensation was present: the leader paid the draw and kept the DON!!.
  Measured before/after on the Ace mirror, seed 7: turn 1 north `2a/0r (8 left)` → `1a/0r (9 left)`,
  with turn 3 at 3 DON!! and the second player at 2 then 4. The condition is
  `turnNumber === 1 && seat === config.firstPlayer`, not the `skipDraw` flag — `config.firstPlayer`
  is authoritative once the 猜拳 winner's `chooseFirstPlayer` has overwritten it, and turn number
  plus seat cannot be misconfigured, whereas a flag can be switched off and would silently take the
  DON!! rule with it. **Two upstream tests asserted the old value and are corrected by the
  `tests: two upstream cases assert the pre-fix first-turn DON!! count` patch** —
  that is fixing the tests, not accommodating the fix: `shared.ts` defaults `skipFirstTurnDraw` to
  `?? true`, so those tests took the skipped draw and still expected the un-reduced DON!!.
  **Every play/draw number measured before it was measured on the wrong rules — but the practical
  effect is small.** Re-measured post-fix: Mihawk proxy mirror, 160 games, overall **50.63%**
  [42.95%, 58.27%] (contains 50%, as a mirror must), gap **8.75 pts** against the **8.5 pts**
  recorded for a real Block 2+ deck before. So the fix does not move this deck's gap out of noise;
  do not treat the older figures as badly inflated, and do not treat them as re-verified either —
  a deck that leans on a turn-1 play is where the surplus would have mattered most. Reported by
  Ping as "the player going first can only have one DON, the opposition got two"; that end state is
  correct, and the defect was the engine handing the leader 2 on turn one.
- **The arena's decision log is real, is written PER DECISION, and three things about it are
  load-bearing — added 2026-08-19, see `docs/arena.md` "The decision log".** It answers Ping's ask to
  record human and LLM decisions, and it replaces `arena/results/last-run.json` as the corpus (that
  file stays, as the summary `branching.ts` reads).
  - **`replayMatch(config, commands)` DID NOT EXIST** while `docs/arena.md`, `arena/types.ts` and
    `arena/driver.ts` all cited it as the guarantee that a thin `DecisionLog` was enough because the
    position was "exactly reconstructable". It is implemented now (`arena/replay.ts`) **and** the
    position is stored inline, so the corpus no longer depends on it; `--verify-replay` folds the
    recorded commands back over a fresh match and reproduced ST01 exactly, going red when one command
    is dropped. Do not re-add a claim that a summary log suffices "because replay".
  - **`process.exit(0)` at the end of `arena/main.ts` was discarding `process.exitCode`, so
    `--integrity` could never fail a run** — a hard hidden-information violation printed `FAIL` and
    exited 0. Fixed to `process.exit(process.exitCode ?? 0)` and verified 1-on-mutant / 0-on-clean.
    This was pre-existing and is the same anti-pattern as a test that cannot fail.
  - **`author` (`human` | `model` | `heuristic`) is a recorded FIELD, per decision, not per agent**,
    because a council routes procedural decisions to the heuristic and degrades to it on a refusal,
    rate limit or exhausted budget. The trap it closes: `scriptedAgent` emits a `reason` for
    **every** decision ("improved score 1210"), so a "has a reason" difficulty filter reports a
    scripted game as **100% contested**. Measured after the fix: scripted 2-game run `contested: 0`;
    a human game with 8 typed notes among 29 decisions `contested: 8`.
  - The position snapshot is `deriveFeatures(view, seat)` verbatim — **projection-derived, so it
    cannot leak, and `integrity.ts` already proves that.** Never snapshot `MatchState` into a log;
    `driver.ts`'s `audit` hook says so explicitly and it still holds.
  - Durability is measured, not assumed: a 40-game run `kill -9`'d at game 6 left **747 decisions /
    6 complete games** readable. Cost: **~390 KB per ST01 game, ~690 KB per real Block 2+ game.**
    `arena/logs/` is gitignored; keep a game by copying it to `arena/corpus/` (tracked).
  - **`menu[chosenIndex]` is the corpus's one invariant.** The driver plays option 0 when an agent
    answers out of range, so `chosenIndex` records the APPLIED index and `requestedIndex` keeps the
    bad request (`null` when honoured). Recording the request in `chosenIndex` gave rows whose index
    was absent from their own menu. Do not "simplify" the two fields back into one.
  - `arena/log.test.ts` runs under plain `node --test` from a clean checkout — **no engine clone, no
    vitest** — because `log.ts` imports engine types with `import type` only. **17 tests, 16 mutants,
    16 caught** by `tools/mutation_check_arena.py`. The **LLM** half was verified with a stand-in
    model-authored agent (9 model / 3 degraded / 3 dissent, 0 broken rows), **not** a live API call —
    the provider adapters are untouched and still have never made one.
- **`arena/` does not run on a clean checkout: `arena/node_modules` is missing and
  `scripts/bootstrap.sh` does not create it.** `providers/anthropic.ts` imports
  `@anthropic-ai/sdk` at module load and `main.ts` reaches it through `agents/council.ts`, so even a
  scripted-only run dies with `ERR_MODULE_NOT_FOUND` before a game starts. Fix is `npm ci` inside
  `arena/` (2 s, 8 packages, `arena/package-lock.json` is committed). Not folded into bootstrap here
  because that script's contract is stdlib-and-pnpm only; just know it is a required step.
- **Real Block 2+ decks now simulate end to end**, 400/400 `rules-win`, median 9 turns.
- **Play/draw: RE-MEASURED 2026-08-20 in Phase 2, and the old figures were a RULES BUG cancelling
  first-player advantage, not a measurement of it.** The second player's illegal first-turn attack was
  worth **+52.50 pts [43.31, 62.04]** of play/draw gap on `mihawk-green-proxy` and **+26.00 pts
  [17.16, 35.02]** on `ace-op16` — paired arms, 400 games each on identical seeds, everything else
  held fixed. Pre-fix the gap on the primary deck was **−28.50 pts**, i.e. the player going SECOND was
  substantially favoured; post-fix it is **−2.50 pts**. So the recorded direction ("prior figures
  understate first-player advantage") was right and the recorded magnitude was far too gentle.
  **THE GAP IS DECK-SPECIFIC AND `mihawk-green-proxy` IS UNFIT FOR THIS MEASUREMENT.** Identical
  rules, identical seeds, 400 games: `ace-op16` **−2.50 pts**, `mihawk-green-proxy` **+34.50 pts**.
  Both are legal 50-card lists. The proxy deck is OP09–OP14 stand-ins predating the OP15/OP16
  encoding and it behaves like the degenerate end of the interaction scale — the ST01 lesson one rung
  up. **Quote `ace-op16`'s −2.50 as the current play/draw figure**; keep the proxy for the ladder,
  where both seats play it and the deck cancels.
  **The counter policy is worth −38.50 pts [−49.71, −27.32] of gap on its own**, which is the single
  largest thing standing between this simulator and a pure race up the Leader — and the reason
  blocking, still unimplemented by decision, is now the largest measured defensive gap.
- **Do not calibrate on ST01.** The play/draw gap was **54.5 pts** on ST01, **26.7** on a vanilla
  Block 2+ pile, and **8.5 pts** on a real Block 2+ deck — all measured on the broken rules, all
  superseded by the Phase 2 figures above. The lesson survives its numbers: the gap tracks how much
  interaction a deck has. The gap
  tracks how much interaction a deck has; a degenerate deck gives degenerate calibration. An
  earlier note here claiming the bot exaggerates first-player advantage "by an order of magnitude"
  was measured on ST01 and is **retracted**. Policy quality remains unmeasured — a plausible split
  shows the policy is not obviously broken, not that it plays well.
- **Tests that cannot fail are this project's most frequent defect — `tools/mutation_check.py`
  exists for it.** Task 2 shipped three: a test with the right name, the right comment, and no
  power to detect the defect it claimed to cover. Two review rounds caught some and missed others.
  Run `python3 tools/mutation_check.py --set OP16` as part of any encoding batch's verification; a
  surviving mutant is a vacuous assertion and it exits 1. It found three gaps on `OP16-001` Ace
  that human review had passed — nothing asserted the [Rush] grant was *restricted* to its two
  clauses at all. **It reaches the vendored sets too now (`--vendor-set OP06`), and
  `tools/mutation_sweep.py` runs the whole corpus in ~35 min instead of ~8h** by batching cards
  whose test files are disjoint — verified against the serial tool on 40 cards / 134 mutants,
  agreeing label-for-label. Both trap SIGTERM and restore the encoding, so a sweep is safe to stop.
  **FOUR mutation tools now exist and they are not interchangeable:** `mutation_check.py` (one card
  at a time, serial — the reference implementation), `mutation_sweep.py` (the same verdicts in
  disjoint batches, for whole-corpus runs), `mutation_check_arena.py` (a different corpus
  entirely — `arena/log.test.ts`, not card encodings), and `mutation_check_engine.py`
  (added 2026-08-20: mutates the ENGINE patches in `tools/patch_engine.py` and the counter policy
  they install, and checks `sim/puzzles.test.ts` notices — 15 mutants, 14 must die, 1 documented
  equivalent survivor).
  **The rule applies to our own test files as well: writing `tools/test_mutation_tools.py` produced
  a vacuous test on the first pass** — the no-files guard could be deleted with the test still
  green, because it pinned the fallback path rather than the guard. Mutate your own guards out and
  watch for red before believing a new test.
- **`scripts/bootstrap.sh` used to skip patching and card corrections in silence — FIXED
  2026-08-19.** It `cd`s into the engine before invoking `tools/patch_engine.py` and
  `tools/correct_cards.py`, both of which default to a REPO-relative engine path. From that cwd
  they printed `engine not found ... run ./scripts/bootstrap.sh` and exited, so a "successful"
  bootstrap left the tree un-patched and un-corrected — no `orderCards` fix, no search-to-hand
  fix, no first-turn DON!! fix, no 48 corrections, and `src/cards/**` still unwired. Both are now
  invoked from `$ROOT`. If you ever see 1601 files / 3370 tests instead of 3665 / 6078, this is
  why; re-run both from the repo root.
- **Parallel batches get their own engine, not a shared one.** `cp -Rc vendor/tcg-engines DEST` is
  an APFS copy-on-write clone: ~8 s, near-zero disk, verified to run the suite clean. Two agents
  grafting different card sets into one 766 MB engine overwrite each other.
- **There is no sideboard in Constructed.** The deck is locked for the whole event; only Sealed
  permits a side deck (official Tournament Rules Manual / Floor Rule). Every tech slot is a
  permanent tax paid in every matchup, so slot decisions are `Σ share × ΔWR` across the *whole*
  field — a card dead outside one 10%-share matchup must swing it >9 points to break even.
  See `docs/research-findings.md` §5.
- **Rotation is live since 2026-04-01.** Standard = Block 2+ only. OP01–OP04 and ST01–ST09 are dead.
- **Banlist:** OP06-086 Gecko Moria, OP07-045 Jinbe, EB01-059 Kingdom Come, OP02-117 Ice Age.
- **Ladder data understates value/control decks — but only half of that applies to THIS event.**
  The original reasoning was: ladder is Bo1, rewards speed, and complex decks are piloted worse by
  the median ladder player. **The target event is Bo1 with a 30-minute clock** (Ping, 2026-08-17),
  so the Bo1/speed half is *format-matched* — a 213k-game Bo1 matrix predicts this event better
  than tournament Bo3 data would. Correct for **population and piloting skill only.** Do not also
  correct for Bo1-ness; that double-counts and biases the analysis toward the slow value decks a
  30-minute round punishes. (The earlier "treat as a lower bound, *always*" was written before the
  format was known.)
- **The 30-minute clock is a format-level edge for Ace, independent of preference.** Tempo closes
  inside the round; attrition may not. It cuts against Teach and Big Mom, the two decks the raw EV
  table favours and the two the research notes describe as attrition engines.
- **`setBasePower` has been PLAYED, not just unit-tested — 44 resolutions across 7 of 30 real games,
  0 illegal commands.** This gap was worth closing on precedent: all 32 of the primitive's unit tests
  are `OnePieceTestEngine` fixtures, and that is exactly how the `OP16-118` search-to-hand defect
  escaped — it passed unit tests and aborted live games with `illegal-command`. `OP16-015` resolves
  through the risky machinery (an optional block, a `trashFromHand` cost carrying two filters, then
  two `setBasePower` actions one of which auto-resolves a single-candidate Leader target).
  Deck: `sim/decks/ace-op16-setbasepower-probe.json` — `ace-op16.json` with its 4 rotated-out
  `OP05-019` slots swapped for `OP16-015`, so it stays a legal 50-card mono-red Ace list, and the
  Leader is the `OP16-001` Ace that the card's own parked cost clause keys on. It holds 16 copies of
  four different EXACTLY-8000 Characters (`OP16-011/014/016/017`), which is what makes the cost
  payable at all — without one the clause can never fire and a clean run would prove nothing.
  Result: `./scripts/simulate.sh --a sim/decks/ace-op16-setbasepower-probe.json --b <same>
  --games 8` gives 8/8 `rules-win`, 0 timeouts. **But a clean run is not evidence the clause fired**,
  and the sim keeps only summary stats, so that was measured separately: `runBotMatch` exposes
  `logHistory`, and counting lines matching `/sets the base power of/` over 30 games at seeds
  1000+i gives **7/30 games, 44 resolutions, `{"rules-win":30}`, illegalCommands 0, unfinished 0**
  on the post-Phase-1 tree (6/30 and 38 before the counter policy landed — the bot now counters, so
  games play out differently; both runs are clean, which is the point),
  with lines reading `Monkey.D.Luffy sets the base power of Portgas.D.Ace to 7000 this turn.`
  The probe itself is not committed — the deck plus this recipe reproduces it in ~50s, and a
  permanent "does this verb ever fire" harness is more surface than the finding needs.
- **The `basePower` TargetFilter reads the PRINTED base, so 50 filter sites across 13 sets cannot see
  ANY "base power becomes N" effect — and SC ruling #762 says they must. Pre-existing, NOT fixed,
  wants its own branch.** `effects/targeting.ts` resolves `filter: "basePower"` as
  `basePower(card)` — the catalog value, no modifiers, no permanent effects — while `filter: "power"`
  goes through `getCardPower`. Ruling #762 (`EB03-004` Carina) settles it in the engine's own terms:
  when `OP06-009` Shuraiya's 原本的力量 *becomes* 6000 by effect, a "原本的力量 6000 or more" test
  **does** see 6000 (不会 +4000, *because* Shuraiya now counts). Shuraiya uses `setBasePowerFrom`, so
  **this has been broken since OP06 and `setBasePower` only adds a fourth way to trip it** — it is
  not a regression from that work. Live consequences with real Standard cards: `OP15-070` Fuza and
  `OP15-071` Holly lift their [Shura]/[Ohm] bodies to base 6000 on the opponent's turn, which is
  exactly when a `basePower lte N` K.O. resolves, and the engine still reads 2000 — dodging that
  removal is Fuza's whole printed function. `OP16-106` pulls a body DOWN to base 7000 and it does not
  become a legal target for a `lte 8000` K.O.
  **Two reasons it is not folded into the setBasePower work.** It changes behaviour at 50 filter
  sites across 13 sets, which is the same "own branch, before/after suite run" call already recorded
  for the trait-matching change. And it CLOSES A CYCLE: `getCardPower → getEffectiveBasePower →
  getPermanentSetBasePower → candidatePoolForTarget → matchesTargetFilter → case "power" →
  getCardPower`. The guard is keyed `setBasePower:${targetInstanceId}`, which stops the direct
  self-cycle but **not permutations across sibling instances** — structurally the `OP16-017` blowup
  moved from the cost path to the power path. Exposure is 0 today only because none of the six
  encoded targets uses a power/basePower filter. **Harden the guard on source AND target first, then
  route the filter through `getEffectiveBasePower`, then add a bench probe pairing 4 copies with a
  power-filtered target.**
- **The ATTACK-side policy cannot see a set base power; the counter step can. Split measured on the
  merged Phase 1 tree 2026-08-20 — an earlier version of this note said "nothing in
  `engine/src/automation/` imports `getCardPower`" and that is now FALSE.**
  `automation/bot-strategies.ts` imports it **zero** times, at four sites named rather than numbered
  because a sibling branch is editing this exact file: **`getTotalPower`** computes `card.power ?? 0`
  plus attached DON!! straight off the printed card; **`cardValue`** reads `card.power / 100` and
  **`valueRanked`'s `playCard` scoring** reads `card.power / 50`, both on cards in HAND; and
  **`valueRanked`'s big-body attack bonus** gates on `attacker.power >= 5000` — all printed. (Those
  were `:169-171`, `:163-164`, `:329-330` and `:342` when written. Treat every line number in this
  file as PRE-fix and tree-relative: the fix in flight shifts two of them to `:346-347` and `:359`,
  which is why the construct names are the citable part.) So attacker choice, DON!! allocation and
  attack scoring are blind to every power-changing effect. Counted rather than asserted, by the
  branch fixing it: only `greedy` (1 read) and `valueRanked` (4) consult power at all, so
  `firstLegal`/`random`/`passOnly` have zero between them — a repro puzzle fails for all five but
  for two different reasons, and only two rungs are actually fixable this way.
  **A fix is in flight on `claude/cranky-matsumoto-8d4137` and is NOT merged; do not read this note
  as stale until it is.** That branch also reports the ladder unmoved by the change — full 10-pair
  round robin, 8 of 10 pairs byte-identical, the two that moved inside ±7pt CIs — with Phase 2's
  table validated as a control first.
  **Phase 1's `automation/counter-policy.ts`
  is the exception and reads it properly**: `getCardPower(state, battle.attackerId)` and
  `getCardPower(state, battle.targetId) + battle.counterTotal` (`:415-416`), so the defender's
  counter decision DOES see a set base power. `battle.ts` resolves combat correctly either way, so
  `setBasePower` changes battle OUTCOMES and every ATTACKING choice remains blind. That matters because the primitive's headline justification is
  `OP17-005` taking Ace's Leader 5000 → 8000 for tech-slot EV, and CLAUDE.md already records the
  failure mode: *a policy that cannot use a conditional card will report that every tech card is
  bad, and that looks like a clean answer rather than a broken measurement.* **Corollary: the
  byte-identical puzzle re-run does NOT prove live play is unperturbed** — an identical result is
  equally consistent with the policy being unable to notice, and that suite cannot tell the two
  apart. `docs/simulation.md` now says so. Closing move: one puzzle whose correct attacker is only
  correct under a live `setBasePower`.
- **The `getPermanentModifierTotal` speedup HAS NOW BEEN TAKEN — 2026-08-20, the
  `permanent: narrow the source set and put the structural test first` patch and its two
  companions. Do not
  re-derive it, and do not re-open the "is it available" question.** `getCardPower` is the hottest
  read in the engine and this was the most expensive thing it called. Two fixes, both ported from
  the `getPermanentSetBasePower` sibling that already did it right: iterate `inPlaySources` (≤14
  slots) instead of `Object.values(state.cards)` (~72 cards — both decks, hands, trashes, Life), and
  run the cheap structural "does this source even carry a relevant action" test BEFORE the expensive
  `sourceEffectsAreNegated` check. Applied to **all three** of `getPermanentModifierTotal`,
  `getPermanentSetCost` and `getPermanentKeywords` — the last of which was worst, having no
  structural prefilter at all.
  **Measured in-process on one host, 200k calls, old body re-implemented locally in
  `bench/throughput.test.ts` (absolute ms is host-dependent; only these ratios are quotable):
  `getPermanentModifierTotal` **6.70x faster**, **22.7µs → 3.2µs** per call, and **1.02x with the
  patch reverted** — which is the correct red value, since the two bodies are then identical.
  (A second run read 6.75x but was taken on a tree where the SIBLING's guards were swapped for the
  slow-shape measurement below, so it is not an independent clean repeat. Quote 6.70x.) Whole-`getCardPower` effect on the same host: vanilla 10-body board **6983ms →
  611ms per 200k calls (11.4x)**, the 4x-Fuza loaded board **4871ms → 999ms (4.9x)**.
  **The port was NOT a copy-paste and the reason is now covered by a test.** The sibling has no
  `sourceIsSelfInHand` exception; `getPermanentModifierTotal` and `getPermanentSetCost` do — a card
  in HAND modifying its own cost, which is how every "give this card in your hand -N cost" ability
  works. The source set is therefore `permanentSources` = `inPlaySources` PLUS that one instance,
  deduped (a stale area-list entry pointing at a hand card would otherwise be summed twice).
  Mutating the exception out fails **3 tests in 3 files**: `op07-064-sanji`, `prb02-014-sabo`
  (`modifyCost`) and the new `op11-023-arlong` (`setCost`). **`OP11-023` Arlong is the catalog's ONLY
  permanent `setCost` reached through hand and it shipped with no test at all**, so that half of the
  exception was guarded by nothing in 6111 tests until the
  `tests: OP11-023 Arlong, the only permanent setCost reached through hand` patch added one — both sides of its
  threshold, per the OP06-054 Borsalino lesson. `getPermanentKeywords` deliberately does NOT get the
  exception: it never had one, no card grants a keyword to a card in hand, and adding it would be a
  behaviour change rather than a narrowing.
  **Two existing bench limits had to be RE-BASED, and the reason is a trap worth remembering: those
  ratios share their denominator with the term this patch shrank.** `BASE_POWER_OVERHEAD_LIMIT`
  1.6 → **4.0**, `LOADED_BASE_POWER_LIMIT` 2.0 → **5.0**. Nothing got slower — `getCardPower` got
  11.4x faster in absolute terms — but with the shared `getPermanentModifierTotal` term down from
  ~22µs to ~3µs, the same absolute setBasePower cost now reads as a larger multiple. **This made
  both guards STRONGER, not weaker**: the vanilla probe's fast-vs-slow window went from 1.04x-vs-1.80x
  (1.7x wide) to **1.93x-vs-15.74x (8.2x wide)**, re-measured by swapping the sibling's guards back.
  **Attribution: the pre-narrowing RIGHT-order figures (1.04x vanilla, 1.20x loaded) were measured
  here; the pre-narrowing WRONG-order figures (1.80x, 1.44x) are quoted from the bench's existing
  comments and were NOT re-measured.** Only the post-narrowing pair is this session's measurement.
  And **the loaded probe's standing claim that it "DOES NOT CATCH THE GUARD-ORDER REGRESSION" is now
  false** — post-narrowing it reads 3.58x right / 6.84x wrong, where before it read 1.20x / 1.44x
  and a 2.0x limit passed both. The comment is corrected in the file.
  **Verification, all on the merged Phase 1 + Phase 2 + `setBasePower` tree:** suite **6111 → 6114
  pass**, 3666 → 3667 files, reconciling exactly against the 3 tests the Arlong patch adds — 0 fail after the
  change, though the 6111 baseline run flaked once on `src/automation/bot-harness.test.ts`'s batch
  test (a timeout under full-suite parallelism on a cold tree; passes in isolation at ~20s and
  passed in the final run — pre-existing and unrelated);
  `patch_engine.py --check` exit 0 with every patch applied; `correct_cards.py --check` 48/48;
  `tools/` unittests **83 OK**; and `./scripts/simulate.sh --puzzles` reproduces **valueRanked
  9/12, greedy 11/12, firstLegal 5/12, random 0/12, passOnly 0/12** — play is unchanged end to end.
  **Those tallies are NOT the 8/11 · 10/11 · 5/11 recorded below, and the difference is not this
  patch.** Re-measured after rebasing onto the merge of the printed-power policy branch, which added
  a twelfth puzzle (`lethal-effective-power-attacker`); `valueRanked` and `greedy` pass it and
  `firstLegal` does not, so the top two rungs each gain one and `firstLegal` holds at 5. Both
  readings are correct for their own tree — quote the puzzle COUNT alongside the tally, or the
  numbers look like a policy change when the instrument grew.
  **The 1.35µs the sibling reports is NOT this function's target and never was**: the sibling's probe
  board short-circuits structurally on every source, while this one deliberately keeps one live
  modifier (`OP09-004` Shanks, the catalog's only unconditional permanent `modifyPower` reaching the
  opponent's Characters) so the old-vs-new equality check has a non-zero value to agree on. Same
  shape of work, different amounts of it.
- **Engine throughput: ~2–4 games/s single-core, host-dependent.** The 2.80 figure was measured on
  another machine and is not comparable across hosts; only within-run ratios are. Full-strength
  ISMCTS remains ~2 orders of magnitude out of reach. **But throughput has not been the binding
  constraint so far** — policy legality was (see the `orderCards` bug below), and
  `docs/engine-audit.md`'s options A–D are all speed levers that would not have found it.
- **Card-effect encoding does not templatise.** 1,092 of 1,219 normalized effect templates are
  singletons; top-100 templates cover only 34.6% of clauses. Composition, not pattern matching.
- **OP15/OP16 encoding IS complete — verified 2026-08-19, and "complete" is now a measured claim,
  not an assertion.** Per set: **119 imported = 119 definitions**, exactly. Of those, OP15 has 6
  vanilla / 113 with effect text, OP16 has 9 vanilla / 110 with effect text. Cards with effect text
  but no `effects:` encoding: **8 in OP15, 2 in OP16 = 10 — and all 10 are in
  `data/parked-clauses.json`.** So **cards unencoded AND unparked = 0**. Test files (105 OP15 /
  108 OP16) are fewer than 119 only because vanillas and parked cards need none. This is the check
  to re-run rather than trusting the count: compare `id:` against `effects:` presence against
  `cards/tests/<set>/`. (Re-measured 2026-08-20: was 3 in OP16 = 11 and 107 OP16 test files;
  `OP16-015` gained an encoding and a test when `setBasePower` was built. The vanilla split was also
  corrected from 8/111 and 10/109, which did not reconcile: **6 vanilla / 113 with text** and
  **9 / 110** are the measured buckets, and they close exactly --
  113 − 8 unencoded = 105 OP15 test files, 110 − 2 = 108 OP16. A card counts as vanilla only if it
  has NEITHER printed effect text NOR a `trigger`; there are zero trigger-only cards in either set.)
- **The parked list is complete for the sets that exist, and 2 of its 18 primitives still clear the
  "cannot scope from one card, can from thirty" bar — the third was BUILT.** Re-measured
  2026-08-20: **34 clauses over 30 cards** (OP15 26 clauses, OP16 8); coverage `partial` 22 /
  `none` 12. Clustering is the decisive part:
  - **`giveDonSourcePlayer` — 10 instances** (all OP15). Scopable now.
  - **`attachedDonTargetFilter` — 7.** Scopable now.
  - ~~**`setBasePowerLiteral` — 6**~~ — **BUILT 2026-08-20 as the DSL action `setBasePower`; all 6
    clauses are encoded and tested. See the `setBasePower` fact below.** It was on the critical path
    because `OP17-005`'s [On Play] sets Ace's Leader base power 5000 → 8000, and that is the whole
    OP17 Ace thesis; the OP17 list is now simulable in principle, once Bandai publishes the set.
  - **`returnDonStateRestriction` has 2 blockers** (`OP15-059`, `OP16-060`) and **15 of the 18 are
    genuine singletons** — including `setCounterLiteral`, the one that prompted the question (only
    `OP16-118`). By the project's own rule those stay parked; waiting for OP17 will add more
    singletons, not make singletons scopable. This mirrors the already-banked fact that 1,092 of
    1,219 effect templates are singletons.
  - **The earlier version of this note said "3 of its 20 primitives" with "17 singletons" and
    "40 clauses over 35 cards (OP15 25, OP16 10)". The three headline numbers were right in
    substance and wrong in detail: there were 19 primitives, not 20, and **15 singletons both before
    and after** -- not 17, and not the "16" an earlier version of this correction claimed
    (`returnDonStateRestriction`'s 2 blockers had been counted as a singleton, and the primitive
    that was built had 6 blockers, so removing it changed the primitive count and not the singleton
    count). The parenthetical 25/10 was a CARD split quoted against a CLAUSE total it does not sum
    to. **And "18 primitives" is only true of the `missing_primitives` array: the `parked` clauses
    reference 19 primitive ids, because `OP15-058`'s DON!!-deck-size clause cites
    `donDeckSizeRule`, which has no `missing_primitives` entry at all.** That gap is pre-existing.
    Re-derive all of these from `data/parked-clauses.json` and say which array you counted.**

  So the answer to "is the list complete enough to scope primitives?" is **yes for the remaining 2,
  no for the other 16, and OP17 will not change that split.**
- **`setBasePower` EXISTS — a literal base-power setter, built 2026-08-20 as the ten `setBasePower`
  patches of `tools/patch_engine.py`, over 5 files. Do not re-park a "base power becomes N" clause,
  and do not reach for `setPower` instead.** ***CITE PATCHES BY NAME, NEVER BY NUMBER.** "Patch N" means the
  Nth entry of that file's `PATCHES` list, and that list gets INSERTED INTO, so every number
  downstream of an insertion goes stale silently — nothing checks these. It has happened twice
  already: PR #22 inserted `tests: OP07-030 Pappag...` at position 7, pushing the
  getPermanentSetCost prefilter down one and staling five references in this file; then Phase 1
  inserted five, pushing the `setBasePower` block down five and staling four more. All nine were
  converted to names on 2026-08-21. **Note this sentence deliberately states the SHIFT and not the
  destination** — an earlier version said "to 15-24" and a third insertion would have made the
  warning itself one of the stale numbers it warns about.
  **And the number can be wrong the day it is written, not only later.** The bot-policy branch
  labelled its own patch 15 while it was in fact 14, because it counted the list by eye instead of
  asking it. So a "patch N" you read here may never have been right. If you find one, re-derive it —
  `python3 -c "import sys;sys.path.insert(0,'tools');import patch_engine as p;[print(i,x['name'])
  for i,x in enumerate(p.PATCHES,1)]"` — and do not propagate it.
  **The same applies one level down, to LINE numbers.** They are tree-relative in exactly the way
  patch numbers are position-relative, and this file cites ~16 of them. Two sessions independently
  produced "both correct, for different trees" citations of `bot-strategies.ts` — the worst kind,
  since each verifies on whichever tree its author had. Name the function or construct and treat the
  line as a hint: the older notes here survive being 1-2 lines off already (`legal.ts:181` points at
  `legal.push({` with the `declareAttack` on 182; `battle.ts:737` lands two lines into
  `legalAttackTargets`' signature) precisely BECAUSE they name the construct alongside the number.*
  Written
  `{ action: "setBasePower", target, value: 7000, duration: "thisTurn" }`.
  - **Why the three near-misses all fail.** `setPower` is the only other literal-valued power setter
    and it adds `action.value - getCardPower(target)` at resolution — a TOTAL-power set, so it
    absorbs modifiers already on the target instead of letting them stack on the new base; it is
    also invisible inside `permanentEffects`, because the permanent power path reads only
    `modifyPower` and `setBasePowerFrom`. `setBasePowerFrom` has the right arithmetic but needs a
    source CARD on the field. `copyPower` only ever retargets the effect's own card.
    **`OP07-002` Ain is the ONLY `setPower` user in the whole catalog**, and it prints "Set the
    POWER of ... to 0", which is the reading `setPower` actually implements.
  - **The design is a REPLACEMENT of the base, not a delta modifier**, and that is what makes it
    right: a `setBasePower` modifier stores the literal in `value` under its own
    `ModifierState["type"]`, and `getCardPower` substitutes it for the printed base through
    `getEffectiveBasePower` (`shared.ts`) — timed modifier first, then `getPermanentSetBasePower`
    (`effects/permanent.ts`, the twin of `getPermanentSetCost`), then the printed base. So +power
    modifiers and attached DON!! stack on top; applying the same literal twice is idempotent (two
    `OP15-070` Fuza both say 6000 about one shared [Shura] body, where a delta would say 8000); and
    it can move a card DOWN (`OP16-106` pulls a 10000 body to 7000 — no `modifyPower` value can do
    that and raise a 5000 Leader in the same clause).
  - **Rulings #909 / #910 / #994 all answer 是的 to the same question** — a Leader carrying "has
    every card's name" DOES reach the literal — so an "all of your [Name] cards' base power" clause
    takes `zones: ["leader", "character"]`. Third appearance of the C1/C2 Leader-exclusion trap
    (rulings #979/#993).
  - **Ruling #927 is what makes the stacking mandatory rather than tidy**: at 30 cards in the trash
    all three of `OP15-092`'s bullets apply, so base-9000 and +1000 must reach 10000.
  - **The duration→expiry mapping is copied from `setPower`, NOT from `setBasePowerFrom`.**
    `setBasePowerFrom` leaves `untilEndOfOpponentNextEndPhase` unmapped, so it would never expire —
    and that is exactly the duration `OP17-005` prints.
  - **The naive implementation cost 2.04x on `getCardPower`, and `getCardPower` is the hottest read
    in the engine — every battle, every legal-command enumeration, every policy score.** Measured on
    a vanilla 10-body board, 200k calls, old-vs-new bodies timed in ONE process so the ratio is not
    a cross-run comparison. The first hypothesis was wrong: narrowing the loop from
    `Object.values(state.cards)` (~72 cards) to `inPlaySources` (≤14 slots) moved the ratio only
    **2.04x → 1.91x**, and the modifier scan was never a factor at all (`getSetBasePowerModifier`
    is 0.02µs). Profiling the pieces found it: `sourceEffectsAreNegated` was being paid per source
    *before* the structural "does any in-play card even print this action" test. Reordering those
    two guards took `getPermanentSetBasePower` from **18.13µs to 1.35µs** per call and the whole
    overhead to **1.16x under load and 1.02x on an idle host** (`getPermanentModifierTotal`
    alongside it is ~25µs, which is what the remaining 1-2% is measured against). The `inPlaySources`
    narrowing was kept anyway — provably equivalent and strictly cheaper — but it was not the fix.
    `bench/throughput.test.ts` now carries the ratio as a second guard at a **1.6x** limit,
    red-green verified in both directions: the slow guard order measures 1.80x there and fails, and
    a 2.5x limit would have passed both and been decoration. Same lesson as the
    `permanent: getPermanentSetCost evaluates conditions it then discards` patch, one level
    deeper: prefilter before you evaluate anything you might discard — and profile before you
    believe a mechanism.
  - Two DIFFERENT literals on one card resolve to whichever source is scanned first, the same
    contract `getPermanentSetCost` already has. Nothing in OP15/OP16 produces that: every permanent
    user names 6000 except `OP15-092`, whose two literals land on a Character and a Leader.
  - **It broke the three OLDER base-power setters and that took a second pair of patches (17-18) to
    fix. Found by review, reproduced before fixing, and worth understanding because the shape
    recurs.** `copyPower`, `setBasePowerFrom` and `swapBasePower` each add a `type: "power"` delta of
    `desired − basePower(card)`. That was self-consistent while `getCardPower` started from the
    PRINTED base — `printed + (desired − printed) == desired` — and the `getCardPower` patch moved
    the starting point
    to `getEffectiveBasePower`, so a card carrying BOTH a literal and one of those deltas read
    `literal + (desired − printed)`: two mutually exclusive REPLACEMENTS added together. Measured on
    real cards: `OP16-106` Sanjuan.Wolf sets `OP16-104` Catarina Devon (printed 3000) to base 7000,
    Devon's `[When Attacking]` `copyPower` off a 10000 body then added +7000, and the engine returned
    **14000 where the printed text says 10000** — on the attacking body, deciding a battle. Both
    cards are yellow and legal together. Fix: those three now measure from `getEffectiveBasePower`,
    which is *identical* to `basePower` on any card without a literal, so the full suite does
    not move. `basePower` is consequently unused in `actions.ts` and the import is dropped in the
    same patch — `noUnusedLocals` is what keeps "every printed-base read was converted" honest.
    Pinned by `copyPower REPLACES this clause's set base power` in `cards/tests/OP16/106-*.test.ts`.
    **The PERMANENT `setBasePowerFrom` branch had the same defect and is ALSO fixed now — by the
    `permanent: setBasePowerFrom is a replacement, not a power delta` patch, after Codex flagged it
    on PR #26. The "bounded and known, not fixed blind" line that stood here
    was the wrong call.** The reason given for deferring was that calling `getEffectiveBasePower`
    inside `getPermanentModifierTotal` would re-enter `getPermanentSetBasePower` across siblings.
    That was true of that particular fix and irrelevant to the right one: `setBasePowerFrom` is a
    base-power REPLACEMENT, so it does not belong in the additive modifier total at all. Moving it
    onto `getPermanentSetBasePower`'s path makes two replacements SELECT — first match wins, the
    contract `getPermanentSetCost` already has — instead of accumulating, and needs no call back
    into the power path.
    **The half that actually bit was the SOURCE side, not the target side.** `OP14EB04-053` Vista is
    the only card in the catalog with `setBasePowerFrom` inside `permanentEffects`, and it targets
    ITSELF while reading the Leader as source: *"this Character's base power becomes the same as your
    Leader's base power."* With `OP15-092`'s bullet 2 setting that Leader to 7000, Vista read the
    PRINTED 5000. Ruling #762 settles it — a base power changed by an effect IS that card's base
    power for every later read. Behaviour-preserving for Vista alone (printed 4000 + delta 1000 = the
    same 5000 the replacement now returns), pinned from both sides in
    `cards/tests/OP15/092-monkey-d-luffy.test.ts`, and red-green verified.
    **Codex described the symptom as an incorrect LEADER power; that part was wrong** — Vista never
    targets the Leader — but the defect it pointed at was real.
  - **Two latent bugs in the new code, also found by review and also fixed:** the duration map
    omitted `untilEndOfYourNextTurn`, which falls through to `expiresAtTurn: null` and then NEVER
    EXPIRES — copy `modifyPower`'s map, which is the only complete one in the file, **not**
    `setPower`'s, which has the same hole; and `getPermanentSetBasePower` never evaluated the
    action-level `condition` its own type declares, failing OPEN with no capability issue and no
    judge prompt.
  - **`setPower` and `setBasePower` were INDISTINGUISHABLE on `OP16-015` and `OP16-106` until tests
    were added for it.** On a target carrying no power modifier both verbs land on the same number,
    so swapping the verb kept both files green — the exact defect class the cards' own PARKED notes
    existed to reject. Now all six cards go red under a `setBasePower` → `setPower` swap, verified by
    doing it. The trick is a target with a LIVE modifier: `op05Ohm101` at 2 Life carries its own
    permanent +1000, so 7000 + 1000 = 8000 under the right verb and 7000 under the wrong one.
  - This is **the first patch to reach outside `packages/engine`** — the Action union lives in
    `packages/types`, which is consumed from source (`main: ./src/index.ts`), so there is no build
    step. `tools/test_patch_engine.py`'s `seed_stock` had to be fixed at the same time: it wrote one
    fixture file per patch, so the three files that now carry two patches each lost an anchor and
    three tests went red. Its "every patch is PENDING, none FAILED" assertion is new and is what
    makes that class of fixture bug fail loudly.
- **The first player may not attack on their own first turn — `canAttackWith` enforces it, and it
  silently voids hand-built attack fixtures.** `if (state.turnNumber === 1 && state.activeSeat ===
  state.config.firstPlayer) return false;` in `battle.ts`. A fixture that seats the acting player as
  `firstPlayer` on turn 1 therefore has **no legal attack at all** — the only legal command is
  `endTurn`. This is not hypothetical: the first run of the puzzle suite reported `valueRanked`
  failing all five attack puzzles, and the cause was the fixture, not the policy. **When building an
  attack position, seat the acting player as the SECOND player** (`firstPlayer: "north"` when acting
  as south), or advance past turn 1. This is also why the suite asserts a SOLVABLE guard per puzzle
  rather than trusting the position.
- **The bot cannot choose an ATTACK TARGET — every attack any policy declares hits the defending
  leader. Verified 2026-08-19, do not re-derive, and it is NOT an engine rules bug.**
  `engine/legal.ts:181` emits one `declareAttack` descriptor per **attacker** with all targets bundled
  into `targetIds`; `bot-strategies.ts:81` `commandFromDescriptor` unconditionally takes
  `targetIds[0]`; and `battle.ts:737` `legalAttackTargets` pushes the defending **leader first**. All
  five ladder strategies route through that helper, `random` included — so target choice is
  unreachable, not merely unexercised. Probed on a board offering leader **and** a rested 4000 body:
  200 samples per strategy, **zero** character targets from valueRanked/greedy/firstLegal/random.
  Only exception: a `rushCharacter`-only attacker the turn it is played, where the leader is excluded.
  Unlike the `orderCards` and search-to-hand defects this produces **legal** commands, so nothing
  aborts — it is blind play, not a crash, and `patch_engine.py` does not touch it. **Consequences:**
  battle-based removal never happens in any simulated game, so every number measured so far assumes a
  board that shrinks only via card effects; `random` is NOT a control for it (same helper); the two
  `futile` puzzles' passes do **not** demonstrate target discrimination, since a leader attack always
  gains material; and a `koVsDamage` puzzle class is **not buildable as a policy measurement** — all
  five policies fail it for one architectural reason. This is the concrete mechanism behind the
  already-recorded warning that a weak policy reports every conditional tech card as bad — the whole
  point of the simulator. Attack target selection joins counter/blocker play (owned by
  `resolveBotPromptCommand`) as a thing that looks like a policy decision and is not; what is left
  policy-attributable is attacker choice, DON!! attachment, and command ordering.
- **`sim/*.test.ts` and `bench/*.test.ts` are NEVER type-checked or format-checked by the suite —
  `vp test run` passes regardless, because esbuild strips types without checking them.** They sit
  outside `vite.config.ts`'s include list and are copied into `tests/cards/` by
  `scripts/simulate.sh` at run time, so a type error in `sim/puzzles.test.ts` is invisible to every
  gate this repo otherwise runs. Found 2026-08-21 on a sibling branch, where `bench/throughput.test.ts`
  was carrying a type predicate that never narrowed (TS2345) plus a pre-existing unused destructure.
  **Check them explicitly, and note the check is real** — a deliberately planted `TS2322` in
  `sim/puzzles.test.ts` was caught, so this is not a vacuous gate:
  ```bash
  cp sim/puzzles.test.ts vendor/tcg-engines/submodules/one-piece/packages/engine/tests/cards/
  cd vendor/tcg-engines/submodules/one-piece/packages/engine && ./node_modules/.bin/vp check tests/cards/puzzles.test.ts
  ```
  `vp check` runs format, lint AND type checks. Two caveats. (a) A bare `vp check` in the engine
  reports 4 pre-existing formatting failures in `arena/*.ts` — those are UNTRACKED files our own
  `scripts/arena.sh` copies in, not upstream's and not a gate you are breaking; scope the check to
  the file you touched. (b) Establish a control before believing a failure is yours: the pre-change
  `sim/puzzles.test.ts` was formatting-clean, which is how a formatting hit was correctly attributed.
- **`battle.ts` has ALWAYS resolved combat through `getCardPower`, so power-changing effects have
  always counted in the OUTCOME — a long-standing note in `docs/simulation.md` said otherwise and
  miscredited the engine with a defect it never had.** The sentence was *"simulated combat has no
  defensive interaction whatsoever — every battle resolves on printed power plus attached DON!!"*.
  The first clause was about counters and blocks and was true when written; the second was simply
  wrong, and it predates every current branch. Corrected 2026-08-21. **Why it matters more than a
  wording fix:** anyone asking the obvious question — "does the simulator see card effects at all?"
  — would have read that and concluded no. The real split is narrower and is the whole point of the
  fix below: effects always reached the OUTCOME, and what read printed power was the POLICY, on the
  attacker's side only.
- **The bot's ATTACKER choice read PRINTED power — FIXED 2026-08-20 by the
  `bot-strategies: the policy compared PRINTED power` patch. Do not re-derive, and
  do not restate the grep that found it: on a patched tree that grep is not empty.**
  `bot-strategies.ts`'s `getTotalPower` rebuilt power as `printed + attachedDon * 1000`, while
  `battle.ts` resolves the very attack it was choosing through `getCardPower` (`basePower` + DON!!
  *only while its controller is the active seat* + power modifiers + permanent power modifiers). So
  **every power-changing effect in the game changed battle OUTCOMES while changing no policy
  CHOICE** — attacker selection and DON!! concentration disagreed with the outcome they were
  selecting for.
  **Scope it precisely.** `bot-strategies.ts` imported `getCardPower` **zero** times. But
  `grep -rn getCardPower src/automation/` is **NOT empty on a patched tree** —
  `counter-policy.ts` (the `counter-policy: the defender's counter step` patch, Phase 1) already
  does this right, so the **defender's** counter
  decision could always see power-changing effects while the **attacker's** could not.
  counter-policy.ts is the REFERENCE for how this looks, not something to change; the empty grep is
  true only of an unpatched engine, where that file does not exist yet.
  **Counted, not assumed: only 2 of the 5 rungs consult power at all** — `greedy` (1 read) and
  `valueRanked` (4). `firstLegal`, `random` and `passOnly` have **zero** between them. So no rung
  could see an effect-modified power, `random` is again **not** a control (it has no power-based
  preference to be wrong about), and the reproduction puzzle fails for all five but for **two
  different reasons** — only the two power-consuming rungs are fixed.
  **Reproduced first, as `lethal-effective-power-attacker`** in `sim/puzzles.test.ts` (class
  `lethal`, command mode). `OP10-005` Sanji **prints 3000 and plays 6000** on its controller's turn
  (`[Your Turn] This Character gains +3000 power`) beside a vanilla 5000, against a 6000 Leader on 0
  life: printed power ranks the two the wrong way round. **The fixture card was found by MEASUREMENT
  — a probe asked the engine for `getCardPower` over every character with printed power ≤ 6000 and
  reported the 7 that answer above their printed value** (largest gap wins), not by reading
  encodings. Red arm **FAIL × 5**, green arm `valueRanked`+`greedy` **pass**; `valueRanked` lethal
  **4/5 → 5/5**, and **all 14 pre-existing puzzles are byte-identical in both arms.**
  **TWO READS ARE DELIBERATELY LEFT ON PRINTED POWER — both measured, both asserted, do not
  "finish the job" by changing them.**
  (a) `valueRanked`'s `attacker.power >= 5000` big-body bonus. It is **inert** for attacker choice:
  a `declareAttack` scores `600 + 300*(Leader target) + 100*(gate) + 150*(is bestAttacker)`,
  `bestAttacker` is a single instanceId so **exactly one** attack gets the 150, and **150 > 100** —
  the gate cannot outvote it under *either* reading. Its only live effect is lifting `declareAttack`
  (1150) above `attachDon` (1050), the swing-before-buff defect already recorded. On effective power
  that defect fires SOONER (a body that just took one DON!! crosses 5000): A/B moved
  `don-concentrate-to-reach` **pass → FAIL** and `valueRanked` donAllocation **2/3 → 1/3**, changing
  nothing else. **The gate is mis-DESIGNED, not mis-sourced** — sequencing worklist, and the standing
  rule not to reweight it without re-running the ladder still applies. `lethal-effective-power-attacker`
  is the guard: its board is one where gate (printed) and bestAttacker (effective) point at different
  bodies, so a reweighting that lets the gate win turns it red.
  (b) The two reads scoring a card in HAND (`cardValue`, `valueRanked`'s `playCard`). Measured over
  the catalog: `getCardPower` on a hand instance disagrees with printed power for **0 of 1968**
  characters, and **0** permanent power modifiers target a hand zone. Routing them through
  `getCardPower` is provably a no-op today at the price of a permanent-effect sweep per hand card per
  decision — the hot path the `permanent: getPermanentSetCost evaluates conditions it then
  discards` patch exists to keep cheap. Asserted by `hand-card power is printed
  power, so the two hand reads stay printed`, so the day a card breaks this the suite says so.
  **THE LADDER DID NOT MOVE, and this was ATTRIBUTED rather than assumed.** Full 10-pair round robin,
  200 games each, `mihawk-green-proxy` mirror, against Phase 2's post-Phase-1 table as the control:
  **8 of 10 pairs byte-identical**, and the two that move go **−1.00** (`valueRanked` vs `greedy`
  57.50% → 56.50%) and **+1.50** (`greedy` vs `firstLegal` 47.50% → 49.00%) — both far inside their
  ±7-point CIs. `random vs passOnly` is 200/200 timeouts either way. Phase 2's ordering stands
  unchanged: **`valueRanked` > {`greedy` ≈ `firstLegal`} > {`random`, `passOnly`}, the last two
  unordered.** The control is trustworthy because a re-run of pair 1 on this host reproduced Phase 2's
  **57.50% [50.57%, 64.15%]** exactly — the ladder is seed-deterministic, so Phase 2's table IS the
  control and a second full arm was redundant.
  **No measurable throughput cost.** `bench/throughput.test.ts`, same host, back to back, nothing
  else running: games/s **1.32 → 1.35** (synthetic), **1.17 → 1.22** (ST01), **0.51 → 0.55**
  (oars-x4). Those look like speedups and cannot be, so they are noise — three repeats of the *same*
  patched binary spread **1.35 / 1.45 / 1.55** on synthetic, i.e. ±15%, which swamps the whole
  before/after delta. The decisive part: `cmds/game` is **identical** across arms on synthetic
  (112.3) and ST01 (140.8), so on those two decks the patch changed no decision at all and the
  comparison is pure cost — below the noise floor. (oars-x4 moved 134.0 → 130.3, so there the policy
  did play differently.)
  **The unpatched arm also settled the realism ratio, but do not read that story here** — the bench
  fact further down this file owns it, and after PR #26 it carries a better version than this branch
  had: a FRESH like-for-like pre-Phase-1 baseline (synthetic 51.9, ST01 96.9) rather than the older
  session's 51.1/94.6 this branch reasoned from. What this branch contributed there is the
  **control**: 1.11–1.18x patched and **1.12x/0.90x on an UNPATCHED arm**, which ATTRIBUTES the
  collapse to Phase 1 instead of inferring it from the mechanism. The two sessions' AFTER figures
  agreed to the decimal (112.3 / 140.8), which is what localises the old disagreement to the
  baseline alone. Never difference a before from one run against an after from another.
  Full write-up: `docs/simulation.md`.
- **The bot NOW COUNTERS — Phase 1, 2026-08-20, patch `bot-harness: resolve the counter step through
  the counter policy` plus `counter-policy: the defender's counter step, with every knob in a config
  object`. It still NEVER BLOCKS, and it still ALWAYS activates a [Trigger], and those two are
  DECISIONS, not oversights.** What was broken:
  `resolveBotPromptCommand`'s `selectCards` branch takes
  `Math.min(prompt.maxSelections, prompt.minSelections)`, which is always `minSelections`, and both
  defensive prompts are built with `minSelections: 0` — the counter step (`battle.ts:146`) and the
  block step (`engine/queue.ts:52`). Measured before the fix, not merely read: a defender holding 1
  and then 3 real counter cards took the damage both times.
  **The counter policy is a new engine file** (`src/automation/counter-policy.ts`, written by
  `tools/patch_engine.py`, so it survives a re-clone). Rule order: spend nothing when the defence
  already holds → never spend a set that fails to lift `defensePower` ABOVE `attackPower` (damage is
  binary, ties to the attacker, so a short set buys nothing) → cheapest sufficient (fewest cards
  FIRST, then lowest play value; exhaustive over subsets up to `maxCardsPerCounter`) → a CHARACTER
  target is decided here and alone, by `maxCardsForCharacter` → override on lethal / [Double Attack]
  / [Banish] → hard floor when
  `remainingAttacksThisTurn >= life` → otherwise counter iff `life <= R` where
  `R = (opponent characters + 1) + floor(opponent DON!! in play / avgCost)`, else TANK. "Tank early,
  counter late" is dominant, not a compromise: leader damage puts the life card IN HAND, usable as a
  counter the same turn — unless it has a [Trigger], which routes to resolution instead.
  **`avgCost` (default 4) is THE calibration knob and must never be quoted as a measured result** —
  same category as `SIM_TURN_BUDGET`. Every parameter is readable from `OPCG_COUNTER_*` or
  `./scripts/simulate.sh --counter avg-cost=3`, which is what makes a Phase 3 sweep a sweep instead
  of fifteen hand-runs. `enabled: false` reproduces the never-counter behaviour exactly and is the
  control arm; it is asserted, so the arm cannot rot.
  **Counter EVENTS are OFF by default (`useEventCounters: false`) and the reason is a DIFFERENT
  defect, not card evaluation:** an Event's [Counter] power grant is applied by a second
  (`selectTargets`) prompt, which this same resolver answers with `Math.min(max, min)` = the empty
  selection, so spending one trashes the card and grants nothing. Do not flip that knob without a
  targeting policy.
  **Blocking and [Trigger] declining are OPEN POLICY SURFACES by decision** — blocking has no
  waste-free rule (it trades a permanent body for ~2 cards of hand and has no threshold at which it
  is provably right), and declining a [Trigger] is a genuine value call the Official Rule Manual
  grants. Both are pinned by `the prompt resolver never blocks, and always activates a [Trigger]` in
  `sim/puzzles.test.ts` so a silent change is loud. So "taking damage gains you a card" is still only
  true for life cards WITHOUT a [Trigger].
  **Consequence for the earlier "simulated combat has NO defensive interaction at all": half of that
  is now false.** Counters happen; blocks and Trigger declines do not, and attack targets are still
  unreachable, so a body saved by a counter is purely offensive.
  **Measured behaviour over 30 real games** (three 10-game pairings, `valueRanked` both seats, 0
  illegal commands): the policy spends on **26-31% of counter prompts**. Reason mix, and two of these
  are worth knowing before reading any Phase 2 number: **`already-holds` is the LARGEST bucket
  (40-56%)** — battles the defender already wins, so the prompt exists only because the attacker
  swung something that cannot connect, which is the `futile` puzzle class showing up as a
  defender-side statistic; and **`tank` fires on only 3-6%** while the hard floor and the R horizon
  fire often, because games end in 10-14 turns and life drops under R early. Do not read that as "the
  default avgCost is wrong" — it is the quantity Phase 3 sweeps. Full tables: `docs/simulation.md`.
  **The "has-effect" observable counts FOUR collections, not one — corrected 2026-08-20 on Codex's
  PR #24 review, do not narrow it again.** `CardEffects` (`types/src/effect/effect.ts:57`) has five
  properties and an encoding may live entirely in any of them: `keywords` (a [Blocker] body!),
  `effects`, `permanentEffects`, `replacementEffects` — all abilities — plus `deckBuildingRules`,
  which is **NOT** one and is deliberately excluded because `grep -rn deckBuildingRules engine/src/`
  finds no consumer at all. Reading only `effects.effects` called **180 of 1523 counter-bearing
  character printings (11.8%) vanilla** — 164 of 1368 by distinct definition; name the unit, the
  runtime catalog counts `_pN` variants separately — and it reached both simulated decks
  (`OP16-017` x4 in ace, `OP10-032` x4 + `OP14-026` x4 in mihawk). The review named two of the four
  and missed `replacementEffects`, which is 29 of the 180, so **a fix scoped to what was reported
  would have left those wrong**; the guard therefore discovers one card per collection BY SHAPE from
  `allCards` and the mutation harness carries one mutant per clause. **Phase 3 caveat:** the flag is
  binary, so `OP14-026`'s "[Opponent's Turn] if rested, +2000 power" scores the same as a [Blocker].
  If that feature's learned coefficient comes out unstable, split the feature rather than re-weight
  it.
- **The SECOND player could illegally attack on their own first turn — FIXED 2026-08-20, patch
  `battle: neither player may attack on their own first turn`. Do not re-derive, and do not reinstate
  the prediction that it breaks the puzzle fixtures.** The Official Rule Manual's Battle Flow footnote
  is *"Neither player can attack on their first turn."* `canAttackWith` gated only on
  `state.turnNumber === 1 && state.activeSeat === state.config.firstPlayer`, and turn numbering is
  per player-turn, so the second player's own first turn is `turnNumber === 2` and passed. Now
  `state.turnNumber === (seat === state.config.firstPlayer ? 1 : 2)` — "this SEAT's own first turn",
  keyed on `config.firstPlayer` exactly as the first-turn DON!! rule in `state.ts` is.
  **Verified on a REAL match** driven through 猜拳/mulligan/startGame, four turns, each seat in each
  role: `declareAttack offered=false` on turns 1 and 2, `true` on 3 and 4, both ways round. A fixture
  cannot verify it (see below), which is why the probe walks a real match.
  **Direction of the bias it removes: every play/draw number measured before 2026-08-20 UNDERSTATES
  first-player advantage**, because the second player got one extra Leader attack. Magnitude is
  Phase 2's job — do not guess it.
  **The prediction that this "breaks the batch-2 puzzle fixtures" was WRONG.** Those fixtures seat
  south as the SECOND player at `turnNumber: 1`, and south's own first turn is turn 2, so their
  attacks stay legal and both puzzle tables are unchanged. What broke was **39 tests in 31 files**,
  all `declareAttack failed: The selected attacker cannot attack.` — 5 in upstream `src/cards`, 21 in
  upstream `tests/cards`, 5 in our grafted OP15/OP16 tests — every one a fixture that starts at
  `turnNumber: 1`, plays one `endTurn`, and attacks with the other seat on turn 2.
  **The cause is that a FIXTURE'S TURN COUNTER IS NOT THE GAME'S.** `createTestMatchState({ skipSetup:
  true })` materialises an arbitrary mid-game board and leaves `turnNumber` at 1. `buildConfig`
  already suspends three other opening-turn rules for that reason (`shuffleDecks: false`,
  `openingHandSize: 0`, `skipFirstTurnDraw: true`), so the fix is a fourth: an opt-in
  `allowFirstTurnAttacks`, set by the fixture builder and by NOTHING else. Real matches — the sim,
  the arena, `starter-decks.ts`, `bot-harness.test.ts` — build configs directly and are banned as the
  rules require. Two alternatives were measured and rejected: expressing the ban as
  `turnNumber <= 2 && activeSeat === seat` would rewrite most of the suite (**1020 of the 1248 test
  files that declare an attack use the seat trick**), and starting fixtures at `turnNumber: 3`
  silently un-sickens the 15 fixtures that use `playedOnTurn: 1` to mean "played this turn".
  **What the flag costs, so nobody discovers it later:** no fixture exercises the ban, so no card test
  can catch a regression in it. The probe asserts the flag's PRESENCE too, so deleting it fails loudly
  instead of silently reverting 39 tests.
- **The Official Rule Manual PDF uses a subset font with a shifted cmap — plain text extraction is
  garbage until you shift it back.** Every glyph is ASCII −31 (`'D'` is `c`, `'3'` is `R`, `'.'` is
  `M`), spaces are frequently absent, and `⒎`/`⒏` are the `ff`/`ffi` ligatures. **Digits do not
  survive extraction at all** (they encode below 0x20 and get dropped), so any rule stated as a
  number — Life totals, character-area limits, "reduced to 0 cards" — is NOT readable this way and
  must be checked another way. Decode with `chr(ord(c)+31)` for `0x21..0x5A`. No poppler, pypdf,
  pdfplumber or PyObjC Quartz on this machine; `./.venv/bin/pip install pypdf` was used for the read
  and no committed code depends on it.
- **`OP16-017` LittleOars Jr. made the Ace deck ~99x more expensive per command — FIXED 2026-08-19
  by the `permanent: getPermanentSetCost evaluates conditions it then discards` patch. Do not
  re-derive, and do NOT trust the mechanism this note used to give.** The cost was
  super-exponential in the number of copies in play; `sim/decks/ace-op16.json` runs 4.
  Per-command cost, mirrors at seed 7 (the only figure comparable across hosts):
  `mihawk-green-proxy` **8.24 -> 5.51 ms**, `ace-op16` **814.60 -> 14.12 ms**, ratio **98.9x -> 2.56x**.
  Deck-level, 1 game at `--turn-budget 6`: 1/2/3/4 copies **350 / 1,499 / 16,789 / 228,271 ms**
  before, **287 / 600 / 940 / 1,057 ms** after — 216x at 4 copies.
  **"Encoded decks are slow" was FALSE then and is still false** — the ~2-4 games/s figure stands.
  **THE OLD MECHANISM IN THIS NOTE WAS WRONG.** It said `getCardPower` re-enters itself across
  copies, reasoning from the card's `modifyPower … self: true`. That was structural, never profiled,
  and measurement refuted it: `getPermanentModifierTotal:power` is called **exactly once** at every
  copy count, before and after. The blowup is on the **COST** path. `getPermanentSetCost` evaluates
  every permanent effect's `conditions` *before* checking whether the effect has a `setCost` action;
  `OP16-017` has none, but its `notHasCard` condition carries `{ filter: "cost", gte 8 }`, so cost
  evaluation computes a condition it discards and that condition asks the cost of every sibling. The
  guard is keyed `${type}:${instanceId}`, which stops the direct self-cycle but not re-entry across
  permutations of siblings. `getCardCost` calls for one `getCardPower`: **2 / 52 / 2,034 / 126,224 /
  11,450,650** at 1-5 copies before, **1 / 4 / 9 / 16 / 25** after (exactly N^2).
  The fix is therefore **neither a recursion guard nor a cache** — both were proposed, both
  unnecessary. It is a three-line pre-filter mirroring `getPermanentModifierTotal`, the only one of
  that file's 14 condition-evaluating functions that already pre-filtered. Result-preserving by
  construction (the discarded condition had no consumer) and by measurement (4-game fixed-seed Ace
  mirror: identical winner sequence `LWWL`, identical commands `[100, 95, 109, 111]`, identical turns
  and aggregates; suite 6078 pass / 0 fail).
  **The lesson generalises: a mechanism inferred from an encoding is a hypothesis, not a finding.**
  This one was recorded here as fact for a day and sent two plans down the wrong path.
  **Catalog exposure after the fix is 0 for the shape that caused it:** of 12 permanent effects
  carrying a `cost` filter, no multi-copy character pairs one with a cost-path action. `OP05-097`
  (stage) and `OP10-042` (leader) do, but one copy plus the 5-slot area bounds them at Σ P(5,k)=325.
  **Consequence for the derive-from-batch plan, measured not estimated:** `ace-op16` is now
  **1,465 ms/game** (was 84.6 s). The Phase 3 sweep of 15 buckets x 2 arms x 200 games = 6,000 games
  is **2.4 h single-core** / ~0.3 h across 8 APFS engine clones, against **5.9 days** before. The
  plan's "~1 hour" was optimistic by ~2.4x; it is affordable either way, which was the point.
- **A deck-based performance guard is unreliable; construct the board — measured 2026-08-19.**
  The first Task 0.2 guard was a per-command ratio on a deck running 4 copies of `OP16-017`, and it
  **passed on the unpatched engine** at 1.55x ST01. The blowup needs copies *simultaneously on the
  board*, and that is the shuffle's call: bench seeds 1000+i never stacked them, the sim harness at
  seed 7 did and cost 3,682 ms/command on the same 50 cards. It even had a non-vacuity check, which
  passed while the measurement meant nothing. `bench/throughput.test.ts` now builds the board with
  `OnePieceTestEngine.create` and times one `getCardPower` at 1-5 copies, ascending, throwing past
  `PERMANENT_EFFECT_MS_LIMIT` (250 ms — a KNOB, not a result). Red-green verified: reverting the
  `permanent: getPermanentSetCost evaluates conditions it then discards` patch alone fails at 4
  copies in ~1.6 s; restoring it passes. It also asserts `power === 4000` at every
  board size, so a future change that alters the answer fails instead of passing quietly.
- **`scripts/bootstrap.sh` had never completed on a fresh clone — FIXED 2026-08-19.** It `cd`s into
  the engine for `pnpm install`, then invoked `tools/patch_engine.py` and `tools/correct_cards.py`,
  both of which defaulted to **cwd-relative** paths. They printed "engine not found", exited 1, and
  `set -e` aborted bootstrap **before any patch, any card correction, or the test run**. Only
  `graft_cards.py` survived, because it alone anchored on `__file__`. All three now do. Symptom to
  recognise: bootstrap ends at the graft step and `patch_engine.py --check` reports 8 PENDING.
- **`sim/catalog.json`'s `hasEffects`/`hasEffectText` flags are STALE for OP15/OP16** — it reports
  `effects=False` for `OP16-118` Portgas.D.Ace, which demonstrably has an `[On Play]` two-prompt
  search cascade, and for `OP16-017` above. Card count (2537) is current, the flags are not. Re-dump
  with `./scripts/simulate.sh --dump-catalog` before trusting them for anything.
- **A leader's printed text is NOT inert, and a printed power is NOT the power a card plays at —
  both bit this project on 2026-08-19.** `OP01-001` Roronoa Zoro, the leader BOTH seats use in all
  six batch-1 puzzles, is `[DON!! x1] [Your Turn] All of your Characters gain +1000 power`, encoded
  as a `permanentEffect` keyed on `donAttached >= 1` — so a single DON!! on the **leader** silently
  buffs every character you control. It surfaced as a 5000 body attacking at 6000 and made no sense
  until the card was read. The six batch-1 puzzles survive **only** because they hold 0 active DON!!
  so the condition cannot fire; `fixture integrity` in `sim/puzzles.test.ts` now asserts that, so
  adding DON!! to one of them fails loudly. Separately `OP13-003` Gol.D.Roger prints **7000** and
  **plays at 9000**, which silently made a puzzle built on the printed value unwinnable.
  **There is no vanilla leader in the game — all 135 have effect text**, so a synthetic position
  cannot avoid the problem by picking a "plain" leader; screen for INERTNESS instead and assert it.
  The screened set is `OP16-060`, `OP05-022` (5000) and `OP11-040` (6000).
- **There is no encoding backlog in the existing sets — it is 0, not 331/125.** Both figures
  were `coverage_report.py` bugs, now fixed: 309 cards inherit their encoding by spread
  (`{ ...baseCard, id: "..._p2" }`) and the check never followed it; 22 have a null printed
  effect written as `effect: "NULL"` and the check read the key's presence as text.
  309 + 22 = 331 and 103 + 22 = 125 — both reconcile exactly. Do not re-add this work item.
  **This measures whether a card HAS an encoding, never whether the encoding is RIGHT.**
  **Do NOT read `docs/encoding-audit.md` as closing the second question — it does not.** That audit
  compares *data to data* and *text to text*; the only things it inspects about an encoding are a
  boolean "is there one" and a regex for `trigger: "trigger"`. It never reads the DSL body against the
  printed card. **1983 definitions carry an `effects:` encoding (1771 of them pre-OP15 — re-counted
  2026-08-19 by `tools/card_deps.py`, which unlike the older count reads `_pN` variant ids; the
  earlier 1975/1763 is superseded) and exactly ONE has had its DSL read against its printed text** — `OP06-054`, and even that surfaced because the
  *text* diverged. A card whose text and encoding are wrong in the same direction is invisible to
  every check that exists today.
  **The reach half of this is FIXED — 2026-08-19, `tools/mutation_check.py --vendor-set` and
  `tools/mutation_sweep.py` now cover the vendored tree, and the sweep has been run. Do not
  re-derive it; see `docs/mutation-sweep.md`.** Measured over all 1771 pre-OP15 encodings:
  **4307 mutants, 2685 killed — 62.3%.** So **37.7% of upstream's decision surface is unprotected**:
  1622 perturbations of a filter, threshold, comparison, zone or once-per-turn flag that no test in
  the 6078-test suite detects, and **177 cards where NOT ONE mutant died**. By contrast our own
  **OP15+OP16 kill 523/523 — 100%**, same tool, same day: the difference is that those tests were
  authored with `mutation_check.py` in the loop. **Re-measured 2026-08-20 after `setBasePower`:
  542/542 across all 213 encoded cards, still 100%, 0 survivors** — and the honest caveat the tool
  itself prints, which the 523 figure did not carry: **31 of the 213 cards produce ZERO mutants**,
  so they are unperturbable rather than verified. Records: `runs/OP15.jsonl` / `runs/OP16.jsonl`
  (which SUPERSEDE the `--vendor-set` sweep's older files of the same name — same corpus, same
  operators, but 105/108 cards against 94/86 because the sweep path skips zero-mutant cards);
  gate: `./runs/mutation_shard.py --aggregate`, which exits 1 on a survivor OR a missing card.
  **Run TWICE, on two different engine states — before and after
  `actions: setBasePowerFrom/copyPower/swapBasePower measure from the effective base` and its
  companion import patch — and the two runs
  are byte-identical record-for-record, card for card and label for label.** That is the evidence
  that those two were result-preserving; it is stronger than the reasoning, which is why it was
  measured instead of argued.
  **Worst offenders, each matching a defect class already in this file:** `zone: "field"` →
  `"character"` survives **15/15** (the C1/C2 Leader-exclusion defect, rulings #979/#993); deleting
  a `cardCategory` filter survives **82%**; `eq` → `gte` survives **62%** (rulings #962/#963,
  "power N" means exactly N); `oncePerTurn` survives **48%**.
  **All 177 were triaged card by card against printed text and the SC rulings — `docs/mutation-triage.md`.
  348 of 382 survivors (91%) are fixable TEST defects, 20 are equivalent mutants, 13 are clauses no
  test executes, and exactly ONE is a suspected wrong encoding — `OP13-084`, which was already known.
  Do not re-triage these 177.** Six fixture habits explain nearly all of it: boundary-only fixtures;
  monotone containment assertions (`toContain`/`arrayContaining`/`legal === true`-only) that cannot
  see a widened candidate pool; single-candidate zones; one negative control failing several filters
  at once; `oncePerTurn` assertions masked by an already-unpayable cost (these read as the
  best-written tests); and power grants asserted only as "did the attack land" when the margin
  exceeds the 1000 mutation step.
  **Caveat on the triage, not the sweep: only the 177 FULLY vacuous cards were read. 595 more cards
  have some surviving mutants and were never triaged** — including **`OP14-020` Mihawk, which killed
  1 of 6**, so one of the two chosen decks' leaders is on no worklist. Its 5 survivors were read out
  of band and are all ordinary fixture defects. The dominant shape is a **boundary-only fixture** — `OP05-001` Sabo
  filters `power gte 5000` and its only test body is a 5000-power Character, so deleting the filter,
  flipping the comparison and shifting the value all still admit it. Same shape as `OP06-054`
  Borsalino, which was found by hand; the sweep shows it is systemic.
  **What this does NOT say, and the distinction matters: the sweep measures whether a wrong
  encoding would be CAUGHT, never whether an encoding IS wrong.** A card whose text and encoding
  are wrong in the same direction still passes every mutant. So: **card data is verified, encoding
  semantics are now *measured for detectability* but still not verified for fidelity.**
  **352 of the 1771 (19.9%) generated zero mutants under the original five operators and are outside
  the 62.3% claim entirely** — `player` scoping (~3400 sites), `zones: [...]` (1900), condition
  objects (1305) and every negative `value:` (200) were unreachable then.
  **The widening LANDED 2026-08-21: ranks 1–6 of `docs/mutation-operators.md` are implemented**
  (player flip, condition delete, negative-value sign/step, zones narrow, amount −1, drop-a-keyword),
  type-validated by applying all 5,062 mutants across 1,919 files and diffing `tsc` output. Because
  widening the instrument changes what the kill rate means, the five-operator pre-OP15 results moved
  to `runs/v2/` — the 62.3% baseline stands as measured there, and any new sweep's rate is not
  comparable to it.

- **The OP01–OP14 data defects are FIXED — 48 corrections, 2026-08-19. Do not re-find them.**
  `data/card-corrections.json` is the table; `tools/correct_cards.py` applies it to the disposable
  `vendor/` tree and `scripts/bootstrap.sh` runs it, so it survives a re-clone the same way
  `patch_engine.py` does. Re-verify with `python3 tools/correct_cards.py --check` (exit 1 if any
  correction is unapplied or has drifted). Closed: **numeric disagreements 13 → 0**, **trait value
  disagreements 29 → 0**, **trait-filter missed matches 21 cards → 0**, printed text
  1607→**1609/1666**. Suite **6078 → 6079 pass, 0 fail** (one test added). Non-`OP` packs included:
  `EB01`, `EB03`, `EB04`, `ST01`, `ST17` (inside `PRB02`).
  **`tools/verify_limitless.py` now automates the adjudication** the audit used to do by hand —
  Limitless serves `Disallow:` (empty), so fetching is explicitly permitted, and pages cache to
  `.cache/limitless/`.
  **All 48 were then second-sourced against the official Bandai list** (`en.onepiece-cardgame.com`,
  `POST freewords=<ID>&search=true`) so a bug in our own scraper could not have skewed them all one
  way: **48/48 confirmed, 0 contradicted.** Two facts from that check worth keeping: **`EB04` has no
  series id — its cards live under `?series=569114` labelled `[OP14-EB04]`**, matching the engine's
  shared `OP14EB04` directory; and **the official EN site prints counter bare, not `+2000`** (the `+`
  is a Limitless/JP convention).
  **Still open and deliberately so:** the **10 missing
  `[Trigger]` abilities**, `OP13-084`'s wrong ability, and the 445 absent card definitions.
  **`OP13-084` is no longer BLOCKED, only unfixed** — it needed a literal base-power setter and that
  primitive landed 2026-08-20. Both halves have to land together (a `card-corrections.json` text fix
  AND replacing the fabricated `[On Play]` encoding), plus new tests, since `docs/mutation-triage.md`
  records it as the one card where fixing the existing test would be wasted work.
  **The "70 Standard-legal encodings referenced by no test" figure is WITHDRAWN — the real number is
  0.** Of the 74 unmentioned ids, **63 are vanilla** (no printed effect text and no `effects:` block,
  so nothing a test could assert) and **11 have printed text but no encoding** — and all 11 were exactly
  the 8 OP15 + 3 OP16 then enumerated in `data/parked-clauses.json` (10 as of 2026-08-20: `OP16-015`
  gained an encoding with `setBasePower`). **Zero cards carry an
  `effects:` encoding with no test.** `section_tests` now prints the three buckets separately so the
  aggregate cannot be quoted as a coverage gap again; this dropped the audit's Standard-legal finding
  count from 506 to 436.

- **A wrong test FIXTURE is as invisible to a green suite as a wrong encoding — two proof cases now,
  and correcting the data is what exposed both.** Exactly 3 of 6078 tests went red, in 2 files.
  (a) `OP06-054` Borsalino, printed "5 or less" and encoded `handCount lte 4`, had a case named
  `test("does not gain Blocker with five cards in hand")` — the opposite of the card, passing. The
  audit predicted it "will actively resist the fix"; it did. (b) `tests/cards/characters/`
  `eb03-008-hibari.test.ts` used **`OP11-012` Franky as its SWORD-trait body**, but `OP11-012` is a
  Straw Hat Crew card that the engine had stored as `["Navy SWORD"]` — data and test shared one wrong
  trait, so both cases passed while asserting something the card cannot do. Fixes are the
  `tests: OP06-054's Blocker threshold...` and `tests: EB03-008 Hibari...` patches in
  `tools/patch_engine.py`: Borsalino now asserts **both** sides of the boundary (5 gains, 6 does
  not), because a one-sided threshold test is what let it hide; Hibari uses `OP11-092` Helmeppo, which
  is genuinely Navy/SWORD. **When a data correction turns a test red, suspect the test's premise
  before suspecting the correction.**

- **Filling in a missing `[Trigger]` TEXT field without its encoding is a regression, not a partial
  fix — verified by reading the engine, do not re-litigate.** Every read of the card-level `trigger`
  string is OR'd with the encoded block (`battle.ts:337`, `battle.ts:603`,
  `effects/targeting.ts:122`, `effects/actions.ts:1355`):
  `hasTrigger = hasPrintedTrigger || effectBlocksFor(card, "trigger").length > 0`, and that decides
  whether a Life card taken as damage goes to `resolution` or to `hand`. For the 10 unencoded cards
  both sides are false today, so the ability is silently skipped; adding only the text flips
  `hasPrintedTrigger` true and routes the card to `resolution` **with no block for the resolver to
  run**. Text and encoding must land together.
  Corollary, and the reason a scary-looking number is NOT a bug: **243 cards carry the literal
  `[Trigger]` marker inside their `effect` string** with an empty `trigger:` field — the engine-side
  twin of the importer's `split_trigger` bug — but they all encode their Trigger, so by that same OR
  the ability fires and play is unaffected. Only 2 of the 243 were touched, for wrong *values* not
  wrong shape (`EB01-039` had `"Ad"` for `"Add"`, `OP06-116` had `"Draw 1 cards."`). Restructuring the
  other 241 is churn.

- **Two parser traps in `tools/audit_encodings.py`, both fixed 2026-08-19 — and one had inflated the
  audit's own findings.** (a) `str_list` could not follow a `const` reference: `ST01` declares
  `const strawHat = ["Straw Hat Crew"];` and writes `traits: strawHat`, which read as `[]`, so **all
  13 ST01 cards were reported as trait defects when 12 were already correct and correctly split** —
  only `ST01-014` was real (missing `Animal`). That also inflated the missed-match table by 17 cards.
  It now returns `None`, not `[]`, for a reference it cannot resolve, so "absent" and "empty" stay
  distinct. **So the old "all 13 ST01 cards have `traits: []`" claim is withdrawn.** (b) `balanced`
  treated an apostrophe inside a `//` comment as a string opening and ran to EOF — our own OP15/OP16
  comments say `K.O.'d` — and it returned `source[start:]` instead of failing, **silently mis-scoping
  68 definitions**. Harmless in practice (fields precede the overshoot, and the audit's JSON is
  byte-identical before and after the fix) but it would read a neighbour's fields in a multi-card
  `PRB01`/`PRB02` file. Both now covered by `tools/test_correct_cards.py`, which is
  mutation-verified: 16 mutants, 0 survivors.

- **Trait matching is FIXED — whole-trait equality on both sites, 2026-08-21. Do not re-litigate.**
  Upstream stored a multi-trait card as ONE space-joined string — `OP01-003` was
  `traits: ["Straw Hat Crew Supernovas"]` — on **838 cards**, and matched traits by SUBSTRING in
  two places: `effects/targeting.ts` trait filters (**597 of 599** set `match: "includes"`) and
  `effects/conditions.ts` `leaderTrait` (substring was the **default on all 292 conditions**).
  Both are collapsed to `(card.traits ?? []).includes(expected)` — the `targeting: trait filters
  match whole traits, never substrings` and `conditions: leaderTrait matches whole traits, never
  substrings` engine patches — and the
  joined store is split into exact tokens (`tools/split_traits.py` regenerates the 840 generated
  rows of `data/card-corrections.json`; 6 more were Limitless-adjudicated by hand).
  **Premise correction vs the original note above the fold: the old substring behaviour was NOT
  "more generous than the card" on `OP16-001` Ace.** Ace's printed text is the including-form —
  "a type including \"Whitebeard Pirates\"" — which Comprehensive Rules 2-4-3-1 and the GENERAL
  包含 ruling make cover `Former Whitebeard Pirates`/`Whitebeard Pirates Allies` *by rule*;
  ruling #961 is about the **power threshold** binding both clauses, not about narrowing the
  trait. So the fix *preserves* Ace's coverage by enumerating the closure. What genuinely
  narrows is the **brace-form** cards — CR 2-4-3 makes `《X》` exact: `{Animal}` no longer reaches
  all 84 `Animal Kingdom Pirates`, `{Navy}` no longer reaches `Former Navy`/`Neo Navy`, and the
  leaderTrait collapse stops `"Roger Pirates"` conditions matching the Former Roger Pirates
  leader `OP12-001` and `"Navy"` conditions matching the Neo Navy leader `OP02-072`.
  Every printed "type including" site instead enumerates its closure over the official trait
  list (2-4-3-1): **64 upstream rows** (Whitebeard/Baroque Works/Roger Pirates filters +
  leaderTraits) on top of the **26 CP/GERMA rows**, plus the **5 OP16 source cards** edited in
  `cards/OP16/`. `match: "includes"` strings remain in the data as intent documentation only.
  **17 upstream tests pinned the defect** (slash/space-joined fixture traits, two shape
  assertions, Former/Allies bodies cast as eligible for brace references) — fixed as
  patch_engine.py entries; one of them exposed a real second bug: reprint name decorations
  (`"Bartolomeo (P-029) (Jolly Roger Foil)"`) defeat exact name references like "other than
  [Bartolomeo]", fixed for that card via `alternateNames` (the Sogeking/Usopp pattern); other
  decorated reprints have the same latent gap until one is referenced.
  Measured: suite **6079 → 6079 pass / 0 fail**, audit **false matches 170 → 0**, joined
  storage **838 → 0**, `correct_cards.py --check` and `patch_engine.py --check` green.
- **Variant printed text is not trustworthy; base text is.** 39 of 315 spread printings
  disagree with the base whose encoding they execute — 16 have lost the `−` from a debuff
  ("give 3000 power" for a card that gives −3000), 12 differ by a bracketed keyword.
  `OP02-013_p3` misspells the trait `"Whitebeard Piratess"` — the exact trait Ace keys on.
  Play is correct today because the engine runs the base's encoding. **When authoring
  OP15–OP17 encodings from printed text, read the base printing.** `tools/variant_audit.py`.
- **Card data is SOLVED for OP15/OP16 via npm — do not re-litigate the acquisition problem.**
  (The egress claim that used to sit here is superseded: see the environment-specific note below.
  On this Mac the direct card sites are reachable; the npm route is still the one the importer
  uses, and it is a mirror of the official Bandai list.)
  `one-piece-card-game-json` publishes the **official Bandai** list (its `image_url`s point
  at `en.onepiece-cardgame.com`), so it is a mirror of the primary source, not an aggregator
  summary. `tools/import_cards.py` pulls it. Validated against the engine's 2,282 hand-checked
  cards: power 100%, life 100%, cost 99.95%, counter 99.63%. `OP16-001` Ace comes back
  matching `docs/research-findings.md` verbatim.
- **Bandai prints a real 0 as `-`, the same string it prints for a field the card does not
  have — and it never prints `0`.** Verified at the source: `en.onepiece-cardgame.com`
  renders `EB01-013` Kouzuki Hiyori, a hand-checked 0-power character, as `power: -`, exactly
  as it renders a counter-less card's counter. The string `"0"` appears zero times in all
  4,674 records of the npm dataset. So the npm package is *faithful* — there is no upstream
  bug to file, and it could not fix this without the same inference we do. `numeric()` never
  had a falsy-zero coercion either; it just never received a `"0"` to coerce. Disambiguation
  is by card frame and lives in `MANDATORY` in `tools/import_cards.py`: a character always
  prints power, an event/stage always prints cost, so `-` there is 0 — but a character's
  counter is genuinely optional and only leaders have life, so `-` there stays null. Do not
  "simplify" this to a blanket `- → 0`. It affected 165 of 2,560 cards, 23 in OP15/OP16.
- **`--validate` measures coverage, not just accuracy — a dropped field is a disagreement,
  not a skip.** It used to skip any field either side left null, which is why 146 cost/power
  comparisons went unmade while it still printed power 100%. That is how the `-` defect
  shipped. Fixed 2026-08-17; power now checks 1819 cards, not 1687, and still agrees 100%.
- **`[Trigger]` in card text is two different things, and the importer used to conflate them.**
  As a *heading* it opens the card's own Trigger box; as a *keyword* it names **other** cards'
  Trigger abilities mid-sentence — "trash 1 card with a [Trigger] from your hand", "an Event or
  [Trigger]". `split_trigger()` cut at the first literal match, so on 24 cards the rest of that
  sentence was lost out of `effect` into `trigger`, and where a real Trigger box followed it was
  glued onto the fragment. Fixed 2026-08-17: a heading never follows a word, so
  `TRIGGER_HEADING_RE` in `tools/import_cards.py` requires the match not to be preceded by one.
  Over the whole dataset that accepts every heading (489 en / 491 jp) — including the four
  anchors that are not a full stop: `)`, `]`, the bare `-` blank-ability marker, and a line
  break — and rejects every keyword reference (30 en / 31 jp). **Do not "simplify" it to
  splitting on the last `[Trigger]`**: a real Trigger box can itself contain a keyword reference,
  and six cards are shaped that way (`OP03-037`, `OP03-119`, `EB04-027`, `OP14-112`, `OP14-118`,
  `P-115`). Three cards in the imported sets were affected — `OP16-080` Teach, the Blackbeard
  leader, plus `OP16-115` and `OP16-117`. Regression tests in `tools/test_import_cards.py`.
- **OP17 is not published yet — it is not missing, it does not exist upstream.** Bandai has
  not put it on the official card list. EN release 2026-08-28, SC ~2026-08-23. Re-run
  `python3 tools/import_cards.py --set OP17 --refresh` after that date; no code change needed.
- **`OP17-005` HAS the On Play, and it is a BUFF. Ping re-added it 2026-08-17, reversing the
  08-16 rejection.** Full text: *"If your opponent has a Character with 10000 power or more, give
  this card in your hand −4 cost. [On Play] Your monocolored Leader's base power becomes 8000
  until the end of your opponent's next End Phase."* Ace's `OP16-001` is **5000 base**, so this is
  **+3000**, not a cost — the old note's reasoning was simply wrong, and no Leader has 8000 base.
  It sets base power, so +power modifiers stack on top, and it lasts through the opponent's next
  End Phase, so it defends too. Provisional until Bandai publishes 2026-08-28. **Do not re-reject
  this clause**; if you think it is wrong, check `onepiece.limitlesstcg.com/cards/OP17-005`.
- **The 08-16 failure mode was not "trusted a bad source".** It was a spoiler-stage source
  changing under us, plus a reasoning error that survived because its conclusion sounded
  conservative. Treat every OP17 row as provisional until 2026-08-28 and re-diff after.
- **Egress: the blocks are environment-specific, not universal. On Ping's Mac, Limitless,
  `en.onepiece-cardgame.com` and `onepiece-cardgame.cn` all return 200.** Only `optcgapi.com`
  times out. Limitless `robots.txt` is `User-agent: * / Disallow:` — empty, so automated fetch
  is explicitly permitted; use it directly for card verification. `onepiece-cardgame.cn` serves
  **no robots.txt at all** — the "robots-blocked" note was wrong; it is a JavaScript SPA, so
  plain fetch returns an empty shell. That needs a rendering browser or its JSON API, which is
  a different problem with a different fix.
- **Aggregator card IDs are not trustworthy, not just aggregator card text.** Re-verifying OP17
  §5 against Limitless found an error in **every** row, including a wrong ID: the card the doc
  filed as `OP17-009` Rakuyo is actually `OP17-016`; `OP17-009` is Haruta, a different card.
- **Official SC rulings are now in the repo: `data/rulings-sc.json`, 1,358 rulings over 893 cards**
  (61 OP15 cards, 51 OP16 cards, plus 53 core-rules answers under `card_id: "GENERAL"`). Source:
  the Q&A PDFs from <https://www.onepiece-cardgame.cn/rules>, given by Ping 2026-08-17. Rebuild with
  `tools/parse_rulings.py`; read one card with `--card OP16-001`. **These are the specification for
  effect edge cases — consult before encoding any card.** They are also SC-native and *official*,
  which is a stronger source than anything else in this project.
- **`OP16-001` Ace's 8000 threshold binds to BOTH clauses — ruling #961.** A 7000-power Whitebeard
  Pirates Character does **not** gain [Rush] (不能). The English text is ambiguous; the ruling is
  not. Ace grants [Rush] to *8000-or-more* bodies, not to Whitebeard bodies. Do not build the deck
  on the trait alone.
- **"Power N" in card text means EXACTLY N** — rulings #962/#963 on `OP16-002` and `OP16-003`.
  Not ≤N-1, not ≥N+1. Encode as `eq`, not `gte`, unless a ruling says otherwise.
- **SC rulings acquisition is fully automated — no browser needed.** `onepiece-cardgame.cn/rules`
  is a JS SPA whose HTML is an empty shell, but it is backed by a plain JSON API and the PDFs sit
  on an ordinary static host:
  - list: `https://webadmin.windoent.com/op-public/rules/rulesinfo/webList`
  - pdfs: `https://source.windoent.com/OnePiecePc/Pdf/...`

  ```bash
  ./.venv/bin/python tools/parse_rulings.py --check   # exit 1 if anything was republished
  ./.venv/bin/python tools/parse_rulings.py --fetch    # download current PDFs and rebuild
  ```
  `--check` diffs each document's `updateTime` against the `sources` block of the last build. That
  is the hook for catching the **OPC17 QA** when OP17 lands. Track `updateTime` from the API, not
  the date shown on the page — they differ (the booster QA shows 2026-01-30 on the page and
  `2026-05-25` in the API).
- **The API lists seven official SC documents, not the four Ping downloaded.** Four are Q&A tables
  (1,358 rulings); three are prose rulebooks that parse to 0 rulings, correctly:
  - **`综合规则 Ver.1.2.0`** — the **SC Comprehensive Rules**. This is the engine-conformance target
    the charter names, now available SC-native instead of only in EN.
  - **`官方公认赛赛事守则 V1.6.0`** — SC official tournament rules. The authority for format
    questions (no side deck, Bo1, timing) in the region actually being played.
  - `官方规则指导手册 Ver.1.11` — rules guide manual.

  All seven are cached to `data/qa-cache/` (gitignored) by `--fetch`.
- **python.org Python on macOS ships without root certificates.** `import_cards.py` dies with
  `CERTIFICATE_VERIFY_FAILED` until `/Applications/Python 3.13/Install Certificates.command`
  is run once. Not a repo bug; it bites every fresh machine.
- **The benchmark deck is fixed and the re-measure is done (2026-08-17). Do not redo it.**
  `bench/throughput.test.ts` runs the 4-card synthetic deck and the engine's real 50-card
  ST01 deck back to back. **Realism ratio 1.79x per game, 0.97x per command** — re-measured
  2026-08-19 after the `getPermanentSetCost` prefilter at **1.78x / 0.96x**, i.e. unmoved, which is
  the expected result since
  neither of those decks contains the pathological shape. (The file gained a third deck and a
  constructed-board regression guard in 2026-08-19, and the setBasePower overhead guard in
  2026-08-20; the realism ratio is still the first two decks only.) **Do NOT read the realism ratio
  as a general regression guard** — 2026-08-20 measured it at 1.78x/0.95x while `getCardPower`
  itself had silently gone 2.04x, because both decks in the ratio are effect-light and a ratio of
  two equally-slowed decks does not move. That is what the in-process overhead guard is for.
  **It is also noisier than the two-decimal figures suggest**: five runs the same day on the
  pre-Phase-1 tree spanned **1.61x-1.90x per game and 0.86x-1.01x per command**, varying with host
  load, so do not read a 0.1 move as a regression.
  **BUT THE 1.78x FIGURE IS SUPERSEDED — Phase 1's counter policy collapsed the realism ratio to
  ~1.0x, and this is the one site Phase 2's "retire the superseded figures" pass did not reach.**
  Measured twice on the merged tree, agreeing: **1.16x then 1.03x per game, 0.93x then 0.82x per
  command.** The mechanism is visible in the same table and is not noise: the counter policy makes
  games much longer and does so UNEVENLY, so the two decks converge in length and a ratio that is
  essentially a game-length ratio collapses toward 1.
  | deck | cmds/game before | cmds/game after | growth |
  |---|---|---|---|
  | synthetic-4card | 51.9 | 112.3 | **2.16x** |
  | ST01-real-50 | 96.9 | 140.8 | 1.45x |
  **On the baselines, because two sessions measured this and got different BEFORE figures.** The
  51.9/96.9 above are a fresh pre-Phase-1 run on this host with the same bench binary as the after
  run — like-for-like, which is the only comparison this project treats as quotable. The 51.1/94.6
  further down this file are an OLDER session's figures and are what the bot-policy branch reasoned
  from; same direction, different host-run. The AFTER figures were independently reproduced at
  112.3/140.8 by that branch, matching to the decimal, which is what makes both measurements
  trustworthy and localises the disagreement to the baseline alone.
  This is the same effect Phase 2 recorded as "game length doubled" on the ladder deck, arriving at
  a second instrument. **Independently measured with a CONTROL by the bot-policy branch, which is
  the better evidence**: it read 1.11-1.18x/0.88-0.94x patched and **1.12x/0.90x on an UNPATCHED
  arm**, which attributes the shift to Phase 1 rather than inferring it from the mechanism as this
  note originally did. **Consequence: the "deck-realism multiplier is ~1.79x per game, making
  Option C optimistic by ~3.4x" argument below no longer rests on a current number.** Re-derive it
  before using it to size anything, and note that per-command cost stayed flat (0.82-0.93x), so the
  original conclusion — the cost is state transitions, not effect resolution — still holds.
  The audit's
  assumed 2–5x roughly holds in magnitude but its mechanism was wrong: per-command cost is flat,
  and the whole slowdown is game length (94.6 cmds/game vs 51.1). Effect resolution is not the
  bottleneck — state transitions are. See `docs/engine-audit.md`.
- **OP15 and OP16 ARE in the engine and encoded — this fact was stale and cost a session.**
  Superseded 2026-08-18 by PR #11 ("Tasks 3-18 complete: all of OP15 and OP16 encoded, tested and
  verified"). Measured after grafting: **246 card definitions across `cards/OP15` + `cards/OP16`,
  212 carrying `effects:`** and the remaining 34 genuinely vanilla; engine catalog **2,537 cards**
  (was 2,282). Known gaps are enumerated in `data/parked-clauses.json`, not left implicit.
  **`OP16-001` Ace is in the engine AND encoded** — its `[Activate: Main]` resolves through
  `grantKeyword`, and `sim/decks/ace-op16.json` is a legal 50-card mono-red Ace list that completes
  games. So is `OP14-020` Mihawk. OP17 is still absent, because Bandai has not published it.
  *The trap this leaves behind:* the old text was true when written and read as permanent, and a
  session working on a branch cut before PR #11 measured "5 of 238 encoded" on its own stale tree
  and reported Ace unplayable. **Before asserting what the engine lacks, check `git log main` and
  re-graft** — `python3 tools/graft_cards.py` is idempotent and takes seconds.
  Still true and worth keeping: having cards in `data/cards-OP16-en.json` is **not** the same as
  having them in `@tcg/op-cards`; the graft step is what closes that gap.

## What the EV tooling is for — decided 2026-08-17

The charter says "field the highest-EV deck." The archetype is nonetheless locked to Ace at
**0.87% field share** on owner preference, and `ev_analysis.py` says Nami is the EV pick at 55.22%.
Those did not compose into a decision procedure. Ping resolved it: **the EV tooling does not pick
the deck.** It has two narrower jobs.

1. **Tech-slot optimisation — the primary job (Ping, 2026-08-17).** The deck is fixed; the
   *slots* are the decision variable. As the meta moves, meta-beater cards get swapped in — his
   worked example is 1–2 copies of `OP17-016` Rakuyo against aggro. The question the simulator
   exists to answer is **"which 1–2 cards raise my win rate against the field I will actually
   face"**, not "which deck is best."
2. **Field forecasting** — what will Ping actually face, so those slots and the mulligans can be
   tuned to it.
3. **Tripwire** — the condition under which Ace is abandoned despite preference.

**This changes the objective function and the critical path.** Marginal EV *per slot* is not
derivable from a leader-vs-leader matchup matrix — a 50-card list differing by 2 cards is the same
row in that matrix. It requires simulation at card granularity, which requires OP15/16/17 encoded
in the engine. **Next action #3 is therefore the critical path, not #2.** Everything else in the
engine track is downstream of it.

The tripwire is **qualitative, not numeric — Ping's call, 2026-08-17.** He has not set a points
threshold and may not. The standing criterion is: **a structural deficiency is decisional; a points
gap is not.** So do not escalate "Ace is N points behind" no matter how large N is. Escalate when
the deck's plan is broken at the mechanism level — its enablers do not turn on against the real
field, its core loop is answered by something ubiquitous, a key piece is banned or rotated.

Rationale, and it is sound: this is Ping's first competitive deck, pilot skill is the binding
constraint, Ace is tempo (near the most pilotable thing in the format) while the decks the numbers
favour — Teach, Big Mom — are the hardest to pilot in the set. The EV table ranks decks *as played
by experts*. Reps on one deck beat a theoretical edge that gets misplayed.

## Repo map

```
CLAUDE.md                       this file
README.md                       public-facing overview
docs/charter.md                 goal, decisions, open questions
docs/engine-audit.md            engine comparison, throughput measurements, options A-D
docs/research-findings.md       all verified competitive data (matrix, leaders, OP17)
tools/ev_analysis.py            field-weighted EV + Nash + sensitivity   <- run this
tools/coverage_report.py        card-effect encoding coverage against the vendored engine
tools/variant_audit.py          alternate-art printings vs the base encoding they inherit
tools/audit_encodings.py        is the encoding RIGHT (not just present) -> docs/encoding-audit.md
tools/mutation_check.py         can a card's tests FAIL — serial, one mutant per test run
tools/mutation_sweep.py         the same verdicts in disjoint batches, ~17x faster
tools/card_deps.py              which test files can exercise which card (shared attribution)
runs/                           mutation sweep results, one jsonl per set
runs/mutation_shard.py          run mutation_check over OP15/OP16 in parallel clones, and GATE on it
docs/mutation-sweep.md          the sweep's findings
docs/mutation-operators.md      what the operators cannot see, and what to add next
tools/verify_limitless.py       fetch/parse Limitless card pages; the adjudicator, automated
tools/correct_cards.py          apply data/card-corrections.json to the disposable vendor/ tree
data/card-corrections.json      48 verified card-data corrections, with from/to/why per field
tools/import_cards.py           card data for sets the engine lacks, via npm (in-policy)
data/cards-OP15-en.json         imported OP15, 119 cards
data/cards-OP16-en.json         imported OP16, 119 cards
arena/log.ts                    decision corpus: append-only NDJSON, one record per decision
arena/replay.ts                 replayMatch — reconstruct a recorded game from (config, commands)
tools/mutation_check_arena.py   mutation harness for arena/log.test.ts (13 mutants, 0 may survive)
tools/mutation_check_engine.py  mutation harness for the ENGINE patches + counter policy (15 mutants)
tools/analyse_playdraw.py       play/draw split per arm + PAIRED differences between arms (Phase 2.2)
bench/throughput.test.ts        throughput benchmark + 3 guards: patch-8 permanent-effect scaling,
                                setBasePower overhead on a vanilla board (<=1.6x) and on a
                                board where 4 setBasePower clauses are live (<=2.0x)
sim/decks/ace-op16-setbasepower-probe.json   ace-op16 + 4x OP16-015; plays setBasePower live
data/op16-matchup-matrix.json   the matchup matrix, machine-readable
data/card-coverage.json         all 2,282 cards classified encoded/gap/vanilla
scripts/bootstrap.sh            clone + install the vendored engine, run its tests
vendor/                         gitignored; created by bootstrap.sh
```

## Commands

```bash
python3 tools/ev_analysis.py                      # who is the best deck right now
python3 tools/ev_analysis.py --sensitivity Teach  # how fragile is that answer
./scripts/bootstrap.sh                            # ~2 min; ends with the engine suite passing
python3 tools/coverage_report.py --exclude-promos # encoding backlog
python3 tools/audit_encodings.py --json data/encoding-audit.json  # is the encoding RIGHT
python3 tools/correct_cards.py --check            # are the 48 corrections still applied (exit 1 if not)
./runs/sweep_all.sh                               # mutation-sweep every pre-OP15 encoding (~35 min)
./runs/status.sh                                  # aggregate the sweep

# OP15/OP16 are the sets this repo OWNS. mutation_sweep.py DOES cover them (sweep_all.sh launches
# both), but only via --vendor-set, which mutates the grafted copy and attributes tests by imported
# symbol; --set reads the pristine encoding from cards/ and is the documented-correct path for these
# two, and only --set has no batched implementation. Serially ~4-5h for 213 cards; this shards it
# over APFS clones, ~1h on 5 workers. Not a new verdict path -- one `--card` process per card.
# WITHOUT --fresh it RESUMES from runs/<SET>.jsonl and therefore verifies nothing.
mkdir -p .mut   # BSD cp will NOT create the destination's parent
for n in 1 2 3 4 5; do cp -Rc vendor/tcg-engines .mut/w$n; done
./runs/mutation_shard.py --clones .mut/w1 .mut/w2 .mut/w3 .mut/w4 .mut/w5 --fresh
rm -rf .mut                                       # the clones are disposable; nothing else reads them
./runs/mutation_shard.py --aggregate              # the gate; exit 1 on a survivor OR a missing card
python3 tools/mutation_check.py --vendor-set OP06 # mutation-check one upstream set, serially
python3 tools/verify_limitless.py OP06-054        # what does the adjudicator actually print
python3 -m unittest discover -s tools -p 'test_*.py'   # tools/ regression tests (76)
node --test arena/log.test.ts                     # decision-log suite (14); needs NO engine clone
python3 tools/mutation_check_arena.py             # prove those 14 can fail (13 mutants)
python3 tools/mutation_check_engine.py           # prove the Phase 1 engine guards can fail (~5 min)
python3 tools/analyse_playdraw.py <dir>          # play/draw arms: paired gap differences with CIs
./scripts/arena.sh --replay arena/logs/<f>.jsonl --contested   # read a played game back
./scripts/simulate.sh --puzzles --counter avg-cost=3 --counter enabled=0  # vary a counter-policy knob

# throughput benchmark AND 3 guards. (1) the getPermanentSetCost prefilter: fails loudly if permanent-effect
# evaluation starts re-entering itself again. (2)+(3) setBasePower: fails if the base-power lookup
# costs getCardPower more than 1.6x its pre-primitive body on a vanilla board, or 2.0x on a board
# where four permanent setBasePower clauses are live. Both measured in-process against a locally
# re-implemented old body, because absolute ms is host-dependent and only in-run ratios are quotable.
# The vanilla probe is the one that catches a guard-order regression (1.77x); the loaded probe is the
# only coverage the per-source condition/candidate-pool loop has at all.
# NOTE this file is NOT in the suite by default -- the 6111 count excludes it, and copying it in
# makes the suite report 6112. CONSEQUENCE WORTH KNOWING: nothing type-checks or lints this file
# unless you copy it in and run `vp check` there. `vp test run` on it passes regardless, because
# esbuild strips types without checking them -- a `Boolean(id)` type predicate that never
# narrowed sat in it from 2026-08-20 until a citation sweep on 08-21 happened to run vp check.
# Run `vp check tests/cards/throughput.test.ts` after editing this file, not just the test.
cp bench/throughput.test.ts vendor/tcg-engines/submodules/one-piece/packages/engine/tests/cards/
cd vendor/tcg-engines/submodules/one-piece/packages/engine && ./node_modules/.bin/vp test run tests/cards/throughput.test.ts
```

`ev_analysis.py` needs numpy; scipy is optional (Nash is skipped without it).
The `tools/` tests are stdlib `unittest`, matching the tools' own stdlib-only constraint.

## Next actions, in priority order

1. **Re-check OP17 spoilers for Mihawk.** None found in the ~135 revealed cards. If he gets support,
   `docs/research-findings.md` §4 flips and Mihawk becomes viable.
2. **Build the Ace OP17 list.** Skeleton is the OP16 Red Ace deck; first slot-in is `OP17-005`
   Edward Newgate (12000 power, cost −4 vs a 10000+ board, so effectively 6-cost — and Ace's leader
   grants it [Rush]). Its [On Play] also takes Ace's Leader 5000 → 8000 for a full turn cycle.
   That is the whole thesis. Second: 1–2 `OP17-016` Rakuyo as anti-aggro tech (Ping's call), but
   see §5 — the removal suite and the discount want opposite fields and rarely both switch on.
3. ~~Generate engine card definitions for OP15/OP16~~ — **DONE, verified 2026-08-19.**
   119 imported = 119 definitions per set, 0 cards unencoded-and-unparked, 213 test files. The
   remaining work is not encoding, it is the DSL primitives below.
   ~~**Build `setBasePowerLiteral` first — it blocks item 2.**~~ — **DONE 2026-08-20.** It is the
   DSL action `setBasePower`, the ten `setBasePower` patches of `tools/patch_engine.py`, and all 6
   parked clauses are
   encoded and tested. Item 2 is unblocked on the engine side; what still blocks it is Bandai not
   having published OP17.
   **Next up, and in this order: `giveDonSourcePlayer` (10 clauses, all OP15) then
   `attachedDonTargetFilter` (7).** Neither blocks OP17, so neither is on the critical path — they
   are the two remaining primitives that can be scoped from real cases rather than from one card.
   Leave the 15 singleton primitives parked.
4. **Measure policy quality, in this order — then and only then pick a Tier-3 lever.**
   Ping approved this sequence 2026-08-19. The audit's four options are all *throughput* levers, and
   **throughput buys precision, never freedom from bias.** A weak policy does not merely add noise to
   a tech-slot measurement; it biases it in a predictable direction — see the note below.
   1. ~~**Dominance ladder**~~ — **RE-MEASURED 2026-08-20 in Phase 2, and the TOTAL ORDER IS GONE.**
      Full round robin, all 10 pairs, 200 games each, post-Phase-1, `mihawk-green-proxy` mirror; two
      unresolved cells extended by 400 more games at a fresh seed. **Do not restate the old chain
      `passOnly < random < firstLegal < greedy < valueRanked` — two of its five relations no longer
      hold.** What holds: **valueRanked > { greedy ≈ firstLegal } > { random, passOnly }, with random
      and passOnly UNORDERED.**
      - `valueRanked > greedy` **56.50% [52.50, 60.41]** over 600 games — was **76.0%**. The default
        policy is still not "greedy wearing a hat", but the margin fell by a factor of ~3.4.
      - `valueRanked > firstLegal` **56.50% [52.50, 60.41]** over 600 games.
      - `greedy ≈ firstLegal` **49.33% [45.35, 53.33]** over 600 games — a TIE. Was a strict win.
      - `random vs passOnly` **200 of 200 games time out**, so neither wins any: a timeout is 双方败北
        and scores against both. The pair cannot order its policies at all. Was 22 timeouts (11%).
        **That 100% is sensitivity to `SIM_TURN_BUDGET` (40 turns), NOT a real-world timeout rate** —
        the same warning as before, now with more force.
      - The top three all beat both bottom rungs **100.00%** [98.12, 100].
      **The collapse is ATTRIBUTED, not left hanging.** A 2×2 on `valueRanked` vs `greedy`, 200 games
      per cell: the attack ban alone costs **−10.5 pts**, the counter policy alone **−15.5 pts**, both
      together **−18.5 pts** (sub-additive). Both changes add decisions that are not
      policy-attributable — countering is resolver-owned and identical for every rung — so they dilute
      the attacker-side difference the ladder measures.
      **The instrument was validated first: the [ban OFF, counters OFF] cell reproduced the published
      76.0% [69.6, 81.4] as 76.00% [69.63, 81.39]**, which is what licenses reading the rest as an
      effect of Phase 1 rather than harness drift.
      Full tables: `docs/simulation.md`.
   2. ~~**Puzzle suite**~~ — **DONE 2026-08-19**, both batches. `./scripts/simulate.sh --puzzles`,
      **14 positions in 5 classes**, every class verified against engine source before authoring.
      **HEADLINE: `greedy` 10/11 beats `valueRanked` 8/11 — the default policy is the worse of the
      two, and every point of the gap is command ORDER.** `valueRanked` adds +100 to a
      `declareAttack` when the attacker's PRINTED power is ≥5000, lifting the swing (1150) above the
      DON!! attach (1050), so it swings before it buffs and then wastes the DON!! on a body that has
      already rested; `greedy`'s two scores tie at 800 and the stable sort puts `attachDon` first
      because `legal.ts` emits those descriptors earlier (line 152 vs 171). In
      `seq-attach-then-swing-for-lethal` that costs `valueRanked` **the game**.
      **This does NOT overturn the step-1 ladder** — `valueRanked` beat `greedy` 76.0% over whole
      games and both results stand. What it establishes: **the ladder gap does not come from DON!!
      sequencing**, and where it does come from is still unmeasured. Do not "fix" `valueRanked` by
      deleting the +100 without re-running the ladder; the puzzles measure 11 hand-built positions,
      the ladder measures 200 games.
      By class, `valueRanked`: lethal 4/4, futile 2/2, donAllocation 2/3, **sequencing 0/2**.
      `seq-spread-not-concentrate` is a **shared** blind spot — both policies hard-code "concentrate
      DON!! on the best attacker" and the position rewards spreading — so the plan's ask for a
      `greedy`-specific failure was not met, and that is reported rather than forced.
      **Batch 1's published numbers are unchanged** (valueRanked 6/6, greedy 6/6, firstLegal 5/6,
      random 0/6) and must stay that way: batch 1 scores ONE command with no decision context, batch
      2 plays the WHOLE turn with a seeded LCG. Feeding real randomness to batch 1 moved `random`
      from 0/6 to 4/6 — an instrument change, not a policy change. **Never average the two modes.**
      **Structural lessons, all still load-bearing:** (i) the answer is **adjudicated by the engine**,
      never by a hand-written predicate — one misclassified south's own leader attack, and the
      SOLVABLE/DISCRIMINATING guards cannot catch a *mislabelled* answer, only a broken or vacuous
      one; (ii) `valueRanked`'s result is **asserted** per puzzle via `expect`, or the suite exits 0
      through a regression to 0/14; (iii) batch-2 guards enumerate the **whole legal line space**
      (up to depth 6, 209 lines on the two-body two-DON!! positions), which is why the suite needs a
      60s timeout; (iv) an opponent-reply puzzle also asserts **THREATENED** — passing the turn must
      actually lose, or the position asks nothing; (v) every new guard was **mutation-checked**, five
      mutants, all confirmed red.
      Full table and mechanism: `docs/simulation.md`; plan and outcome: `docs/plans/policy-puzzle-batch-2.md`.
   3. ~~**Rules fidelity + a counter policy**~~ — **DONE 2026-08-20, Phase 1 of
      `docs/plans/engine-fidelity-and-derived-counter-policy.md`.** Neither player may attack on their
      own first turn; the bot counters, on a parameterised policy; blocking and [Trigger] declining
      are documented open surfaces. Engine suite unchanged at 3666 files / 6079 tests / 0 failures.
      (**That 3666/6079 counts `bench/throughput.test.ts` copied into `tests/cards/`, which is not
      part of the suite.** A clean tree with nothing copied in is **3665 files / 6078 tests / 2
      skipped / 0 failures** — re-measured 2026-08-20. The recurring off-by-one in this file is
      always the bench file; check `tests/cards/` for stray copies before treating a count as a
      regression.)
      Both facts above are updated in place — read them, not this line.
   4. ~~**Phase 2: re-measure the baseline ONCE.**~~ — **DONE 2026-08-20.** The full 10-pair round
      robin, the play/draw split and the puzzle suite, all against the merged Phase 1 tree, with the
      pre-Phase-1 instrument reproduced first. Three findings that change later work: the total order
      is gone, the play/draw gap is deck-specific (and the deck this project measured it on is unfit),
      and the policy signal on the ladder deck fell ~3.4x while game length doubled — so **Phase 3
      must be sized against the Phase 2 numbers, not against anything older.** Both facts above are
      rewritten in place; read them, not this line.
   5. **Meta calibration** — sim matchup win rates against the 213k-game EN ladder matrix.
      **Newly possible:** this repo used to note that no matchup between two *different* decks had
      ever been simulated because `OP16-001` Ace was not in the engine. OP15/OP16 encoding is now
      complete, so real deck-vs-deck calibration is available for the first time. This is the
      charter's own validation layer 3.
   6. **Oracle agreement** (deferred) — grade the cheap policy against an expensive deep search on a
      few hundred sampled positions. **This dissolves the throughput objection:** "full-strength
      ISMCTS is ~2 orders of magnitude out of reach" is true for using search as the policy in
      *every game*, and false for using it as an *offline grader on a sample*.
   7. **Human benchmark** (deferred) — Ping plays 10–20 games against the bot. Highest validity,
      lowest volume. If a first-time pilot crushes it, no further measurement is needed.

   **Why this matters more here than for a generic simulator, and the exact failure mode to fear.**
   The simulator's job is tech-slot optimisation: a differential of maybe 1–3 points between two
   50-card lists differing by 2 cards. Tech cards are precisely the cards whose value is conditional
   and timing-sensitive — `OP17-005` is −4 cost *only* against a 10000+ board, `OP17-016` Rakuyo is
   dead outside aggro matchups. **A policy that cannot use a conditional card will report that every
   tech card is bad, and that looks like a clean answer rather than a broken measurement.** It
   compounds with the no-sideboard arithmetic: a card dead outside one 10%-share matchup must swing
   it >9 points to break even, and that large required ΔWR is being measured on exactly the cards a
   weak policy evaluates worst.
   **Do not resolve this by arguing that Ping is a novice so a weak policy is representative.**
   bot-weak ≠ novice-weak: a novice mistimes a counter, a weak bot orders cards by identity because
   that is the placeholder. The failure modes do not overlap, so a weak policy is not a model of a
   novice — it is a model of nothing. The novice argument applies to *deck choice* (pilotable Ace
   over Teach), where it is already banked and already decided.

   **Decision rule:** spend on throughput only once measured policy quality is no longer the binding
   constraint. If the puzzle suite shows the policy misses lethal 30% of the time, speed only samples
   a broken policy more precisely. Two measured corrections to the audit still stand: the
   deck-realism multiplier is ~1.79x per game (flat per command, so the cost is state transitions,
   not effect resolution), making Option C optimistic by ~3.4x; and the calibration evidence that
   would trigger Option A/B is much weaker than it looked — the play/draw gap is small on a real Block
   2+ deck, not the 54.5 pts ST01 showed. **Phase 2 re-measured that second clause and it survives
   with different numbers: `ace-op16` is −2.50 pts. But the "8.5 pts" this sentence used to quote is
   retired** — it was measured on the broken first-turn rules, and the same-class `mihawk-green-proxy`
   comes out at +34.50, so "a real Block 2+ deck" is not one number.
5. **Both upstream items are sent — nothing outstanding, just waiting on maintainers.**
   - Fix: <https://github.com/TheCardGoat/tcg-engines/pull/216> — 2 files, +56/−3, `MERGEABLE`,
     **ready for review** (opened as a draft per their `CONTRIBUTING.md`, promoted once issue #217
     took the one open design question off it). Validated in a clean upstream clone:
     `ci:one-piece:check` 10/10, `vp check` clean, test red without the fix.
   - Test wiring: <https://github.com/TheCardGoat/tcg-engines/issues/217>.

   **Temper expectations on both.** The public repo is an export mirror of a private canonical one:
   of 211 PRs, the recent merged ones are all `eduardomoroni` / `TheCardGoat-BOT` "Public sync"
   commits, with no external-contributor PRs in that history, and only 5 issues have ever been
   opened. Neither may get a response, and that is not a reason to re-litigate the work.
   Record: `docs/upstream/README.md`.

## Open questions only Ping can answer

1. ~~Target event and date~~ — **answered 2026-08-17: no event yet.** Format is settled
   (**Bo1, Swiss + top cut, 30-minute rounds**); only the occasion is missing. **There is no
   deadline**, so the earlier advice — freeze a list, favour reps over list quality, treat the
   engine as building for the *next* format — no longer applies. Build the engine properly. When
   an event does appear, re-read the 30-minute clock and Bo1 variance notes before choosing a list.
2. ~~Acquisition budget ceiling (RMB)~~ — **answered 2026-08-19: no cap.** Consistent with the
   charter's "no ceiling" on project budget, and it now covers card acquisition too. Practical
   consequence: **cost stops being a tiebreak in slot decisions.** Do not propose a weaker card
   because it is cheaper, and do not treat "needs 4 copies of a SEC" as an objection. The binding
   constraints remain pilotability and the 30-minute clock, not money.
3. Is SC OP17 the same list as JP/EN OP17, or does it carry SC-exclusive content? (The 08-17
   parity confirmation was scoped to banlist and rotation only — this is still open.)
4. **SC-native field data — source named 2026-08-19, acquisition NOT built.** Ping: the iOS app
   **集换社 (JiHuanShe)** carries both a **share pie chart** and **tournament top-cut decklists**
   for SC. That is exactly the two things missing — `docs/research-findings.md` shares are a
   Limitless EN proxy and the matchup matrix is an EN ladder. **This is the input that finally lets
   the "corrected by SC-native sources" half of the ground-truth decision be finished.**
   **The data is app-only — Ping confirmed 2026-08-19. There is no scraper to build; stop looking.**
   `https://www.jihuanshe.com` does return 200 and serves no robots.txt, so the *domain* is
   reachable, but the pie chart and top-cut decklists are reachable only inside the iOS app. Do not
   re-litigate this as an acquisition problem — it is not one, it is a **manual transcription**
   problem. **The realistic route is Ping reading the figures off and pasting them**, which is
   entirely adequate: a hand-entered SC share table beats a 213k-game EN proxy for this purpose,
   because the defect in the EN numbers is *population*, not sample size. What to ask him for when
   the time comes: the share pie chart (leader → % of field) and the top-cut decklists, plus the
   event size and date so the sample can be weighted. Until then every share-weighted number in
   `docs/research-findings.md` stays an EN proxy and must be labelled as one.

**Answered 2026-08-17: SC matches other regions on banlist and rotation.** Both were open since
day one. Note precisely what this does and does not buy: an identical *legal pool*, not an
identical *metagame*. Shares (Limitless) and the matchup matrix (opdecks.xyz ladder) are both
still EN, so every share-weighted number in `docs/research-findings.md` remains an EN proxy and
the "corrected by SC-native sources" half of the ground-truth decision is unfinished.

## Working notes

- Ping is building his **first competitive deck**. Piloting skill is the binding constraint, not list
  quality — the gap between a deck's ceiling and a new pilot's realised win rate dwarfs the 2–3 point
  spreads in the matrix. Weight pilotability accordingly, and say so when it conflicts with raw EV.
- Ace and Mihawk are both **fringe decks** (0.87% and 1.02% of the OP16 field). This was flagged and
  accepted knowingly. Do not silently re-litigate it, but do report honestly if the gap widens.
- Ping pushes back on method, correctly. Show your working and flag your own biases before he has to.
- Source quality varies wildly. Limitless and official Bandai pages are reliable. `shonentcg.com`
  reported 65–72% leader win rates and was excluded as an SEO farm. Verify card text against
  `onepiece.limitlesstcg.com/cards/<ID>`, never against aggregator summaries — two of them returned
  garbled leader effects and a decklist that summed to 48.
