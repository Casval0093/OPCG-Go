// Engine throughput benchmark. Copy into packages/engine/tests/cards/ in the
// vendored engine and run with `vp test run tests/cards/throughput.test.ts`.
//
// Two decks are measured, and the point is the RATIO between them.
//
//   synthetic  4 distinct cards cycled to 50. What the original benchmark used.
//   ST01      the real 50-card ST01 starter deck, 17 distinct cards, shipped by
//             the engine itself (src/starter-decks.ts) so it cannot rot.
//
// docs/engine-audit.md sizes the ISMCTS budget off the synthetic number and then
// asserts, without measuring, that "real 51-card decks with live effects will be
// 2-5x slower". That multiplier is the difference between Option C running today
// and Option C not running today, so it should be measured rather than assumed.
// The realism ratio printed below is that measurement.
//
// ST01 is Block 1 and rotated out of Standard. That is irrelevant here: this
// measures engine cost per command, not deck legality. It is a proxy for card
// diversity and effect density, and a starter deck is SIMPLER than a meta deck,
// so the ratio it produces is a lower bound on the real multiplier.
//
// The intended deck was the B/Y Teach list in docs/research-findings.md, but 10
// of its 14 slots plus its leader are OP16, and the engine has no OP15/OP16/OP17
// cards. Switch this over once those are encoded.

import { test } from "vite-plus/test";
import { runBotMatch } from "../../src/automation/bot-harness.ts";
import { valueRankedStrategy } from "../../src/automation/bot-strategies.ts";
import { ST01_LEADER_CARD_ID, ST01_MAIN_DECK } from "../../src/starter-decks.ts";
import {
  eb01Doma005,
  eb01Fourtricks025,
  eb01Koza004,
  eb01MsMonday035,
  op13MonkeyDLuffy001,
} from "@tcg/op-cards";
import type { MatchConfig } from "../../src/types.ts";

const SYNTHETIC_CARDS = [eb01Doma005, eb01Koza004, eb01Fourtricks025, eb01MsMonday035];
const SYNTHETIC_DECK = Array.from({ length: 50 }, (_, i) => SYNTHETIC_CARDS[i % 4]!.id);

interface Deck {
  label: string;
  leaderCardId: string;
  mainDeck: readonly string[];
}

const DECKS: Deck[] = [
  { label: "synthetic-4card", leaderCardId: op13MonkeyDLuffy001.id, mainDeck: SYNTHETIC_DECK },
  { label: "ST01-real-50", leaderCardId: ST01_LEADER_CARD_ID, mainDeck: ST01_MAIN_DECK },
];

// Match settings are identical across decks so the only variable is the deck.
function cfg(deck: Deck, seed: number): MatchConfig {
  const seat = (playerName: string) => ({
    leaderCardId: deck.leaderCardId,
    mainDeck: [...deck.mainDeck],
    donDeckCount: 10,
    playerName,
  });
  return {
    firstPlayer: seed % 2 === 0 ? "south" : "north",
    seed,
    shuffleDecks: true,
    openingHandSize: 5,
    skipFirstTurnDraw: true,
    maxCharacterSlots: 5,
    players: { south: seat("S"), north: seat("N") },
  };
}

interface Measurement {
  label: string;
  distinct: number;
  gamesPerSec: number;
  cmdsPerSec: number;
  decided: number;
  cmdsPerGame: number;
}

function measure(deck: Deck, games: number): Measurement {
  const t0 = process.hrtime.bigint();
  let cmds = 0;
  let decided = 0;
  for (let i = 0; i < games; i++) {
    const r = runBotMatch(
      cfg(deck, 1000 + i),
      { south: valueRankedStrategy, north: valueRankedStrategy },
      { maxCommands: 500 },
    );
    cmds += r.totalCommands;
    if (r.winner) decided++;
  }
  const secs = Number(process.hrtime.bigint() - t0) / 1e9;
  return {
    label: deck.label,
    distinct: new Set(deck.mainDeck).size,
    gamesPerSec: games / secs,
    cmdsPerSec: cmds / secs,
    decided,
    cmdsPerGame: cmds / games,
  };
}

test("bench", () => {
  const N = 100;
  const results = DECKS.map((d) => measure(d, N));

  console.log(`\nBENCH games=${N} strategy=valueRanked mirror`);
  console.log("deck                distinct  games/s   cmds/s  cmds/game  decided");
  for (const r of results) {
    console.log(
      `${r.label.padEnd(20)}${String(r.distinct).padStart(6)}${r.gamesPerSec.toFixed(2).padStart(10)}` +
        `${r.cmdsPerSec.toFixed(0).padStart(9)}${r.cmdsPerGame.toFixed(1).padStart(11)}${String(r.decided).padStart(9)}`,
    );
  }

  const [synthetic, real] = results;
  if (synthetic && real) {
    // >1 means the real deck is slower, which is the expected direction.
    console.log(
      `\nREALISM RATIO ${(synthetic.gamesPerSec / real.gamesPerSec).toFixed(2)}x slower per game, ` +
        `${(synthetic.cmdsPerSec / real.cmdsPerSec).toFixed(2)}x slower per command`,
    );
    console.log("audit assumed 2-5x; ST01 is a starter deck so treat this as a LOWER bound\n");
  }
}, 600000);
