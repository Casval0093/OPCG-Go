#!/usr/bin/env bash
# Run the arena inside the vendored engine.
#
#   ./scripts/arena.sh --south scripted --north faithful --games 5
#   ./scripts/arena.sh --serve                        # browser board, you vs the anchor
#
# arena/ in THIS repo is the source of truth (docs/plans/encode-op15-op16.md Global Constraint #1).
# The grafted copy under vendor/ is disposable and must never be edited in place.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENG="$ROOT/vendor/tcg-engines/submodules/one-piece/packages/engine"
[ -d "$ENG" ] || { echo "vendored engine missing - run ./scripts/bootstrap.sh first" >&2; exit 1; }

rm -rf "$ENG/arena"
mkdir -p "$ENG/arena"
cp -R "$ROOT/arena/." "$ENG/arena/"

export ARENA_ROOT="$ROOT"
cd "$ENG"
exec node arena/main.ts "$@"
