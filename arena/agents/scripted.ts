// Zero-cost agents: the tournament anchor, and the smoke-test opponent.
//
// WHY AN ANCHOR IS MANDATORY IN THE FIELD
//
// A playbook tuned only against other LLMs learns to beat LLMs. Every arena tournament seeds a
// scripted entrant so the standings have a fixed reference point across rounds and across weeks.
//
// TWO MODES, AND THE DIFFERENCE MATTERS
//
// `faithful` reproduces the shipped `valueRankedStrategy` exactly, INCLUDING its three defects, so
// arena results stay comparable with the batch numbers in docs/simulation.md — which were all
// produced by that policy. `improved` uses the choice set `enumerate.ts` actually offers: it picks
// attack targets, declines bad optional effects, and selects removal targets on merit. Comparing the
// two is the cheapest available measurement of what those defects cost.

import { getCard } from "../../../cards/src/runtime-catalog.ts";
import type { Agent, AgentContext, Choice } from "../types.ts";

export type ScriptedMode = "faithful" | "improved";

function num(choice: Choice, key: string, fallback = 0): number {
  const value = choice.numbers?.[key];
  return typeof value === "number" ? value : fallback;
}

function flag(choice: Choice, key: string): boolean {
  return choice.numbers?.[key] === true;
}

function cardCost(choice: Choice): number {
  if (!choice.cardId) return 0;
  const def = getCard(choice.cardId);
  return "cost" in def ? (def.cost ?? 0) : 0;
}

function cardPower(choice: Choice): number {
  if (!choice.cardId) return 0;
  const def = getCard(choice.cardId);
  return "power" in def ? (def.power ?? 0) : 0;
}

/**
 * Ported from `valueRankedStrategy`, scoring our Choice list rather than the engine's descriptors.
 * The numbers are the originals so `faithful` behaves like the batch policy.
 */
function score(choice: Choice, context: AgentContext, mode: ScriptedMode): number {
  const { features } = context;
  const activeDon = Number(features.myActiveDon ?? 0);

  switch (choice.kind) {
    case "playCard": {
      const cost = cardCost(choice);
      const efficiency = cost > 0 ? activeDon / cost : 1;
      return 1000 + cost * 50 + efficiency * 100 + cardPower(choice) / 50;
    }

    case "declareAttack": {
      let value = 600;
      const margin = num(choice, "margin");
      const targetIsLeader = flag(choice, "targetIsLeader");

      if (mode === "faithful") {
        // The shipped policy only ever saw targetIds[0], which legalAttackTargets always fills with
        // the defending Leader, so its +300 was unconditional. Reproduce that: rank Leader attacks
        // top and never pick a Character.
        if (!targetIsLeader) return -1;
        value += 300;
        if (cardPower(choice) >= 5000) value += 100;
        return value;
      }

      // improved: an attack that bounces off is worse than not attacking.
      if (margin < 0) return -1;
      if (targetIsLeader) {
        // Chip damage is worth most when it is close to lethal.
        const oppLife = Number(features.opponentLife ?? 4);
        value += 200 + Math.max(0, 5 - oppLife) * 60;
      } else {
        // Removing a body is worth roughly what the body cost, and more when the trade is free.
        value += 180 + num(choice, "targetPower") / 100;
      }
      return value;
    }

    case "attachDon": {
      let value = 400;
      if (!flag(choice, "isLeader")) value += 250;
      else value -= 100;
      return value;
    }

    case "activateEffect":
      return 250;

    case "confirm": {
      if (mode === "faithful") {
        // The shipped resolver answers every confirm with yes.
        return /yes|activate/i.test(choice.label) ? 100 : -1;
      }
      // improved: firing a mandatory-looking effect is usually right, but not when it is a cost we
      // cannot evaluate; prefer yes and let the enumerated alternative exist.
      return /yes|activate/i.test(choice.label) ? 100 : 40;
    }

    case "selectCards":
    case "selectTargets":
    case "costPayment": {
      if (mode === "faithful") {
        // First N in engine order — that IS the shipped behaviour.
        return 100 - choice.index;
      }
      // improved: for removal-shaped prompts prefer the biggest body; for costs prefer the cheapest
      // card. Both read from the catalog, which is public information.
      const power = cardPower(choice);
      const cost = cardCost(choice);
      return choice.kind === "costPayment" ? 100 - cost : 50 + power / 100;
    }

    case "orderCards":
      return 100 - choice.index;

    case "chooseOption":
      return 100 - choice.index;

    case "chooseJoKenPo":
      // Handled outside score(): a tie re-rolls, so two agents that both rank the same throw first
      // will tie forever. `commandFromDescriptor` sidesteps this with a seat offset; scoring cannot,
      // because both seats run identical scoring. See jokenpoIndex().
      return 120 - choice.index;

    case "chooseFirstPlayer":
      // Going first is a large edge in OPTCG even at the cost of the first draw.
      return /take the first turn/i.test(choice.label) ? 200 : 100;

    case "mulligan":
      return 30;
    case "keepHand":
      return 35;
    case "startGame":
      return 80;
    case "endTurn":
      return 5;
    case "judge":
      return 1;
    default:
      return 1;
  }
}

export function scriptedAgent(mode: ScriptedMode = "improved", label?: string): Agent {
  // Per-agent 猜拳 counter. A tie re-rolls the round, so a deterministic policy that always picks
  // the same throw deadlocks against itself — 800 commands on turn 1, which is exactly what the
  // first arena smoke run produced. Rotating by (call count + seat) guarantees the tie breaks, and
  // keeps the agent deterministic for a given seed.
  let joKenPoCalls = 0;

  return {
    name: label ?? `scripted:${mode}`,
    async decide(context: AgentContext) {
      const first = context.decision.choices[0]!;
      if (first.kind === "chooseJoKenPo") {
        const offset = context.decision.seat === "north" ? 1 : 0;
        const pick = (joKenPoCalls++ + offset) % context.decision.choices.length;
        const choice = context.decision.choices[pick]!;
        return { index: choice.index, reason: `rotating throw ${choice.label}` };
      }

      const ranked = context.decision.choices
        .map((choice) => ({ choice, value: score(choice, context, mode) }))
        .filter((entry) => entry.value >= 0)
        .sort((a, b) => b.value - a.value);
      const best = ranked[0]?.choice ?? context.decision.choices[0]!;
      return { index: best.index, reason: `${mode} score ${ranked[0]?.value.toFixed(0) ?? "n/a"}` };
    },
  };
}

/** Deterministic, dependency-free opponent for smoke tests. */
export function firstLegalAgent(): Agent {
  return {
    name: "scripted:firstLegal",
    async decide() {
      return 0;
    },
  };
}
