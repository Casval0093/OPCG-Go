// Deck loading. Same JSON shape the batch simulator already uses in sim/decks/, so a deck that
// prevailed in `./scripts/simulate.sh` is playable here with no conversion step.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { allCards } from "@tcg/op-cards";
import type { MatchConfig, MatchSeat } from "../src/types.ts";

export interface Deck {
  name: string;
  leader: string;
  /** 50 card ids, repeats included. */
  main: string[];
}

export function loadDeck(root: string, path: string): Deck {
  const deck = JSON.parse(readFileSync(resolve(root, path), "utf8")) as Deck;
  if (!deck.leader) throw new Error(`${path}: no leader`);
  if (!Array.isArray(deck.main)) throw new Error(`${path}: main is not an array`);
  if (deck.main.length !== 50) {
    console.warn(`WARNING ${deck.name}: ${deck.main.length} cards, not 50 — not tournament legal`);
  }
  return deck;
}

/**
 * Fail with the missing ids rather than letting the engine throw a bare "Unknown One Piece card"
 * from deep inside match construction. The engine ships OP01-OP14, EB01-04, PRB01-02, ST01 and DON;
 * OP15/OP16 arrive only if `scripts/bootstrap.sh` has grafted `cards/` in, and only 5 of those 238
 * cards carry encoded effects so far.
 */
export function assertPlayable(...decks: Deck[]): void {
  const wanted = new Set(decks.flatMap((d) => [d.leader, ...d.main]));
  const missing = [...wanted].filter((id) => !allCards.some((c) => c.id === id));
  if (missing.length === 0) return;
  throw new Error(
    `${missing.length} card id(s) are not in the engine catalog: ${missing.slice(0, 10).join(", ")}` +
      `${missing.length > 10 ? " …" : ""}. Run ./scripts/bootstrap.sh to graft cards/ in.`,
  );
}

export function matchConfig(
  south: Deck,
  north: Deck,
  seed: number,
  names: Record<MatchSeat, string>,
): MatchConfig {
  const seat = (deck: Deck, playerName: string) => ({
    leaderCardId: deck.leader,
    mainDeck: [...deck.main],
    donDeckCount: 10,
    playerName,
  });
  return {
    // Retained for completeness. The engine overwrites it during the 猜拳 setup roll — unlike the
    // batch harness, the arena lets agents make that roll and the following chooseFirstPlayer for
    // real, so turn order is genuinely decided in game.
    firstPlayer: "north",
    seed,
    shuffleDecks: true,
    openingHandSize: 5,
    skipFirstTurnDraw: true, // Comprehensive Rules 6-3-1
    maxCharacterSlots: 5,
    players: { south: seat(south, names.south), north: seat(north, names.north) },
  };
}
