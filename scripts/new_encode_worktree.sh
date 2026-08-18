#!/usr/bin/env bash
# Create an isolated workspace for one encoding batch: a git worktree AND its own engine clone.
#
# Both halves are required, and the reason is recorded in docs/plans/encode-op15-op16.md:
#   * a worktree, because a concurrent session once wrote into the shared checkout mid-task and 486 of
#     its files were swept into an unrelated commit;
#   * an engine clone, because vendor/ is 766 MB and shared, so two agents grafting different card
#     sets into one engine overwrite each other.
# `cp -Rc` is an APFS copy-on-write clone: ~8 s and almost no disk until written.
#
# Usage:  ./scripts/new_encode_worktree.sh <batch-name> [<base-ref>]
# Example: ./scripts/new_encode_worktree.sh op16-leaders-events
set -euo pipefail

BATCH="${1:?usage: new_encode_worktree.sh <batch-name> [<base-ref>]}"
BASE="${2:-HEAD}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Worktrees live beside the current one so they share the repo's .claude/worktrees convention.
DEST="$(cd "$ROOT/.." && pwd)/encode-$BATCH"
BRANCH="claude/encode-$BATCH"

if [ -e "$DEST" ]; then
  echo "refusing to overwrite existing $DEST" >&2
  exit 1
fi

git -C "$ROOT" worktree add -b "$BRANCH" "$DEST" "$BASE" >/dev/null
mkdir -p "$DEST/vendor"
cp -Rc "$ROOT/vendor/tcg-engines" "$DEST/vendor/tcg-engines"

# Prove the clone is usable before handing it over: graft this repo's cards into it and re-apply the
# local engine patches (vendor/ is gitignored, so the patch never survives a fresh tree on its own).
PY="$ROOT/.venv/bin/python"
[ -x "$PY" ] || PY="$(command -v python3)"
(cd "$DEST" && "$PY" tools/graft_cards.py >/dev/null && "$PY" tools/patch_engine.py >/dev/null)

echo "worktree : $DEST"
echo "branch   : $BRANCH"
echo "engine   : $DEST/vendor/tcg-engines/submodules/one-piece/packages/engine"
