# OPCG-Go — Context for Claude Code

Read this first. It is the handoff from the session that scoped this project.

## What this is

Competitive deck research and simulation for the **One Piece Card Game, Simplified Chinese (简中) format**.
Owner: Ping Han. Goal: determine and field the highest-EV deck in the SC format, continuously, across
set rotations.

Two tracks run in parallel:

- **Research track** — mine real tournament + ladder data, compute field-weighted EV, recommend a deck. *Working today.*
- **Engine track** — fork a rules engine, add search AI, simulate matchups for formats that have no
  data yet. *In progress:* OP15/OP16 card shells generated, simulation harness working end to end
  on Block 2+ decks. Remaining: encode OP15/OP16 effects, then a play policy worth trusting.

## Ground truth: what is real vs what is not

**Every competitive number in `docs/research-findings.md` and `docs/charter.md` is empirical** —
real human games from Limitless and an EN ladder. No simulated figure has ever been mixed into
them, and none should be without saying so explicitly.

**Simulation started working on 2026-08-17** and its output lives only in `docs/simulation.md` and
`sim/results/`. So far that is mirror matches used to validate the harness — 400-game ST01 and
Mihawk mirrors — plus the prompt diagnostic. **No matchup between two different decks has been
simulated**, because the current field is OP15/OP16 and those cards are shells, not encodings.
Keep the two bodies of evidence clearly separated when writing anything.

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
- **A timed-out round is a DOUBLE LOSS, not a draw** — 官方公认赛赛事守则 V1.6.0 §II: *"该对战结果
  为双方败北"*. Failing to close inside 30 minutes is a loss on your record. Extra turns (+3 / +2)
  and the Life→deck→猜拳 tiebreak apply **only in finals and elimination**, never in Swiss.
  The simulator scores `win | loss | timeout` for this reason. See `docs/simulation.md`.
- **`MatchConfig.firstPlayer` is silently discarded by the engine.** It sets the initial
  `activeSeat` only; the 猜拳 setup roll (Comprehensive Rules 5-2-1) overwrites it, and
  `runBotMatch` consumes that command from its prompt queue before any strategy sees it. Forcing
  it both ways gives byte-identical results, and **north led all 120 test games**. Control turn
  order by **seat assignment** instead — north leads, so seat the deck north to put it on the play.
- **The engine's bot could not resolve `orderCards` prompts — FIXED 2026-08-17, do not re-diagnose.**
  It abandoned **88% of games** on a Block 2+ deck with `illegal-command` at turn 2. Cause:
  `resolveBotPromptCommand` branches on four of six `ChoiceKind`s and falls through to a single
  `optionId`, which cannot express an ordering. `orderCards` failed **17/17**; every other kind
  passed, including `chooseOption`. The ~8-line fix is `tools/patch_engine.py`, re-applied by
  `scripts/bootstrap.sh` since `vendor/` is gitignored. A/B: 3/20 games completed → **20/20**.
  Engine suite unchanged at 2632. **This belongs upstream** — tcg-engines is MIT and the bug is
  theirs. See `docs/simulation.md`.
- **Real Block 2+ decks now simulate end to end**, 400/400 `rules-win`, median 9 turns.
- **Do not calibrate on ST01.** The play/draw gap is **54.5 pts** on ST01, **26.7** on a vanilla
  Block 2+ pile, and **8.5 pts** on a real Block 2+ deck — the last of which is plausible. The gap
  tracks how much interaction a deck has; a degenerate deck gives degenerate calibration. An
  earlier note here claiming the bot exaggerates first-player advantage "by an order of magnitude"
  was measured on ST01 and is **retracted**. Policy quality remains unmeasured — a plausible split
  shows the policy is not obviously broken, not that it plays well.
- **There is no sideboard in Constructed.** The deck is locked for the whole event; only Sealed
  permits a side deck (official Tournament Rules Manual / Floor Rule). Every tech slot is a
  permanent tax paid in every matchup, so slot decisions are `Σ share × ΔWR` across the *whole*
  field — a card dead outside one 10%-share matchup must swing it >9 points to break even.
  See `docs/research-findings.md` §5.
- **Rotation is live since 2026-04-01.** Standard = Block 2+ only. OP01–OP04 and ST01–ST09 are dead.
- **Banlist:** OP06-086 Gecko Moria, OP07-045 Jinbe, EB01-059 Kingdom Come, OP02-117 Ice Age.
- **Ladder data understates value/control decks — but only half of that applies to THIS event.**
  The original reasoning was: ladder is Bo1, rewards speed, and complex decks are piloted worse by
  the median ladder player. **The target event is Bo1 with a 30-minute clock** (Ping, 2026-08-17),
  so the Bo1/speed half is *format-matched* — a 213k-game Bo1 matrix predicts this event better
  than tournament Bo3 data would. Correct for **population and piloting skill only.** Do not also
  correct for Bo1-ness; that double-counts and biases the analysis toward the slow value decks a
  30-minute round punishes. (The earlier "treat as a lower bound, *always*" was written before the
  format was known.)
- **The 30-minute clock is a format-level edge for Ace, independent of preference.** Tempo closes
  inside the round; attrition may not. It cuts against Teach and Big Mom, the two decks the raw EV
  table favours and the two the research notes describe as attrition engines.
- **Engine throughput: ~2–4 games/s single-core, host-dependent.** The 2.80 figure was measured on
  another machine and is not comparable across hosts; only within-run ratios are. Full-strength
  ISMCTS remains ~2 orders of magnitude out of reach. **But throughput has not been the binding
  constraint so far** — policy legality was (see the `orderCards` bug below), and
  `docs/engine-audit.md`'s options A–D are all speed levers that would not have found it.
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
- **Card data is SOLVED for OP15/OP16 via npm — do not re-litigate the acquisition problem.**
  (The egress claim that used to sit here is superseded: see the environment-specific note below.
  On this Mac the direct card sites are reachable; the npm route is still the one the importer
  uses, and it is a mirror of the official Bandai list.)
  `one-piece-card-game-json` publishes the **official Bandai** list (its `image_url`s point
  at `en.onepiece-cardgame.com`), so it is a mirror of the primary source, not an aggregator
  summary. `tools/import_cards.py` pulls it. Validated against the engine's 2,282 hand-checked
  cards: power 100%, life 100%, cost 99.95%, counter 99.58%. `OP16-001` Ace comes back
  matching `docs/research-findings.md` verbatim.
- **`[Trigger]` in card text is two different things, and the importer used to conflate them.**
  As a *heading* it opens the card's own Trigger box; as a *keyword* it names **other** cards'
  Trigger abilities mid-sentence — "trash 1 card with a [Trigger] from your hand", "an Event or
  [Trigger]". `split_trigger()` cut at the first literal match, so on 24 cards the rest of that
  sentence was lost out of `effect` into `trigger`, and where a real Trigger box followed it was
  glued onto the fragment. Fixed 2026-08-17: a heading never follows a word, so
  `TRIGGER_HEADING_RE` in `tools/import_cards.py` requires the match not to be preceded by one.
  Over the whole dataset that accepts every heading (489 en / 491 jp) — including the four
  anchors that are not a full stop: `)`, `]`, the bare `-` blank-ability marker, and a line
  break — and rejects every keyword reference (30 en / 31 jp). **Do not "simplify" it to
  splitting on the last `[Trigger]`**: a real Trigger box can itself contain a keyword reference,
  and six cards are shaped that way (`OP03-037`, `OP03-119`, `EB04-027`, `OP14-112`, `OP14-118`,
  `P-115`). Three cards in the imported sets were affected — `OP16-080` Teach, the Blackbeard
  leader, plus `OP16-115` and `OP16-117`. Regression tests in `tools/test_import_cards.py`.
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
- **Official SC rulings are now in the repo: `data/rulings-sc.json`, 1,358 rulings over 893 cards**
  (61 OP15 cards, 51 OP16 cards, plus 53 core-rules answers under `card_id: "GENERAL"`). Source:
  the Q&A PDFs from <https://www.onepiece-cardgame.cn/rules>, given by Ping 2026-08-17. Rebuild with
  `tools/parse_rulings.py`; read one card with `--card OP16-001`. **These are the specification for
  effect edge cases — consult before encoding any card.** They are also SC-native and *official*,
  which is a stronger source than anything else in this project.
- **`OP16-001` Ace's 8000 threshold binds to BOTH clauses — ruling #961.** A 7000-power Whitebeard
  Pirates Character does **not** gain [Rush] (不能). The English text is ambiguous; the ruling is
  not. Ace grants [Rush] to *8000-or-more* bodies, not to Whitebeard bodies. Do not build the deck
  on the trait alone.
- **"Power N" in card text means EXACTLY N** — rulings #962/#963 on `OP16-002` and `OP16-003`.
  Not ≤N-1, not ≥N+1. Encode as `eq`, not `gte`, unless a ruling says otherwise.
- **SC rulings acquisition is fully automated — no browser needed.** `onepiece-cardgame.cn/rules`
  is a JS SPA whose HTML is an empty shell, but it is backed by a plain JSON API and the PDFs sit
  on an ordinary static host:
  - list: `https://webadmin.windoent.com/op-public/rules/rulesinfo/webList`
  - pdfs: `https://source.windoent.com/OnePiecePc/Pdf/...`

  ```bash
  ./.venv/bin/python tools/parse_rulings.py --check   # exit 1 if anything was republished
  ./.venv/bin/python tools/parse_rulings.py --fetch    # download current PDFs and rebuild
  ```
  `--check` diffs each document's `updateTime` against the `sources` block of the last build. That
  is the hook for catching the **OPC17 QA** when OP17 lands. Track `updateTime` from the API, not
  the date shown on the page — they differ (the booster QA shows 2026-01-30 on the page and
  `2026-05-25` in the API).
- **The API lists seven official SC documents, not the four Ping downloaded.** Four are Q&A tables
  (1,358 rulings); three are prose rulebooks that parse to 0 rulings, correctly:
  - **`综合规则 Ver.1.2.0`** — the **SC Comprehensive Rules**. This is the engine-conformance target
    the charter names, now available SC-native instead of only in EN.
  - **`官方公认赛赛事守则 V1.6.0`** — SC official tournament rules. The authority for format
    questions (no side deck, Bo1, timing) in the region actually being played.
  - `官方规则指导手册 Ver.1.11` — rules guide manual.

  All seven are cached to `data/qa-cache/` (gitignored) by `--fetch`.
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
python3 -m unittest discover -s tools -p 'test_*.py'   # tools/ regression tests
```

`ev_analysis.py` needs numpy; scipy is optional (Nash is skipped without it).
The `tools/` tests are stdlib `unittest`, matching the tools' own stdlib-only constraint.

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
4. **Pick the Tier-3 lever — but the audit's framing needs revising first.** Its four options are
   all throughput levers, and throughput has not been the binding constraint: an unimplemented
   `orderCards` branch was, and it cost 88% of games on modern decks until fixed. Two measured
   corrections stand: the deck-realism multiplier is ~1.79x per game (flat per command, so the
   cost is state transitions rather than effect resolution), which makes Option C optimistic by
   ~3.4x; and the calibration evidence that would trigger Option A/B is **much weaker than it
   looked** — the play/draw gap is 8.5 pts on a real Block 2+ deck, not the 54.5 pts ST01 showed.
   Measure policy *quality* before spending on speed.
5. **Send the `orderCards` fix upstream to `TheCardGoat/tcg-engines`.** MIT, the bug is theirs, the
   fix is ~8 lines and A/B-proven (3/20 → 20/20 games completed). Currently carried locally in
   `tools/patch_engine.py`.

## Open questions only Ping can answer

1. **Target event and date** (店赛 / 标准对战会 / 旗舰赛)? — **the binding unknown.** (Format is
   settled: **Bo1, Swiss + top cut, 30-minute rounds**, Ping 2026-08-17 — he has an event
   announcement in hand, so the date is probably knowable.) The engine cannot contribute to any
   event inside ~6 weeks:
   SC OP17 lands ~2026-08-23, Bandai publishes 2026-08-28, and encoding runs weeks past that. For
   a near event the deliverable is a frozen list plus reps, and the engine builds for the *next*
   format.
2. Acquisition budget ceiling (RMB)
3. Is SC OP17 the same list as JP/EN OP17, or does it carry SC-exclusive content? (The 08-17
   parity confirmation was scoped to banlist and rotation only — this is still open.)
4. SC-native field data — what is actually played locally.

**Answered 2026-08-17: SC matches other regions on banlist and rotation.** Both were open since
day one. Note precisely what this does and does not buy: an identical *legal pool*, not an
identical *metagame*. Shares (Limitless) and the matchup matrix (opdecks.xyz ladder) are both
still EN, so every share-weighted number in `docs/research-findings.md` remains an EN proxy and
the "corrected by SC-native sources" half of the ground-truth decision is unfinished.

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
