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


# --- Patches 10-16: setBasePower, a literal base-power setter -------------------------------
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
  // OPCG-Go patch: the permanent-effect half of the setBasePower primitive.
  getPermanentSetBasePower,
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
 * OPCG-Go patch: the literal base power a timed `setBasePower` modifier currently imposes on a
 * card, or null when none does.
 *
 * "Base power becomes N" REPLACES the printed base, so the modifier stores N itself rather than a
 * delta. That is what lets +power modifiers and attached DON!! stack on top of N, and what makes
 * two sources naming the same literal idempotent instead of additive.
 *
 * When two of them overlap the most recently applied wins, which is the printed rule for
 * conflicting replacements. `nextIdentifier` zero-pads to six digits, so lexicographic order over
 * modifier ids IS application order and no extra timestamp is needed.
 */
export function getSetBasePowerModifier(state: MatchState, instanceId: string): number | null {
  let latest: ModifierState | null = null;
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
 * OPCG-Go patch: the literal base power a permanent `setBasePower` effect imposes on a card, or
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
      if (
        !effects?.some((effect) =>
          effect.actions.some((action) => action.action === "setBasePower"),
        )
      ) {
        continue;
      }
      if (
        !sourceIsInPlay(state, source.instanceId) ||
        sourceEffectsAreNegated(state, source.instanceId)
      ) {
        continue;
      }
      for (const effect of effects) {
        if (!effect.actions.some((action) => action.action === "setBasePower")) {
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
          if (action.action !== "setBasePower") {
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
          if (pool.supported && pool.candidateIds.includes(targetInstanceId)) {
            return action.value;
          }
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


# --- Patch 17: the older base-power setters must measure from the EFFECTIVE base ---------------
#
# REGRESSION INTRODUCED BY PATCH 14, found by review and reproduced before fixing. `copyPower`,
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
        if not os.path.exists(path):
            print(f"  MISSING  {patch['name']}: {path} does not exist")
            failed += 1
            continue

        with open(path, encoding="utf-8") as fh:
            source = fh.read()

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
