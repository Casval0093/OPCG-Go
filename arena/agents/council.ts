// The council: several models argue, one adjudicates.
//
// WHY A COUNCIL, AND WHY IT IS GATED
//
// Ping's requirement: "a single agent might not make the most viable play, there needs to be multiple
// agents discussing." The measurement that shapes the design is this branch's own: **89.2 substantive
// decisions per seat per game** on a real Block 2+ deck (56.4 on ST01) — see `arena/branching.ts`,
// which produced the first real value for the figure `docs/policy-proposals.md` called "Step 0".
//
// An ungated N-proposer + adjudicator council is therefore (N+1) x 89 calls per seat per game. Three
// gates cut that without weakening the contested decisions:
//
//   1. FORCED decisions never reach an agent at all — the driver auto-plays them.
//   2. PROCEDURAL decisions (the 猜拳 throw, mulligan/keep, startGame, judge acknowledgements) go to
//      the scripted heuristic. Deliberating over rock-paper-scissors is pure waste.
//   3. UNANIMOUS proposals skip the adjudicator. There is nothing to adjudicate when every lens
//      already agrees, so the expensive step fires only on genuine disagreement.
//
// Gate 3 is the interesting one, because it makes cost land exactly on the hard positions — and those
// are the same positions worth storing in the decision bank. Disagreement is a free difficulty
// signal: no critic pass needed to find the decisions that mattered.
//
// DEGRADATION IS EXPLICIT, NEVER SILENT
//
// A refusal, a malformed answer, an out-of-range index, a rate limit, or an exhausted call budget all
// fall back to the scripted heuristic and are counted. The counts are printed at the end of the run.
// A council that quietly became a heuristic mid-tournament would invalidate the standings, and this
// repo has twice shipped a confident conclusion built on an unreported tool limit.

import { getProvider, type LlmProvider, type ProviderName } from "../providers/index.ts";
import { renderPrompt } from "../prompt.ts";
import { scriptedAgent } from "./scripted.ts";
import type { Agent, AgentAnswer, AgentContext } from "../types.ts";

/** Kinds the council never spends a call on. Matches branching.ts's "procedural" tier. */
const PROCEDURAL_KINDS = new Set([
  "chooseJoKenPo",
  "chooseFirstPlayer",
  "mulligan",
  "keepHand",
  "startGame",
  "judge",
]);

export interface CouncilMember {
  name: string;
  /** The angle this member argues from. Distinct lenses beat N identical proposers. */
  lens: string;
  /** "anthropic" or "deepseek". Falls back to the council's provider, then "anthropic". */
  provider?: ProviderName;
  /** Omit to take the provider's default (claude-opus-5 / deepseek-v4-flash). */
  model?: string;
  /** low | medium | high | xhigh | max. DeepSeek collapses these onto low|high|max and says so. */
  effort?: string;
  temperature?: number;
}

export interface CouncilConfig {
  name: string;
  /** Default provider for every member that does not name its own. */
  provider?: ProviderName;
  /** Free text injected into every prompt. This is the artifact that "learns" — not the weights. */
  playbook: string;
  proposers: CouncilMember[];
  adjudicator: CouncilMember;
  /** Hard cap on model calls per game. On exhaustion the seat degrades to the scripted heuristic. */
  callBudgetPerGame?: number;
}

export const TEMPO_LENS =
  "You argue for TEMPO. The event is Bo1 with a 30-minute round clock, and a round that expires " +
  "with no winner is a LOSS FOR BOTH players (官方公认赛赛事守则 V1.6.0 §II) — not a draw. Failing " +
  "to close is a loss on your record. Prefer pressure, board development on curve, and attacks that " +
  "advance a clock on the opponent's Life. Treat a turn spent without threatening Life as a cost.";

export const ATTRITION_LENS =
  "You argue for RESOURCES. Count what each choice spends: cards in hand, DON, board bodies, and " +
  "Counter power you will need on the opponent's turn. Prefer trades that leave you with more " +
  "usable material than the opponent. An attack that bounces off, or that spends a counter you " +
  "needed later, is worse than not attacking. Watch for over-committing into removal.";

export const RULES_LENS =
  "You argue from CARD TEXT. Read the printed text of every card involved in the candidate moves and " +
  "check the move actually does what it appears to do. Thresholds are exact: 'power N' means exactly " +
  "N. A qualifier opening an ability may bind to every clause after it, not just the first. If a " +
  "move relies on an effect triggering, say explicitly which printed clause makes it trigger — and " +
  "if no clause does, choose a different move.";

export function councilAgent(config: CouncilConfig): Agent {
  // Resolved per member, so one council can mix vendors — which is the point of the provider seam:
  // a tournament that fields an Anthropic council against a DeepSeek one is measuring something.
  const providerFor = (member: CouncilMember): LlmProvider =>
    getProvider(member.provider ?? config.provider ?? "anthropic");
  const used = new Set<LlmProvider>();
  const resolve = (member: CouncilMember) => {
    const provider = providerFor(member);
    used.add(provider);
    return provider;
  };
  const fallback = scriptedAgent("improved", `${config.name}:fallback`);
  const budget = config.callBudgetPerGame ?? Number.POSITIVE_INFINITY;

  const stats = {
    deliberations: 0,
    unanimous: 0,
    adjudicated: 0,
    procedural: 0,
    degraded: 0,
    callsThisGame: 0,
    failures: [] as string[],
  };

  const degrade = async (context: AgentContext, why: string): Promise<AgentAnswer> => {
    stats.degraded++;
    if (stats.failures.length < 20) stats.failures.push(why);
    const answer = await fallback.decide(context);
    const normalized = typeof answer === "number" ? { index: answer } : answer;
    // `author: "heuristic"` is the load-bearing part: the log must not attribute a degraded decision
    // to the model. The `[degraded:]` prefix on the reason is for a human reading a transcript; this
    // is for anything counting.
    return {
      ...normalized,
      author: "heuristic",
      reason: `[degraded: ${why}] ${normalized.reason ?? ""}`.trim(),
    };
  };

  return {
    name: config.name,
    author: "model",

    async decide(context: AgentContext): Promise<AgentAnswer> {
      const { decision } = context;
      const kind = decision.choices[0]?.kind ?? "unknown";

      // Gate 2: procedural decisions are not worth a model call.
      if (PROCEDURAL_KINDS.has(kind)) {
        stats.procedural++;
        const answer = await fallback.decide(context);
        const normalized = typeof answer === "number" ? { index: answer } : answer;
        // Gated to the heuristic by design, so it is attributed to the heuristic. A corpus that
        // counted the 猜拳 throw as a model decision would overstate the council's contribution.
        return { ...normalized, author: "heuristic" };
      }

      if (stats.callsThisGame + config.proposers.length > budget) {
        return degrade(context, "call budget exhausted");
      }

      // Proposers are independent, so they run concurrently — latency is one call, not N.
      stats.deliberations++;
      const proposals = await Promise.all(
        config.proposers.map(async (member) => {
          stats.callsThisGame++;
          const prompt = renderPrompt({
            view: context.view,
            seat: decision.seat,
            decision,
            features: context.features,
            playbook: config.playbook,
            lens: member.lens,
            rejection: context.rejection,
          });
          const provider = resolve(member);
          const result = await provider.choose(prompt, {
            model: member.model ?? provider.defaultModel,
            effort: member.effort,
            temperature: member.temperature,
            choiceCount: decision.choices.length,
            label: `${config.name}/${member.name}@${provider.name}`,
          });
          return { member, result };
        }),
      );

      const good = proposals.filter((p) => p.result.ok);
      if (good.length === 0) {
        const why = proposals
          .map((p) => (p.result.ok ? "" : `${p.member.name}:${p.result.failure.kind}`))
          .filter(Boolean)
          .join(", ");
        return degrade(context, `all proposers failed (${why})`);
      }

      const votes = good.map((p) => ({
        member: p.member.name,
        index: (p.result as { ok: true; answer: { index: number; reason: string } }).answer.index,
        reason: (p.result as { ok: true; answer: { index: number; reason: string } }).answer.reason,
      }));

      const distinct = [...new Set(votes.map((v) => v.index))];

      // Gate 3: nothing to adjudicate when every lens agrees.
      if (distinct.length === 1) {
        stats.unanimous++;
        return {
          index: distinct[0]!,
          reason: `unanimous: ${votes.map((v) => `${v.member} — ${v.reason}`).join(" | ")}`,
          disagreement: null,
        };
      }

      // Contested. Spend the adjudicator call, and mark the position as contested so the decision
      // bank can find it later without a critic pass.
      if (stats.callsThisGame + 1 > budget) {
        return degrade(context, "call budget exhausted before adjudication");
      }
      stats.callsThisGame++;
      stats.adjudicated++;

      const debate = votes
        .map((v) => `- ${v.member} chose [${v.index}] ${decision.choices[v.index]?.label}: ${v.reason}`)
        .join("\n");

      const prompt = renderPrompt({
        view: context.view,
        seat: decision.seat,
        decision,
        features: context.features,
        playbook: config.playbook,
        lens:
          "You are the ADJUDICATOR. Your advisors disagree. Weigh their arguments against the board " +
          "and pick the move that best wins THIS game — not the one that splits the difference. " +
          "You may pick a move none of them proposed if both are wrong.\n\n" +
          `Their proposals:\n${debate}`,
        rejection: context.rejection,
      });

      const adjudicatorProvider = resolve(config.adjudicator);
      const verdict = await adjudicatorProvider.choose(prompt, {
        model: config.adjudicator.model ?? adjudicatorProvider.defaultModel,
        effort: config.adjudicator.effort,
        temperature: config.adjudicator.temperature,
        choiceCount: decision.choices.length,
        label: `${config.name}/adjudicator@${adjudicatorProvider.name}`,
      });

      if (!verdict.ok) {
        // The adjudicator failed but the proposers did not. Take the first proposal rather than
        // throwing away work — and record that the verdict is a plurality, not a ruling.
        return {
          index: votes[0]!.index,
          reason: `[adjudicator ${verdict.failure.kind}] fell back to ${votes[0]!.member}: ${votes[0]!.reason}`,
          disagreement: votes.map((v) => `${v.member}:[${v.index}]`),
        };
      }

      return {
        index: verdict.answer.index,
        reason: `adjudicated: ${verdict.answer.reason}`,
        disagreement: votes.map((v) => `${v.member}:[${v.index}] ${v.reason}`),
      };
    },

    async finish() {
      console.log(
        `\n  ${config.name}: ${stats.deliberations} deliberations ` +
          `(${stats.unanimous} unanimous, ${stats.adjudicated} adjudicated), ` +
          `${stats.procedural} procedural, ${stats.degraded} degraded to heuristic`,
      );
      // Reported per provider, because a mixed council's combined totals would hide which vendor is
      // failing — and "which vendor is failing" is exactly what a mixed council exists to reveal.
      for (const provider of used) {
        const u = provider.totals;
        console.log(
          `  ${config.name} via ${provider.name}: in ${u.inputTokens} tokens ` +
            `(cache read ${u.cacheReadTokens}, write ${u.cacheWriteTokens}) out ${u.outputTokens} ` +
            `over ${u.calls} calls, ${u.failures} failed`,
        );
        // Gate on SUCCESSFUL calls: a run where every call 401'd has zero cache reads for an
        // unrelated reason, and a warning that cries wolf is one people learn to ignore.
        if (u.calls - u.failures > 5 && u.cacheReadTokens === 0) {
          const why =
            provider.name === "anthropic"
              ? "the stable prefix is probably under the minimum cacheable length (512 tokens on claude-opus-5)"
              : "DeepSeek caches automatically on a prefix match, so the stable prefix is probably changing between calls";
          console.log(
            `  *** ${config.name}/${provider.name}: ${u.calls} calls, ZERO cache reads — ${why}. ***`,
          );
        }
      }
      if (stats.degraded > 0) {
        console.log(
          `  *** ${config.name} degraded to the scripted heuristic on ${stats.degraded} decision(s). ` +
            `Those decisions were NOT made by the council: ${[...new Set(stats.failures)].join("; ")} ***`,
        );
      }
      stats.callsThisGame = 0;
    },
  };
}
