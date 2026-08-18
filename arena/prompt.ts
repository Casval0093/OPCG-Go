// Renders a decision into text for a model.
//
// THE RETRIEVAL LAYER IS HERE, AND IT IS NOT OPTIONAL
//
// A model reasoning from card names alone plays a hallucinated deck. Two facts from CLAUDE.md make
// this concrete rather than theoretical:
//
//   - `OP16-001` Ace's 8000-power threshold binds to BOTH clauses (official SC ruling #961): a
//     7000-power Whitebeard Pirates Character does NOT gain [Rush]. The English printed text is
//     ambiguous; the ruling is not. A model given only the English text gets this backwards.
//   - "Power N" in card text means EXACTLY N (rulings #962/#963) — not ≤N-1, not ≥N+1.
//
// So every card the seat can legitimately see is rendered with its full printed text, and the
// rulings file is injected for the cards actually in play. Card knowledge is retrieval, not learning
// — which is precisely why no fine-tuned model is needed to play a specific deck.
//
// WHAT IS DELIBERATELY NOT SENT
//
// Images. The projected view is complete — every visible card id, power, cost, DON, life count — so
// vision adds latency and a hallucination surface for zero extra information. Card art is for Ping's
// eyes, in the browser board.

import { getCard } from "../../cards/src/runtime-catalog.ts";
import type { MatchSeat, PlayerView, ProjectedCard } from "../src/types.ts";
import type { Choice, Decision } from "./types.ts";

/** Cards whose text is worth spending tokens on: everything in play plus my own hand. */
function visibleCards(view: PlayerView, seat: MatchSeat): ProjectedCard[] {
  const opponent = seat === "south" ? "north" : "south";
  const out: ProjectedCard[] = [];
  for (const side of [seat, opponent] as const) {
    const player = view.players[side];
    out.push(player.leader);
    for (const card of player.characters) if (card) out.push(card);
    if (player.stage) out.push(player.stage);
    if (side === seat) out.push(...player.hand);
  }
  return out.filter((card) => card.cardId !== null);
}

function cardText(cardId: string): string {
  const card = getCard(cardId);
  const bits = [
    card.cardType,
    "cost" in card && card.cost !== null ? `cost ${card.cost}` : null,
    "power" in card && card.power !== null ? `${card.power} power` : null,
    "counter" in card && card.counter ? `counter ${card.counter}` : null,
    "life" in card && card.life !== null ? `life ${card.life}` : null,
    card.traits && card.traits.length > 0 ? card.traits.join("/") : null,
  ].filter(Boolean);
  const effect = card.i18n.en.effect;
  const text = effect && effect !== "NULL" ? ` — ${effect.replace(/\s*\n\s*/g, " ")}` : "";
  return `${cardId} ${card.i18n.en.name} [${bits.join(", ")}]${text}`;
}

function renderCard(card: ProjectedCard): string {
  if (!card.cardId) return "face-down";
  const state = [
    card.rested ? "RESTED" : "active",
    card.power !== null ? `${card.power} power` : null,
    card.attachedDon > 0 ? `${card.attachedDon} DON attached` : null,
  ].filter(Boolean);
  return `${card.name} (${card.cardId}) [${state.join(", ")}]`;
}

function renderSide(view: PlayerView, seat: MatchSeat, label: string, own: boolean): string {
  const p = view.players[seat];
  const chars = p.characters.filter((c): c is ProjectedCard => c !== null);
  const lines = [
    `${label} — Leader ${renderCard(p.leader)}`,
    `  life ${p.lifeCount}   deck ${p.deckCount}   DON ${p.activeDon} active / ${p.restedDon} rested (${p.donDeckCount} left in DON deck)`,
    `  characters: ${chars.length ? chars.map(renderCard).join(" | ") : "none"}`,
    `  stage: ${p.stage ? renderCard(p.stage) : "none"}`,
    own
      ? `  hand (${p.handCount}): ${p.hand.map((c) => `${c.name} (${c.cardId})`).join(" | ") || "empty"}`
      : `  hand: ${p.handCount} cards, contents hidden`,
    `  trash: ${p.trash.filter((c) => c.cardId).map((c) => c.name).join(", ") || "empty"}`,
  ];
  return lines.join("\n");
}

function renderMenu(choices: Choice[]): string {
  return choices
    .map((c) => {
      const parts = [`[${c.index}] ${c.label}`];
      if (c.note) parts.push(`      ${c.note}`);
      return parts.join("\n");
    })
    .join("\n");
}

export interface RenderedPrompt {
  /** Stable across every decision for this player — the cache prefix. */
  stable: string;
  /** Changes every decision — must come after the cache breakpoint. */
  volatile: string;
}

export interface PromptInputs {
  view: PlayerView;
  seat: MatchSeat;
  decision: Decision;
  features: Record<string, unknown>;
  /** The deck's playbook. This is where "learning" accumulates — see docs/arena.md. */
  playbook: string;
  /** Which angle this proposer argues from. */
  lens: string;
  rejection: string | null;
}

/**
 * The stable half of every prompt, and therefore the cache prefix.
 *
 * ITS LENGTH IS LOAD-BEARING. Claude Opus 5's minimum cacheable prefix is 512 tokens; below that the
 * request silently does not cache — no error, just `cache_creation_input_tokens: 0`. Across the
 * measured 89.2 substantive decisions per seat per game, silently losing the cache is the single
 * largest avoidable cost in the arena. An earlier, terser primer measured ~509 estimated tokens with
 * a short playbook, i.e. right on the boundary, so this one is deliberately sized to clear it on its
 * own without depending on how long a player's playbook happens to be. Everything here is load-
 * bearing rules content, not padding — and `council.ts` warns at the end of a run if the observed
 * cache-read tokens are still zero, so a regression is caught rather than assumed away.
 */
const RULES_PRIMER = `You are playing the One Piece Card Game (Simplified Chinese format, Standard, Block 2+).

## Winning and losing
- A deck is exactly 50 cards, plus 1 Leader and 10 DON!!.
- Life is a face-down stack. An attack that connects with a Leader removes the top Life card; the
  removed card's [Trigger] ability, if it has one, may be used.
- You lose when an attack connects with your Leader while your Life is already 0, or when you would
  draw from an empty deck.
- A round that reaches its time limit with no winner is a LOSS FOR BOTH PLAYERS, not a draw
  (官方公认赛赛事守则 V1.6.0 §II: 该对战结果为双方败北). Failing to close is a loss on your record.

## Turn structure
Refresh (your rested DON!! become active) -> Draw -> DON!! (add up to 2 from the DON!! deck) ->
Main (play cards, attach DON!!, attack, use [Activate: Main] abilities) -> End.
The player going first skips their very first draw (Comprehensive Rules 6-3-1).

## Combat
- Declaring an attack rests the attacker. An attack needs power >= the target's power to connect.
- Legal targets are the opponent's Leader and their RESTED Characters. An active Character cannot be
  attacked unless an effect says otherwise.
- The defender may activate [Blocker] on an active Character to redirect the attack to it.
- The defender may then play Counter cards from hand, adding that card's Counter value to the
  defender's power for the battle. You cannot see the opponent's hand, so treat their hand size as
  the ceiling on how much Counter power they might hold — and remember Counter events exist, so no
  hand size implies a hard maximum.
- Attaching a DON!! card to a Leader or Character gives it +1000 power until the end of the turn.

## Reading card text precisely
- "Power N" means EXACTLY N. Not at most N, not at least N.
- A qualifier at the start of an ability can bind to every clause that follows, not only the first.
  Where the English printing is ambiguous, the official Simplified Chinese ruling governs, and the
  ruling is frequently narrower than the English reads.
- [Rush] lets a Character attack the turn it is played. [Banish] discards damage instead of using
  Life triggers. [Double Attack] removes 2 Life. [On Play], [When Attacking], [On K.O.], [End of Your
  Turn] and [Activate: Main] name WHEN an ability happens; check that the timing actually applies
  before relying on it.
- There is no side deck in Constructed. Every card in the list is paid for in every matchup.

## Your task
You will be given the board as you can legitimately see it, a set of already-computed facts, and a
numbered list of legal moves. You may only choose from that list. You cannot make an illegal move, so
do not reason about legality — reason about which legal move is best. Choose exactly one index.`;

export function renderPrompt(input: PromptInputs): RenderedPrompt {
  const { view, seat, decision, features, playbook, lens, rejection } = input;
  const opponent = seat === "south" ? "north" : "south";

  const cardIds = [...new Set(visibleCards(view, seat).map((c) => c.cardId!))].sort();

  const stable = [
    RULES_PRIMER,
    "",
    "## Your playbook for this deck",
    playbook.trim() || "(none yet — play on general principles)",
    "",
    "## Your lens",
    lens,
  ].join("\n");

  const volatile = [
    `## Board — you are seated ${seat}, turn ${view.turnNumber}, phase ${view.phase}`,
    "",
    renderSide(view, seat, "YOU", true),
    "",
    renderSide(view, opponent, "OPPONENT", false),
    "",
    "## Card text for everything in play and in your hand",
    cardIds.map(cardText).join("\n"),
    "",
    "## Computed facts (already calculated — do not recompute)",
    JSON.stringify(features, null, 1),
    "",
    decision.prompt
      ? `## Resolving an effect: ${decision.prompt.label}\n${decision.prompt.details}\n` +
        `Select between ${decision.prompt.minSelections} and ${decision.prompt.maxSelections}.`
      : "## It is your turn to act in the main phase.",
    decision.truncated
      ? "\nNOTE: the legal-move list below was capped and does not show every legal combination."
      : "",
    "",
    "## Legal moves — choose exactly one by its index",
    renderMenu(decision.choices),
    "",
    rejection
      ? `## Your previous choice was REJECTED by the rules engine: ${rejection}\nChoose differently.`
      : "",
    "",
    `Reply with the index of your chosen move and a one-sentence reason. Indices run 0..${decision.choices.length - 1}.`,
  ]
    .filter((line) => line !== "")
    .join("\n");

  return { stable, volatile };
}
