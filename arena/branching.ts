// Branching-factor report — "Step 0" from docs/policy-proposals.md, which has been the load-bearing
// unmeasured number in every LLM costing this project has written.
//
// The question it answers: of the ~120 engine commands in a game, how many are decisions with more
// than one real option? That figure sets an LLM's per-game call count, and therefore whether an LLM
// can finish a game at all.
//
// It reports three tiers, because "non-forced" is too generous a definition to cost against:
//
//   forced        exactly one legal choice. Auto-played by the driver, never shown to an agent.
//   procedural    more than one choice, but the kind is not a play decision worth a model call:
//                 setup throws, mulligan/keep, judge acknowledgements, and single-position orderings.
//   substantive   everything else — what to play, where to attack, which target, whether to fire an
//                 optional effect. This is the number an LLM harness is actually billed for.
//
// The split is a judgement call and it is stated rather than hidden, because it moves the cost of an
// LLM policy by several times and every previous estimate assumed one without saying so.

import type { GameRecord } from "./types.ts";

const PROCEDURAL_KINDS = new Set([
  "chooseJoKenPo",
  "chooseFirstPlayer",
  "mulligan",
  "keepHand",
  "startGame",
  "judge",
]);

export interface BranchingReport {
  games: number;
  substantivePerGame: number;
  substantivePerSeatPerGame: number;
  proceduralPerGame: number;
  byKind: Array<{ kind: string; count: number; meanMenuSize: number; maxMenuSize: number }>;
}

export function branchingReport(records: GameRecord[]): BranchingReport {
  const games = Math.max(1, records.length);
  const buckets = new Map<string, { count: number; choices: number; max: number }>();
  let substantive = 0;
  let procedural = 0;

  for (const record of records) {
    for (const decision of record.decisions) {
      const bucket = buckets.get(decision.kind) ?? { count: 0, choices: 0, max: 0 };
      bucket.count++;
      bucket.choices += decision.choiceCount;
      bucket.max = Math.max(bucket.max, decision.choiceCount);
      buckets.set(decision.kind, bucket);

      if (PROCEDURAL_KINDS.has(decision.kind)) procedural++;
      else substantive++;
    }
  }

  return {
    games: records.length,
    substantivePerGame: substantive / games,
    substantivePerSeatPerGame: substantive / games / 2,
    proceduralPerGame: procedural / games,
    byKind: [...buckets.entries()]
      .map(([kind, b]) => ({
        kind,
        count: b.count,
        meanMenuSize: b.choices / b.count,
        maxMenuSize: b.max,
      }))
      .sort((a, b) => b.count - a.count),
  };
}

export function reportBranching(records: GameRecord[]): BranchingReport {
  const report = branchingReport(records);
  console.log(`\nBRANCHING FACTOR  (${report.games} games)`);
  console.log(
    `  substantive decisions: ${report.substantivePerGame.toFixed(1)}/game, ` +
      `${report.substantivePerSeatPerGame.toFixed(1)}/seat/game   ` +
      `procedural: ${report.proceduralPerGame.toFixed(1)}/game`,
  );
  // "menu size" is the size of the WHOLE option list at that decision, not the number of options
  // of this kind. It is what an agent has to read, which is the quantity that matters for a prompt.
  console.log(`  kind chosen          count   mean menu   max menu`);
  for (const row of report.byKind) {
    const tier = PROCEDURAL_KINDS.has(row.kind) ? "procedural" : "substantive";
    console.log(
      `  ${row.kind.padEnd(20)} ${String(row.count).padStart(5)}   ` +
        `${row.meanMenuSize.toFixed(2).padStart(9)}   ${String(row.maxMenuSize).padStart(8)}   ${tier}`,
    );
  }
  return report;
}
