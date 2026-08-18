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
