# OPCG-Go — Context for Claude Code

Read this first. It is the handoff from the session that scoped this project.

## What this is

Competitive deck research and simulation for the **One Piece Card Game, Simplified Chinese (简中) format**.
Owner: Ping Han. Goal: determine and field the highest-EV deck in the SC format, continuously, across
set rotations.

Two tracks run in parallel:

- **Research track** — mine real tournament + ladder data, compute field-weighted EV, recommend a deck. *Working today.*
- **Engine track** — fork a rules engine, add search AI, simulate matchups for formats that have no data yet. *Scoped, not started.*

## Ground truth: what is real vs what is not

**No simulation has ever run in this project.** Every number in `docs/` is empirical — real human
games. If you write something implying otherwise, you are wrong. The engine does not exist yet.

## Locked decisions

| Branch | Decision |
|---|---|
| Format | Simplified Chinese, Standard, Block 2+ |
| Meta ground truth | Limitless EN/JP as statistical backbone, corrected by SC-native sources |
| Engine base | Fork `TheCardGoat/tcg-engines` (MIT). MOOgiwara rejected (AGPL, 30% MVP, no card logic) |
| Effect encoding | Adopt that repo's existing compositional DSL; LLM-author gaps with generated tests |
| Objective function | Field-weighted expected match win rate vs the real SC field, split by play/draw |
| Validation | 3 layers: per-card assertion tests → Comprehensive Rules conformance → meta calibration |
| Budget | **No ceiling.** Cost is out of the objective function. |
| Chosen archetypes | **Ace (`OP16-001`) primary, Mihawk (`OP14-020`) secondary** — owner preference, see caveat below |

## Hard-won facts — do not re-derive these

- **An OPTCG deck is 50 cards** + 1 leader + 10 DON!!. (An earlier draft said 51. It was wrong.)
- **Rotation is live since 2026-04-01.** Standard = Block 2+ only. OP01–OP04 and ST01–ST09 are dead.
- **Banlist:** OP06-086 Gecko Moria, OP07-045 Jinbe, EB01-059 Kingdom Come, OP02-117 Ice Age.
- **Ladder data understates value/control decks.** Bo1, speed-rewarded, complex decks piloted worse
  by the median ladder player. Treat resource-rotation archetypes as a *lower bound*, always.
- **Engine throughput is 2.80 games/s single-core** (3.54 with the cycle detector off). Full-strength
  ISMCTS is ~2 orders of magnitude out of reach. See `docs/engine-audit.md` for the four options.
- **`onepiece-cardgame.cn` (official SC) is robots-blocked** to automated fetch. SC-official data must
  come from mirrors, community sources, or Ping.
- **Card-effect encoding does not templatise.** 1,092 of 1,219 normalized effect templates are
  singletons; top-100 templates cover only 34.6% of clauses. Composition, not pattern matching.
- **There is no encoding backlog in the existing sets — it is 0, not 331/125.** Both figures
  were `coverage_report.py` bugs, now fixed: 309 cards inherit their encoding by spread
  (`{ ...baseCard, id: "..._p2" }`) and the check never followed it; 22 have a null printed
  effect written as `effect: "NULL"` and the check read the key's presence as text.
  309 + 22 = 331 and 103 + 22 = 125 — both reconcile exactly. Do not re-add this work item.
- **Variant printed text is not trustworthy; base text is.** 39 of 315 spread printings
  disagree with the base whose encoding they execute — 16 have lost the `−` from a debuff
  ("give 3000 power" for a card that gives −3000), 12 differ by a bracketed keyword.
  `OP02-013_p3` misspells the trait `"Whitebeard Piratess"` — the exact trait Ace keys on.
  Play is correct today because the engine runs the base's encoding. **When authoring
  OP15–OP17 encodings from printed text, read the base printing.** `tools/variant_audit.py`.
- **Card data is SOLVED for OP15/OP16 via npm — do not re-litigate the egress problem.**
  Direct card sites (`optcgapi.com`, `onepiece.limitlesstcg.com`, `onepiece-cardgame.cn`,
  `en.onepiece-cardgame.com`) are all blocked by egress policy. The npm registry is not.
  `one-piece-card-game-json` publishes the **official Bandai** list (its `image_url`s point
  at `en.onepiece-cardgame.com`), so it is a mirror of the primary source, not an aggregator
  summary. `tools/import_cards.py` pulls it. Validated against the engine's 2,282 hand-checked
  cards: power 100%, life 100%, cost 99.95%, counter 99.58%. `OP16-001` Ace comes back
  matching `docs/research-findings.md` verbatim.
- **OP17 is not published yet — it is not missing, it does not exist upstream.** Bandai has
  not put it on the official card list. EN release 2026-08-28, SC ~2026-08-23. Re-run
  `python3 tools/import_cards.py --set OP17 --refresh` after that date; no code change needed.
- **`OP17-005`'s effect: `docs/research-findings.md` is correct, the aggregator was wrong.**
  A WebSearch summary claimed an On Play that sets your own single-colour Leader's base power
  to 8000. Ping checked Limitless and rejected it. Do not reintroduce that clause.
- **Do not re-measure throughput until the benchmark deck is fixed** (Ping's call, 2026-08-16).
  `bench/throughput.test.ts` uses a 4-card deck; a re-measure on that deck would just reproduce
  a number we already know is unrepresentative. Fix the deck to a real 50-card list first, then
  measure once.

## Repo map

```
CLAUDE.md                       this file
README.md                       public-facing overview
docs/charter.md                 goal, decisions, open questions
docs/engine-audit.md            engine comparison, throughput measurements, options A-D
docs/research-findings.md       all verified competitive data (matrix, leaders, OP17)
tools/ev_analysis.py            field-weighted EV + Nash + sensitivity   <- run this
tools/coverage_report.py        card-effect encoding coverage against the vendored engine
tools/variant_audit.py          alternate-art printings vs the base encoding they inherit
tools/import_cards.py           card data for sets the engine lacks, via npm (in-policy)
data/cards-OP15-en.json         imported OP15, 119 cards
data/cards-OP16-en.json         imported OP16, 119 cards
bench/throughput.test.ts        engine throughput benchmark
data/op16-matchup-matrix.json   the matchup matrix, machine-readable
data/card-coverage.json         all 2,282 cards classified encoded/gap/vanilla
scripts/bootstrap.sh            clone + install the vendored engine, run its tests
vendor/                         gitignored; created by bootstrap.sh
```

## Commands

```bash
python3 tools/ev_analysis.py                      # who is the best deck right now
python3 tools/ev_analysis.py --sensitivity Teach  # how fragile is that answer
./scripts/bootstrap.sh                            # ~2 min; ends with 2631 passing tests
python3 tools/coverage_report.py --exclude-promos # encoding backlog
```

`ev_analysis.py` needs numpy; scipy is optional (Nash is skipped without it).

## Next actions, in priority order

1. **Re-check OP17 spoilers for Mihawk.** None found in the ~135 revealed cards. If he gets support,
   `docs/research-findings.md` §4 flips and Mihawk becomes viable.
2. **Build the Ace OP17 list.** Skeleton is the OP16 Red Ace deck; first slot-in is `OP17-005`
   Edward Newgate (12000 power, cost −4 vs a 10000+ board, so effectively 6-cost — and Ace's leader
   grants it [Rush]). That is the whole thesis.
3. **Generate engine card definitions from `data/cards-OP15-en.json` / `cards-OP16-en.json`.**
   Acquisition is done (238 cards, 223 with printed effects). What remains is the real work:
   emit `.ts` + `.i18n.ts` definitions in the vendored engine's shape, then encode effects in
   its existing DSL with per-card tests. Author from these files, never from a variant printing.
   (The "fill the 125 mainline gaps" item that used to sit here has been deleted — that backlog
   was a measurement bug and is 0.)
4. **Pick the Tier-3 lever** — recommendation is Tier 2.5 now, learned value net next, Rust port only
   if calibration proves heuristic play distorts matchups. Note the audit's throughput table is
   derived from a 4-card test deck; it self-notes real decks run 2–5x slower but does not carry
   that multiplier into the options, so Option C's "runs today on 2 cores" is optimistic.

## Open questions only Ping can answer

1. Does SC Standard currently run the same Block 2+ rotation?
2. Is the SC banlist identical to the four cards above?
3. Is SC OP17 the same list as JP/EN OP17, or does it carry SC-exclusive content?
4. Target event and date (店赛 / 标准对战会 / 旗舰赛), and Bo1 or Bo3?

## Working notes

- Ping is building his **first competitive deck**. Piloting skill is the binding constraint, not list
  quality — the gap between a deck's ceiling and a new pilot's realised win rate dwarfs the 2–3 point
  spreads in the matrix. Weight pilotability accordingly, and say so when it conflicts with raw EV.
- Ace and Mihawk are both **fringe decks** (0.87% and 1.02% of the OP16 field). This was flagged and
  accepted knowingly. Do not silently re-litigate it, but do report honestly if the gap widens.
- Ping pushes back on method, correctly. Show your working and flag your own biases before he has to.
- Source quality varies wildly. Limitless and official Bandai pages are reliable. `shonentcg.com`
  reported 65–72% leader win rates and was excluded as an SEO farm. Verify card text against
  `onepiece.limitlesstcg.com/cards/<ID>`, never against aggregator summaries — two of them returned
  garbled leader effects and a decklist that summed to 48.
