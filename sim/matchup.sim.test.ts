// Matchup simulator — the measurement layer the tech-slot question needs.
//
//   ./scripts/simulate.sh --a sim/decks/st01.json --b sim/decks/st01.json --games 200
//
// Grafted into packages/engine/tests/cards/ and run by the engine's own runner, gated on
// SIM_RUN=1, following the precedent of the engine's RUN_OP_BOT_BATCHES batch tests. It is a
// runner wearing a test's clothes: the engine's module resolution is the only reliable way to
// reach @tcg/op-cards, and vitest is how this repo already reaches it (see bench/throughput.test.ts).
//
// WHAT IT MEASURES, AND WHY IT IS NOT JUST "WIN RATE"
//
// From 官方公认赛赛事守则 V1.6.0 §II (关于时间截止), the SC tournament rules Ping's event runs under:
//
//   "在各对战中，如果在宣布的结束时间到来时还没有决定胜负，则不进行胜负判定，该对战结果为双方败北。"
//
// If the round clock expires with no winner, the result is **a loss for BOTH players** — 双方败北.
// Not a draw. That makes running out of clock strictly worse than a coin flip, and it means a win
// rate over clock-expired games only would systematically flatter slow decks. Four outcomes:
//
//   win | loss | timeout | unfinished
//
// `timeout` is the ROUND CLOCK — a real rules outcome, scored as a loss for both decks.
// `unfinished` is OUR command ceiling or the engine giving up — a tool limit, not a game result.
// It is excluded from the win rate and from paired differences entirely.
//
// These were one branch until a tech-slot A/B reported "-28.5 points, significant at 95%" that
// turned out to be 52% command-ceiling hits wearing a rules outcome's clothes. Scoring a tool
// limit as a double loss makes any deck that stalls the policy look catastrophic, which is a
// statement about the bot rather than the cards.
//
// Extra turns exist ONLY in finals and elimination brackets, not in Swiss rounds: +3 turns if time
// is called on the first player's turn, +2 if on the second player's, then a tiebreak of Life count
// -> deck count -> rock-paper-scissors. Ping's event is Swiss + top cut, so both regimes apply and
// they score differently. `--turn-budget` models the Swiss regime, which is the one that decides
// whether you reach the cut at all.
//
// TURN BUDGET IS A PROXY, AND AN UNCALIBRATED ONE
//
// The engine has no wall clock, so real minutes are not simulable. `--turn-budget` caps total turns
// and calls anything beyond it a timeout. The mapping from turns to 30 minutes is NOT yet measured
// against real games — until it is, treat the timeout column as a sensitivity knob, not a
// prediction. The honest default is a budget high enough that timeouts are rare, plus the reported
// turn distribution so a threshold can be applied afterwards without re-running.
//
// PLAY/DRAW IS SEPARATED, NEVER AVERAGED
//
// Turn order in OPTCG is severely asymmetric — per the Comprehensive Rules 6-3-1, the first player
// skips their first draw. Games alternate who leads strictly by index, so the split is exactly
// balanced by construction and each side is reported with its own interval.
//
// COMMON RANDOM NUMBERS
//
// A tech-slot test compares two decks differing by 1-2 cards, so the effect is small and the noise
// is not. Both arms are run over the SAME seed sequence, which pairs the games: identical shuffles
// and identical opponent draws, differing only by the swapped cards. The paired difference has far
// lower variance than two independent samples, which is what makes a 2-3 point effect measurable
// in a feasible number of games. See --compare.

import { test } from "vite-plus/test";
// Task 10: deck loading, strategy selection, MatchConfig construction, single-game execution, and
// summary primitives were moved into ./batch-runner.ts (runLegacyMatchupCli and friends), shared
// with the new strict fixed-seat environment job adapter (environment-job.sim.test.ts). Behavior,
// CLI surface, and sim/results/last-run.json are unchanged — see batch-runner.ts's own header for
// the two things that DID change (an additive turnBudgetKind label, and --first now failing loudly
// on an invalid value instead of silently becoming "alternate").
import { runLegacyMatchupCli } from "./batch-runner.ts";

const run = process.env.SIM_RUN === "1" ? test : test.skip;

run("matchup", () => runLegacyMatchupCli(), 3_600_000);
