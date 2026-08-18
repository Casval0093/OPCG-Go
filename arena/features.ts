// Derived arithmetic, handed to an agent so it is never asked to do sums in its head.
//
// WHY THIS IS COMPUTED FROM THE VIEW AND NOT FROM MatchState
//
// Every value here is derived from the same `PlayerView` the agent already has. That is a security
// property, not a style choice: a feature block computed from `MatchState` could leak the opponent's
// hand through an aggregate (a "total counter power available to the opponent" figure would do it
// silently). Because this file cannot see hidden cards, it cannot leak them, and it is honest about
// what it does not know — `opponentHandCount` is reported, an opponent counter *bound* is not,
// because Counter events exist and no sound bound can be derived from the view.
//
// This module is also the one that a distilled code policy will need verbatim, which is the reason
// it is code rather than prompt text.

import { getCard } from "../../cards/src/runtime-catalog.ts";
import type { MatchSeat, PlayerView, ProjectedCard } from "../src/types.ts";

function counterValue(card: ProjectedCard): number {
  if (!card.cardId) return 0;
  const def = getCard(card.cardId);
  return "counter" in def ? (def.counter ?? 0) : 0;
}

function live(cards: Array<ProjectedCard | null>): ProjectedCard[] {
  return cards.filter((c): c is ProjectedCard => c !== null);
}

export function deriveFeatures(view: PlayerView, seat: MatchSeat): Record<string, unknown> {
  const me = view.players[seat];
  const opp = view.players[seat === "south" ? "north" : "south"];

  const myChars = live(me.characters);
  const oppChars = live(opp.characters);

  /** Bodies that could attack if they are not rested and it is my main phase. */
  const readyAttackers = [
    ...(me.leader.rested ? [] : [me.leader]),
    ...myChars.filter((c) => !c.rested),
  ];

  /** What the opponent must answer. A rested Character can be attacked; an active one cannot. */
  const oppRestedChars = oppChars.filter((c) => c.rested);

  const counterInHand = me.hand.reduce((sum, c) => sum + counterValue(c), 0);

  return {
    turn: view.turnNumber,
    phase: view.phase,
    myLife: me.lifeCount,
    opponentLife: opp.lifeCount,
    myDeckRemaining: me.deckCount,
    opponentDeckRemaining: opp.deckCount,
    myActiveDon: me.activeDon,
    myRestedDon: me.restedDon,
    myDonDeckRemaining: me.donDeckCount,
    myHandCount: me.handCount,
    opponentHandCount: opp.handCount,

    myLeaderPower: me.leader.power,
    opponentLeaderPower: opp.leader.power,

    myBoard: myChars.map((c) => ({
      name: c.name,
      cardId: c.cardId,
      power: c.power,
      rested: c.rested,
      don: c.attachedDon,
    })),
    opponentBoard: oppChars.map((c) => ({
      name: c.name,
      cardId: c.cardId,
      power: c.power,
      rested: c.rested,
      don: c.attachedDon,
    })),

    readyAttackerCount: readyAttackers.length,
    opponentAttackableCharacters: oppRestedChars.map((c) => ({ name: c.name, power: c.power })),

    /**
     * Connecting attacks needed to win, ignoring counters and blockers. If
     * `readyAttackerCount >= attacksToLethal` the turn is *potentially* lethal — it is not a
     * guarantee, because the opponent still holds `opponentHandCount` unknown cards.
     */
    attacksToLethal: opp.lifeCount === 0 ? 1 : opp.lifeCount,
    potentiallyLethalThisTurn: readyAttackers.length >= Math.max(1, opp.lifeCount),

    /** Total Counter power sitting in my own hand — mine to see, so sound to compute. */
    counterPowerInMyHand: counterInHand,
    /**
     * Deliberately absent: any bound on the opponent's counter power. Counter events are not
     * bounded by 2000 and the view cannot see their hand. Reporting a fabricated ceiling would be
     * worse than reporting nothing.
     */
    opponentCounterPower: null,

    myTrash: me.trash.filter((c) => c.cardId).map((c) => c.cardId),
    opponentTrash: opp.trash.filter((c) => c.cardId).map((c) => c.cardId),
  };
}
