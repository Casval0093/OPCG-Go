// Engine throughput benchmark AND per-command cost regression guard.
// Copy into packages/engine/tests/cards/ in the vendored engine and run with
// `vp test run tests/cards/throughput.test.ts`.
//
// Three decks are measured, and the point is the RATIO between them.
//
//   synthetic  4 distinct cards cycled to 50. What the original benchmark used.
//   ST01      the real 50-card ST01 starter deck, 17 distinct cards, shipped by
//             the engine itself (src/starter-decks.ts) so it cannot rot.
//   oars-x4   4 copies of OP16-017 LittleOars Jr. plus vanilla filler. This deck
//             exists ONLY to fail loudly. Both decks above are effect-light,
//             which is exactly why a ~200x per-command blowup on the project's
//             primary deck went unnoticed until it was hunted by hand: the
//             benchmark could not see it, because nothing it measured had a
//             permanent effect whose condition re-entered cost evaluation.
//             See patch 8 in tools/patch_engine.py for the mechanism.
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
//
// WHY THE GUARD IS A RATIO, NOT A WALL CLOCK. CLAUDE.md records that absolute
// ms/game is host-dependent and not comparable across machines; only within-run
// ratios are. So the assertion below compares oars-x4 against ST01 measured in
// the SAME run, on the same host, in the same process.

import { test } from "vite-plus/test";
import { runBotMatch } from "../../src/automation/bot-harness.ts";
import { valueRankedStrategy } from "../../src/automation/bot-strategies.ts";
import { ST01_LEADER_CARD_ID, ST01_MAIN_DECK } from "../../src/starter-decks.ts";
import { OnePieceTestEngine } from "../../src/index.ts";
import { basePower, getCardPower, getInstance, getPowerModifierTotal } from "../../src/shared.ts";
import { getPermanentModifierTotal } from "../../src/effects/permanent.ts";
import { getCard } from "../../../cards/src/runtime-catalog.ts";
import {
  eb01Doma005,
  eb01Fourtricks025,
  eb01Koza004,
  eb01MsMonday035,
  op05Shura106,
  op13MonkeyDLuffy001,
  op15Fuza070,
} from "@tcg/op-cards";
import type { MatchConfig } from "../../src/types.ts";

const SYNTHETIC_CARDS = [eb01Doma005, eb01Koza004, eb01Fourtricks025, eb01MsMonday035];
const SYNTHETIC_DECK = Array.from({ length: 50 }, (_, i) => SYNTHETIC_CARDS[i % 4]!.id);

// The pathological shape, reduced to its essentials: the 4 copies that make the
// permutation blow up, and nothing else that could confound the number. Card ids
// are literals rather than imports because MatchConfig takes ids, and a literal
// keeps this deck readable as "the repro" instead of as a real list.
const OARS_DECK = [
  ...Array.from({ length: 4 }, () => "OP16-017"),
  ...Array.from({ length: 46 }, () => "OP12-035"),
];

interface Deck {
  label: string;
  leaderCardId: string;
  mainDeck: readonly string[];
  /** Games to measure. The pathological deck gets fewer: pre-patch it costs
   *  ~100 s/game, and the ratio is decisive long before 100 games. */
  games?: number;
  /** Card whose presence IN PLAY is what makes this deck's measurement mean
   *  anything. If the shuffle never puts it on the board the ratio measures a
   *  pile of vanillas and the guard silently passes -- the vacuous-test failure
   *  mode CLAUDE.md calls this project's most frequent defect. Asserted below. */
  probeCardId?: string;
}

// Wall-clock ceiling for ONE getCardPower call on a board of N OP16-017. A
// CALIBRATION KNOB in the sense of docs/simulation.md -- a tripwire threshold,
// not a measured result, and never to be quoted as one.
//
// Measured on the dev host, single call, milliseconds:
//   copies          1      2      3       4         5
//   pre-patch-8   1.6    1.9   28.5   1520.5   154287.1
//   post-patch-8  1.3    0.3    0.5      1.1        4.7
//
// 250 ms sits ~50x above the worst post-fix value and ~6x below the first
// pre-fix violation, so host noise cannot trip it and the regression cannot
// hide. Checked in ascending N with an early throw, so a broken engine fails
// at N=4 in ~1.5 s instead of grinding through N=5 for two and a half minutes.
const PERMANENT_EFFECT_MS_LIMIT = 250;

// getCardPower is the hottest read in the engine, and the setBasePower primitive added two lookups
// to it -- one over state.modifiers and one over every card's permanentEffects. Both almost always
// return null, but "almost always cheap" is how the OP16-017 blowup was justified too, so the
// overhead is measured rather than argued.
//
// The probe board is deliberately VANILLA, not the OP16-017 board above. That is the adverse case
// for this ratio and the representative one: on the pathological board getPermanentModifierTotal
// costs ~3ms per call and swamps the two new lookups into 1.01x, which flatters them. On a plain
// board getCardPower is sub-microsecond and the added scans are a visible fraction of it.
//
// The SECOND setBasePower probe's limit. The first one (below) times a board where no in-play card
// prints `setBasePower`, so getPermanentSetBasePower's structural prefilter returns on its first
// `.some()` for every call and the loop the guard's own error message names -- evaluateConditions
// plus candidatePoolForTarget, per source, per getCardPower -- has ZERO coverage. That is
// CLAUDE.md's "a deck-based performance guard is unreliable; construct the board" lesson in a new
// form: a board WAS constructed, but one where the code under test is skipped.
//
// So the loaded probe puts 4x OP15-070 Fuza in play on the opponent's turn, which is exactly when
// their [Opponent's Turn] clause is live, and times getCardPower on a [Shura] body that all four
// of them target. Every call then pays four condition evaluations and four candidate-pool scans.
// A KNOB, not a result. Measured 1.20x with the guards in the right order and 1.44x with them in
// the wrong one, so -- and this is worth stating rather than leaving implied -- THIS PROBE DOES NOT
// CATCH THE GUARD-ORDER REGRESSION. The vanilla probe does (1.77x against its 1.6x limit), and that
// is the expected split: on a loaded board getPermanentSetBasePower has to do the per-source work
// whatever order the guards are in, so reordering barely shows. What this probe bounds instead is
// the per-source work ITSELF -- it is the only coverage the evaluateConditions +
// candidatePoolForTarget loop has, and it would catch a change that made that loop scale with
// something larger than the board. 2.0x is ~1.7x headroom over the measured 1.20x.
const LOADED_BASE_POWER_LIMIT = 2.0;

// A KNOB, not a result -- but a deliberately TIGHT one, because it has a real value to separate.
// The first implementation of getPermanentSetBasePower measured 2.04x here; reordering its guards so
// the structural "does any in-play card even print this action" test runs before the negation check
// took it to 1.02x on an idle host and 1.16x under load. A limit of 2.5x would have passed both
// shapes, i.e. would have been decoration. 1.6x fails the slow shape (measured 1.80x) and passes
// the fast one, verified in both directions.
const BASE_POWER_OVERHEAD_LIMIT = 1.6;
const OVERHEAD_SAMPLES = 200_000;
const PATHOLOGICAL_COPIES = [1, 2, 3, 4, 5];
const PATHOLOGICAL_GAMES = 3;

const DECKS: Deck[] = [
  { label: "synthetic-4card", leaderCardId: op13MonkeyDLuffy001.id, mainDeck: SYNTHETIC_DECK },
  { label: "ST01-real-50", leaderCardId: ST01_LEADER_CARD_ID, mainDeck: ST01_MAIN_DECK },
  {
    label: "oars-x4",
    leaderCardId: "OP16-060",
    mainDeck: OARS_DECK,
    games: PATHOLOGICAL_GAMES,
    probeCardId: "OP16-017",
  },
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
  /** Games in which `probeCardId` reached the board. Undefined when no probe is set. */
  probeGames?: number;
}

function measure(deck: Deck, games: number): Measurement {
  const t0 = process.hrtime.bigint();
  let cmds = 0;
  let decided = 0;
  let probeGames = 0;
  for (let i = 0; i < games; i++) {
    const r = runBotMatch(
      cfg(deck, 1000 + i),
      { south: valueRankedStrategy, north: valueRankedStrategy },
      { maxCommands: 500 },
    );
    cmds += r.totalCommands;
    if (r.winner) decided++;
    if (deck.probeCardId) {
      // "character" is on the board now; "trash" is played-then-KO'd. Either way the
      // card was in play and its permanent effect was evaluated. Deck and hand are not
      // enough -- an unplayed copy costs nothing and proves nothing.
      const inPlay = Object.values(r.finalState.cards).some(
        (c) => c.cardId === deck.probeCardId && (c.zone === "character" || c.zone === "trash"),
      );
      if (inPlay) probeGames++;
    }
  }
  const secs = Number(process.hrtime.bigint() - t0) / 1e9;
  return {
    label: deck.label,
    distinct: new Set(deck.mainDeck).size,
    gamesPerSec: games / secs,
    cmdsPerSec: cmds / secs,
    decided,
    cmdsPerGame: cmds / games,
    ...(deck.probeCardId ? { probeGames } : {}),
  };
}

test("bench", () => {
  const N = 100;
  const results = DECKS.map((d) => measure(d, d.games ?? N));

  console.log(`\nBENCH games=${N} (oars-x4 ${PATHOLOGICAL_GAMES}) strategy=valueRanked mirror`);
  console.log("deck                distinct  games/s   cmds/s  cmds/game  decided");
  for (const r of results) {
    console.log(
      `${r.label.padEnd(20)}${String(r.distinct).padStart(6)}${r.gamesPerSec.toFixed(2).padStart(10)}` +
        `${r.cmdsPerSec.toFixed(0).padStart(9)}${r.cmdsPerGame.toFixed(1).padStart(11)}${String(r.decided).padStart(9)}`,
    );
  }

  const [synthetic, real, pathological] = results;
  if (synthetic && real) {
    // >1 means the real deck is slower, which is the expected direction.
    console.log(
      `\nREALISM RATIO ${(synthetic.gamesPerSec / real.gamesPerSec).toFixed(2)}x slower per game, ` +
        `${(synthetic.cmdsPerSec / real.cmdsPerSec).toFixed(2)}x slower per command`,
    );
    console.log("audit assumed 2-5x; ST01 is a starter deck so treat this as a LOWER bound\n");
  }

  // THE GUARD — a deterministic board, not a deck.
  //
  // This started out as a per-command ratio on the oars-x4 deck above, and that
  // MEASURABLY DID NOT WORK: on the unpatched engine it came out at 1.55x ST01
  // and passed, because whether the blowup happens depends on how many copies of
  // OP16-017 are simultaneously on the board, and that is decided by the shuffle.
  // The bench seeds (1000+i) never stacked them; the sim harness at seed 7 did,
  // and cost 3,682 ms/command on the same 50 cards. A guard that only fires on a
  // lucky shuffle is the vacuous-test failure mode one level down -- it had a
  // non-vacuity check, and the check passed while the measurement meant nothing.
  //
  // So the board is CONSTRUCTED instead of drawn. This measures the regressed
  // quantity directly, cannot be defeated by a shuffle, and is fast in both
  // directions. The deck row above stays as end-to-end context, not as a guard.
  console.log("\nPERMANENT-EFFECT SCALING — one getCardPower on a board of N x OP16-017");
  const timings: string[] = [];
  for (const copies of PATHOLOGICAL_COPIES) {
    const engine = OnePieceTestEngine.create(
      { leaderCardId: "OP16-060", character: Array.from({ length: copies }, () => "OP16-017") },
      { leaderCardId: "OP16-060" },
      { activeSeat: "south", firstPlayer: "north" },
    );
    const state = engine.getState();
    const ids = state.players.south.characterArea.filter((x): x is string => Boolean(x));
    if (ids.length !== copies) {
      throw new Error(
        `Fixture did not seat ${copies} copies (got ${ids.length}), so the scaling probe ` +
          `measures nothing. Check maxCharacterSlots and the character fixture format.`,
      );
    }
    const t0 = process.hrtime.bigint();
    const power = getCardPower(state, ids[0]!);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    timings.push(`${copies}:${ms.toFixed(2)}ms`);
    console.log(`  copies=${copies}  power=${power}  ${ms.toFixed(2)}ms`);

    // Power must be identical at every board size: 8000 base - 4000, because no
    // cost-8+ Whitebeard Pirates body is present. If this moves, the fix changed
    // a RESULT and not just a cost, which is the one thing patch 8 must never do.
    if (power !== 4000) {
      throw new Error(
        `OP16-017 power is ${power} with ${copies} copies out, expected 4000 ` +
          `(8000 base, -4000 from its own permanent effect). A performance change ` +
          `altered a game result.`,
      );
    }
    if (ms > PERMANENT_EFFECT_MS_LIMIT) {
      throw new Error(
        `Permanent-effect evaluation regression: one getCardPower on ${copies} copies of ` +
          `OP16-017 took ${ms.toFixed(1)}ms, limit ${PERMANENT_EFFECT_MS_LIMIT}ms ` +
          `(curve so far ${timings.join(" ")}). Cost or power evaluation is re-entering ` +
          `itself across sibling instances. Check patch 8 is applied ` +
          `(python3 tools/patch_engine.py --check), then look for another ` +
          `compute-then-discard site in src/effects/permanent.ts.`,
      );
    }
  }
  console.log(`  all under ${PERMANENT_EFFECT_MS_LIMIT}ms — ${timings.join(" ")}\n`);

  // THE SECOND GUARD — what the setBasePower base-power lookup costs on the hot path.
  //
  // Measured as a RATIO inside one process against a locally re-implemented "old" getCardPower,
  // rather than by comparing two runs: absolute ms/call is host- and load-dependent, and the two
  // variants here see the same board, the same cache state and the same contention. The old body
  // is `basePower(card) + attachedDon + power modifiers + permanent power modifiers`, verbatim what
  // shared.ts computed before the setBasePower patch.
  console.log(
    "setBasePower OVERHEAD — getCardPower vs its pre-setBasePower body, same process, vanilla board",
  );
  const board = OnePieceTestEngine.create(
    {
      leaderCardId: "OP16-060",
      character: Array.from({ length: 5 }, (_, i) => SYNTHETIC_CARDS[i % 4]!.id),
      hand: 5,
      trash: 10,
    },
    {
      leaderCardId: "OP16-060",
      character: Array.from({ length: 5 }, (_, i) => SYNTHETIC_CARDS[i % 4]!.id),
      hand: 5,
      trash: 10,
    },
    { activeSeat: "south", firstPlayer: "north" },
  );
  const boardState = board.getState();
  const probeId = boardState.players.south.characterArea.find((x): x is string => Boolean(x))!;

  const oldGetCardPower = (id: string) => {
    const instance = getInstance(boardState, id);
    const card = getCard(instance.cardId);
    return (
      basePower(card) +
      (boardState.activeSeat === instance.controller ? instance.attachedDon * 1000 : 0) +
      getPowerModifierTotal(boardState, id) +
      getPermanentModifierTotal(boardState, id, "power")
    );
  };

  // Same answer, or the ratio below is comparing two different computations.
  if (oldGetCardPower(probeId) !== getCardPower(boardState, probeId)) {
    throw new Error(
      `The pre-setBasePower body disagrees with getCardPower (${oldGetCardPower(probeId)} vs ` +
        `${getCardPower(boardState, probeId)}), so this ratio is meaningless. Re-derive the old ` +
        `body from shared.ts before trusting the number.`,
    );
  }

  const time = (fn: () => number) => {
    for (let i = 0; i < 200; i += 1) fn(); // warm
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < OVERHEAD_SAMPLES; i += 1) fn();
    return Number(process.hrtime.bigint() - t0) / 1e6;
  };
  const oldMs = time(() => oldGetCardPower(probeId));
  const newMs = time(() => getCardPower(boardState, probeId));
  const overhead = newMs / oldMs;
  console.log(
    `  ${OVERHEAD_SAMPLES} calls: old ${oldMs.toFixed(0)}ms, new ${newMs.toFixed(0)}ms, ` +
      `${overhead.toFixed(2)}x\n`,
  );
  // THE LOADED PROBE — the same ratio on a board where the new code cannot short-circuit.
  const loaded = OnePieceTestEngine.create(
    {
      leaderCardId: "OP16-060",
      character: [
        op05Shura106.id,
        op15Fuza070.id,
        op15Fuza070.id,
        op15Fuza070.id,
        op15Fuza070.id,
      ],
      hand: 5,
      trash: 10,
    },
    { leaderCardId: "OP16-060", hand: 5, trash: 10 },
    // north active => it is the OPPONENT's turn for south, so all four Fuza clauses are live.
    { activeSeat: "north", firstPlayer: "south" },
  );
  const loadedState = loaded.getState();
  const shuraId = loadedState.players.south.characterArea.find(
    (id): id is string => Boolean(id) && getCard(getInstance(loadedState, id).cardId).name === "Shura",
  );
  if (!shuraId) {
    throw new Error(
      "The loaded probe did not seat a [Shura] body, so it measures the same short-circuit as the " +
        "probe above and proves nothing. Check the character fixture and maxCharacterSlots.",
    );
  }
  // Non-vacuity: 2000 printed, 6000 through four overlapping Fuza clauses. If this reads 2000 the
  // clauses are not live and the timing below is the empty case again.
  const loadedPower = getCardPower(loadedState, shuraId);
  if (loadedPower !== 6000) {
    throw new Error(
      `The loaded probe's [Shura] reads ${loadedPower}, not 6000, so the four Fuza clauses are not ` +
        `live and this probe is measuring the short-circuit it exists to avoid.`,
    );
  }
  const loadedOld = time(() => {
    const instance = getInstance(loadedState, shuraId);
    const card = getCard(instance.cardId);
    return (
      basePower(card) +
      (loadedState.activeSeat === instance.controller ? instance.attachedDon * 1000 : 0) +
      getPowerModifierTotal(loadedState, shuraId) +
      getPermanentModifierTotal(loadedState, shuraId, "power")
    );
  });
  const loadedNew = time(() => getCardPower(loadedState, shuraId));
  const loadedRatio = loadedNew / loadedOld;
  console.log(
    `  4x Fuza + [Shura], ${OVERHEAD_SAMPLES} calls: old ${loadedOld.toFixed(0)}ms, ` +
      `new ${loadedNew.toFixed(0)}ms, ${loadedRatio.toFixed(2)}x (power=${loadedPower})\n`,
  );
  if (loadedRatio > LOADED_BASE_POWER_LIMIT) {
    throw new Error(
      `getCardPower is ${loadedRatio.toFixed(2)}x its pre-setBasePower cost on a board where four ` +
        `permanent setBasePower clauses are live, limit ${LOADED_BASE_POWER_LIMIT}x. This is the ` +
        `path the vanilla probe cannot see: getPermanentSetBasePower is evaluating conditions and ` +
        `candidate pools per source, per call.`,
    );
  }

  if (overhead > BASE_POWER_OVERHEAD_LIMIT) {
    throw new Error(
      `getCardPower is ${overhead.toFixed(2)}x its pre-setBasePower cost, limit ` +
        `${BASE_POWER_OVERHEAD_LIMIT}x. getEffectiveBasePower (shared.ts) consults a modifier scan ` +
        `and getPermanentSetBasePower (effects/permanent.ts); one of them has stopped short-` +
        `circuiting. Note this is the hottest read in the engine -- every battle, every legal-` +
        `command enumeration and every policy score goes through it.`,
    );
  }
}, 1_800_000);
