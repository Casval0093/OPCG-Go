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
  "Whitebeard Piratess"-class typo in the encodings. **That clears the filter *values* only —
  the trait *matching semantics* are separately broken, and that is not this note. Do not read
  this as "traits have been checked": see the trait-matching fact below.** Blast radius was **171 of the 185 encodings
  with a `search` action** (every one that reveals to hand), and only 19 are OP15/OP16 — the other
  152 are upstream's own cards. Fix is patch 2 in `tools/patch_engine.py`; A/B on the 10-game Ace
  mirror with the arena's masking retry disabled: **`illegal-command=1` → `rules-win=10`**. Engine
  suite 3370 pass / 0 fail. **Sent upstream as a draft PR 2026-08-19 on Ping's authorisation** —
  <https://github.com/TheCardGoat/tcg-engines/pull/216>. That does not reopen the `orderCards`
  decision: Ping's 2026-08-17 "stays local" call stands for that one, and `patch_engine.py` remains
  permanent regardless of whether #216 merges.
- **Upstream never ran ~2000 of its own per-card tests; we now do — FIXED 2026-08-19, quote 6078.**
  `packages/engine/vite.config.ts` sets `test.include` to `tests/cards/**` plus four named files —
  **not** `src/cards/**`, where **2065** test files live. Only 26 of their basenames appear under
  `tests/cards/` at all, leaving **1972 with no running counterpart**. Pristine arithmetic confirms
  the include list accounts for everything that ran: **1384 + 4 = 1388**, exactly the file count a
  stock `vp test run` reports. **This is why the search-to-hand bug in patch 2 survived** —
  `OP12-086` Koala's own test file is one of the 1972.
  **Patch 3 in `tools/patch_engine.py` turns them all on: 1601 → 3666 files, 3370 → 6078 tests,
  0 failures, 89s → 87s.** +2065 files and +2708 tests for no measurable wall clock (`isolate: false`,
  and transform/import dominate). Nothing needed fixing; they were only unwired. Measured twice — by
  hand-editing the include, then through `patch_engine.py` — identically. **Our OP01–OP14 conformance
  baseline roughly doubled at zero cost, so quote 6078, not 3370.** (The suite is **6079** as of
  the 2026-08-19 card corrections, which added one boundary test; 6078 remains the right figure
  for what patch 3 itself bought.)
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
- **The first player takes 1 DON!! on their first turn, not 2 — FIXED 2026-08-19, patch 4.**
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
  DON!! rule with it. **Two upstream tests asserted the old value and are corrected by patch 5** —
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
- **Do not calibrate on ST01.** The play/draw gap is **54.5 pts** on ST01, **26.7** on a vanilla
  Block 2+ pile, and **8.5 pts** on a real Block 2+ deck — the last of which is plausible. The gap
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
  clauses at all.
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
- **Engine throughput: ~2–4 games/s single-core, host-dependent.** The 2.80 figure was measured on
  another machine and is not comparable across hosts; only within-run ratios are. Full-strength
  ISMCTS remains ~2 orders of magnitude out of reach. **But throughput has not been the binding
  constraint so far** — policy legality was (see the `orderCards` bug below), and
  `docs/engine-audit.md`'s options A–D are all speed levers that would not have found it.
- **Card-effect encoding does not templatise.** 1,092 of 1,219 normalized effect templates are
  singletons; top-100 templates cover only 34.6% of clauses. Composition, not pattern matching.
- **OP15/OP16 encoding IS complete — verified 2026-08-19, and "complete" is now a measured claim,
  not an assertion.** Per set: **119 imported = 119 definitions**, exactly. Of those, OP15 has 8
  vanilla / 111 with effect text, OP16 has 10 vanilla / 109 with effect text. Cards with effect text
  but no `effects:` encoding: **8 in OP15, 3 in OP16 = 11 — and all 11 are in
  `data/parked-clauses.json`.** So **cards unencoded AND unparked = 0**. Test files (105 OP15 /
  107 OP16) are fewer than 119 only because vanillas and parked cards need none. This is the check
  to re-run rather than trusting the count: compare `id:` against `effects:` presence against
  `cards/tests/<set>/`.
- **The parked list is complete for the sets that exist, and 3 of its 20 primitives have already
  cleared the "cannot scope from one card, can from thirty" bar.** 40 clauses over 35 cards
  (OP15 25, OP16 10); coverage `partial` 26 / `none` 14. Clustering is the decisive part:
  - **`giveDonSourcePlayer` — 10 instances** (all OP15). Scopable now.
  - **`attachedDonTargetFilter` — 7.** Scopable now.
  - **`setBasePowerLiteral` — 6** (spans both sets). Scopable now, and **on the critical path**:
    `OP17-005`'s [On Play] sets Ace's Leader base power 5000 → 8000, which CLAUDE.md records as the
    whole OP17 Ace thesis. Without this primitive the OP17 list cannot be simulated at all.
  - **17 of the 20 primitives are singletons** — including `setCounterLiteral`, the one that
    prompted the question (only `OP16-118`). By the project's own rule those stay parked; waiting
    for OP17 will add more singletons, not make singletons scopable. This mirrors the already-banked
    fact that 1,092 of 1,219 effect templates are singletons.

  So the answer to "is the list complete enough to scope primitives?" is **yes for the top 3, no for
  the other 17, and OP17 will not change that split.**
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
  Full write-up: `docs/simulation.md`.
- **The bot NEVER counters and NEVER blocks — verified 2026-08-19, do not re-diagnose.**
  `resolveBotPromptCommand`'s `selectCards` branch takes
  `Math.min(prompt.maxSelections, prompt.minSelections)`, which is always `minSelections`; both
  defensive prompts are built with `minSelections: 0` — the counter step (`battle.ts:146`) and the
  block step (`engine/queue.ts:52`). So the selection is always empty. **Measured, not merely read:**
  a defender holding 1 and then 3 real counter cards took the damage both times, and an ACTIVE
  character carrying the genuine `blocker` keyword was offered in the prompt and declined.
  **Combined with the attack-target fact above, simulated combat has NO defensive interaction at
  all** — every battle resolves on printed power plus attached DON!!. This is Task 5's answer and it
  is worse than "plays counters badly": it never plays them. **It is not a mark against any policy**
  — the strategy never sees a prompt — but it biases every matchup the simulator produces, and it
  hits exactly the cards a tech-slot A/B is meant to evaluate. Asserted by `the prompt resolver never
  counters and never blocks` in `sim/puzzles.test.ts`.
  **The resolver also ALWAYS activates a [Trigger]** — the life-damage prompt is `choiceKind:
  "confirm"` with `activate`/`skip` (`battle.ts:197`) and the confirm branch picks `activate`
  unconditionally. Per the Official Rule Manual this is a real choice: you may activate the
  [Trigger] **instead of** adding the card to your hand, or decline and bank the card unrevealed. So
  the bot never banks a Trigger life card, and "taking damage gains you a card" is only true for
  life cards WITHOUT a [Trigger]. Third member of the same family as counter/block: resolver-owned,
  looks like policy, is not.
- **The SECOND player may illegally attack on their own first turn — found 2026-08-19 by auditing the
  Official Rule Manual, NOT yet patched.** The manual's Battle Flow footnote is
  *"Neither player can attack on their first turn."* `canAttackWith` (`battle.ts:712`) gates only on
  `state.turnNumber === 1 && state.activeSeat === state.config.firstPlayer`, and turn numbering is
  per player-turn, so the second player's own first turn is `turnNumber === 2` and passes. Measured:
  turn 1 north (first) `declareAttack offered=false` correctly, **turn 2 south (second)
  `offered=true`** — wrong — turns 3 and 4 correctly true. It is the only first-turn attack gate in
  the engine (`state.ts:780` is the DON!!/draw one).
  **Direction of the bias: every play/draw number so far UNDERSTATES first-player advantage**, because
  the second player gets one extra Leader attack (anything they play is summoning-sick, so it is the
  Leader only). That covers the 8.5 pts on a real Block 2+ deck, 26.7 on a vanilla pile and 54.5 on
  ST01. Magnitude is unmeasured until a re-run — do not guess it.
  **Fixing it will break the batch-2 puzzle fixtures**, which sit at `turnNumber: 1` with
  `firstPlayer: "north"` while acting as south. The durable fix for a fixture is to **advance past
  turn 1**, not to rely on the seat trick; the suite's SOLVABLE guards will fail loudly rather than
  silently mis-score. Bundle this with the counter-policy patch, since that already forces a ladder
  re-run.
- **The Official Rule Manual PDF uses a subset font with a shifted cmap — plain text extraction is
  garbage until you shift it back.** Every glyph is ASCII −31 (`'D'` is `c`, `'3'` is `R`, `'.'` is
  `M`), spaces are frequently absent, and `⒎`/`⒏` are the `ff`/`ffi` ligatures. **Digits do not
  survive extraction at all** (they encode below 0x20 and get dropped), so any rule stated as a
  number — Life totals, character-area limits, "reduced to 0 cards" — is NOT readable this way and
  must be checked another way. Decode with `chr(ord(c)+31)` for `0x21..0x5A`. No poppler, pypdf,
  pdfplumber or PyObjC Quartz on this machine; `./.venv/bin/pip install pypdf` was used for the read
  and no committed code depends on it.
- **`OP16-017` LittleOars Jr. made the Ace deck ~99x more expensive per command — FIXED 2026-08-19,
  patch 8. Do not re-derive, and do NOT trust the mechanism this note used to give.** The cost was
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
  `PERMANENT_EFFECT_MS_LIMIT` (250 ms — a KNOB, not a result). Red-green verified: reverting patch 8
  alone fails at 4 copies in ~1.6 s; restoring it passes. It also asserts `power === 4000` at every
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
  printed card. **1975 definitions carry an `effects:` encoding (1763 of them pre-OP15) and exactly
  ONE has had its DSL read against its printed text** — `OP06-054`, and even that surfaced because the
  *text* diverged. A card whose text and encoding are wrong in the same direction is invisible to
  every check that exists today. `tools/mutation_check.py` is the right instrument but resolves cards
  from `<repo>/cards/`, i.e. **OP15/OP16 only**; upstream's encodings and tests live in `vendor/` and
  are out of its reach. So: **card data is verified, encoding semantics are not.**

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
  **Still open and deliberately so:** the trait-*matching* change (below), the **10 missing
  `[Trigger]` abilities**, `OP13-084`'s wrong ability (needs `setBasePowerLiteral`), and the 445 absent
  card definitions.
  **The "70 Standard-legal encodings referenced by no test" figure is WITHDRAWN — the real number is
  0.** Of the 74 unmentioned ids, **63 are vanilla** (no printed effect text and no `effects:` block,
  so nothing a test could assert) and **11 have printed text but no encoding** — and all 11 are exactly
  the 8 OP15 + 3 OP16 already enumerated in `data/parked-clauses.json`. **Zero cards carry an
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
  trait, so both cases passed while asserting something the card cannot do. Fixes are patches 6 and 7
  in `tools/patch_engine.py`: Borsalino now asserts **both** sides of the boundary (5 gains, 6 does
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

- **Trait matching is structurally unsound, and the fix is two halves that do not work alone.**
  Upstream stores a multi-trait card as ONE space-joined string — `OP01-003` is
  `traits: ["Straw Hat Crew Supernovas"]` — on **838 cards**. Our own OP15/OP16 store `["A","B"]`
  correctly, so this is upstream's defect. `effects/targeting.ts` branches on `match: "includes"`
  to a **substring** test, which is what makes the joined store work at all — and **597 of 599
  trait filters set it**. It is also why **19 of the 164 official traits are proper substrings of
  another official trait**, producing **170 Standard-legal false matches** (was 175; the trait-value corrections removed the `SWORD` and `The Vinsmoke Family` rows): `Animal` matches all 84
  `Animal Kingdom Pirates`, `Navy` matches `Former Navy`/`Neo Navy`, and **`Whitebeard Pirates`
  matches `Former Whitebeard Pirates`/`Whitebeard Pirates Allies` (10 Standard)** — which is
  `OP16-001` Ace's key trait, so the engine is currently **more generous than the card in the
  direction that flatters the Ace deck**, against ruling #961 which makes the grant narrower.
  **Splitting the joined values is a precondition, not the fix**: with traits split and `includes`
  kept, `"Former Whitebeard Pirates".includes("Whitebeard Pirates")` is still true. Both halves are
  required — (1) split the 838 values, (2) collapse the `targeting.ts` branches to
  `(card.traits ?? []).includes(expectedTrait)`. **Step 2 leaves all 597 `match: "includes"`
  declarations untouched**, because once traits are split that is already what they mean; the only
  casualties are the **21 filters with genuine prefix intent**, `CP` (14) and `GERMA` (7), neither
  of which is an official trait. This is an engine behaviour change, so it wants its own branch and
  a before/after 6078-test run — do not fold it in with the data corrections.
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
  2026-08-19 after patch 8 at **1.78x / 0.96x**, i.e. unmoved, which is the expected result since
  neither of those decks contains the pathological shape. (The file gained a third deck and a
  constructed-board regression guard in 2026-08-19; the realism ratio is still the first two decks
  only.) The audit's
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
tools/verify_limitless.py       fetch/parse Limitless card pages; the adjudicator, automated
tools/correct_cards.py          apply data/card-corrections.json to the disposable vendor/ tree
data/card-corrections.json      48 verified card-data corrections, with from/to/why per field
tools/import_cards.py           card data for sets the engine lacks, via npm (in-policy)
data/cards-OP15-en.json         imported OP15, 119 cards
data/cards-OP16-en.json         imported OP16, 119 cards
arena/log.ts                    decision corpus: append-only NDJSON, one record per decision
arena/replay.ts                 replayMatch — reconstruct a recorded game from (config, commands)
tools/mutation_check_arena.py   mutation harness for arena/log.test.ts (13 mutants, 0 may survive)
bench/throughput.test.ts        throughput benchmark + the patch-8 per-command regression guard
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
python3 tools/verify_limitless.py OP06-054        # what does the adjudicator actually print
python3 -m unittest discover -s tools -p 'test_*.py'   # tools/ regression tests (56)
node --test arena/log.test.ts                     # decision-log suite (14); needs NO engine clone
python3 tools/mutation_check_arena.py             # prove those 14 can fail (13 mutants)
./scripts/arena.sh --replay arena/logs/<f>.jsonl --contested   # read a played game back

# throughput benchmark AND the per-command regression guard (patch 8). Fails loudly if
# permanent-effect evaluation starts re-entering itself again.
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
   119 imported = 119 definitions per set, 0 cards unencoded-and-unparked, 212 test files. The
   remaining work is not encoding, it is the 3 scopable DSL primitives below.
   **Build `setBasePowerLiteral` first — it blocks item 2.** `OP17-005` sets Ace's Leader base power
   5000 → 8000 and that is the OP17 thesis; 6 parked clauses across OP15/OP16 already pin the
   semantics, so it can be scoped from real cases rather than from one. Then
   `giveDonSourcePlayer` (10 clauses) and `attachedDonTargetFilter` (7). Leave the 17 singleton
   primitives parked.
4. **Measure policy quality, in this order — then and only then pick a Tier-3 lever.**
   Ping approved this sequence 2026-08-19. The audit's four options are all *throughput* levers, and
   **throughput buys precision, never freedom from bias.** A weak policy does not merely add noise to
   a tech-slot measurement; it biases it in a predictable direction — see the note below.
   1. ~~**Dominance ladder**~~ — **DONE 2026-08-19**, `./scripts/policy_ladder.sh`, **full round
      robin, all 10 pairs**, 200 games each, post-patch-4 engine.
      **Measured total order: `passOnly < random < firstLegal < greedy < valueRanked`** — win counts
      4-3-2-1-0, every pair decisive, **no cycles** (checked, not assumed). The pair that mattered
      went the default's way: **`valueRanked` beats `greedy` 76.0% [69.6, 81.4]**, so the default is
      not "greedy wearing a hat".
      **Three things previously written here as known were refuted by measurement:**
      (a) `firstLegal` beats `random` 98.0%, so **`random` is the honest no-policy control** — the
      legal-command list leads with plays and attacks while random throws turns away on pass;
      (b) `passOnly`'s timeouts are **opponent-dependent** — 0 in 9 pairs, but **22 (11%) in
      `random vs passOnly`**, because when both sides are incompetent neither closes inside the clock
      and the result is 双方败北. Both the original claim ("mostly timeouts") and its first correction
      ("0 timeouts, loses outright") were wrong as stated; the second was measured only against
      competent opponents. **That 11% is sensitivity to `SIM_TURN_BUDGET` (40 turns), NOT a
      real-world timeout rate** — the turns-to-minutes mapping is uncalibrated, so it must never be
      quoted against the 30-minute clock. What it does show is narrower: the timeout **scoring path**
      fires only when neither side can close, and scores a double loss rather than a win;
      (c) an 8-pair version of this claimed the same total order **while never having played
      `random` vs `passOnly`** — pairwise policy strength need not be transitive, so a total order
      may only be stated when every pair has been played. **Keep the round robin complete.**
      **The first-turn DON!! fix did not move the ladder — for the 8 pairs that have a pre-fix
      number.** The pre-fix run covered only 8 of 10, so `greedy vs passOnly` and `random vs passOnly`
      are first measurements, not re-measurements, and **the 22-timeout pair is one of them** — the
      fix can be neither credited nor cleared there. For the 8, all within noise, because the mirror
      alternates seats so the surplus DON!! fell on both policies equally.
      **A ceiling inference from the greedy gap is RETRACTED — do not re-derive it.** The gap between
      the top two rungs measures the spacing of five hand-picked heuristics, not the distance to a
      ceiling: an already-optimal `valueRanked` against a merely-poor `greedy` gives the same margin.
      **No ladder result may be used to argue for or against buying throughput.** The decision rule
      below survives untouched because it rests on the *bias* argument, not on this.
      Full table: `docs/simulation.md`.
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
   3. **Meta calibration** — sim matchup win rates against the 213k-game EN ladder matrix.
      **Newly possible:** this repo used to note that no matchup between two *different* decks had
      ever been simulated because `OP16-001` Ace was not in the engine. OP15/OP16 encoding is now
      complete, so real deck-vs-deck calibration is available for the first time. This is the
      charter's own validation layer 3.
   4. **Oracle agreement** (deferred) — grade the cheap policy against an expensive deep search on a
      few hundred sampled positions. **This dissolves the throughput objection:** "full-strength
      ISMCTS is ~2 orders of magnitude out of reach" is true for using search as the policy in
      *every game*, and false for using it as an *offline grader on a sample*.
   5. **Human benchmark** (deferred) — Ping plays 10–20 games against the bot. Highest validity,
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
   would trigger Option A/B is much weaker than it looked — the play/draw gap is 8.5 pts on a real
   Block 2+ deck, not the 54.5 pts ST01 showed.
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
