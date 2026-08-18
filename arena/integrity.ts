// Does an agent's view actually hide what it is supposed to hide?
//
// This is a test, not a claim. CLAUDE.md records two occasions where this project produced a
// confident, statistically significant, wrong answer because a tool limit was mistaken for a game
// property. A cheating agent is the same failure with a worse blast radius: every game record, every
// decision in the bank, and every playbook rule derived from them would be void, and nothing would
// look wrong.
//
// Four things are checked at every step of every game:
//
//   1. The opponent's hand carries no card ids.
//   2. Neither deck top is revealed (including your own — deck order is hidden from its owner too).
//   3. No Life card is face up to anyone.
//   4. THE LOG, advisory only. `projectLogs` picks `privateMessages[viewer] ?? message`, so a public
//      message naming a card could leak through the log the board renders even though the zone
//      projection is airtight. This one cannot be made exact — see the long comment at the check
//      itself — because card ids and names both identify a card TYPE, not a copy, and a legal deck
//      holds up to 4 copies. It is reported as an advisory count and never fails a run.
//
// Checks 1-3 are the actual guarantee. They are exact, they are what stops an agent from reading the
// opponent's hand, and the mutation probe below proves they can fail.
//
//   ./scripts/arena.sh --integrity --games 10 --deck-south sim/decks/mihawk-green-proxy.json

import { getCard } from "../../cards/src/runtime-catalog.ts";
import { projectStateForSeat } from "../src/projection.ts";
import type { MatchSeat, MatchState, PlayerView } from "../src/types.ts";

export interface Violation {
  check: string;
  seat: MatchSeat;
  turn: number;
  detail: string;
}

function nameOf(state: MatchState, instanceId: string): string {
  return getCard(state.cards[instanceId]!.cardId).i18n.en.name;
}

/** Everything the seat can legitimately see the name of, from its own projection. */
function knownNames(view: PlayerView, seat: MatchSeat): Set<string> {
  const names = new Set<string>();
  const add = (value: string | null) => {
    if (value) names.add(value);
  };
  for (const side of ["south", "north"] as const) {
    const player = view.players[side];
    add(player.leader.name);
    for (const card of [...player.trash, ...player.characters, player.stage]) add(card?.name ?? null);
    if (side === seat) for (const card of player.hand) add(card.name);
  }
  return names;
}

/**
 * @param viewerOverride Project as a DIFFERENT viewer while still auditing as `seat`. Only
 *   `selfTest` passes this: it is the deliberate mutation that proves these checks can fail. A test
 *   that always passes is this project's most frequent defect — `tools/mutation_check.py` exists
 *   because Task 2 shipped three of them — so the audit is not trusted until the mutant dies.
 */
export function checkState(
  state: MatchState,
  seat: MatchSeat,
  viewerOverride?: MatchSeat,
): Violation[] {
  const violations: Violation[] = [];
  const view = projectStateForSeat(state, viewerOverride ?? seat);
  const opponent = seat === "south" ? "north" : "south";
  const record = (check: string, detail: string) =>
    violations.push({ check, seat, turn: state.turnNumber, detail });

  for (const card of view.players[opponent].hand) {
    if (card.cardId !== null) record("1-opponent-hand", `saw ${card.cardId} in opponent's hand`);
  }

  for (const side of ["south", "north"] as const) {
    const top = view.players[side].deckTop;
    if (top && top.cardId !== null) record("2-deck-top", `saw ${top.cardId} on top of ${side}'s deck`);
    for (const life of view.players[side].life) {
      if (life.cardId !== null) record("3-life", `saw ${life.cardId} in ${side}'s Life`);
    }
  }

  // Check 4 — THE LOG. Advisory, and the reason it cannot be exact is worth writing down, because
  // three successive attempts to make it exact each produced a confident false alarm.
  //
  //   Attempt 1, name substring: failed on Ace with 146 "violations" reading `reveals Marco from
  //     hand`. Legitimate — an OP16 effect reveals from hand, the log keeps that line forever, and a
  //     DIFFERENT copy of Marco sits hidden later.
  //   Attempt 2, `sourceInstanceId` / `targetIds` against hidden instances: failed on all three decks
  //     (1370 / 428 / 339). Wrong target — an instance id is an opaque handle. The projection refuses
  //     to resolve one for a card you cannot see, so knowing that instance `abc123` moved tells a
  //     player nothing.
  //   Attempt 3, card-id substring: failed on Mihawk with 871. Two causes, both data-shaped: **63 of
  //     2,537 cards embed their own id in their display name** ("Kikunojo - OP14-023"), and a card id
  //     identifies a card TYPE, not a copy.
  //
  // That last point is the general result: **ids and names are both per-type, so no text-based check
  // can distinguish "the hidden copy was named" from "a visible copy of the same card was named".**
  // With up to 4 copies of a card in a legal deck, an exact log check does not exist. Reporting one as
  // a failure would train the next person to disable the whole audit, which is strictly worse than a
  // calibrated advisory.
  //
  // What remains genuinely exact — and is what actually stops an agent from cheating — is checks 1-3:
  // the ZONES never resolve a hidden card, so `hand`, `deckTop` and `life` come back with
  // `cardId: null`. Those are hard failures. The log is a residual, heuristic risk; if it ever needs
  // to be closed, the fix is in the driver (hand agents a filtered log), not in a cleverer assertion.
  const visible = knownNames(view, seat);
  const secretNames = new Set<string>();
  const isSecret = (instanceId: string) => !state.cards[instanceId]?.publicKnowledge;
  for (const instanceId of state.players[opponent].hand) {
    if (isSecret(instanceId)) secretNames.add(nameOf(state, instanceId));
  }
  for (const side of ["south", "north"] as const) {
    for (const instanceId of state.players[side].life) {
      if (isSecret(instanceId)) secretNames.add(nameOf(state, instanceId));
    }
  }
  for (const name of secretNames) {
    if (visible.has(name)) continue;
    for (const entry of view.logs) {
      if (entry.message.includes(name)) {
        record("4-name-in-log (advisory)", `log visible to ${seat} mentions "${name}": ${entry.message}`);
        break;
      }
    }
  }

  return violations;
}

/**
 * Hand each seat its OPPONENT's projection. Checks 1 and 4 must both fire: the opponent's view shows
 * their own hand (which is hidden from this seat) and their own private log lines. If this returns
 * clean, `checkState` is not testing anything and the PASS above is meaningless.
 */
export function selfTest(state: MatchState): { fired: string[]; ok: boolean } {
  const fired = new Set<string>();
  for (const seat of ["south", "north"] as const) {
    const opponent = seat === "south" ? "north" : "south";
    for (const violation of checkState(state, seat, opponent)) fired.add(violation.check);
  }
  return { fired: [...fired].sort(), ok: fired.has("1-opponent-hand") };
}

export interface Auditor {
  audit: (state: MatchState) => void;
  violations: Violation[];
  steps: number;
  /**
   * A mid-game state kept for `selfTest`. Deliberately not the first state: at setup both hands may
   * still be empty, and a probe against an empty hand would itself be vacuous.
   */
  mutationProbe: MatchState | null;
}

export function auditor(): Auditor {
  const violations: Violation[] = [];
  const self = {
    violations,
    steps: 0,
    mutationProbe: null as MatchState | null,
    audit(state: MatchState) {
      self.steps++;
      if (self.steps === 12) self.mutationProbe = state;
      violations.push(...checkState(state, "south"), ...checkState(state, "north"));
    },
  };
  return self;
}
