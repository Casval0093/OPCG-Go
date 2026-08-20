#!/usr/bin/env python3
"""Apply OPCG-Go's local fixes to the vendored engine.

`vendor/` is gitignored and recreated by bootstrap, so anything edited there by hand is lost on the
next clone. Fixes live here instead and are re-applied by `scripts/bootstrap.sh`. Each patch is
idempotent and refuses to apply blindly: it verifies the anchor text still exists and skips if the
fix is already present, so an upstream refactor produces a clear failure rather than a silent
no-op.

`patch_engine.py` is permanent, not a stopgap: Ping decided 2026-08-17 that the orderCards fix
stays local (docs/plans/encode-op15-op16.md), so these patches must survive upstream drift
indefinitely. That is what `--check` is for.

    python3 tools/patch_engine.py            # apply anything outstanding
    python3 tools/patch_engine.py --check    # report only; EXIT 1 if any patch is not applied

`--check` exits non-zero for a PENDING patch as well as a broken one, so it works as a CI gate:
an engine that merely has not been patched yet is just as wrong to test against as one whose
anchor has moved. Applying (the default) exits 0 on success -- only `--check` gates.
"""

from __future__ import annotations

import argparse
import os
import sys

# Anchored on this file, not on the caller's cwd: `scripts/bootstrap.sh` has to `cd` into the engine
# for `pnpm install` and then invoked this by absolute path, so a cwd-relative default resolved to
# nothing, the script exited 1, and `set -e` aborted bootstrap before it ever applied a patch or ran
# the suite. `tools/graft_cards.py` already anchors this way, which is why it was the only one of the
# three that survived the `cd`.
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE = os.path.join(REPO_ROOT, "vendor/tcg-engines/submodules/one-piece/packages/engine")

# --- Patch 1: the bot cannot resolve `orderCards` prompts -----------------------------------
#
# `resolveBotPromptCommand` branches on four of the six ChoiceKinds and lets `orderCards` fall
# through to `optionId = prompt.options[0]?.id`. An orderCards prompt wants a full permutation in
# `selectedIds`; a lone optionId is rejected with "Prompt resolution could not be applied", and
# runBotMatch treats one rejected command as fatal.
#
# Measured on a Block 2+ mono-green deck, 20 games:
#   stock    3/20 games completed (15%), orderCards 17 seen / 17 rejected
#   patched  20/20 completed (100%), 0 rejections, 890 prompts resolved
#
# Ordering cards *well* is a strategy question. Ordering them *legally* is not, and this is only
# the legality fix — identity order is as good a default as any until a real policy exists.

ORDERCARDS_ANCHOR = """  if (prompt.choiceKind === "confirm") {"""

ORDERCARDS_FIX = """  // OPCG-Go patch: `orderCards` needs a full ordering in selectedIds, not a single optionId.
  // Without this branch the prompt falls through to `optionId = options[0].id`, the engine rejects
  // it, and runBotMatch abandons the game. Identity order is a placeholder policy, not a good one.
  if (prompt.choiceKind === "orderCards") {
    return {
      type: "resolvePrompt",
      seat,
      promptId: prompt.id,
      selectedIds: prompt.options.map((o) => o.id),
    };
  }

  if (prompt.choiceKind === "confirm") {"""

# --- Patch 2: search-to-hand is gated on open CHARACTER slots ------------------------------
#
# `effectSearchSelection` in effects/resolution.ts rejects a selection when
#   selectedIds.filter(cardType === "character").length > openCharacterSlots
# and it applies that test for EVERY search, including one whose `revealDestination` is "hand".
# Adding a card to your hand does not need a board slot, so with a full character area (0 open
# slots) the engine refuses every Character the prompt just offered.
#
# The two halves disagree, which is why this looks like a filter bug and is not one. Prompt
# creation in effects/actions.ts folds `openCharacterSlots` into `destinationCapacity` ONLY for
# `revealDestination === "character"`; resolution applies it unconditionally. The trait/name
# filters are fine -- on OP16-118 Ace the prompt's own `eligibleIds` is correct and every rejected
# card is in it.
#
# Reproduced on OP16-118 Portgas.D.Ace: 4 bodies down, Ace takes the 5th slot, [On Play] looks at
# 5, prompt marks Monkey.D.Luffy `enabled: true` and lists it in `eligibleIds`, and resolving it
# returns `accepted: false` / "Prompt resolution could not be applied."
#
# Blast radius is not one card: 171 of the 185 encodings with a `search` action reveal to hand,
# and only 19 of those are OP15/OP16. The other 152 are upstream's own cards, so like the
# orderCards bug above this belongs upstream.
#
# The fix mirrors actions.ts -- gate the slot test on the destination. The `playableEligibleIds`
# membership test on the line above still constrains a hand reveal, so nothing is loosened for
# `revealDestination === "character"`.

SEARCH_SLOTS_ANCHOR = """        selectedIds.some((instanceId) => !playableEligibleIds.includes(instanceId)) ||
        selectedIds.filter(
          (instanceId) => getCardForInstance(state, instanceId).cardType === "character",
        ).length > openCharacterSlots ||"""

SEARCH_SLOTS_FIX = """        selectedIds.some((instanceId) => !playableEligibleIds.includes(instanceId)) ||
        // OPCG-Go patch: only a search that PLAYS what it reveals needs open character slots.
        // A search revealing to hand does not, and gating it here rejected selections that the
        // prompt in actions.ts had already marked eligible whenever the board was full.
        (context.action.revealDestination === "character" &&
          selectedIds.filter(
            (instanceId) => getCardForInstance(state, instanceId).cardType === "character",
          ).length > openCharacterSlots) ||"""

# --- Patch 3: src/cards per-card tests are never executed -----------------------------------
#
# `packages/engine/vite.config.ts` sets `test.include` to `tests/cards/**` plus four named files.
# It does NOT cover `src/cards/**`, where 2065 `*.test.ts` files live -- 1972 of them with no
# same-named counterpart under `tests/cards/`. So roughly two thousand per-card tests never ran.
#
# This is how the search-to-hand bug in patch 2 survived: `OP12-086` Koala's own test file is one
# of the 1972, so a full Character area was never exercised against a hand reveal.
#
# Measured here, enabling all of them:
#   before   1601 files / 3370 tests / 85-89s
#   after    3666 files / 6078 tests / 85s      +2065 files, +2708 tests, ZERO failures
#
# It is effectively free: `isolate: false` plus transform/import dominating means wall clock does
# not move. An earlier note in CLAUDE.md warned a bulk enable might surface pre-existing failures
# outside the OP12 sample -- it does not. Nothing needed fixing; they were simply not wired in.
#
# Filed upstream as https://github.com/TheCardGoat/tcg-engines/issues/217.

SRC_CARDS_TESTS_ANCHOR = """      "src/automation/bot-harness.test.ts","""

SRC_CARDS_TESTS_FIX = """      "src/automation/bot-harness.test.ts",
      // OPCG-Go patch: upstream never included these, so ~2000 per-card tests never ran. Enabling
      // them adds 2065 files / 2708 tests, all passing, at no measurable wall-clock cost.
      "src/cards/**/*.test.ts","""


# --- Patch 4: the first player takes 2 DON!! on their first turn, and should take 1 -----------
#
# `finalizeBeginTurnRefresh` places `Math.min(2, player.donDeckCount)` every DON!! Phase with no
# first-turn exception, so the player going first opens on 2 active DON!! instead of 1.
#
# The rule: a player places 2 DON!! from their DON!! deck each DON!! Phase, EXCEPT the first
# player's first turn, when they place only 1. It is first-player compensation and it is the pair of
# the skipped first draw, which this engine *does* implement (`skipFirstTurnDraw`,
# Comprehensive Rules 6-3-1). Only half the compensation was there.
#
# Measured before the patch, Ace mirror, seed 7 (`turnNumber active=seat  north | south`):
#   turn 1 active=north   north 2a/0r don (8 left) hand 5   <-- first player, should be 1a/9 left
#   turn 2 active=south   south 2a/0r don (8 left) hand 6
#
# Why the condition is written this way: `state.config.firstPlayer` is authoritative by the time
# turn 1 begins -- the 猜拳 winner's `chooseFirstPlayer` overwrites the config value during setup
# (CLAUDE.md), so it names whoever actually leads. The alternative signal, `skipDraw`, would work
# today because it is true exactly once per game, but it is derived from a config flag a caller can
# switch off, which would silently take the DON!! rule with it. Turn number plus seat cannot be
# misconfigured.
#
# THIS CHANGES EVERY PLAY/DRAW NUMBER MEASURED BEFORE IT. The first player has been running a turn-1
# DON!! surplus, so the first-player advantage in docs/simulation.md is overstated by an unknown
# amount and its 8.5-point Block 2+ gap needs re-measuring.

FIRST_TURN_DON_ANCHOR = """  const player = getPlayer(state, seat);
  const placedDon = Math.min(2, player.donDeckCount);"""

FIRST_TURN_DON_FIX = """  const player = getPlayer(state, seat);
  // OPCG-Go patch: the first player places only 1 DON!! on their first turn. A player places 2 each
  // DON!! Phase otherwise. This is the pair of the skipped first draw (Comprehensive Rules 6-3-1),
  // which this engine already implements via `skipFirstTurnDraw`; without this branch the leading
  // player opens on 2 DON!! and gets half the compensation but none of the cost.
  // `state.config.firstPlayer` is authoritative here: the 猜拳 winner's `chooseFirstPlayer`
  // overwrites it during setup, so it names whoever actually leads.
  const isFirstPlayersFirstTurn = state.turnNumber === 1 && seat === state.config.firstPlayer;
  const placedDon = Math.min(isFirstPlayersFirstTurn ? 1 : 2, player.donDeckCount);"""


# --- Patch 5: two upstream tests assert the pre-fix DON!! behaviour --------------------------
#
# Patch 4 makes the first player place 1 DON!! on their first turn. Two tests in
# `tests/index.test.ts` were written against the old flat 2 and fail after it. Both are correcting
# the TEST, not accommodating the fix -- they assert a state the official rules do not permit:
#
#   1. `supports accepting a mulligan...` asserts `players.south.activeDon === 2` immediately after
#      startGame. South wins 猜拳 in `startGameCommands()` and chooses itself as first player, so the
#      correct value is 1.
#   2. `plays a stage, activates it, ...` plays two 1-cost cards (Otama, then Windmill Village) on
#      south's first turn. On 1 DON!! the second play is refused, `stageArea` stays null, and the
#      test dies on `Unknown card instance: null` rather than a clean assertion. Its subject is the
#      stage's power projection, not the opening DON!! count, so it is given a turn cycle to breathe:
#      south ends, north ends, and south acts on turn 3 with 3 DON!!.
#
# Note this is NOT the `skipFirstTurnDraw` flag being off. `src/shared.ts` defaults it to
# `config.skipFirstTurnDraw ?? true`, so first-player compensation is ON in these tests -- they take
# the skipped draw and still expect the un-reduced DON!!. That is upstream encoding the bug, which is
# why patch 3 is unconditional rather than hung off that flag.

MULLIGAN_DON_ANCHOR = """    expect(started.state.players.south.activeDon).toBe(2);"""

MULLIGAN_DON_FIX = """    // OPCG-Go patch: south wins 猜拳 and chooses itself first, so it places 1 DON!!, not 2.
    expect(started.state.players.south.activeDon).toBe(1);"""

STAGE_TURN_ANCHOR = """  test("plays a stage, activates it, and projects the modified character power", () => {
    const started = runCommands(createMatch(buildConfig()), startGameCommands());"""

STAGE_TURN_FIX = """  test("plays a stage, activates it, and projects the modified character power", () => {
    // OPCG-Go patch: this test plays two 1-cost cards, and the first player now opens on 1 DON!!.
    // Give it a full turn cycle so south acts on turn 3 with 3 DON!! — the subject under test is the
    // stage's power projection, not the opening DON!! count.
    const started = runCommands(createMatch(buildConfig()), [
      ...startGameCommands(),
      { type: "endTurn", seat: "south" },
      { type: "endTurn", seat: "north" },
    ]);"""


# --- Patch 6: two upstream tests assert the card data that data/card-corrections.json fixes -------
#
# Both are the failure mode docs/encoding-audit.md is built around: a per-card test asserts that the
# encoding matches *the text the encoder read*, so when that text was wrong the test is wrong in the
# same direction and passes. Correcting the data turns them red, which is the proof the correction is
# real -- these two are the only red in 6078 tests.
#
# `OP06-054` Borsalino is printed "5 or less cards in your hand" and was encoded `handCount lte 4`,
# with a case literally named "does not gain Blocker with five cards in hand". Rather than move the
# number by one, assert BOTH sides of the corrected boundary: 5 gains, 6 does not. A single-sided
# threshold test is what let the defect hide.

BORSALINO_ANCHOR = """  test("does not gain Blocker with five cards in hand", () => {
    const { borsalinoId, engine, lifeBefore } = attackBorsalinoController(5);"""

BORSALINO_FIX = """  // OPCG-Go patch: printed "5 or less", encoded `lte 4`, and this case asserted the opposite of the
  // card and passed. data/card-corrections.json moves the threshold to 5; both sides of the boundary
  // are asserted now so the next wrong threshold cannot hide in a one-sided test.
  test("gains Blocker with five cards in hand", () => {
    const { borsalinoId, engine, lifeBefore } = attackBorsalinoController(5);
    const blocker = engine.pendingDecision("battleBlocker", "north").steps[0];

    expect(blocker?.kind).toBe("selectEntity");
    if (blocker?.kind !== "selectEntity") throw new Error("Expected Borsalino's Blocker choice.");
    expect(blocker.candidates.map((candidate) => candidate.ref.id)).toContain(borsalinoId);
    engine.resolveDecision("battleBlocker", { selectedIds: [borsalinoId] }, "north");

    const view = engine.getView("north");
    expect(view.players.north.lifeCount).toBe(lifeBefore);
    expect(
      view.players.north.characters.find((card) => card?.instanceId === borsalinoId)?.rested,
    ).toBe(true);
  });

  test("does not gain Blocker with six cards in hand", () => {
    const { borsalinoId, engine, lifeBefore } = attackBorsalinoController(6);"""

# `EB03-008` Hibari's test used `OP11-012` Franky as its SWORD-trait body. Limitless prints
# OP11-012 as Straw Hat Crew; the engine stored ["Navy SWORD"]. So the test and the card data shared
# one wrong trait and both assertions passed. `OP11-092` Helmeppo is genuinely Navy/SWORD (checked on
# Limitless, 7000 power) and still beats the 3000-power Doma that both tests attack.

# `OP07-030` Pappag's negative case asserted a condition that is unconditionally true, so the test
# could not fail for any reason. `decisions[].title` is `prompt.label` (src/projection.ts:590) and
# the blocker prompt's label is built as `${playerName} may block` (src/engine/queue.ts:55) — the
# substring "Blocker" never appears in any prompt label, so
# `decisions.some((d) => d.title.includes("Blocker"))` is always false and `.toBe(false)` always
# passes. Found by the 2026-08-19 mutation sweep: deleting Pappag's `name: "Camie"` filter changed
# nothing detectable. The replacement is the idiom the Borsalino patch above already uses.

PAPPAG_ANCHOR = """    expect(
      withoutCamie
        .getView("south")
        .decisions.some((decision) => decision.title.includes("Blocker")),
    ).toBe(false);"""

PAPPAG_FIX = """    // OPCG-Go patch: this asserted `decisions.some(d => d.title.includes("Blocker"))` is false.
    // No prompt label ever contains "Blocker" — the blocker prompt is labelled "<player> may block"
    // — so the assertion was true by construction and the test could not fail. Assert the prompt is
    // absent instead, which is what the case claims to check.
    expect(() => withoutCamie.pendingDecision("battleBlocker", "south")).toThrow();"""

HIBARI_ANCHOR = """import { eb01Doma005, eb03Hibari008, op11Franky012 } from "@tcg/op-cards";"""

HIBARI_FIX = """// OPCG-Go patch: this test used OP11-012 Franky as its SWORD body, but OP11-012 is a Straw Hat Crew
// card -- Limitless prints "Straw Hat Crew" and the engine wrongly stored ["Navy SWORD"]. Both cases
// passed only because the card data and the test shared the same wrong trait, which is exactly the
// OP06-054 failure mode. OP11-092 Helmeppo is really Navy/SWORD and at 7000 power still beats Doma.
import { eb01Doma005, eb03Hibari008, op11Helmeppo092 } from "@tcg/op-cards";"""


# --- Patch 8: getPermanentSetCost evaluates conditions it is about to throw away ---------------
#
# `OP16-017` LittleOars Jr. made `sim/decks/ace-op16.json` ~200x slower than every other deck, and
# the cost was EXPONENTIAL in the number of copies in play. Measured on this host, 1 game at
# `--turn-budget 6`, seed 7 (matchup wall clock):
#
#   copies of OP16-017   1       2        3         4
#   before             350ms  1,499ms  16,789ms  228,271ms      x4.3, x11.2, x13.6 per copy
#
# The Ace deck runs 4 copies. Measured here, mirror at seed 7, per COMMAND (the only figure that
# is comparable across hosts):
#
#   deck                        before        after
#   mihawk-green-proxy, 8 games   8.24 ms      5.51 ms
#   ace-op16, 4 games           814.60 ms     14.12 ms
#   ace / mihawk                  98.9x         2.56x
#
#
# THE MECHANISM IS NOT WHAT THE CARD LOOKS LIKE. OP16-017's permanentEffect is a `modifyPower` on
# itself, so the obvious suspect is power recursion -- and it is not. Instrumented call counts for a
# single `getCardPower` on a board of N copies show `getPermanentModifierTotal:power` called exactly
# ONCE at every N; it is the COST path that explodes:
#
#   copies                1     2      3        4          5
#   getCardCost calls     2    52   2,034  126,224  11,450,650      before
#   getCardCost calls     1     4       9       16          25      after  (exactly N^2)
#
# The cycle, from a captured stack:
#
#   getCardCost(C)
#     -> getPermanentSetCost(C)
#          -> evaluateConditions(source)          for EVERY permanentEffect of EVERY source in play
#               -> candidatePoolForTarget -> matchesTargetFilter   `filter: "cost"`
#                    -> getCardCost(C')           a DIFFERENT instance -> re-entry
#
# `getPermanentSetCost` evaluates each effect's `conditions` BEFORE checking whether that effect has
# a `setCost` action at all. OP16-017 has none -- its only action is `modifyPower` -- but its
# condition is a `notHasCard` scan carrying `{ filter: "cost", comparison: "gte", value: 8 }`, so the
# cost path evaluates a condition that can never contribute, and that condition asks for the cost of
# every sibling. The existing re-entrancy guard is keyed `${type}:${targetInstanceId}`, which breaks
# the DIRECT self-cycle but permits re-entry along every distinct permutation of sibling instances:
# with S copies of the source and T targets the branching is (S x T) per level, hence (S x T)^depth.
#
# The fix is the pre-filter, and `getPermanentModifierTotal` in this same file already does exactly
# this (`relevantActions.length === 0 -> continue`). It is the only one of the file's 14
# condition-evaluating functions that does; the other 13 share the compute-then-discard shape, and
# `getPermanentSetCost` is the one measured to be in the cycle. See docs/upstream/README.md.
#
# WHY THIS CANNOT CHANGE RESULTS: for an effect with no `setCost` action the inner loop `continue`s
# on every action, so the effect can never contribute a return value -- `evaluateConditions` was
# computed and discarded. `evaluateConditions` is a pure read of state (no assignment to `state.*`
# anywhere in conditions.ts), which is the same assumption `getPermanentModifierTotal` already
# relies on. Verified empirically as well: a 4-game fixed-seed Ace mirror (seed 7) returns an
# IDENTICAL winner sequence (LWWL), identical per-game command counts ([100, 95, 109, 111]),
# identical per-game turns and termination, and identical aggregates (mean cmds 103.75, median
# turns 9). Engine suite after the patch: 6078 passed / 0 failed / 10 skipped.

SETCOST_PREFILTER_ANCHOR = """      const card = getCard(source.cardId);
      for (const effect of card.effects?.permanentEffects ?? []) {
        const conditions = evaluateConditions(
          state,
          source.controller,
          source.instanceId,
          effect.conditions,
        );
        if (!conditions.supported || !conditions.matches) {
          continue;
        }
        for (const action of effect.actions) {
          if (action.action !== "setCost") {
            continue;
          }"""

SETCOST_PREFILTER_FIX = """      const card = getCard(source.cardId);
      for (const effect of card.effects?.permanentEffects ?? []) {
        // OPCG-Go patch: skip the effect before evaluating its conditions when it has no `setCost`
        // action, exactly as getPermanentModifierTotal does with `relevantActions`. Without this,
        // cost evaluation evaluates conditions it then discards -- and a discarded condition
        // carrying a `cost` filter asks for the cost of every sibling, re-entering cost evaluation.
        // The `${type}:${id}` guard at the top of this function stops the direct self-cycle but
        // not re-entry across sibling instances, so N copies of OP16-017 cost (S x T)^depth:
        // 11,450,650 getCardCost calls at N=5, versus 25 after this line. Result-preserving: an
        // effect with no `setCost` action cannot return a value here, so the condition's result
        // was computed and thrown away.
        if (!effect.actions.some((action) => action.action === "setCost")) {
          continue;
        }
        const conditions = evaluateConditions(
          state,
          source.controller,
          source.instanceId,
          effect.conditions,
        );
        if (!conditions.supported || !conditions.matches) {
          continue;
        }
        for (const action of effect.actions) {
          if (action.action !== "setCost") {
            continue;
          }"""


# --- Patch 10: the SECOND player may attack on their own first turn ---------------------------
#
# The Official Rule Manual's Battle Flow footnote is "Neither player can attack on their first
# turn." `canAttackWith` gated only the FIRST player. Turn numbering here is per PLAYER-turn --
# `engine/queue.ts` does `state.turnNumber += 1` at each turn end -- so the first player owns the
# odd turns and the second player the even ones, and the second player's OWN first turn is
# `turnNumber === 2`, which sailed straight through the old condition.
#
# Measured before the fix, walking a real match through setup and four turns (firstPlayer north):
#
#   turn  active  declareAttack offered
#   1     north   false      correct -- the first player's own first turn
#   2     south   TRUE       WRONG   -- the second player's own first turn
#   3     north   true       correct
#   4     south   true       correct
#
# DIRECTION OF THE BIAS THIS REMOVES: the second player got one extra Leader attack (anything they
# played that turn is summoning-sick), so every play/draw figure measured before this UNDERSTATES
# first-player advantage. Magnitude is Phase 2's job; do not guess it here.
#
# WHY IT IS KEYED ON config.firstPlayer AND NOT ON activeSeat. Two formulations express "this
# seat's own first turn":
#
#   A  state.turnNumber === (seat === state.config.firstPlayer ? 1 : 2)
#   B  state.turnNumber <= 2 && state.activeSeat === seat
#
# They agree on every state a real game can reach, and differ only on synthetic fixtures whose
# `activeSeat` contradicts `firstPlayer` -- `{ firstPlayer: "north", activeSeat: "south" }` at
# `turnNumber: 1`, which is how a test fixture makes an attack legal on a freshly created board.
# B refuses those. MEASURED BLAST RADIUS: 1248 test files declare an attack and 1020 of them use
# exactly that seat trick (622 north-first/south-active, 398 south-first/north-active), so B would
# have rewritten most of the suite to fix a rule that is already right in every reachable state.
# A is also the direct symmetric extension of the first-turn DON!! rule in state.ts, which keys off
# `config.firstPlayer` for the same reason: turn number plus seat cannot be misconfigured.
#
# CONSEQUENCE FOR THE PUZZLE FIXTURES, and it contradicts what the plan predicted: they do NOT
# break. `sim/puzzles.test.ts` seats south as the SECOND player at `turnNumber: 1`, and under A
# south's own first turn is turn 2, so its attacks stay legal. Reported rather than forced.
FIRST_TURN_ATTACK_ANCHOR = """  if (state.turnNumber === 1 && state.activeSeat === state.config.firstPlayer) {
    return false;
  }"""

FIRST_TURN_ATTACK_FIX = """  // OPCG-Go patch: NEITHER player may attack on their own first turn (Official Rule Manual, Battle
  // Flow: "Neither player can attack on their first turn."). This gate read
  // `turnNumber === 1 && activeSeat === firstPlayer`, which is only the FIRST player's first turn;
  // turn numbering is per player-turn, so the second player's own first turn is turnNumber === 2
  // and it was allowed to attack a full turn early. Keyed on config.firstPlayer -- the same basis
  // as the first-turn DON!! rule in state.ts -- and phrased as "this SEAT's own first turn" so it
  // holds for whichever seat leads. `allowFirstTurnAttacks` is set ONLY by the mid-game test
  // fixture builder, never by a real match; see the patch note in tools/patch_engine.py.
  if (
    !state.config.allowFirstTurnAttacks &&
    state.turnNumber === (seat === state.config.firstPlayer ? 1 : 2)
  ) {
    return false;
  }"""


# --- Patch 11: the bot never counters ----------------------------------------------------------
#
# `resolveBotPromptCommand`'s selectCards branch takes `Math.min(maxSelections, minSelections)`,
# and `beginBattleCounterStep` builds its prompt with `minSelections: 0`, so the selection was
# always empty and the bot NEVER countered. Measured, not inferred: a defender holding one and then
# three real counter cards took the damage both times.
#
# The policy itself is a new file (see COUNTER_POLICY_SOURCE below) rather than an inlined branch,
# because it is ~250 lines with its own config surface and a string-replacement patch that large is
# unreadable and unreviewable. This patch is only the two-line call into it.
#
# The BLOCK step (engine/queue.ts) and the [Trigger] confirm (battle.ts) are deliberately left
# alone -- see docs/simulation.md, "Open policy surfaces". Blocking has no waste-free rule and
# declining a [Trigger] is a genuine value call; neither is an oversight and neither is silently
# fixed here.
COUNTER_CALL_ANCHOR = """  if (prompt.choiceKind === "confirm") {
    const yesOption = prompt.options.find((o) => o.id === "yes" || o.id === "activate");
    optionId = yesOption?.id ?? prompt.options[0]?.id;
  } else if (prompt.choiceKind === "selectCards" || prompt.choiceKind === "selectTargets") {"""

COUNTER_CALL_FIX = """  // OPCG-Go patch: the COUNTER STEP is a decision, not a default. Without this branch it falls
  // through to `Math.min(maxSelections, minSelections)` below, and the counter prompt is built with
  // `minSelections: 0`, so the bot never countered at all. counter-policy.ts holds the rules and
  // every knob they read. The BLOCK prompt (intent "battleBlocker") and the [Trigger] confirm are
  // deliberately NOT touched: docs/simulation.md, "Open policy surfaces".
  if (prompt.resolutionContext?.intent === "battleCounter") {
    return {
      type: "resolvePrompt",
      seat,
      promptId: prompt.id,
      selectedIds: decideCounter(state, prompt).selectedIds,
    };
  }

  if (prompt.choiceKind === "confirm") {
    const yesOption = prompt.options.find((o) => o.id === "yes" || o.id === "activate");
    optionId = yesOption?.id ?? prompt.options[0]?.id;
  } else if (prompt.choiceKind === "selectCards" || prompt.choiceKind === "selectTargets") {"""

COUNTER_IMPORT_ANCHOR = """import type { OnePieceBotStrategy } from "./bot-strategies.ts";"""

COUNTER_IMPORT_FIX = """import type { OnePieceBotStrategy } from "./bot-strategies.ts";
// OPCG-Go patch: created by tools/patch_engine.py, not by upstream.
import { decideCounter } from "./counter-policy.ts";"""

# The policy module itself. A new FILE, not an inlined branch: it is ~250 lines with its own
# config surface, and a string-replacement patch that large is unreviewable. `patch_engine.py`
# writes it verbatim and recognises it later by the marker in its first line.
COUNTER_POLICY_SOURCE = """// OPCG-Go: the defender's COUNTER STEP policy.
//
// CREATED BY tools/patch_engine.py. `vendor/` is gitignored and recreated by bootstrap, so this
// file is not the source of truth -- the patch is. Edit tools/patch_engine.py, never this copy.
//
// WHAT IT REPLACES. `resolveBotPromptCommand`'s selectCards branch takes
// `Math.min(prompt.maxSelections, prompt.minSelections)`, and `beginBattleCounterStep` (battle.ts)
// builds its prompt with `minSelections: 0`, so the selection was ALWAYS empty and the bot never
// countered. Measured, not inferred: a defender holding one and then three real counter cards took
// the damage both times.
//
// WHY THE RULES ARE ABOUT *WHETHER*, NEVER *HOW MUCH*. `finalizeBattle` compares
// `attackPower >= defensePower` with ties to the attacker, so damage is BINARY: a counter set
// either lifts defensePower ABOVE attackPower or is entirely wasted. There is no "counter harder"
// axis. And leader damage puts the life card IN HAND, usable as a counter later in the SAME turn
// (unless it carries a [Trigger], which routes to resolution instead), so "tank early, counter
// late" is dominant rather than a compromise -- the life card is not lost, it is deferred.
//
// EVERY PARAMETER IS CONFIG, deliberately. A Phase 3 sweep has to vary these WITHOUT a code edit,
// which is the difference between a sweep and fifteen hand-runs: they are read from the environment
// (OPCG_COUNTER_*) and can be overridden in-process by `setCounterPolicyConfig()`. `avgCost` is a
// CALIBRATION KNOB in the same category as SIM_TURN_BUDGET -- an assumption about the opponent's
// curve, never a measured result. See docs/simulation.md.

import { canAttackWith } from "../battle.ts";
import {
  baseCost,
  effectBlocksFor,
  getCardCounter,
  getCardForInstance,
  getCardPower,
  getInstance,
  getKeywords,
  getPlayer,
} from "../shared.ts";
import type { MatchSeat, MatchState, PromptState } from "../types.ts";
import type { OPCard } from "@tcg/op-types";

export interface CounterPolicyConfig {
  /** Master switch. `false` reproduces the never-counter behaviour byte for byte. */
  enabled: boolean;
  /**
   * KNOB, not a measurement: DON!! per future body, used only by the R horizon below. Phase 3
   * sweeps it. Zero or negative disables the growth term rather than dividing by zero.
   */
  avgCost: number;
  /** Counter when this turn's remaining attacks alone can reach zero life. */
  hardFloor: boolean;
  /** Counter when taking this damage loses outright (0 life cards, the Leader is the target). */
  lethalOverride: boolean;
  /** Counter regardless of the R rule when the attacker has [Double Attack] / [Banish]. */
  doubleAttackOverride: boolean;
  banishOverride: boolean;
  /**
   * Spend counter EVENTS as well as character counters. OFF by default, and the reason is a
   * defect elsewhere rather than card evaluation: an Event's power grant is applied by a SECOND
   * prompt (selectTargets), which this same resolver answers with `Math.min(max, min)` = the empty
   * selection. Spending one today therefore trashes the card and grants nothing. Flip this only
   * together with a targeting policy.
   */
  useEventCounters: boolean;
  /** Largest set of cards spent on one battle. Also bounds the subset search. */
  maxCardsPerCounter: number;
  /** Largest set spent to save a CHARACTER rather than life. */
  maxCardsForCharacter: number;
  /** Candidates considered at all, lowest play value first. Bounds the enumeration. */
  maxSearchCandidates: number;
  /** Play-value weights -- the coefficients Phase 3 is meant to learn. Higher = keep the card. */
  playValueCostWeight: number;
  playValueEffectWeight: number;
  playValueCounterWeight: number;
}

export const COUNTER_POLICY_DEFAULTS: CounterPolicyConfig = {
  enabled: true,
  avgCost: 4,
  hardFloor: true,
  lethalOverride: true,
  doubleAttackOverride: true,
  banishOverride: true,
  useEventCounters: false,
  maxCardsPerCounter: 2,
  maxCardsForCharacter: 1,
  maxSearchCandidates: 10,
  playValueCostWeight: 1,
  playValueEffectWeight: 2,
  playValueCounterWeight: 0.001,
};

/** Env var per field. Explicit table, not a camelCase-to-SNAKE guess, so a rename cannot silently
 *  orphan a sweep's knob. */
const ENV_KEYS: Record<keyof CounterPolicyConfig, string> = {
  enabled: "OPCG_COUNTER_ENABLED",
  avgCost: "OPCG_COUNTER_AVG_COST",
  hardFloor: "OPCG_COUNTER_HARD_FLOOR",
  lethalOverride: "OPCG_COUNTER_LETHAL_OVERRIDE",
  doubleAttackOverride: "OPCG_COUNTER_DOUBLE_ATTACK_OVERRIDE",
  banishOverride: "OPCG_COUNTER_BANISH_OVERRIDE",
  useEventCounters: "OPCG_COUNTER_USE_EVENT_COUNTERS",
  maxCardsPerCounter: "OPCG_COUNTER_MAX_CARDS",
  maxCardsForCharacter: "OPCG_COUNTER_MAX_CARDS_FOR_CHARACTER",
  maxSearchCandidates: "OPCG_COUNTER_MAX_CANDIDATES",
  playValueCostWeight: "OPCG_COUNTER_W_COST",
  playValueEffectWeight: "OPCG_COUNTER_W_EFFECT",
  playValueCounterWeight: "OPCG_COUNTER_W_COUNTER",
};

/** Read an env var without depending on @types/node, which this package does not pull in. */
function envValue(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

function parseBoolean(raw: string): boolean | undefined {
  const text = raw.trim().toLowerCase();
  if (text === "1" || text === "true" || text === "on" || text === "yes") return true;
  if (text === "0" || text === "false" || text === "off" || text === "no") return false;
  return undefined;
}

function parseNumber(raw: string): number | undefined {
  const value = Number(raw.trim());
  return Number.isFinite(value) ? value : undefined;
}

let inProcessOverride: Partial<CounterPolicyConfig> | null = null;

/**
 * In-process override, for tests and puzzles. Takes precedence over the environment so a puzzle can
 * pin a knob without exporting anything; pass `null` to go back to env-and-defaults.
 */
export function setCounterPolicyConfig(next: Partial<CounterPolicyConfig> | null): void {
  inProcessOverride = next;
}

/** defaults <- environment <- setCounterPolicyConfig(). Resolved per call, never cached, so a sweep
 *  that mutates the environment between games is honoured. */
export function counterPolicyConfig(): CounterPolicyConfig {
  const resolved: CounterPolicyConfig = { ...COUNTER_POLICY_DEFAULTS };
  for (const key of Object.keys(ENV_KEYS) as Array<keyof CounterPolicyConfig>) {
    const raw = envValue(ENV_KEYS[key]);
    if (raw === undefined || raw === "") continue;
    if (typeof COUNTER_POLICY_DEFAULTS[key] === "boolean") {
      const parsed = parseBoolean(raw);
      if (parsed !== undefined) (resolved[key] as boolean) = parsed;
    } else {
      const parsed = parseNumber(raw);
      if (parsed !== undefined) (resolved[key] as number) = parsed;
    }
  }
  return { ...resolved, ...inProcessOverride };
}

/** Why the policy did what it did. Printed by the puzzle suite; never read by the engine. */
export type CounterReason =
  | "disabled"
  | "not-a-counter-prompt"
  | "no-battle"
  | "already-holds"
  | "cannot-flip"
  | "lethal"
  | "hard-floor"
  | "double-attack"
  | "banish"
  | "within-horizon"
  | "tank"
  | "save-character"
  | "character-not-worth-it";

export interface CounterDecision {
  selectedIds: string[];
  reason: CounterReason;
  /** Power the selection has to add for the defender to SURVIVE (ties go to the attacker). */
  needed: number;
  attackPower: number;
  defensePower: number;
  /** Life cards left; 0 means the next Leader hit ends the game. */
  life: number;
  /** R -- the opponent's attacker horizon. */
  threshold: number;
  /** Attacks the opponent can still make this turn, including the one being resolved. */
  remainingAttacks: number;
}

interface Candidate {
  instanceId: string;
  /** Power this card adds to defensePower if selected. */
  counter: number;
  /** DON!! it costs to activate (Events only). */
  eventCost: number;
  /** Higher = more worth keeping in hand. */
  playValue: number;
}

/**
 * The power an Event's [Counter] block grants, read statically. Counts only the FIRST positive
 * `modifyPower` in the block, which deliberately UNDER-counts a card like OP01-029 whose second
 * clause is conditional. Under-counting can only make the policy decline a counter that would have
 * sufficed -- a missed save. OVER-counting would spend a card that does not flip the battle, which
 * is the one thing this policy must never do.
 */
function staticCounterPowerGain(state: MatchState, instanceId: string): number {
  const card = getCardForInstance(state, instanceId);
  const blocks = effectBlocksFor(card, "counter") as Array<{
    actions?: Array<{ action?: string; value?: number }>;
  }>;
  for (const block of blocks) {
    for (const action of block.actions ?? []) {
      if (action.action === "modifyPower" && typeof action.value === "number" && action.value > 0) {
        return action.value;
      }
    }
  }
  return 0;
}

/**
 * Does this card have an encoded ability at all? The "has-effect" observable the Phase 3 feature
 * model is meant to learn a coefficient on, so getting it wrong does not merely mis-order one
 * counter -- it teaches the sweep a coefficient for a feature that was measured on the wrong
 * population.
 *
 * IT MUST CONSULT EVERY ABILITY-BEARING COLLECTION, not just the triggered blocks. `CardEffects`
 * (types/src/effect/effect.ts:57) declares FIVE properties, and an encoding may live entirely in
 * any one of them:
 *
 *   keywords            [Blocker] / [Rush] / [Double Attack] ...  -- an ability
 *   effects             triggered blocks (On Play, When Attacking) -- an ability
 *   permanentEffects    continuous, e.g. [DON!! x1] +2000 power    -- an ability
 *   replacementEffects  "if this would be K.O.'d, instead ..."     -- an ability
 *   deckBuildingRules   unlimitedCopies / cannotInclude            -- NOT an ability
 *
 * `deckBuildingRules` is deliberately EXCLUDED: it constrains deck construction and does nothing
 * once the card is in hand, so a card carrying only that is worth exactly what a vanilla is worth as
 * counter fodder. Including it would misclassify in the other direction.
 *
 * Reading only `effects.effects`, as this did until 2026-08-20, called 164 of the 1368
 * counter-bearing characters in the catalog vanilla -- 12.0% -- including every keywords-only
 * [Blocker] body, which is close to the most valuable card in hand to KEEP. Found by Codex on
 * PR #24; its own list named two of the four and would have left ~29 `replacementEffects` cards
 * still wrong.
 */
export function hasEncodedAbility(card: OPCard): boolean {
  const effects = card.effects;
  if (!effects) return false;
  return (
    (effects.keywords?.length ?? 0) > 0 ||
    (effects.effects?.length ?? 0) > 0 ||
    (effects.permanentEffects?.length ?? 0) > 0 ||
    (effects.replacementEffects?.length ?? 0) > 0
  );
}

function playValueOf(
  state: MatchState,
  instanceId: string,
  counter: number,
  config: CounterPolicyConfig,
): number {
  const card = getCardForInstance(state, instanceId);
  return (
    baseCost(card) * config.playValueCostWeight +
    (hasEncodedAbility(card) ? config.playValueEffectWeight : 0) +
    counter * config.playValueCounterWeight
  );
}

function candidatesFor(
  state: MatchState,
  prompt: PromptState,
  config: CounterPolicyConfig,
): Candidate[] {
  const out: Candidate[] = [];
  for (const option of prompt.options) {
    if (option.enabled === false) continue;
    const instanceId = option.id;
    if (!state.cards[instanceId]) continue;
    const card = getCardForInstance(state, instanceId);
    if (card.cardType === "character") {
      const counter = getCardCounter(state, instanceId);
      if (counter <= 0) continue;
      out.push({
        instanceId,
        counter,
        eventCost: 0,
        playValue: playValueOf(state, instanceId, counter, config),
      });
      continue;
    }
    if (card.cardType === "event" && config.useEventCounters) {
      const counter = staticCounterPowerGain(state, instanceId);
      if (counter <= 0) continue;
      out.push({
        instanceId,
        counter,
        eventCost: baseCost(card),
        playValue: playValueOf(state, instanceId, counter, config),
      });
    }
  }
  // Lowest play value first, then smallest counter: the order the search should try, and the order
  // the cap keeps if a hand offers more candidates than maxSearchCandidates.
  out.sort(
    (a, b) =>
      a.playValue - b.playValue ||
      a.counter - b.counter ||
      a.instanceId.localeCompare(b.instanceId),
  );
  return out.slice(0, Math.max(0, Math.floor(config.maxSearchCandidates)));
}

/**
 * Cheapest set that FLIPS the battle: fewest cards, then lowest total play value, then least
 * counter overshoot. Exhaustive over subsets up to `maxCardsPerCounter` (176 of them at the
 * defaults, 10 candidates and 2 cards), so it is exact within that bound rather than greedy.
 */
function cheapestSufficient(
  candidates: Candidate[],
  needed: number,
  activeDon: number,
  maxCards: number,
): Candidate[] | null {
  const limit = Math.min(Math.max(0, Math.floor(maxCards)), candidates.length);
  let best: Candidate[] | null = null;
  const better = (a: Candidate[], b: Candidate[] | null): boolean => {
    if (b === null) return true;
    if (a.length !== b.length) return a.length < b.length;
    const av = a.reduce((t, c) => t + c.playValue, 0);
    const bv = b.reduce((t, c) => t + c.playValue, 0);
    if (av !== bv) return av < bv;
    const ac = a.reduce((t, c) => t + c.counter, 0);
    const bc = b.reduce((t, c) => t + c.counter, 0);
    if (ac !== bc) return ac < bc;
    return a.map((c) => c.instanceId).join() < b.map((c) => c.instanceId).join();
  };
  const walk = (start: number, picked: Candidate[]) => {
    if (picked.length > 0) {
      const counter = picked.reduce((t, c) => t + c.counter, 0);
      const cost = picked.reduce((t, c) => t + c.eventCost, 0);
      if (counter >= needed && cost <= activeDon && better(picked, best)) {
        best = [...picked];
      }
    }
    if (picked.length >= limit) return;
    for (let i = start; i < candidates.length; i++) {
      picked.push(candidates[i]!);
      walk(i + 1, picked);
      picked.pop();
    }
  };
  walk(0, []);
  return best;
}

/** Attacks the opponent can still make this turn, counting the one being resolved. The current
 *  attacker is already rested (beginAttack rests it), so canAttackWith excludes it. */
function remainingAttacksFor(state: MatchState, attackerSeat: MatchSeat): number {
  const player = getPlayer(state, attackerSeat);
  const ready = [
    player.leaderInstanceId,
    ...player.characterArea.filter((entry): entry is string => Boolean(entry)),
  ].filter((instanceId) => canAttackWith(state, attackerSeat, instanceId));
  return ready.length + 1;
}

/**
 * R = (opponent characters + 1) + floor(opponent DON!! in play / avgCost).
 *
 * The first term is every body they already have plus the Leader -- all of it refreshes and can
 * attack next turn. The second is growth: DON!! they can spend on new bodies, which cannot attack
 * the turn they arrive, so it is a turn+2 term. Ping's shape, 2026-08-19.
 */
function attackerHorizon(
  state: MatchState,
  attackerSeat: MatchSeat,
  config: CounterPolicyConfig,
): number {
  const player = getPlayer(state, attackerSeat);
  const bodies = player.characterArea.filter(Boolean).length + 1;
  const don = player.activeDon + player.restedDon;
  const growth = config.avgCost > 0 ? Math.floor(don / config.avgCost) : 0;
  return bodies + growth;
}

export function decideCounter(
  state: MatchState,
  prompt: PromptState,
  configIn?: CounterPolicyConfig,
): CounterDecision {
  const config = configIn ?? counterPolicyConfig();
  const empty = (reason: CounterReason, rest: Partial<CounterDecision> = {}): CounterDecision => ({
    selectedIds: [],
    reason,
    needed: 0,
    attackPower: 0,
    defensePower: 0,
    life: 0,
    threshold: 0,
    remainingAttacks: 0,
    ...rest,
  });

  if (!config.enabled) return empty("disabled");
  if (prompt.resolutionContext?.intent !== "battleCounter") return empty("not-a-counter-prompt");
  const battle = state.battle;
  if (!battle || prompt.seat === "judge") return empty("no-battle");

  const seat = prompt.seat;
  const defender = getPlayer(state, seat);
  const attackerSeat = getInstance(state, battle.attackerId).controller;
  const target = getInstance(state, battle.targetId);

  // Recomputed here rather than read off `battle`: finalizeBattle recomputes both, and anything the
  // block step or an [On Attack] effect did since the attack was declared has to be counted.
  const attackPower = getCardPower(state, battle.attackerId);
  const defensePower = getCardPower(state, battle.targetId) + battle.counterTotal;
  const life = defender.life.length;
  const threshold = attackerHorizon(state, attackerSeat, config);
  const remainingAttacks = remainingAttacksFor(state, attackerSeat);
  const context = { attackPower, defensePower, life, threshold, remainingAttacks };

  const needed = attackPower - defensePower + 1;
  // Ties go to the attacker, so needed <= 0 means the defence already holds. Spending here is the
  // purest form of waste.
  if (needed <= 0) return empty("already-holds", { ...context, needed });

  const candidates = candidatesFor(state, prompt, config);
  const best = cheapestSufficient(
    candidates,
    needed,
    defender.activeDon,
    config.maxCardsPerCounter,
  );
  // NEVER spend a counter that does not flip the outcome. Damage is binary; a set that falls short
  // buys literally nothing.
  if (!best) return empty("cannot-flip", { ...context, needed });

  const spend = (reason: CounterReason): CounterDecision => ({
    selectedIds: best.map((c) => c.instanceId),
    reason,
    needed,
    ...context,
  });

  // A character target: the question is a body, not life, so the R rule does not apply. Bounded by
  // its own knob instead of asserting a value for a body we cannot even attack back (no policy can
  // choose an attack target, so a saved body is purely offensive).
  if (target.zone !== "leader") {
    return best.length <= config.maxCardsForCharacter
      ? spend("save-character")
      : empty("character-not-worth-it", { ...context, needed });
  }

  const keywords = getKeywords(state, battle.attackerId);
  // Lethal: continueLeaderDamage declares the attacker the winner when the defender takes Leader
  // damage on 0 life cards. Nothing is worth keeping past that.
  if (config.lethalOverride && life === 0) return spend("lethal");
  if (config.doubleAttackOverride && keywords.has("doubleAttack")) return spend("double-attack");
  // [Banish] trashes the life card instead of putting it in hand, which is what makes tanking
  // cheap; without it the card is simply gone.
  if (config.banishOverride && keywords.has("banish")) return spend("banish");
  if (config.hardFloor && remainingAttacks >= life) return spend("hard-floor");
  if (life <= threshold) return spend("within-horizon");
  return empty("tank", { ...context, needed });
}
"""


# --- Patch 13: fixtures materialise a mid-game position but their turn counter says turn 1 -------
#
# Companion to the first-turn attack ban above, and the reason the ban is affordable at all.
#
# `createTestMatchState(..., { skipSetup: true })` -- the DEFAULT -- builds an arbitrary mid-game
# board (bodies with `playedOnTurn: 0`, DON!! already active, stocked hands) and leaves
# `state.turnNumber` at 1, because there is nothing to count. So a fixture's turn number is not the
# game's turn number, and the ban read as: no attacks for the active seat on the fixture's first
# turn, and none for the other seat after one `endTurn`. MEASURED: 39 tests in 31 files went red,
# every one of them `declareAttack failed: The selected attacker cannot attack.` -- 5 in upstream's
# `src/cards`, 21 in upstream's `tests/cards`, 5 in our own grafted OP15/OP16 tests.
#
# `buildConfig` ALREADY suspends three opening-turn rules for exactly this reason -- `shuffleDecks:
# false`, `openingHandSize: 0`, `skipFirstTurnDraw: true` -- so this is upstream's own design intent
# applied to a fourth rule, not a new escape hatch. The flag is opt-IN and real matches never set
# it: `sim/matchup.sim.test.ts`, `arena/`, `starter-decks.ts` and `bot-harness.test.ts` all build
# their configs directly, so the ban is enforced everywhere a game is actually played -- which is
# everywhere it can bias a measurement.
#
# WHAT IT COSTS, stated rather than buried: the ban is not exercised by any fixture, so a card test
# cannot catch a regression in it. That is why its verification is a REAL match walked through
# setup (sim/puzzles.test.ts, "neither player may attack on their own first turn"), and why that
# probe asserts the fixture flag is present as well -- deleting the flag has to fail loudly instead
# of silently reverting 39 tests.
#
# The alternatives were measured and rejected. (a) Patch the 26 upstream test files: 26 anchored
# rewrites of tests we do not own, each changing what the test proves. (b) Start fixtures at
# turnNumber 3: one line, but it silently un-sickens the 15 fixtures that use `playedOnTurn: 1` to
# mean "played this turn" and breaks the two cases asserting turnNumber 2/3 -- a wrong fixture that
# still passes is this project's most frequent defect.
FIRST_TURN_ATTACK_FLAG_TYPE_ANCHOR = """  skipFirstTurnDraw?: boolean;"""

FIRST_TURN_ATTACK_FLAG_TYPE_FIX = """  skipFirstTurnDraw?: boolean;
  /**
   * OPCG-Go patch: suspend "neither player may attack on their own first turn" (Official Rule
   * Manual, Battle Flow). A real match must never set this -- the ban IS the rule, and every
   * simulated game relies on it. It exists for synthetic mid-game fixtures, whose `turnNumber`
   * starts at 1 whatever position they materialise, and which already suspend three other
   * opening-turn rules (`shuffleDecks: false`, `openingHandSize: 0`, `skipFirstTurnDraw: true`).
   */
  allowFirstTurnAttacks?: boolean;"""

FIRST_TURN_ATTACK_FLAG_STATE_ANCHOR = (
    """    Pick<MatchConfig, "firstPlayer" | "players" | "seed">;"""
)

FIRST_TURN_ATTACK_FLAG_STATE_FIX = (
    """    // OPCG-Go patch: allowFirstTurnAttacks rides in the OPTIONAL half on purpose -- it stays
    // `boolean | undefined` on state.config, so normalizeConfig needs no default and absent
    // (every real match) reads as "the ban applies".
    Pick<MatchConfig, "firstPlayer" | "players" | "seed" | "allowFirstTurnAttacks">;"""
)

FIRST_TURN_ATTACK_FIXTURE_ANCHOR = """    skipFirstTurnDraw: true,
    maxCharacterSlots: options.maxCharacterSlots,"""

FIRST_TURN_ATTACK_FIXTURE_FIX = """    skipFirstTurnDraw: true,
    // OPCG-Go patch: a fixture is a mid-game position with a turn counter stuck at 1, so the
    // first-turn attack ban (battle.ts) would refuse the active seat's attacks and, after one
    // endTurn, the other seat's -- 39 tests in 31 files, all "The selected attacker cannot
    // attack.". Suspended here for the same reason the three lines around it are. Real matches do
    // not go through buildConfig and are banned as the rules require.
    allowFirstTurnAttacks: true,
    maxCharacterSlots: options.maxCharacterSlots,"""

# --- Patches 15-23: setBasePower, a literal base-power setter -------------------------------
#
# The DSL had no verb for "base power becomes <literal>", and three near-misses that each fail in
# a different way:
#   * `setPower` is the only literal-valued power setter, but it adds
#     `action.value - getCardPower(target)` (effects/actions.ts) -- a TOTAL-power set measured at
#     resolution, so it ABSORBS modifiers already on the target instead of letting them stack on
#     the new base. It is also invisible inside `permanentEffects`, because the permanent path
#     reads only `modifyPower`/`setBasePowerFrom`.
#   * `setBasePowerFrom` has the right arithmetic but requires a source CARD on the field to copy.
#   * `copyPower` only ever retargets the effect's own card.
#
# Six printed clauses across OP15/OP16 needed it and are now encoded against it -- they were
# parked in data/parked-clauses.json as `setBasePowerLiteral` until 2026-08-20: OP15-070 Fuza,
# OP15-071 Holly and OP15-092 Monkey.D.Luffy as permanent effects; OP16-015 Monkey.D.Luffy,
# OP16-058 The Prisoners Are Rioting!! and OP16-106 Sanjuan.Wolf as timed ones. It was also OP17's
# critical path: OP17-005's [On Play] takes a monocolored Leader's base power to 8000, which is the
# whole OP17 Ace thesis.
#
# NOTE ON NUMBERING. "Patch N" in this project means the Nth entry of PATCHES below, and the list
# has been inserted into before: CLAUDE.md calls the getPermanentSetCost prefilter "patch 8" from
# when it was 8th, and it is now 9th. Prefer the patch NAME when writing anything durable.
#
# THE DESIGN DECISION, and why a delta modifier is not good enough. A `setBasePower` modifier
# stores the LITERAL in `value` and `getCardPower` substitutes it for the printed base, rather than
# storing `literal - printedBase` as a `type: "power"` delta. Three consequences, all wanted:
#   1. +power modifiers stack on top, because the substitution happens before the sum. Ruling #927
#      makes that observable rather than theoretical -- at 30 cards in the trash all three of
#      OP15-092's bullets apply at once, so base-9000 and +1000 must reach 10000.
#   2. Applying it twice is idempotent. Two OP15-070 Fuza in play both say 6000 about a shared
#      [Shura] body; two deltas would say 8000.
#   3. It cannot be double-counted against attached DON!!, which a `getCardPower`-relative delta
#      would be whenever the DON!! is attached after the effect resolves.
# The cost of the choice is a new ModifierState["type"]. That is cheap for a narrower reason than
# "every read is type-filtered", which is FALSE -- state.ts's expiry sweeps
# (cleanupTurnEndModifiers, cleanupBattleModifiers, cleanupTurnStartModifiers) deliberately iterate
# every modifier regardless of type, and that is exactly what makes the new type expire for free.
# The load-bearing claim is narrower and true: every read that SUMS or INTERPRETS a modifier filters
# on `type` first, so nothing can mistake a literal base power for a power bonus, and no cleanup
# path selects by type, so nothing drops the new type on the floor.
#
# Rulings #909 (OP15-070), #910 (OP15-071) and #994 (OP16-058) all answer 是的 to the same
# question -- a Leader carrying "has every card's name" DOES reach the literal -- so the action's
# target has to span `zones: ["leader", "character"]`, not just characters. That is a card-encoding
# consequence rather than an engine one, but it is the reason the engine half must not assume the
# character zone anywhere.

SETBASEPOWER_UNION_ANCHOR = """  | SetPowerAction
  | SetBasePowerFromAction"""

SETBASEPOWER_UNION_FIX = """  | SetPowerAction
  | SetBasePowerAction
  | SetBasePowerFromAction"""

SETBASEPOWER_TYPE_ANCHOR = """/** Set a card's base power from another card while preserving other modifiers. */
export interface SetBasePowerFromAction {"""

SETBASEPOWER_TYPE_FIX = """/**
 * OPCG-Go patch: set a card's base power to a LITERAL value, preserving other modifiers.
 *
 * The sibling of `setBasePowerFrom` for the far commoner printed wording "base power becomes N".
 * Not `setPower`: that one sets TOTAL power, computing its delta from `getCardPower` at resolution
 * and so swallowing modifiers the card already carries. Six OP15/OP16 clauses print this, and
 * OP17-005 needs it.
 */
export interface SetBasePowerAction {
  action: "setBasePower";
  target: Target;
  value: number;
  duration: Duration;
  condition?: Condition;
}

/** Set a card's base power from another card while preserving other modifiers. */
export interface SetBasePowerFromAction {"""

SETBASEPOWER_MODIFIER_ANCHOR = """  type: "power" | "cost" | "keyword" | "flag" | "attackRestriction";"""

SETBASEPOWER_MODIFIER_FIX = """  // OPCG-Go patch: `setBasePower` carries a LITERAL base power in `value`, not a delta, and is
  // deliberately a separate type from "power". getPowerModifierTotal sums only "power", so a
  // literal can never be added as though it were a bonus; getCardPower substitutes it for the
  // printed base before that sum. Widening this union is safe because of two DIFFERENT properties:
  // every read that sums or interprets a modifier filters on `type` first, and no expiry sweep does
  // -- state.ts walks every modifier by duration, which is what makes the new type expire for free.
  type: "power" | "setBasePower" | "cost" | "keyword" | "flag" | "attackRestriction";"""

SETBASEPOWER_IMPORT_ANCHOR = """import {
  arePlayerEffectsNegatedByPermanentEffect,
  getPermanentKeywords,
  getPermanentModifierTotal,
  getPermanentSetCost,
  isRefreshPreventedByPermanentEffect,
} from "./effects/permanent.ts";"""

SETBASEPOWER_IMPORT_FIX = """import {
  arePlayerEffectsNegatedByPermanentEffect,
  getPermanentKeywords,
  getPermanentModifierTotal,
  // OPCG-Go patch: the setBasePower primitive's two lookups. Both live in effects/permanent.ts --
  // getSetBasePowerModifier only reads state.modifiers, but permanent.ts needs it too and THIS
  // module is the one permanent.ts must not import, so the single definition lives there.
  getPermanentSetBasePower,
  getSetBasePowerModifier,
  getPermanentSetCost,
  isRefreshPreventedByPermanentEffect,
} from "./effects/permanent.ts";"""

SETBASEPOWER_GETCARDPOWER_ANCHOR = """export function getCardPower(state: MatchState, instanceId: string): number {
  const instance = getInstance(state, instanceId);
  const card = getCard(instance.cardId);
  return (
    basePower(card) +
    (state.activeSeat === instance.controller ? instance.attachedDon * 1000 : 0) +
    getPowerModifierTotal(state, instanceId) +
    getPermanentModifierTotal(state, instanceId, "power")
  );
}"""

SETBASEPOWER_GETCARDPOWER_FIX = """/**
 * OPCG-Go patch: a card's base power after any "base power becomes N" effect, and its printed base
 * otherwise.
 *
 * A timed modifier wins over a permanent effect, unconditionally. Do not read that as "because it
 * was applied later" -- a continuous ability has no application instant this engine records, so
 * that justification is not something the code can check. What the code does is: timed first,
 * then permanent, then printed; among timed modifiers the highest id (= latest applied) wins; and
 * two competing permanent literals resolve to whichever source is scanned first, the same contract
 * getPermanentSetCost already has.
 */
export function getEffectiveBasePower(state: MatchState, instanceId: string): number {
  return (
    getSetBasePowerModifier(state, instanceId) ??
    getPermanentSetBasePower(state, instanceId) ??
    basePower(getCard(getInstance(state, instanceId).cardId))
  );
}

export function getCardPower(state: MatchState, instanceId: string): number {
  const instance = getInstance(state, instanceId);
  return (
    // OPCG-Go patch: was `basePower(card)`. A "base power becomes N" effect substitutes the base
    // right here, which is the whole point of the primitive -- attached DON!! and every +/-power
    // modifier then stack on top of N instead of being swallowed by it.
    getEffectiveBasePower(state, instanceId) +
    (state.activeSeat === instance.controller ? instance.attachedDon * 1000 : 0) +
    getPowerModifierTotal(state, instanceId) +
    getPermanentModifierTotal(state, instanceId, "power")
  );
}"""

SETBASEPOWER_PERMANENT_ANCHOR = """export function getPermanentSetCost(state: MatchState, targetInstanceId: string): number | null {"""

SETBASEPOWER_PERMANENT_FIX = """/**
 * OPCG-Go patch: the two actions that REPLACE a card's base power rather than adjusting it.
 * `setBasePower` names a literal; `setBasePowerFrom` copies another card's base power. Both are
 * replacements, so they belong on the base-power path and not in the additive modifier total.
 */
function isBasePowerReplacement(
  action: Action,
): action is Extract<Action, { action: "setBasePower" | "setBasePowerFrom" }> {
  return action.action === "setBasePower" || action.action === "setBasePowerFrom";
}

/**
 * OPCG-Go patch: the literal base power a timed `setBasePower` modifier currently imposes, or null.
 * Defined HERE rather than in shared.ts so that this module -- which shared.ts imports -- can reach
 * it without a circular import. shared.ts re-exports it for getEffectiveBasePower.
 *
 * "Base power becomes N" REPLACES the printed base, so the modifier stores N itself rather than a
 * delta. Where two overlap the most recently applied wins: `nextIdentifier` zero-pads to six
 * digits, so lexicographic order over modifier ids IS application order.
 */
export function getSetBasePowerModifier(state: MatchState, instanceId: string): number | null {
  let latest: { id: string; value?: number } | null = null;
  for (const modifier of Object.values(state.modifiers)) {
    if (modifier.targetId !== instanceId || modifier.type !== "setBasePower") {
      continue;
    }
    if (!latest || modifier.id > latest.id) {
      latest = modifier;
    }
  }
  return latest?.value ?? null;
}

/**
 * OPCG-Go patch: the base power a permanent replacement imposes on a card, or
 * null when none applies. The twin of `getPermanentSetCost` -- and the function whose absence is
 * why a `setPower` written inside `permanentEffects` was never read at all, since the permanent
 * power path recognises only `modifyPower` and `setBasePowerFrom`.
 *
 * Returns the FIRST match, exactly as getPermanentSetCost does. Two sources naming the same
 * literal are therefore idempotent -- two OP15-070 Fuza both say 6000 about a shared [Shura] body
 * -- and two naming different literals resolve deterministically to whichever is scanned first.
 * Nothing in OP15/OP16 creates the second case: every permanent user of this action names 6000
 * except OP15-092, whose two literals land on a Character and on a Leader respectively.
 *
 * The prefilter ahead of evaluateConditions is not an optimisation, it is the same fix as the
 * getPermanentSetCost patch below: evaluating a condition this function then discards can
 * re-enter power evaluation across sibling instances, and the `${key}:${id}` guard stops only the
 * direct self-cycle.
 */
export function getPermanentSetBasePower(
  state: MatchState,
  targetInstanceId: string,
): number | null {
  const evaluationKey = `setBasePower:${targetInstanceId}`;
  const active = activeEvaluations.get(state) ?? new Set<string>();
  if (active.has(evaluationKey)) {
    return null;
  }
  activeEvaluations.set(state, active);
  active.add(evaluationKey);

  try {
    // The loop shape here is MEASURED, not stylistic, and two things about it are load-bearing.
    // getCardPower is the hottest read in the engine, so a second full pass over the match would
    // roughly halve engine throughput.
    //
    // 1. `inPlaySources`, not `Object.values(state.cards)`: at most 14 slots instead of every card
    //    in both decks, hands, trashes and Life. `sourceIsInPlay` is still checked below so the two
    //    source sets are provably identical -- inPlaySources reads the area lists, sourceIsInPlay
    //    cross-checks the card's own zone field, and a disagreement must exclude the card either way.
    // 2. The STRUCTURAL prefilter runs before `sourceEffectsAreNegated` and before any condition.
    //    That is the getPermanentSetCost prefilter's lesson one level deeper: the negation check
    //    is the expensive guard, and
    //    on a board where nothing prints "base power becomes N" -- which is almost every board,
    //    since 6 cards in a 2,537-card catalog use the action -- paying it per source bought
    //    nothing. Measured on a vanilla 10-body board, 200k calls: 18.13us/call with the checks in
    //    the other order, 1.35us with them this way round, against ~25us for
    //    getPermanentModifierTotal measured alongside it in the same process.
    //
    // Result-preserving by construction: all three guards are conjunctive on reaching the return.
    for (const source of inPlaySources(state)) {
      const effects = getCard(source.cardId).effects?.permanentEffects;
      if (!effects?.some((effect) => effect.actions.some((a) => isBasePowerReplacement(a)))) {
        continue;
      }
      if (
        !sourceIsInPlay(state, source.instanceId) ||
        sourceEffectsAreNegated(state, source.instanceId)
      ) {
        continue;
      }
      for (const effect of effects) {
        if (!effect.actions.some((action) => isBasePowerReplacement(action))) {
          continue;
        }
        const conditions = evaluateConditions(
          state,
          source.controller,
          source.instanceId,
          effect.conditions,
        );
        if (!conditions.supported || !conditions.matches) {
          continue;
        }
        for (const action of effect.actions) {
          if (!isBasePowerReplacement(action)) {
            continue;
          }
          // The ACTION-level condition, which SetBasePowerAction declares and this function used to
          // ignore. Omitting it fails OPEN -- the effect applies when it should not, with no
          // capability issue and no judge prompt to show it. The timed path honours it generically
          // in effects/resolution.ts; the permanent path has to do it by hand, exactly as
          // getPermanentModifierTotal does.
          if (action.condition) {
            const actionCondition = evaluateConditions(
              state,
              source.controller,
              source.instanceId,
              [action.condition],
            );
            if (!actionCondition.supported || !actionCondition.matches) {
              continue;
            }
          }
          // The same guard getPermanentModifierTotal applies to a dynamic modifier: a permanent
          // effect cannot make a CHOICE, so a target that is not `self` must be written
          // `count.amount: "all"` or a `{ amount: 1 }` target would silently reach every
          // candidate its filters matched.
          if (action.target.count.amount !== "all" && !action.target.self) {
            continue;
          }
          const pool = candidatePoolForTarget(
            state,
            source.controller,
            source.instanceId,
            action.target,
          );
          if (!pool.supported || !pool.candidateIds.includes(targetInstanceId)) {
            continue;
          }
          if (action.action === "setBasePower") {
            return action.value;
          }
          // `setBasePowerFrom` -- "base power becomes the same as X's base power". It lives here
          // and NOT in getPermanentModifierTotal because it is a REPLACEMENT, not a bonus. As a
          // delta of `sourceBase - printedTargetBase` it was self-consistent only while
          // getCardPower started from the printed base; once a literal can replace that base, a
          // card carrying both read `literal + (sourceBase - printed)` -- two mutually exclusive
          // replacements added together. Handling it here makes the two SELECT (first match wins,
          // the same contract getPermanentSetCost has) instead of accumulating.
          const sourcePool = candidatePoolForTarget(
            state,
            source.controller,
            source.instanceId,
            action.source,
          );
          if (!sourcePool.supported || sourcePool.candidateIds.length !== 1) {
            continue;
          }
          // The SOURCE's own effective base, not its printed one: SC ruling #762 settles that a
          // base power changed by an effect IS that card's base power for every later read, so
          // "the same as your Leader's base power" must see a Leader whose base was set to 7000.
          // Recursion is bounded and cannot loop: this function's own `setBasePower:${id}` guard
          // returns null on re-entry, so a card copying from a card that copies back terminates.
          return effectivePermanentBasePower(state, sourcePool.candidateIds[0]!);
        }
      }
    }
    return null;
  } finally {
    active.delete(evaluationKey);
    if (active.size === 0) {
      activeEvaluations.delete(state);
    }
  }
}

/**
 * OPCG-Go patch: the base power a card presents to another card's base-power COPY -- a timed
 * literal first, then a permanent replacement, then the printed value. Deliberately not
 * getEffectiveBasePower: that lives in shared.ts, which imports THIS module, so calling it here
 * would be a cycle.
 */
function effectivePermanentBasePower(state: MatchState, instanceId: string): number {
  const timed = getSetBasePowerModifier(state, instanceId);
  if (timed !== null) {
    return timed;
  }
  const permanent = getPermanentSetBasePower(state, instanceId);
  if (permanent !== null) {
    return permanent;
  }
  const card = getCard(state.cards[instanceId]!.cardId);
  return card.cardType === "leader" || card.cardType === "character" ? (card.power ?? 0) : 0;
}

export function getPermanentSetCost(state: MatchState, targetInstanceId: string): number | null {"""

SETBASEPOWER_ACTION_ANCHOR = """    case "setBasePowerFrom": {"""

SETBASEPOWER_ACTION_FIX = """    case "setBasePower": {
      // OPCG-Go patch: "base power becomes <literal>". Contrast `setPower` below, which sets TOTAL
      // power by subtracting getCardPower at resolution; this one hands the literal to
      // getEffectiveBasePower so DON!! and +/-power modifiers stack on top of it.
      const targetIds = resolveActionTargets(
        state,
        controller,
        sourceInstanceId,
        action,
        selectedTargetIds,
        previousActionTargetIds,
      );
      if (targetIds === "prompt" || !targetIds) {
        return false;
      }
      for (const targetId of targetIds) {
        addModifier(state, sourceInstanceId, targetId, {
          type: "setBasePower",
          value: action.value,
          duration: action.duration,
          // The duration mapping is copied from `modifyPower`, which is the only COMPLETE one in
          // this file. An unmapped duration falls through to `expiresAtTurn: null` and the modifier
          // then NEVER EXPIRES, so every member of the Duration union has to appear here.
          // `setPower`'s map -- which this originally copied -- omits `untilEndOfYourNextTurn` and
          // has that bug; do not use it as the model. `untilEndOfOpponentNextEndPhase` matters
          // separately because it is the duration OP17-005 prints.
          expiresAtTurn:
            action.duration === "thisTurn"
              ? state.turnNumber
              : action.duration === "untilEndOfYourNextTurn" ||
                  action.duration === "untilEndOfOpponentNextTurn" ||
                  action.duration === "untilEndOfOpponentNextEndPhase"
                ? state.turnNumber + 1
                : null,
          expiresAtBattleId: action.duration === "thisBattle" ? (state.battle?.id ?? null) : null,
          expiresOnTurnStartOfSeat: action.duration === "untilStartOfNextTurn" ? controller : null,
        });
      }
      emitLog(
        state,
        controller,
        `${effectSourceName(state, sourceInstanceId)} sets the base power of ${targetNames(state, targetIds)} to ${action.value} ${durationLabel(action.duration)}.`,
        {
          sourceCardId: getInstance(state, sourceInstanceId).cardId,
          sourceInstanceId,
          targetIds,
          visibility: "public",
        },
      );
      return true;
    }
    case "setBasePowerFrom": {"""


# --- Patches 22-23: the older base-power setters must measure from the EFFECTIVE base ---------
#
# REGRESSION INTRODUCED BY the getCardPower patch above, found by review and reproduced before fixing. `copyPower`,
# `setBasePowerFrom` and `swapBasePower` each emit a `type: "power"` delta of
# `desired - basePower(card)`. That was self-consistent while getCardPower started from the printed
# base -- `printed + (desired - printed) == desired`. Patch 14 made getCardPower start from
# getEffectiveBasePower, so a card carrying BOTH a setBasePower literal and one of those deltas
# reads `literal + (desired - printed)`: two mutually exclusive REPLACEMENTS combined additively.
#
# Measured, not argued. OP16-106 Sanjuan.Wolf sets OP16-104 Catarina Devon (printed 3000) to base
# 7000; Devon's [When Attacking] copyPower off a 10000 body then adds +7000. Before this patch the
# engine read 14000 where the printed text says 10000 -- on the attacking body, deciding a battle.
# Both cards are real, yellow, and legal together. tests/cards/OP16/zz-compose.test.ts pins it.
#
# The fix is result-preserving for every card that does NOT carry a literal, because
# getEffectiveBasePower falls through to `basePower(card)` when no setBasePower applies. That is why
# it is safe to apply to three verbs used by 20+ existing cards: the 6106-test suite does not move.
#
# NOT touched: the PERMANENT `setBasePowerFrom` branch in getPermanentModifierTotal. It runs INSIDE
# a power computation, so calling getEffectiveBasePower there re-enters getPermanentSetBasePower
# across sibling instances -- the OP16-017 blowup shape. Exactly one card uses that branch
# (OP14EB04-053 Vista, blue), and reaching it needs Vista plus a permanent literal on the same
# Leader, i.e. a black/blue deck pairing Vista with OP15-092. Recorded in CLAUDE.md as a known,
# bounded gap rather than fixed blind.

SETTERS_EFFECTIVE_SWAP_ANCHOR = """      const [firstId, secondId] = targetIds;
      const firstPower = basePower(getCardForInstance(state, firstId!));
      const secondPower = basePower(getCardForInstance(state, secondId!));"""

SETTERS_EFFECTIVE_SWAP_FIX = """      const [firstId, secondId] = targetIds;
      // OPCG-Go patch: EFFECTIVE base, not printed. Swapping base powers has to exchange what the
      // two cards' base powers CURRENTLY are; a card whose base was set to a literal must swap
      // that literal away, not its printed value. Identical to basePower() when no literal applies.
      const firstPower = getEffectiveBasePower(state, firstId!);
      const secondPower = getEffectiveBasePower(state, secondId!);"""

SETTERS_EFFECTIVE_FROM_ANCHOR = """      const copiedBasePower = basePower(getCardForInstance(state, sourceIds[0]!));
      for (const targetId of targetIds) {
        const printedBasePower = basePower(getCardForInstance(state, targetId));"""

SETTERS_EFFECTIVE_FROM_FIX = """      // OPCG-Go patch: both sides read the EFFECTIVE base rather than the printed one. The source
      // side is what SC ruling #762 requires -- when OP06-009 Shuraiya's 原本的力量 BECOMES 6000 by
      // effect, that 6000 is its base power for every later test. The target side is what stops the
      // delta double-applying over a setBasePower literal. Both are no-ops without a literal.
      const copiedBasePower = getEffectiveBasePower(state, sourceIds[0]!);
      for (const targetId of targetIds) {
        const printedBasePower = getEffectiveBasePower(state, targetId);"""

SETTERS_EFFECTIVE_COPY_ANCHOR = """      const copiedPower = getCardPower(state, copiedFromId);
      const sourceBasePower = basePower(getCardForInstance(state, sourceInstanceId));"""

SETTERS_EFFECTIVE_COPY_FIX = """      const copiedPower = getCardPower(state, copiedFromId);
      // OPCG-Go patch: EFFECTIVE base. `copyPower` replaces the bearer's base power, so the delta
      // has to be measured from whatever that base currently is.
      const sourceBasePower = getEffectiveBasePower(state, sourceInstanceId);"""

# `basePower` becomes UNUSED in actions.ts once the four reads above are converted, and
# `noUnusedLocals` makes that a type error rather than a warning. That is a useful signal, not an
# annoyance: it proves the patch converted EVERY printed-base read in the file, so the import is
# dropped in the same patch.
SETTERS_EFFECTIVE_IMPORT_ANCHOR = """import {
  basePower,
  cardName,"""

SETTERS_EFFECTIVE_IMPORT_FIX = """import {
  // OPCG-Go patch: `basePower` is gone from this file -- every base-power setter here now measures
  // its delta from getEffectiveBasePower instead, so a setBasePower literal is replaced rather than
  // stacked on. noUnusedLocals is what keeps that claim honest.
  cardName,"""

SETTERS_EFFECTIVE_ADD_ANCHOR = """  getCardPower,
  getInstance,"""

SETTERS_EFFECTIVE_ADD_FIX = """  getCardPower,
  getEffectiveBasePower,
  getInstance,"""

# --- Patch 24: getPermanentModifierTotal must not ALSO apply setBasePowerFrom ------------------
#
# Found by Codex review on PR #26. `setBasePowerFrom` in `permanentEffects` was handled here as a
# `type: "power"` delta of `sourceBase - printedTargetBase`, which was self-consistent only while
# getCardPower started from the printed base. Once a literal can replace that base, a card in reach
# of both read `literal + (sourceBase - printed)` -- two mutually exclusive REPLACEMENTS summed.
#
# The other half of the same defect is on the SOURCE side and is what the test actually caught:
# this branch read `sourceCard.power`, the PRINTED value, so a copy could not see a base power that
# had been set on the card it was copying FROM.
#
# Reachable, measured: OP14EB04-053 Vista is the only card in the catalog with `setBasePowerFrom`
# inside permanentEffects -- "[Opponent's Turn] if you have 7 or less cards in hand, this
# Character's base power becomes the same as your Leader's base power" -- and OP15-092's bullet 2
# sets that Leader's base to 7000 on the opponent's turn at 20+ trash. Vista read 5000 while the
# Leader read 7000. SC ruling #762 settles which is right: a base power changed by an effect IS
# that card's base power for every later read.
#
# Both halves are fixed by moving the action onto the replacement path in
# getPermanentSetBasePower, so it is SELECTED against a literal (first match wins, the contract
# getPermanentSetCost already has) rather than added to one. This branch is therefore deleted, and
# `actionIsDynamicModifier` alone decides what counts as a permanent modifier again.
#
# Behaviour-preserving for Vista alone, which is the only existing user: previously
# `printed 4000 + (leader 5000 - 4000) = 5000`; now the effective base IS the leader's 5000. Pinned
# from both sides by cards/tests/OP15/092-monkey-d-luffy.test.ts.

PERM_SETBASEPOWERFROM_ANCHOR = """        const relevantActions = effect.actions.filter(
          (action) =>
            (type === "power" && action.action === "setBasePowerFrom") ||
            actionIsDynamicModifier(action, type),
        );"""

PERM_SETBASEPOWERFROM_FIX = """        // OPCG-Go patch: `setBasePowerFrom` used to be folded in here as a power delta. It is a
        // base-power REPLACEMENT, so it now lives on getPermanentSetBasePower's path instead --
        // otherwise a card reachable by both it and a `setBasePower` literal sums two mutually
        // exclusive replacements. `actionIsDynamicModifier` alone decides again.
        const relevantActions = effect.actions.filter((action) =>
          actionIsDynamicModifier(action, type),
        );"""

PERM_SETBASEPOWERFROM_BRANCH_ANCHOR = """          if (type === "power" && action.action === "setBasePowerFrom") {
            const targetPool = candidatePoolForTarget(
              state,
              source.controller,
              source.instanceId,
              action.target,
            );
            if (!targetPool.supported || !targetPool.candidateIds.includes(targetInstanceId)) {
              continue;
            }
            const sourcePool = candidatePoolForTarget(
              state,
              source.controller,
              source.instanceId,
              action.source,
            );
            if (!sourcePool.supported || sourcePool.candidateIds.length !== 1) {
              continue;
            }
            const targetCard = getCard(state.cards[targetInstanceId]!.cardId);
            const sourceCard = getCard(state.cards[sourcePool.candidateIds[0]!]!.cardId);
            const targetBasePower =
              targetCard.cardType === "leader" || targetCard.cardType === "character"
                ? (targetCard.power ?? 0)
                : 0;
            const sourceBasePower =
              sourceCard.cardType === "leader" || sourceCard.cardType === "character"
                ? (sourceCard.power ?? 0)
                : 0;
            total += sourceBasePower - targetBasePower;
            continue;
          }"""

PERM_SETBASEPOWERFROM_BRANCH_FIX = ""


PATCHES = [
    {
        "name": "bot-harness: resolve orderCards prompts",
        "relpath": "src/automation/bot-harness.ts",
        "anchor": ORDERCARDS_ANCHOR,
        "already": 'prompt.choiceKind === "orderCards"',
        "apply": lambda s: s.replace(ORDERCARDS_ANCHOR, ORDERCARDS_FIX, 1),
    },
    {
        "name": "resolution: search-to-hand must not require open character slots",
        "relpath": "src/effects/resolution.ts",
        "anchor": SEARCH_SLOTS_ANCHOR,
        "already": 'OPCG-Go patch: only a search that PLAYS what it reveals',
        "apply": lambda s: s.replace(SEARCH_SLOTS_ANCHOR, SEARCH_SLOTS_FIX, 1),
    },
    {
        "name": "vite.config: run the per-card tests under src/cards",
        "relpath": "vite.config.ts",
        "anchor": SRC_CARDS_TESTS_ANCHOR,
        "already": '"src/cards/**/*.test.ts"',
        "apply": lambda s: s.replace(SRC_CARDS_TESTS_ANCHOR, SRC_CARDS_TESTS_FIX, 1),
    },
    {
        "name": "state: first player places 1 DON!! on their first turn, not 2",
        "relpath": "src/state.ts",
        "anchor": FIRST_TURN_DON_ANCHOR,
        "already": "isFirstPlayersFirstTurn",
        "apply": lambda s: s.replace(FIRST_TURN_DON_ANCHOR, FIRST_TURN_DON_FIX, 1),
    },
    {
        "name": "tests: two upstream cases assert the pre-fix first-turn DON!! count",
        "relpath": "tests/index.test.ts",
        "anchor": MULLIGAN_DON_ANCHOR,
        "already": "south wins 猜拳 and chooses itself first",
        "apply": lambda s: s.replace(MULLIGAN_DON_ANCHOR, MULLIGAN_DON_FIX, 1).replace(
            STAGE_TURN_ANCHOR, STAGE_TURN_FIX, 1
        ),
    },
    {
        "name": "tests: OP06-054's Blocker threshold asserted the defect, not the card",
        "relpath": "tests/cards/characters/op06-054-borsalino.test.ts",
        "anchor": BORSALINO_ANCHOR,
        "already": 'test("does not gain Blocker with six cards in hand"',
        "apply": lambda s: s.replace(BORSALINO_ANCHOR, BORSALINO_FIX, 1),
    },
    {
        "name": "tests: OP07-030 Pappag asserted a condition that is always true",
        "relpath": "tests/cards/characters/op07-030-pappag.test.ts",
        "anchor": PAPPAG_ANCHOR,
        "already": 'expect(() => withoutCamie.pendingDecision("battleBlocker", "south")).toThrow();',
        "apply": lambda s: s.replace(PAPPAG_ANCHOR, PAPPAG_FIX, 1),
    },
    {
        "name": "tests: EB03-008 Hibari used a non-SWORD card as its SWORD body",
        "relpath": "tests/cards/characters/eb03-008-hibari.test.ts",
        "anchor": HIBARI_ANCHOR,
        "already": "op11Helmeppo092",
        # The comment goes in first, anchored on the original import line; only then can the
        # remaining identifiers be swapped wholesale, or the anchor would already be gone.
        "apply": lambda s: s.replace(HIBARI_ANCHOR, HIBARI_FIX, 1)
        .replace("op11Franky012", "op11Helmeppo092")
        .replace("frankyId", "helmeppoId"),
    },
    {
        "name": "permanent: getPermanentSetCost evaluates conditions it then discards",
        "relpath": "src/effects/permanent.ts",
        "anchor": SETCOST_PREFILTER_ANCHOR,
        "already": "OPCG-Go patch: skip the effect before evaluating its conditions",
        "apply": lambda s: s.replace(SETCOST_PREFILTER_ANCHOR, SETCOST_PREFILTER_FIX, 1),
    },
    {
        "name": "battle: neither player may attack on their own first turn",
        "relpath": "src/battle.ts",
        "anchor": FIRST_TURN_ATTACK_ANCHOR,
        "already": "OPCG-Go patch: NEITHER player may attack on their own first turn",
        "apply": lambda s: s.replace(FIRST_TURN_ATTACK_ANCHOR, FIRST_TURN_ATTACK_FIX, 1),
    },
    {
        "name": "counter-policy: the defender's counter step, with every knob in a config object",
        "relpath": "src/automation/counter-policy.ts",
        "create": COUNTER_POLICY_SOURCE,
        "already": "OPCG-Go: the defender's COUNTER STEP policy.",
    },
    {
        "name": "bot-harness: resolve the counter step through the counter policy",
        "relpath": "src/automation/bot-harness.ts",
        "anchor": COUNTER_CALL_ANCHOR,
        "already": "OPCG-Go patch: the COUNTER STEP is a decision, not a default",
        # The import goes in first: COUNTER_CALL_FIX does not contain the import anchor, so order is
        # not load-bearing, but keeping the import edit first means a half-applied patch still names
        # the module that is missing rather than failing on an unresolved symbol.
        "apply": lambda s: s.replace(COUNTER_IMPORT_ANCHOR, COUNTER_IMPORT_FIX, 1).replace(
            COUNTER_CALL_ANCHOR, COUNTER_CALL_FIX, 1
        ),
    },
    {
        "name": "types: an opt-in flag letting a mid-game FIXTURE attack on its first turn",
        "relpath": "src/types.ts",
        "anchor": FIRST_TURN_ATTACK_FLAG_TYPE_ANCHOR,
        "already": "allowFirstTurnAttacks?: boolean;",
        "apply": lambda s: s.replace(
            FIRST_TURN_ATTACK_FLAG_TYPE_ANCHOR, FIRST_TURN_ATTACK_FLAG_TYPE_FIX, 1
        ).replace(FIRST_TURN_ATTACK_FLAG_STATE_ANCHOR, FIRST_TURN_ATTACK_FLAG_STATE_FIX, 1),
    },
    {
        "name": "test-fixtures: a mid-game fixture is not turn 1, so it may attack",
        "relpath": "src/testing/test-fixtures.ts",
        "anchor": FIRST_TURN_ATTACK_FIXTURE_ANCHOR,
        "already": "allowFirstTurnAttacks: true,",
        "apply": lambda s: s.replace(
            FIRST_TURN_ATTACK_FIXTURE_ANCHOR, FIRST_TURN_ATTACK_FIXTURE_FIX, 1
        ),
    },
    {
        # The one patch that reaches outside packages/engine: the Action union lives in
        # packages/types, which is consumed from source (`main: ./src/index.ts`), so there is no
        # build step to re-run.
        "name": "types: setBasePower joins the Action union",
        "relpath": "../types/src/effect/action.ts",
        "anchor": SETBASEPOWER_UNION_ANCHOR,
        "already": "  | SetBasePowerAction",
        "apply": lambda s: s.replace(SETBASEPOWER_UNION_ANCHOR, SETBASEPOWER_UNION_FIX, 1),
    },
    {
        "name": "types: SetBasePowerAction — set base power to a literal",
        "relpath": "../types/src/effect/action.ts",
        "anchor": SETBASEPOWER_TYPE_ANCHOR,
        "already": "export interface SetBasePowerAction {",
        "apply": lambda s: s.replace(SETBASEPOWER_TYPE_ANCHOR, SETBASEPOWER_TYPE_FIX, 1),
    },
    {
        "name": "types: a modifier may carry a literal base power",
        "relpath": "src/types.ts",
        "anchor": SETBASEPOWER_MODIFIER_ANCHOR,
        "already": '"power" | "setBasePower" | "cost"',
        "apply": lambda s: s.replace(SETBASEPOWER_MODIFIER_ANCHOR, SETBASEPOWER_MODIFIER_FIX, 1),
    },
    {
        "name": "shared: import the permanent half of setBasePower",
        "relpath": "src/shared.ts",
        "anchor": SETBASEPOWER_IMPORT_ANCHOR,
        "already": "  getPermanentSetBasePower,",
        "apply": lambda s: s.replace(SETBASEPOWER_IMPORT_ANCHOR, SETBASEPOWER_IMPORT_FIX, 1),
    },
    {
        "name": "shared: getCardPower substitutes a set base power for the printed one",
        "relpath": "src/shared.ts",
        "anchor": SETBASEPOWER_GETCARDPOWER_ANCHOR,
        "already": "export function getEffectiveBasePower(",
        "apply": lambda s: s.replace(
            SETBASEPOWER_GETCARDPOWER_ANCHOR, SETBASEPOWER_GETCARDPOWER_FIX, 1
        ),
    },
    {
        "name": "permanent: getPermanentSetBasePower, the setCost twin for base power",
        "relpath": "src/effects/permanent.ts",
        "anchor": SETBASEPOWER_PERMANENT_ANCHOR,
        "already": "export function getPermanentSetBasePower(",
        "apply": lambda s: s.replace(
            SETBASEPOWER_PERMANENT_ANCHOR, SETBASEPOWER_PERMANENT_FIX, 1
        ),
    },
    {
        "name": "actions: resolve the setBasePower action",
        "relpath": "src/effects/actions.ts",
        "anchor": SETBASEPOWER_ACTION_ANCHOR,
        "already": 'case "setBasePower": {',
        "apply": lambda s: s.replace(SETBASEPOWER_ACTION_ANCHOR, SETBASEPOWER_ACTION_FIX, 1),
    },
    {
        "name": "actions: swap the basePower import for getEffectiveBasePower",
        "relpath": "src/effects/actions.ts",
        "anchor": SETTERS_EFFECTIVE_IMPORT_ANCHOR,
        "already": "OPCG-Go patch: `basePower` is gone from this file",
        # Two edits, one patch: drop the now-unused `basePower` and add `getEffectiveBasePower`.
        # Splitting them would leave the file un-typecheckable between the two.
        "apply": lambda s: s.replace(
            SETTERS_EFFECTIVE_IMPORT_ANCHOR, SETTERS_EFFECTIVE_IMPORT_FIX, 1
        ).replace(SETTERS_EFFECTIVE_ADD_ANCHOR, SETTERS_EFFECTIVE_ADD_FIX, 1),
    },
    {
        "name": "actions: setBasePowerFrom/copyPower/swapBasePower measure from the effective base",
        "relpath": "src/effects/actions.ts",
        "anchor": SETTERS_EFFECTIVE_SWAP_ANCHOR,
        "already": "OPCG-Go patch: EFFECTIVE base, not printed. Swapping base powers",
        "apply": lambda s: s.replace(SETTERS_EFFECTIVE_SWAP_ANCHOR, SETTERS_EFFECTIVE_SWAP_FIX, 1)
        .replace(SETTERS_EFFECTIVE_FROM_ANCHOR, SETTERS_EFFECTIVE_FROM_FIX, 1)
        .replace(SETTERS_EFFECTIVE_COPY_ANCHOR, SETTERS_EFFECTIVE_COPY_FIX, 1),
    },
    {
        "name": "permanent: setBasePowerFrom is a replacement, not a power delta",
        "relpath": "src/effects/permanent.ts",
        "anchor": PERM_SETBASEPOWERFROM_ANCHOR,
        "already": "OPCG-Go patch: `setBasePowerFrom` used to be folded in here as a power delta",
        # Two edits, one patch: narrow relevantActions AND delete the branch it used to admit.
        # Splitting them would leave either dead code or a filter with no handler.
        "apply": lambda s: s.replace(PERM_SETBASEPOWERFROM_ANCHOR, PERM_SETBASEPOWERFROM_FIX, 1)
        # `+ "\n"` so the deletion takes the branch's own trailing newline with it. Without that
        # the closing brace's line break survives as a blank line and `vp check` fails on format.
        .replace(
            PERM_SETBASEPOWERFROM_BRANCH_ANCHOR + "\n", PERM_SETBASEPOWERFROM_BRANCH_FIX, 1
        ),
    },
]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--check",
        action="store_true",
        help="report status without writing; exit 1 if any patch is not applied",
    )
    ap.add_argument(
        "--engine",
        default=ENGINE,
        help="engine checkout to patch (default: the vendored one)",
    )
    args = ap.parse_args(argv)

    if not os.path.isdir(args.engine):
        print(
            f"engine not found at {args.engine} — run ./scripts/bootstrap.sh first",
            file=sys.stderr,
        )
        return 1

    failed = 0
    pending = 0
    for patch in PATCHES:
        path = os.path.join(args.engine, patch["relpath"])
        exists = os.path.exists(path)
        source = ""
        if exists:
            with open(path, encoding="utf-8") as fh:
                source = fh.read()

        # A CREATE patch adds a file upstream does not have, so it cannot be anchored -- there is
        # nothing to anchor to. Its three states: absent (PENDING, and applying writes it), present
        # carrying our marker (ok), or present WITHOUT the marker, which means something else
        # occupies the path and writing over it would destroy that file (FAILED, never overwrite).
        if "create" in patch:
            if exists and patch["already"] in source:
                print(f"  ok       {patch['name']} (already applied)")
                continue
            if exists:
                print(
                    f"  FAILED   {patch['name']}: {path} exists but is not ours — refusing to "
                    f"overwrite it; re-derive this patch"
                )
                failed += 1
                continue
            if args.check:
                print(f"  PENDING  {patch['name']}")
                pending += 1
                continue
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(patch["create"])
            print(f"  applied  {patch['name']}")
            continue

        if not exists:
            print(f"  MISSING  {patch['name']}: {path} does not exist")
            failed += 1
            continue

        if patch["already"] in source:
            print(f"  ok       {patch['name']} (already applied)")
            continue

        if patch["anchor"] not in source:
            print(
                f"  FAILED   {patch['name']}: anchor text not found — upstream changed, "
                f"re-derive this patch against {path}"
            )
            failed += 1
            continue

        if args.check:
            print(f"  PENDING  {patch['name']}")
            pending += 1
            continue

        with open(path, "w", encoding="utf-8") as fh:
            fh.write(patch["apply"](source))
        print(f"  applied  {patch['name']}")

    if failed:
        print(f"\n{failed} patch(es) could not be applied.", file=sys.stderr)
    if pending:
        # A merely-unpatched engine is as wrong to test against as a broken patch, so --check
        # gates on it. Without this the exit code was 0 and a CI gate would wave it through.
        print(
            f"\n{pending} patch(es) not applied — run `python3 tools/patch_engine.py`.",
            file=sys.stderr,
        )
    return 1 if (failed or pending) else 0


if __name__ == "__main__":
    sys.exit(main())
