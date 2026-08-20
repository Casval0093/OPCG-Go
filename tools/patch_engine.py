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


# --- Patch 9: trait filters substring-match instead of matching whole traits ------------------
#
# `matchesTargetFilter` branched on `match: "includes"` to a SUBSTRING test —
# `trait.includes(expectedTrait)` — and 597 of the 599 trait filters set it. That was load-bearing
# while upstream stored a multi-trait card as one space-joined string (838+ cards), but it also
# made 16 official traits proper-substring-match other official traits: brace references like
# {Whitebeard Pirates} matched "Former Whitebeard Pirates" and "Whitebeard Pirates Allies",
# {Navy} matched "Former Navy"/"Neo Navy", {Animal} matched all 84 "Animal Kingdom Pirates" —
# wider than the card, since Comprehensive Rules 2-4-3 makes 《》/brace references exact.
#
# data/card-corrections.json now splits every joined value into the official trait list
# (tools/split_traits.py regenerates that block), so whole-trait equality is the whole semantics.
# Filters and leader conditions whose printed text is genuinely a "type including" reference
# (CP, GERMA, Whitebeard Pirates, Baroque Works, Roger Pirates sites) are rewritten in the same
# table to enumerate every official trait containing the reference — Comprehensive Rules 2-4-3-1
# makes that the card-faithful reading, so e.g. OP16-001 Ace keeps covering Former/Allies exactly
# as printed.

TRAIT_FILTER_ANCHOR = """      const hasMatchingTrait = expectedTraits.some((expectedTrait) =>
        filter.match === "includes"
          ? (card.traits ?? []).some((trait) => trait.includes(expectedTrait))
          : (card.traits ?? []).includes(expectedTrait),
      );"""

TRAIT_FILTER_FIX = """      // OPCG-Go patch: whole-trait equality only. Traits are stored as exact tokens now that
      // data/card-corrections.json splits upstream's space-joined strings, and the printed
      // "type including" filters enumerate the traits they mean (Comprehensive Rules 2-4-3-1),
      // so nothing needs the substring branch — which let brace references like
      // {Whitebeard Pirates} match "Former Whitebeard Pirates"/"Whitebeard Pirates Allies" and
      // {Animal} match all "Animal Kingdom Pirates", wider than the card (CR 2-4-3: exact).
      const hasMatchingTrait = expectedTraits.some((expectedTrait) =>
        (card.traits ?? []).includes(expectedTrait),
      );"""


# --- Patch 10: leaderTrait conditions substring-match, same defect as patch 9 -----------------
#
# The `leaderTrait` condition is the targeting.ts defect's twin: `match: "includes"` was the
# DEFAULT (292 of 292 conditions), so every "if your Leader has the {X} type" condition
# substring-matched. Teeth, not just theory: 14 "Whitebeard Pirates" conditions match a Former
# Whitebeard Pirates leader, 13 "Navy" conditions match the Neo Navy leader OP02-072, and 3
# "Roger Pirates" conditions match the Former Roger Pirates leader OP12-001 (Standard-legal).
# Collapse to whole-trait equality; the printed "type including" conditions (CP x4,
# GERMA x1, plus the Whitebeard/Baroque Works/Roger Pirates sites) are rewritten to
# compound-or enumerations by data/card-corrections.json.

LEADER_TRAIT_ANCHOR = """    case "leaderTrait":
      return {
        supported: true,
        matches:
          condition.match === "exact"
            ? (leader.traits ?? []).includes(condition.trait)
            : (leader.traits ?? []).some((trait) => trait.includes(condition.trait)),
      };"""

LEADER_TRAIT_FIX = """    case "leaderTrait":
      return {
        supported: true,
        // OPCG-Go patch: whole-trait equality only, same as the targeting.ts trait filter.
        // Substring matching let "Whitebeard Pirates" leader conditions match Former Whitebeard
        // Pirates leaders, "Navy" match the Neo Navy leader, and "Roger Pirates" match the Former
        // Roger Pirates leader OP12-001. Printed "type including" conditions (CP/GERMA) are now
        // compound-or enumerations via data/card-corrections.json.
        matches: (leader.traits ?? []).includes(condition.trait),
      };"""


# --- Patch 11: test-side pins of the joined-trait / substring-matching era ------------------------
#
# Seventeen upstream tests encoded the defects patches 9+10 remove: they registered test-local
# bodies with slash/space-joined trait strings (only reachable via substring matching), asserted
# the joined storage shape directly, or cast a Former/Allies-trait card as eligible for a brace
# {X} reference. Every fix is test-only: split the fixture string into the official traits, or
# swap the body for a card that carries the referenced trait exactly (Comprehensive Rules 2-4-3).

LAW_009_ANCHOR = """    expect(op14eb04TrafalgarLawOp14009009.traits).toEqual([
      "Heart Pirates Supernovas The Seven Warlords of the Sea",
    ]);"""

LAW_009_FIX = """    expect(op14eb04TrafalgarLawOp14009009.traits).toEqual([
      "The Seven Warlords of the Sea",
      "Supernovas",
      "Heart Pirates",
    ]);"""

LAFFITTE_IMPORT_ANCHOR = 'import { op09Peachbeard094 } from "../../../../../cards/src/cards/OP09/characters/094-peachbeard.ts";'

LAFFITTE_IMPORT_FIX = 'import { op10Kuzan082 } from "../../../../../cards/src/cards/OP10/characters/082-kuzan.ts";'

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
        "name": "targeting: trait filters match whole traits, never substrings",
        "relpath": "src/effects/targeting.ts",
        "anchor": TRAIT_FILTER_ANCHOR,
        "already": "OPCG-Go patch: whole-trait equality only",
        "apply": lambda s: s.replace(TRAIT_FILTER_ANCHOR, TRAIT_FILTER_FIX, 1),
    },
    {
        "name": "conditions: leaderTrait matches whole traits, never substrings",
        "relpath": "src/effects/conditions.ts",
        "anchor": LEADER_TRAIT_ANCHOR,
        "already": "OPCG-Go patch: whole-trait equality only, same as the targeting.ts",
        "apply": lambda s: s.replace(LEADER_TRAIT_ANCHOR, LEADER_TRAIT_FIX, 1),
    },
    {
        "name": "tests: OP05-033 Baby 5's compound body pinned slash-joined trait storage",
        "relpath": "tests/cards/characters/op05-033-baby-5.test.ts",
        "anchor": 'traits: ["Test Fleet/Donquixote Pirates"],',
        "already": 'traits: ["Test Fleet", "Donquixote Pirates"],',
        "apply": lambda s: s.replace(
            'traits: ["Test Fleet/Donquixote Pirates"],',
            'traits: ["Test Fleet", "Donquixote Pirates"],', 1),
    },
    {
        "name": "tests: OP05-034 Baby 5's compound body pinned slash-joined trait storage",
        "relpath": "tests/cards/characters/op05-034-baby-5.test.ts",
        "anchor": 'traits: ["Test Fleet/Donquixote Pirates"],',
        "already": 'traits: ["Test Fleet", "Donquixote Pirates"],',
        "apply": lambda s: s.replace(
            'traits: ["Test Fleet/Donquixote Pirates"],',
            'traits: ["Test Fleet", "Donquixote Pirates"],', 1),
    },
    {
        "name": "tests: OP05-064 Killer's compound body pinned slash-joined trait storage",
        "relpath": "tests/cards/characters/op05-064-killer.test.ts",
        "anchor": 'traits: ["Supernovas/Kid Pirates"],',
        "already": 'traits: ["Supernovas", "Kid Pirates"],',
        "apply": lambda s: s.replace(
            'traits: ["Supernovas/Kid Pirates"],',
            'traits: ["Supernovas", "Kid Pirates"],', 1),
    },
    {
        "name": "tests: OP05-090 Riku Doldo III's compound body pinned slash-joined trait storage",
        "relpath": "tests/cards/characters/op05-090-riku-doldo-iii.test.ts",
        "anchor": 'traits: ["Beautiful Pirates/Dressrosa"],',
        "already": 'traits: ["Beautiful Pirates", "Dressrosa"],',
        "apply": lambda s: s.replace(
            'traits: ["Beautiful Pirates/Dressrosa"],',
            'traits: ["Beautiful Pirates", "Dressrosa"],', 1),
    },
    {
        "name": "tests: OP08-033 Roddy's compound body pinned space-joined trait storage",
        "relpath": "tests/cards/characters/op08-033-roddy.test.ts",
        "anchor": 'traits: ["Heart Pirates Minks"],',
        "already": 'traits: ["Heart Pirates", "Minks"],',
        "apply": lambda s: s.replace(
            'traits: ["Heart Pirates Minks"],',
            'traits: ["Heart Pirates", "Minks"],', 1),
    },
    {
        "name": "tests: OP10-007 Ceaser Soldier's compound body pinned space-joined trait storage",
        "relpath": "src/cards/OP10/characters/007-ceaser-soldier.test.ts",
        "anchor": 'traits: ["Scientist Punk Hazard"],',
        "already": 'traits: ["Scientist", "Punk Hazard"],',
        "apply": lambda s: s.replace(
            'traits: ["Scientist Punk Hazard"],',
            'traits: ["Scientist", "Punk Hazard"],', 1),
    },
    {
        "name": "tests: OP10-071 Doflamingo's compound body pinned space-joined trait storage",
        "relpath": "src/cards/OP10/characters/071-donquixote-doflamingo.test.ts",
        "anchor": 'traits: ["Donquixote Pirates Navy"],',
        "already": 'traits: ["Donquixote Pirates", "Navy"],',
        "apply": lambda s: s.replace(
            'traits: ["Donquixote Pirates Navy"],',
            'traits: ["Donquixote Pirates", "Navy"],', 1),
    },
    {
        "name": "tests: OP05-015 Belo Betty's search body pinned slash-joined trait storage",
        "relpath": "tests/cards/characters/op05-015-belo-betty.test.ts",
        "anchor": 'traits: ["Test Fleet/Revolutionary Army"],',
        "already": 'traits: ["Test Fleet", "Revolutionary Army"],',
        "apply": lambda s: s.replace(
            'traits: ["Test Fleet/Revolutionary Army"],',
            'traits: ["Test Fleet", "Revolutionary Army"],', 1),
    },
    {
        "name": "tests: OP07-060 Itomimizu mutated its leader to a space-joined trait string",
        "relpath": "tests/cards/characters/op07-060-itomimizu.test.ts",
        "anchor": 'op07Foxy059.traits = ["Foxy Pirates Long Ring Long Land"];',
        "already": 'op07Foxy059.traits = ["Foxy Pirates", "Long Ring Long Land"];',
        "apply": lambda s: s.replace(
            'op07Foxy059.traits = ["Foxy Pirates Long Ring Long Land"];',
            'op07Foxy059.traits = ["Foxy Pirates", "Long Ring Long Land"];', 1),
    },
    {
        "name": "tests: OP07-071 Foxy mutated its leader to a space-joined trait string",
        "relpath": "tests/cards/characters/op07-071-foxy.test.ts",
        "anchor": 'op07Foxy059.traits = ["Special Foxy Pirates"];',
        "already": 'op07Foxy059.traits = ["Special", "Foxy Pirates"];',
        "apply": lambda s: s.replace(
            'op07Foxy059.traits = ["Special Foxy Pirates"];',
            'op07Foxy059.traits = ["Special", "Foxy Pirates"];', 1),
    },
    {
        "name": "tests: OP05-012 Hack asserted the space-joined trait storage shape",
        "relpath": "tests/cards/characters/op05-012-hack.test.ts",
        "anchor": 'traits: ["Fish-Man Revolutionary Army"],',
        "already": 'traits: ["Fish-Man", "Revolutionary Army"],',
        "apply": lambda s: s.replace(
            'traits: ["Fish-Man Revolutionary Army"],',
            'traits: ["Fish-Man", "Revolutionary Army"],', 1),
    },
    {
        "name": "tests: OP14-009 Law asserted the space-joined trait storage shape",
        "relpath": "src/cards/OP14EB04/characters/009-trafalgar-law-op14-009.test.ts",
        "anchor": LAW_009_ANCHOR,
        "already": '"The Seven Warlords of the Sea",\n      "Supernovas",',
        "apply": lambda s: s.replace(LAW_009_ANCHOR, LAW_009_FIX, 1),
    },
    {
        "name": "tests: OP05-075 Mr.1 cast a Former Baroque Works body for a {Baroque Works} play",
        "relpath": "tests/cards/characters/op05-075-mr-1-daz-bonez.test.ts",
        "anchor": "op02Mr1DazBonez063",
        "already": "op01Mr1DazBonez083",
        # OP02-063 carries [Impel Down, Former Baroque Works]; the brace reference is exact now,
        # so the eligible body becomes the OP01 printing of the same character (cost 2, plain
        # [Baroque Works]). OP04-067 stays as the too-expensive case (cost 4, same exact trait).
        "apply": lambda s: s.replace("op02Mr1DazBonez063", "op01Mr1DazBonez083"),
    },
    {
        "name": "tests: EB01-009 cast Animal Kingdom Pirates bodies for an {Animal} play",
        "relpath": "tests/cards/events/eb01-009-just-shut-up-and-come-with-us.test.ts",
        "anchor": "eb01Hamlet024",
        "already": "op04Karoo004",
        # Hamlet/Fourtricks are [Animal Kingdom Pirates, SMILE] — the brace {Animal} reference
        # no longer reaches them. Karoo and Laboon carry [Animal] exactly at cost 1; Mountain
        # God stays as the too-expensive true-Animal case.
        "apply": lambda s: s.replace("eb01Hamlet024", "op04Karoo004")
        .replace("eb01Fourtricks025", "op15Laboon035"),
    },
    {
        "name": "tests: OP09-099 Fullalead cast an Allies body for a {Blackbeard Pirates} reveal",
        "relpath": "tests/cards/stages/op09-099-fullalead.test.ts",
        "anchor": "op09Peachbeard094",
        "already": "op10Kuzan082",
        # Peachbeard is [Peachbeard Pirates, Blackbeard Pirates Allies]; Kuzan OP10-082 is the
        # composite the test name describes — [Former Navy, Blackbeard Pirates] exactly.
        "apply": lambda s: s.replace("op09Peachbeard094", "op10Kuzan082"),
    },
    {
        "name": "tests: OP09-095 Laffitte cast an Allies body for a {Blackbeard Pirates} reveal",
        "relpath": "src/cards/OP09/characters/095-laffitte.test.ts",
        "anchor": LAFFITTE_IMPORT_ANCHOR,
        "already": "op10Kuzan082",
        "apply": lambda s: s.replace(LAFFITTE_IMPORT_ANCHOR, LAFFITTE_IMPORT_FIX, 1)
        .replace("op09Peachbeard094", "op10Kuzan082"),
    },
    {
        "name": "tests: OP10-082 Kuzan cast an Allies body for a {Blackbeard Pirates} trash play",
        "relpath": "src/cards/OP10/characters/082-kuzan.test.ts",
        "anchor": "op09Peachbeard094",
        "already": "op10JesusBurgess085",
        # Peachbeard is Blackbeard Pirates Allies; OP10-085 Jesus Burgess is the composite
        # [Dressrosa, Blackbeard Pirates] at exactly cost 5, keeping the cost boundary covered.
        "apply": lambda s: s.replace("op09Peachbeard094", "op10JesusBurgess085"),
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
