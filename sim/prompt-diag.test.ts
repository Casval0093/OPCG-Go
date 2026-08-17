// Root-cause diagnostic for the bot's illegal-command aborts on Block 2+ decks.
//
//   ./scripts/simulate.sh --diag-prompts --a sim/decks/mihawk-green-proxy.json
//
// `runBotMatch` is a closed loop and drops the per-command rejection reason, so this replays the
// same match manually — same strategy, same resolver, same seeds — and reports, for every command
// the engine REJECTS, the prompt's `choiceKind` and the engine's own reason text.
//
// CONFIRMED, 20 games on a Block 2+ green deck:
//
//   selectCards    seen=149  rejected=0
//   confirm        seen= 51  rejected=0
//   costPayment    seen= 23  rejected=0
//   orderCards     seen= 17  rejected=17   <-- 100%, "Prompt resolution could not be applied."
//   selectTargets  seen= 16  rejected=0
//   chooseOption   seen= 13  rejected=0
//
// `resolveBotPromptCommand` branches on four of the six `ChoiceKind`s and lets `orderCards` and
// `chooseOption` fall through to `optionId = options[0].id`. That fall-through is FINE for
// `chooseOption` — picking an option is exactly what it wants. It is meaningless for `orderCards`,
// which needs a full permutation in `selectedIds`, so every such prompt is rejected and the game
// dies. One unimplemented branch is responsible for 88% of games being abandoned.
//
// This file also A/B-proves the fix: `--diag-prompts` runs the stock resolver and a patched one
// that adds the missing branch, and reports how many games each completes.

import { test } from "vite-plus/test";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { allCards } from "@tcg/op-cards";
// Same barrel the bot harness itself imports from — the per-module paths do not re-export these.
import { applyCommand, createMatch, getLegalCommands } from "../../src/core.ts";
import { resolveBotPromptCommand } from "../../src/automation/bot-harness.ts";
import { valueRankedStrategy } from "../../src/automation/bot-strategies.ts";
import type {
  EngineCommand,
  MatchConfig,
  MatchSeat,
  MatchState,
  PromptState,
} from "../../src/types.ts";

const run = process.env.SIM_DIAG_PROMPTS === "1" ? test : test.skip;

interface Deck {
  name: string;
  leader: string;
  main: string[];
}

/**
 * The missing branch. `orderCards` asks for a full ordering of the offered cards, so the reply has
 * to be every option id in some sequence — not a single `optionId`. Ordering top-of-deck cards
 * well is a strategy question; ordering them *legally* is not, and this is the legality fix.
 */
function resolvePromptWithOrderCards(state: MatchState, prompt: PromptState) {
  if (prompt.kind !== "judge" && prompt.choiceKind === "orderCards") {
    return {
      type: "resolvePrompt" as const,
      seat: prompt.seat as MatchSeat,
      promptId: prompt.id,
      selectedIds: prompt.options.map((o) => o.id),
    };
  }
  return resolveBotPromptCommand(state, prompt);
}

run(
  "prompt diagnostic",
  () => {
    const root = process.env.SIM_ROOT ?? process.cwd();
    const deckPath = process.env.SIM_DECK_A ?? "sim/decks/mihawk-green-proxy.json";
    const deck = JSON.parse(readFileSync(resolve(root, deckPath), "utf8")) as Deck;
    const games = Number(process.env.SIM_GAMES ?? "20");

    const seat = (name: string) => ({
      leaderCardId: deck.leader,
      mainDeck: [...deck.main],
      donDeckCount: 10,
      playerName: name,
    });

    const usePatch = process.env.SIM_PATCH_ORDERCARDS === "1";
    const resolver = usePatch ? resolvePromptWithOrderCards : resolveBotPromptCommand;
    let completed = 0;

    const rejectionsByKind = new Map<string, number>();
    const reasonsByKind = new Map<string, Set<string>>();
    const promptsSeen = new Map<string, number>();
    let rejected = 0;
    let applied = 0;

    for (let g = 0; g < games; g++) {
      const config: MatchConfig = {
        firstPlayer: "north",
        seed: 1000 + g,
        shuffleDecks: true,
        openingHandSize: 5,
        skipFirstTurnDraw: true,
        maxCharacterSlots: 5,
        players: { south: seat("A"), north: seat("B") },
      };

      let state: MatchState = createMatch(config);
      for (let step = 0; step < 800; step++) {
        if (state.status === "finished") {
          completed++;
          break;
        }

        const pending = state.promptQueue.filter((p) => p.status === "pending");
        if (pending.length > 0) {
          const prompt = pending[0]!;
          const kind = String(prompt.kind === "judge" ? "judge" : (prompt.choiceKind ?? "unknown"));
          promptsSeen.set(kind, (promptsSeen.get(kind) ?? 0) + 1);

          const command = resolver(state, prompt);
          if (!command) break;
          const result = applyCommand(state, command);
          if (!result.accepted) {
            rejected++;
            rejectionsByKind.set(kind, (rejectionsByKind.get(kind) ?? 0) + 1);
            if (!reasonsByKind.has(kind)) reasonsByKind.set(kind, new Set());
            reasonsByKind
              .get(kind)!
              .add(String(result.reason ?? "(no reason given)").slice(0, 140));
            break; // matches runBotMatch: one illegal command ends the game
          }
          applied++;
          state = result.state;
          continue;
        }

        const legal =
          state.status === "setup"
            ? [...getLegalCommands(state, "south"), ...getLegalCommands(state, "north")]
            : getLegalCommands(state);
        const setupActor = legal
          .map((d) => d.seat)
          .find((s): s is MatchSeat => s === "south" || s === "north");
        const active = state.status === "setup" && setupActor ? setupActor : state.activeSeat;
        const mine = legal.filter((c) => c.seat === active);
        if (mine.length === 0) break;

        // getLegalCommands yields DESCRIPTORS, not commands. The strategy returns a real
        // EngineCommand; when it declines, the harness builds one rather than submitting a
        // descriptor, and this mirrors that. Passing a descriptor to applyCommand happens to work at
        // runtime and does not typecheck, which is exactly the kind of thing to fix rather than cast.
        const chosen: EngineCommand | null =
          valueRankedStrategy(state, active, mine, { random: () => 0.5 }) ??
          (mine.some((c) => c.type === "endTurn") ? { type: "endTurn", seat: active } : null);
        if (!chosen) break;
        const result = applyCommand(state, chosen);
        if (!result.accepted) break;
        state = result.state;
      }
    }

    console.log(
      `\nPROMPT DIAGNOSTIC — ${deck.name}, ${games} games, catalog ${allCards.length}` +
        `   resolver=${usePatch ? "PATCHED (orderCards implemented)" : "stock"}`,
    );
    console.log(
      `games completed to a rules win: ${completed}/${games} (${((100 * completed) / games).toFixed(1)}%)`,
    );
    console.log(`prompts resolved OK: ${applied}   rejected: ${rejected}\n`);
    console.log("prompts seen by choiceKind:");
    for (const [k, n] of [...promptsSeen.entries()].sort((a, b) => b[1] - a[1])) {
      const bad = rejectionsByKind.get(k) ?? 0;
      console.log(
        `  ${k.padEnd(16)} seen=${String(n).padStart(5)}  REJECTED=${String(bad).padStart(4)}`,
      );
    }
    console.log("\nrejection reasons by kind:");
    for (const [k, reasons] of reasonsByKind) {
      for (const r of reasons) console.log(`  [${k}] ${r}`);
    }
    console.log("");
  },
  900_000,
);
