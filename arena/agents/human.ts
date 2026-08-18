// The human seat. Identical interface to an LLM council: it receives a projected view plus a list of
// legal choices and returns an index. The driver cannot tell the two apart, which is the property
// that makes "Ping vs an LLM" and "LLM vs LLM" the same code path.

import type { ArenaServer } from "../server.ts";
import type { Agent, AgentContext } from "../types.ts";

export function humanAgent(server: ArenaServer, name = "human"): Agent {
  return {
    name,
    async decide(context: AgentContext) {
      const index = await server.awaitChoice(
        context.decision,
        context.view,
        context.rejection,
      );
      return { index, reason: null };
    },
    async finish(view, outcome) {
      server.publish({
        view,
        awaitingYou: false,
        decision: null,
        message:
          outcome.termination === "rules-win"
            ? `Game over — ${outcome.winner === null ? "no winner" : `${outcome.winner} wins`} on turn ${outcome.turns}.`
            : `Game stopped: ${outcome.termination} after ${outcome.commands} commands.`,
      });
    },
  };
}
