#!/usr/bin/env bash
# Policy-quality measurement, step 1 of the plan in CLAUDE.md: the DOMINANCE LADDER.
#
# Both seats play the SAME deck, so the deck cancels and the win rate is a read on the POLICY.
# A stronger policy must beat a weaker one by a wide margin. This is a FLOOR test: it proves the
# ladder is ordered, NOT that the top rung plays well. Nothing here says valueRanked is good.
#
# The pair that actually matters is valueRanked vs greedy. If the extra machinery in valueRanked
# buys nothing over greedy, the sim's default policy is greedy wearing a hat.
#
#   ./scripts/policy_ladder.sh [GAMES] [DECK]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GAMES="${1:-200}"
DECK="${2:-sim/decks/mihawk-green-proxy.json}"

# Adjacent rungs plus every pair against the presumed top, so a non-monotonic ladder is visible
# rather than inferred from a chain of adjacent comparisons.
PAIRS="
valueRanked passOnly
valueRanked firstLegal
valueRanked random
valueRanked greedy
greedy random
greedy firstLegal
random firstLegal
firstLegal passOnly
"

printf '%-14s %-12s %10s %22s %8s\n' A B WIN_A CI95 TIMEOUT
printf '%s\n' "--------------------------------------------------------------------------"
echo "$PAIRS" | while read -r a b; do
  [ -z "$a" ] && continue
  out=$("$ROOT/scripts/simulate.sh" --games "$GAMES" --a "$DECK" --b "$DECK" \
        --strategy-a "$a" --strategy-b "$b" 2>&1)
  win=$(printf '%s' "$out" | grep -E '^\s+overall' | head -1 | awk '{print $2}')
  ci=$(printf  '%s' "$out" | grep -E '^\s+overall' | head -1 | sed -E 's/.*(\[[^]]*\]).*/\1/')
  to=$(printf  '%s' "$out" | grep -E '^\s+timeouts' | head -1 | awk '{print $2}')
  if [ -z "$win" ]; then
    printf '%-14s %-12s %10s %22s %8s\n' "$a" "$b" "ERROR" "-" "-"
    printf '%s\n' "$out" | tail -5
  else
    printf '%-14s %-12s %10s %22s %8s\n' "$a" "$b" "$win" "$ci" "${to:-?}"
  fi
done
