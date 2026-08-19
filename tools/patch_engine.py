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

ENGINE = "vendor/tcg-engines/submodules/one-piece/packages/engine"

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

HIBARI_ANCHOR = """import { eb01Doma005, eb03Hibari008, op11Franky012 } from "@tcg/op-cards";"""

HIBARI_FIX = """// OPCG-Go patch: this test used OP11-012 Franky as its SWORD body, but OP11-012 is a Straw Hat Crew
// card -- Limitless prints "Straw Hat Crew" and the engine wrongly stored ["Navy SWORD"]. Both cases
// passed only because the card data and the test shared the same wrong trait, which is exactly the
// OP06-054 failure mode. OP11-092 Helmeppo is really Navy/SWORD and at 7000 power still beats Doma.
import { eb01Doma005, eb03Hibari008, op11Helmeppo092 } from "@tcg/op-cards";"""


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
