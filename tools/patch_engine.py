#!/usr/bin/env python3
"""Apply OPCG-Go's local fixes to the vendored engine.

`vendor/` is gitignored and recreated by bootstrap, so anything edited there by hand is lost on the
next clone. Fixes live here instead and are re-applied by `scripts/bootstrap.sh`. Each patch is
idempotent and refuses to apply blindly: it verifies the anchor text still exists and skips if the
fix is already present, so an upstream refactor produces a clear failure rather than a silent
no-op.

Run manually with:  python3 tools/patch_engine.py [--check]
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

PATCHES = [
    {
        "name": "bot-harness: resolve orderCards prompts",
        "path": f"{ENGINE}/src/automation/bot-harness.ts",
        "anchor": ORDERCARDS_ANCHOR,
        "already": 'prompt.choiceKind === "orderCards"',
        "apply": lambda s: s.replace(ORDERCARDS_ANCHOR, ORDERCARDS_FIX, 1),
    },
]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="report status without writing")
    args = ap.parse_args()

    if not os.path.isdir(ENGINE):
        print(f"engine not found at {ENGINE} — run ./scripts/bootstrap.sh first", file=sys.stderr)
        return 1

    failed = 0
    for patch in PATCHES:
        path = patch["path"]
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
            continue

        with open(path, "w", encoding="utf-8") as fh:
            fh.write(patch["apply"](source))
        print(f"  applied  {patch['name']}")

    if failed:
        print(f"\n{failed} patch(es) could not be applied.", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
