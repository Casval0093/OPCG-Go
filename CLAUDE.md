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
| Role of the EV tooling | **Not deck selection.** Ping accepted this 2026-08-17. See below. |

## Hard-won facts — do not re-derive these

- **An OPTCG deck is 50 cards** + 1 leader + 10 DON!!. (An earlier draft said 51. It was wrong.)
- **There is no sideboard in Constructed.** The deck is locked for the whole event; only Sealed
  permits a side deck (official Tournament Rules Manual / Floor Rule). Every tech slot is a
  permanent tax paid in every matchup, so slot decisions are `Σ share × ΔWR` across the *whole*
  field — a card dead outside one 10%-share matchup must swing it >9 points to break even.
  See `docs/research-findings.md` §5.
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
- **`OP17-005` HAS the On Play, and it is a BUFF. Ping re-added it 2026-08-17, reversing the
  08-16 rejection.** Full text: *"If your opponent has a Character with 10000 power or more, give
  this card in your hand −4 cost. [On Play] Your monocolored Leader's base power becomes 8000
  until the end of your opponent's next End Phase."* Ace's `OP16-001` is **5000 base**, so this is
  **+3000**, not a cost — the old note's reasoning was simply wrong, and no Leader has 8000 base.
  It sets base power, so +power modifiers stack on top, and it lasts through the opponent's next
  End Phase, so it defends too. Provisional until Bandai publishes 2026-08-28. **Do not re-reject
  this clause**; if you think it is wrong, check `onepiece.limitlesstcg.com/cards/OP17-005`.
- **The 08-16 failure mode was not "trusted a bad source".** It was a spoiler-stage source
  changing under us, plus a reasoning error that survived because its conclusion sounded
  conservative. Treat every OP17 row as provisional until 2026-08-28 and re-diff after.
- **Egress: the blocks are environment-specific, not universal. On Ping's Mac, Limitless,
  `en.onepiece-cardgame.com` and `onepiece-cardgame.cn` all return 200.** Only `optcgapi.com`
  times out. Limitless `robots.txt` is `User-agent: * / Disallow:` — empty, so automated fetch
  is explicitly permitted; use it directly for card verification. `onepiece-cardgame.cn` serves
  **no robots.txt at all** — the "robots-blocked" note was wrong; it is a JavaScript SPA, so
  plain fetch returns an empty shell. That needs a rendering browser or its JSON API, which is
  a different problem with a different fix.
- **Aggregator card IDs are not trustworthy, not just aggregator card text.** Re-verifying OP17
  §5 against Limitless found an error in **every** row, including a wrong ID: the card the doc
  filed as `OP17-009` Rakuyo is actually `OP17-016`; `OP17-009` is Haruta, a different card.
- **python.org Python on macOS ships without root certificates.** `import_cards.py` dies with
  `CERTIFICATE_VERIFY_FAILED` until `/Applications/Python 3.13/Install Certificates.command`
  is run once. Not a repo bug; it bites every fresh machine.
- **The benchmark deck is fixed and the re-measure is done (2026-08-17). Do not redo it.**
  `bench/throughput.test.ts` now runs the 4-card synthetic deck and the engine's real 50-card
  ST01 deck back to back. **Realism ratio 1.79x per game, 0.97x per command.** The audit's
  assumed 2–5x roughly holds in magnitude but its mechanism was wrong: per-command cost is flat,
  and the whole slowdown is game length (94.6 cmds/game vs 51.1). Effect resolution is not the
  bottleneck — state transitions are. See `docs/engine-audit.md`.
- **The engine has no OP15/OP16/OP17 — only OP01–OP14, EB01–04, PRB01–02, ST01, DON.**
  This blocks more than it looks. The B/Y Teach list cannot be built in the engine (10 of 14
  slots plus leader `OP16-080` are missing), so "benchmark on the Teach deck" was never
  available — having cards in `data/cards-OP16-en.json` is not the same as having them in
  `@tcg/op-cards`. **`OP14-020` Mihawk IS in the engine; `OP16-001` Ace is not** — the secondary
  archetype is the simulable one today.

## What the EV tooling is for — decided 2026-08-17

The charter says "field the highest-EV deck." The archetype is nonetheless locked to Ace at
**0.87% field share** on owner preference, and `ev_analysis.py` says Nami is the EV pick at 55.22%.
Those did not compose into a decision procedure. Ping resolved it: **the EV tooling does not pick
the deck.** It has two narrower jobs.

1. **Tech-slot optimisation — the primary job (Ping, 2026-08-17).** The deck is fixed; the
   *slots* are the decision variable. As the meta moves, meta-beater cards get swapped in — his
   worked example is 1–2 copies of `OP17-016` Rakuyo against aggro. The question the simulator
   exists to answer is **"which 1–2 cards raise my win rate against the field I will actually
   face"**, not "which deck is best."
2. **Field forecasting** — what will Ping actually face, so those slots and the mulligans can be
   tuned to it.
3. **Tripwire** — the condition under which Ace is abandoned despite preference.

**This changes the objective function and the critical path.** Marginal EV *per slot* is not
derivable from a leader-vs-leader matchup matrix — a 50-card list differing by 2 cards is the same
row in that matrix. It requires simulation at card granularity, which requires OP15/16/17 encoded
in the engine. **Next action #3 is therefore the critical path, not #2.** Everything else in the
engine track is downstream of it.

The tripwire is **qualitative, not numeric — Ping's call, 2026-08-17.** He has not set a points
threshold and may not. The standing criterion is: **a structural deficiency is decisional; a points
gap is not.** So do not escalate "Ace is N points behind" no matter how large N is. Escalate when
the deck's plan is broken at the mechanism level — its enablers do not turn on against the real
field, its core loop is answered by something ubiquitous, a key piece is banned or rotated.

Rationale, and it is sound: this is Ping's first competitive deck, pilot skill is the binding
constraint, Ace is tempo (near the most pilotable thing in the format) while the decks the numbers
favour — Teach, Big Mom — are the hardest to pilot in the set. The EV table ranks decks *as played
by experts*. Reps on one deck beat a theoretical edge that gets misplayed.

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
   grants it [Rush]). Its [On Play] also takes Ace's Leader 5000 → 8000 for a full turn cycle.
   That is the whole thesis. Second: 1–2 `OP17-016` Rakuyo as anti-aggro tech (Ping's call), but
   see §5 — the removal suite and the discount want opposite fields and rarely both switch on.
3. **Generate engine card definitions from `data/cards-OP15-en.json` / `cards-OP16-en.json`.**
   Acquisition is done (238 cards, 223 with printed effects). What remains is the real work:
   emit `.ts` + `.i18n.ts` definitions in the vendored engine's shape, then encode effects in
   its existing DSL with per-card tests. Author from these files, never from a variant printing.
   (The "fill the 125 mainline gaps" item that used to sit here has been deleted — that backlog
   was a measurement bug and is 0.)
4. **Pick the Tier-3 lever** — recommendation is Tier 2.5 now, learned value net next, Rust port only
   if calibration proves heuristic play distorts matchups. The multiplier is now measured, not
   assumed: Option C's "runs today on 2 cores" is optimistic by ~3.4x (1.85x game length hitting
   both decisions/game and rollout length), and that is a lower bound since ST01 is a starter deck.
   Option A's framing needs revising — the cost is state transitions, not effect resolution.

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
