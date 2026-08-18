// Turns engine state into a flat list of concrete, legal, ready-to-apply choices.
//
// This is the arena's core, and it FIXES THREE DEFECTS in the shipped bot policy. All three are the
// same class as the `orderCards` bug in CLAUDE.md — an *absent* branch, not a weak heuristic — and
// all three are invisible to a win-rate table.
//
//   1. ATTACK TARGET IS NEVER CHOSEN. `getLegalCommands` emits ONE `declareAttack` descriptor per
//      attacker carrying `targetIds: legalAttackTargets(...)`, the whole legal target list.
//      `commandFromDescriptor` then takes `targetIds[0]`, and `legalAttackTargets` builds its array
//      as `[defender.leaderInstanceId, ...restedCharacters]` (src/battle.ts:737). So
//      **`targetIds[0]` is always the Leader**, and every shipped strategy always face-hits and
//      never kills a rested Character. `valueRankedStrategy` compounds it: it scores the attack by
//      reading `targetIds[0]` too and adds +300 "because the target is a Leader" — a bonus that is
//      therefore unconditional. Here, one Choice per (attacker × legal target).
//
//   2. TARGETS ARE TAKEN, NOT SELECTED. `resolveBotPromptCommand` answers `selectCards` and
//      `selectTargets` with `prompt.options.slice(0, count)` — the first N in engine order, with no
//      evaluation. Those are 165 of 252 prompts in a 20-game sample. Here, the legal selections are
//      enumerated as combinations so the choice actually exists.
//
//   3. OPTIONAL EFFECTS ALWAYS FIRE. The same resolver answers every `confirm` with yes. Here, both
//      branches are offered.
//
// A fourth is left deliberately unfixed and documented instead: `playCard` uses the first open
// character slot rather than enumerating slots. OPTCG has no adjacency mechanics, so slot identity
// is cosmetic for every card encoded today.

import { getCard } from "../../cards/src/runtime-catalog.ts";
import { getCardCost, getCardPower } from "../src/shared.ts";
import type {
  EngineCommand,
  LegalCommandDescriptor,
  MatchSeat,
  MatchState,
  PromptOption,
  PromptState,
} from "../src/types.ts";
import type { Choice, Decision } from "./types.ts";

/**
 * Cap on enumerated combinations for one decision. A `selectCards` over 10 options picking 3 is 120
 * subsets; unbounded enumeration would blow both the browser board and the prompt. When the cap
 * binds, `Decision.truncated` is set and the driver reports it — this project has twice turned a
 * silent tool limit into a confident wrong answer.
 */
const MAX_COMBINATIONS = 48;

function nameOf(state: MatchState, instanceId: string | null | undefined): string {
  if (!instanceId) return "?";
  const instance = state.cards[instanceId];
  if (!instance) return "?";
  return getCard(instance.cardId).i18n.en.name;
}

function cardIdOf(state: MatchState, instanceId: string | null | undefined): string | null {
  if (!instanceId) return null;
  return state.cards[instanceId]?.cardId ?? null;
}

/** All k-subsets of `items` for k in [min, max], in ascending size, stopping at `cap`. */
function combinations<T>(items: T[], min: number, max: number, cap: number): { sets: T[][]; truncated: boolean } {
  const sets: T[][] = [];
  const lo = Math.max(0, min);
  const hi = Math.min(max, items.length);
  let truncated = false;

  for (let k = lo; k <= hi; k++) {
    if (k === 0) {
      sets.push([]);
      continue;
    }
    const indices = Array.from({ length: k }, (_, i) => i);
    for (;;) {
      if (sets.length >= cap) return { sets, truncated: true };
      sets.push(indices.map((i) => items[i]!));
      let pivot = k - 1;
      while (pivot >= 0 && indices[pivot] === items.length - k + pivot) pivot--;
      if (pivot < 0) break;
      indices[pivot]!++;
      for (let j = pivot + 1; j < k; j++) indices[j] = indices[j - 1]! + 1;
    }
  }
  return { sets, truncated };
}

function selectableOptions(prompt: PromptState): PromptOption[] {
  return prompt.options.filter((option) => option.enabled !== false);
}

/**
 * Expand the engine's descriptors into concrete commands.
 *
 * Where a descriptor hides a choice inside itself, it is expanded rather than collapsed — that is
 * defect #1 above. Where a descriptor carries its own specific choice (`chooseJoKenPo` emits three
 * descriptors, one per throw, with the throw in `options[0].value`), that value is used; note
 * `commandFromDescriptor` discards it and recomputes the throw from the round number, which is why
 * this does not delegate to it.
 */
export function commandChoices(
  state: MatchState,
  seat: MatchSeat,
  descriptors: LegalCommandDescriptor[],
): Choice[] {
  const out: Omit<Choice, "index">[] = [];
  const push = (c: Omit<Choice, "index">) => out.push(c);

  for (const d of descriptors) {
    const base = {
      kind: d.type,
      cardId: cardIdOf(state, d.sourceId),
      instanceId: d.sourceId ?? null,
      targetCardId: null as string | null,
      targetInstanceId: null as string | null,
      note: null as string | null,
      numbers: null as Record<string, number | boolean> | null,
    };

    switch (d.type) {
      case "chooseJoKenPo": {
        // The specific throw lives in the descriptor's single option (src/engine/legal.ts:49).
        const choice = d.options?.[0]?.value;
        if (choice !== "rock" && choice !== "paper" && choice !== "scissors") continue;
        push({ ...base, label: d.label, command: { type: "chooseJoKenPo", seat, choice } });
        break;
      }

      case "chooseFirstPlayer": {
        const firstPlayer = d.targetIds?.[0];
        if (firstPlayer !== "north" && firstPlayer !== "south") continue;
        push({ ...base, label: d.label, command: { type: "chooseFirstPlayer", seat, firstPlayer } });
        break;
      }

      case "mulligan":
      case "keepHand":
      case "startGame":
      case "endTurn":
        push({ ...base, label: d.label, command: { type: d.type, seat } });
        break;

      case "playCard": {
        if (!d.sourceId) continue;
        // Slots are cosmetic in OPTCG (no adjacency mechanics); take the first open one.
        if (d.slotChoices !== undefined && d.slotChoices.length === 0) continue;
        const cost = getCardCost(state, d.sourceId);
        push({
          ...base,
          label: d.label,
          note: `cost ${cost}`,
          numbers: { cost },
          command: {
            type: "playCard",
            seat,
            instanceId: d.sourceId,
            slotIndex: d.slotChoices?.[0],
          },
        });
        break;
      }

      case "attachDon": {
        if (!d.sourceId) continue;
        push({
          ...base,
          label: d.label,
          note: `${nameOf(state, d.sourceId)} -> ${getCardPower(state, d.sourceId) + 1000} power`,
          numbers: {
            powerBefore: getCardPower(state, d.sourceId),
            powerAfter: getCardPower(state, d.sourceId) + 1000,
            isLeader: state.cards[d.sourceId]?.zone === "leader",
          },
          command: { type: "attachDon", seat, targetId: d.sourceId, amount: 1 },
        });
        break;
      }

      case "declareAttack": {
        // DEFECT #1, fixed: one choice per legal target, not just targetIds[0] (always the Leader).
        if (!d.sourceId || !d.targetIds?.length) continue;
        const attackPower = getCardPower(state, d.sourceId);
        for (const targetId of d.targetIds) {
          const targetPower = getCardPower(state, targetId);
          const targetIsLeader = state.cards[targetId]?.zone === "leader";
          const margin = attackPower - targetPower;
          push({
            ...base,
            label: `Attack ${nameOf(state, targetId)} with ${nameOf(state, d.sourceId)}`,
            targetCardId: cardIdOf(state, targetId),
            targetInstanceId: targetId,
            note:
              `${attackPower} vs ${targetPower}` +
              (margin >= 0
                ? targetIsLeader
                  ? ` — connects for 1 Life unless countered by ${margin + 1}+`
                  : ` — KOs unless countered by ${margin + 1}+`
                : ` — bounces off (short by ${-margin})`),
            numbers: { attackPower, targetPower, margin, targetIsLeader, connects: margin >= 0 },
            command: { type: "declareAttack", seat, attackerId: d.sourceId, targetId },
          });
        }
        break;
      }

      case "activateEffect": {
        if (!d.sourceId) continue;
        push({
          ...base,
          label: d.label,
          command: {
            type: "activateEffect",
            seat,
            sourceInstanceId: d.sourceId,
            trigger: "activateMain",
          },
        });
        break;
      }

      case "resolveJoKenPoTimeout":
        // A timeout artefact of the engine's setup model, not a play decision. Never offered.
        continue;

      case "resolvePrompt":
        // Handled by promptChoices() from the PromptState, which carries min/max selections.
        continue;

      default:
        continue;
    }
  }

  return out.map((c, index) => ({ ...c, index }));
}

/** Expand a pending prompt into every legal resolution. */
export function promptChoices(
  state: MatchState,
  prompt: PromptState,
): { choices: Choice[]; truncated: boolean } {
  const seat = prompt.seat as MatchSeat;
  const out: Omit<Choice, "index">[] = [];
  let truncated = false;

  if (prompt.kind === "judge") {
    return {
      choices: [
        {
          index: 0,
          kind: "judge",
          label: "Acknowledge judge prompt",
          cardId: null,
          instanceId: null,
          targetCardId: null,
          targetInstanceId: null,
          note: null,
          numbers: null,
          command: {
            type: "judgeResolvePrompt",
            seat: "judge",
            promptId: prompt.id,
            note: "Arena auto-resolved judge prompt.",
          },
        },
      ],
      truncated: false,
    };
  }

  const options = selectableOptions(prompt);
  const annotate = (option: PromptOption): { cardId: string | null; instanceId: string | null } => {
    const instanceId = option.targetId ?? (state.cards[option.id] ? option.id : null);
    return { cardId: cardIdOf(state, instanceId), instanceId: instanceId ?? null };
  };

  switch (prompt.choiceKind) {
    // DEFECT #3, fixed: both branches offered, rather than always answering yes.
    case "confirm":
    case "chooseOption": {
      for (const option of options) {
        out.push({
          ...annotate(option),
          kind: prompt.choiceKind,
          label: option.label,
          targetCardId: null,
          targetInstanceId: null,
          note: null,
          numbers: null,
          command: { type: "resolvePrompt", seat, promptId: prompt.id, optionId: option.id },
        });
      }
      break;
    }

    // DEFECT #2, fixed: the legal selections are enumerated instead of taking the first N.
    case "selectCards":
    case "selectTargets":
    case "costPayment": {
      const min =
        prompt.choiceKind === "costPayment"
          ? Math.max(prompt.minSelections, 1)
          : prompt.minSelections;
      const { sets, truncated: capped } = combinations(
        options,
        min,
        prompt.maxSelections,
        MAX_COMBINATIONS,
      );
      truncated = capped;
      for (const set of sets) {
        const first = set[0];
        out.push({
          ...(first ? annotate(first) : { cardId: null, instanceId: null }),
          kind: prompt.choiceKind,
          label: set.length === 0 ? "Select nothing" : set.map((o) => o.label).join(" + "),
          targetCardId: null,
          targetInstanceId: null,
          note: set.length > 1 ? `${set.length} selected` : null,
          numbers: { selected: set.length },
          command: {
            type: "resolvePrompt",
            seat,
            promptId: prompt.id,
            selectedIds: set.map((o) => o.id),
          },
        });
      }
      break;
    }

    case "orderCards": {
      // n! explodes. Enumerate exhaustively while it is cheap, otherwise offer a handful of
      // meaningful orderings and say so. The engine patch in tools/patch_engine.py makes identity
      // order LEGAL; choosing an order is still a real decision and this is where it lives.
      const permutations: PromptOption[][] = [];
      if (options.length <= 4) {
        const permute = (rest: PromptOption[], acc: PromptOption[]) => {
          if (rest.length === 0) {
            permutations.push(acc);
            return;
          }
          rest.forEach((o, i) => permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, o]));
        };
        permute(options, []);
      } else {
        truncated = true;
        const byCost = [...options].sort((a, b) => {
          const ai = annotate(a).instanceId;
          const bi = annotate(b).instanceId;
          return (
            (bi ? getCardCost(state, bi) : 0) - (ai ? getCardCost(state, ai) : 0)
          );
        });
        permutations.push(options, [...options].reverse(), byCost, [...byCost].reverse());
      }
      const seen = new Set<string>();
      for (const order of permutations) {
        const key = order.map((o) => o.id).join(">");
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          kind: "orderCards",
          label: order.map((o) => o.label).join(" > "),
          cardId: null,
          instanceId: null,
          targetCardId: null,
          targetInstanceId: null,
          note: "first listed resolves first",
          numbers: { positions: order.length },
          command: {
            type: "resolvePrompt",
            seat,
            promptId: prompt.id,
            selectedIds: order.map((o) => o.id),
          },
        });
      }
      break;
    }

    default: {
      // An unknown choiceKind must not be silently guessed at. Offer the engine's own options and
      // let the truncated flag carry the doubt.
      truncated = true;
      for (const option of options) {
        out.push({
          ...annotate(option),
          kind: String(prompt.choiceKind ?? "unknown"),
          label: option.label,
          targetCardId: null,
          targetInstanceId: null,
          note: null,
          numbers: null,
          command: { type: "resolvePrompt", seat, promptId: prompt.id, optionId: option.id },
        });
      }
    }
  }

  return { choices: out.map((c, index) => ({ ...c, index })), truncated };
}

/** Assemble the decision an agent is asked to answer. */
export function buildDecision(
  state: MatchState,
  seat: MatchSeat,
  prompt: PromptState | null,
  descriptors: LegalCommandDescriptor[],
): Decision {
  const { choices, truncated } = prompt
    ? promptChoices(state, prompt)
    : { choices: commandChoices(state, seat, descriptors), truncated: false };

  return {
    seat,
    source: prompt ? (prompt.kind === "judge" ? "judge" : "prompt") : "command",
    turnNumber: state.turnNumber,
    phase: state.phase,
    prompt: prompt
      ? {
          id: prompt.id,
          label: prompt.label,
          details: prompt.details,
          choiceKind: String(prompt.choiceKind ?? prompt.kind),
          minSelections: prompt.minSelections,
          maxSelections: prompt.maxSelections,
        }
      : null,
    choices,
    truncated,
    forced: choices.length === 1,
  };
}

export type { EngineCommand };
