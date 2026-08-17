# Project Charter

**Owner:** Ping Han · **Format:** One Piece Card Game, Simplified Chinese (简中) · **Established:** 2026-08-16

## Goal

Determine and field the highest-EV deck in the SC format, continuously, across set rotations.

- **Phase 1** — current SC OP16 format. Research-driven, no engine. Deadline: SC OP17 release (~2026-08-23).
- **Phase 2** — build the engine + search AI as reusable infrastructure; warm up for OP17 and every set after.

## Decisions locked

| Branch | Decision |
|---|---|
| Deliverable | Empirical meta research + full rules engine + reusable tooling |
| Target format | SC; current-format updates and next-format warm-ups, in sequence |
| Meta ground truth | Limitless EN/JP as statistical backbone, corrected by SC-native sources |
| Sim fidelity | Tier 3 requested; **audit shows it is ~100x out of reach on this engine**. Lever undecided — see audit options A-D |
| Engine base | **Fork `TheCardGoat/tcg-engines` (MIT)** — audit complete. MOOgiwara rejected (AGPL, 30% MVP) |
| Effect encoding | Adopt the engine's existing compositional DSL; LLM-author the gaps with generated tests |
| Persistence & compute | This repo; heavy self-play on user hardware |
| Match format | **Bo1, Swiss + top cut, 30-min rounds** (Ping, 2026-08-17). No side deck — Constructed locks the deck all event |
| Objective function | Field-weighted expected match win rate vs the real SC field, split by play/draw |
| Role of that objective | **Diagnostic, not selective** (2026-08-17). It forecasts the field and arms a tripwire; it does not choose the archetype. Tripwire is qualitative: structural deficiency is decisional, a points gap is not. See `CLAUDE.md`. |
| Validation | Per-card assertion tests → Comprehensive Rules conformance → meta calibration |
| Deck constraints | No preference constraints; budget cap on acquisition (ceiling TBD) |

## Format context

**Rotation is live since 2026-04-01.** Standard is Block 2+ only. Block 1 (OP01–OP04, ST01–ST09) is dead.
Blocks: 1 = OP01–04, 2 = OP05–08, 3 = OP09–12.

Banned: Gecko Moria (OP06-086), Jinbe (OP07-045), Kingdom Come (EB01-059), Ice Age (OP02-117).
**SC confirmed identical to other regions on banlist and rotation — Ping, 2026-08-17.**

**EN OP16 field (Limitless):** B/Y Nami 23.5% · G/B Luffy 22.9% · P Enel 22.7% · then a cliff to
P/Y Rosinante 9.9%. Top three ≈ 69% of the field.

## What the simulator is for — Ping, 2026-08-17

**Find weak points in the meta and raise this deck's win rate against them.** The archetype is
fixed; the flex slots are the decision variable, and they move as the meta moves. Worked example:
1–2 `OP17-016` Rakuyo against an aggro field.

Consequence: the unit of analysis is a **card slot**, not a deck. A leader-vs-leader matchup matrix
cannot answer it — two lists differing by two cards are one row in that matrix. Card-granular
simulation is required, so encoding OP15/16/17 into the engine is the critical path.

## Known blockers

- ~~`onepiece-cardgame.cn` is robots-blocked~~ — **wrong, corrected 2026-08-17.** It serves no
  robots.txt and returns 200. It is a JavaScript SPA, so a plain fetch gets an empty shell; it
  needs a rendering browser or its underlying JSON API.
- Egress blocks are **environment-specific**. On Ping's Mac, Limitless, `en.onepiece-cardgame.com`
  and `onepiece-cardgame.cn` are all reachable; only `optcgapi.com` times out. Limitless permits
  automated fetch (`robots.txt` is `Disallow:` with an empty value).
- Limitless `/decks/matchups` returned HTTP 500 on first attempt; retry needed for calibration data.

## Resolved

- ~~Push access~~ — **resolved 2026-08-16.** The cause was not the credential proxy: the Claude
  GitHub App was not installed on the account. OAuth authorization alone is not sufficient.
  Installing it at `github.com/apps/claude/installations/new` fixed push and the API.
- ~~OP15–OP17 card data~~ — **resolved for OP15/OP16, 2026-08-16.** Every direct card source is
  egress-blocked, but the npm registry is not, and `one-piece-card-game-json` mirrors the
  official Bandai list. See `tools/import_cards.py` and the README. OP17 is not yet published
  by Bandai, so it is pending a date, not pending a method.

## Match format: Bo1, Swiss + top cut, 30-minute rounds

标准赛制 · 1V1 · 一局定胜负 (BO1) · 瑞士轮 + 淘汰赛机制 · 每局 30 分钟.
Ping, 2026-08-17, from the event announcement. **This supersedes a Bo3 note recorded earlier the
same day.** The 30-minute clock is the part that matters most, and it was not previously known.

**1. Swiss validates the objective function.** Swiss pairs you against a roughly random sample of
the field over N rounds. That is *literally* what `tools/ev_analysis.py` computes — field-weighted
expected win rate. The objective function was chosen before the format was known and happens to be
exactly right for it. Single-elimination would have argued for a different target (beat the
specific decks that top-cut); Swiss does not.

**2. The 30-minute clock is a structural bias toward tempo, and it favours Ace.** A deck that wins
slowly can fail to close inside the round. This is a real, format-level edge for the archetype
already chosen on preference — and unlike preference, it is not a matter of taste. It cuts directly
against the decks the raw EV table favours: **Teach and Big Mom are attrition decks**, and Big Mom
is explicitly a "life-cycling attrition engine … wins by attrition" (§5). Attrition plans are the
ones a clock punishes.

**3. Bo1 raises variance, so EV margin matters more than EV rank.** One game decides each round;
there is no second game to correct a bad draw or a bad play/draw assignment. A 51% deck and a 55%
deck are much closer in outcome over 5–7 Bo1 rounds than the numbers suggest. Consistency across
the field beats a spiky edge against part of it.

**4. It does not change the tech-slot maths.** No side deck in Constructed regardless, so
`ΔEV(c) = Σ share × ΔWR` is untouched. Bo1 vs Bo3 was never the variable there.

### Why `ΔWR` is taken on game rates, and when that would be wrong

Raised in review on PR #3 against the superseded Bo3 draft: a simulator emits a per-game win
probability `p`, and under Bo3 the match rate is `3p² − 2p³`, so a constant game-rate delta does
not map to a constant match-rate delta. The formula is right, and this is worth writing down
because **it would have been a real defect had the format stayed Bo3.**

What decides it is *where* the non-linearity sits.

- **Per-matchup transforms can reorder candidates.** Under Bo3 you convert each matchup's `p`
  before the weighted sum, and the slope `6p(1−p)` varies across matchups — 1.50 at `p=0.50`
  against 0.96 at `p=0.80`. A card swinging a coinflip matchup by 5 points would be worth
  materially more than one swinging a lopsided matchup by 5 points, and summing raw game-rate
  deltas would rank them equal. That is a genuine reordering.
- **Aggregate monotone transforms cannot reorder.** They rescale.

**Under Bo1 the per-matchup transform is the identity** — match win rate *is* game win rate — so
`ΔWR` on game rates is exactly right, and no conversion belongs in the pipeline. Adding one would
distort the result rather than improve it.

The only non-linearity left is aggregate: with Swiss + top cut, what you actually want is
`P(make the cut)`, a binomial in your overall match win rate `p̄`. Over 5 rounds cutting at 4+ wins:

| `p̄` → `p̄+0.05` | `P(cut)` | gain | amplification |
|---|---|---|---|
| 0.35 → 0.40 | 0.054 → 0.087 | +3.3 pts | 0.66× |
| 0.50 → 0.55 | 0.188 → 0.256 | +6.9 pts | 1.37× |
| 0.60 → 0.65 | 0.337 → 0.428 | +9.2 pts | 1.83× |

**This does not change which tech card wins.** Every candidate shifts the same `p̄` from the same
baseline through the same monotone function, so the ordering by `Σ share × ΔWR` is preserved. What
it changes is what an edge is *worth*: a point of match win rate buys nearly **3× more** top-cut
probability to a 60% deck than to a 35% deck. Use it to judge whether a marginal slot is worth
chasing — never to re-rank the slots.

### The ladder-bias correction must be reduced, not applied

`§1` of `docs/research-findings.md` discounts the matchup matrix because it comes from ranked
ladder: *"ladder is Bo1, rewards speed"*, therefore value and control decks are understated and
should be treated as a lower bound.

**Half of that justification just became an argument for trusting the data.** The target event is
Bo1 with a 30-minute clock — the same conditions that produce the ladder's speed bias. A matrix
built from 213,084 **Bo1** games is *format-matched* to this event in a way tournament Bo3 data
would not be.

What survives of the seam is **population**, not format: ladder players are not the tournament
field, and median ladder piloting differs from event piloting. Correct for that. **Do not** also
correct for Bo1-ness — for this event that is signal, not noise. Applying both corrections
double-counts and would push the analysis toward exactly the slow value decks a 30-minute Bo1
round punishes.

## Legal-pool parity with EN/JP — confirmed 2026-08-17

Ping: **SC matches the other regions on banlist and rotation.** So the four bans and Block 2+ apply
unchanged, and EN/JP card-legality data transfers to SC directly.

**This does not make the metagames identical, and the distinction is load-bearing.** An identical
legal pool constrains what *can* be played; it does not determine what *is* played. Release timing,
player base and local preference all move field composition. Both of our data sources are still EN —
shares from Limitless, the matchup matrix from an EN ladder — so the "corrected by SC-native
sources" half of the ground-truth decision is **still outstanding**, and the covered-field and
share-weighted EV numbers remain EN proxies. Parity closes the legality question, not the field one.

**Partially closed 2026-08-17: SC-native *rules* are now sourced, SC-native *field data* is not.**
Ping supplied the official SC Q&A PDFs, parsed to `data/rulings-sc.json` — 1,358 rulings, official
and SC-native, the strongest source in the project. That serves the engine-conformance validation
layer and card-effect encoding. It says nothing about what decks people bring to a 店赛 in China,
which is the gap that still matters for share-weighting.

## Open inputs needed

1. ~~Target event and date~~ — **answered 2026-08-17: there is no event yet.** Format is settled
   (**Bo1, Swiss + top cut, 30-minute rounds**), only the occasion is not. This *removes the
   deadline*, which changes the calculus rather than lowering the stakes: the engine track is now
   worth building properly instead of racing a date, and there is no reason to freeze a list.
2. Acquisition budget ceiling (RMB)
3. Is SC OP17 the same list as JP/EN OP17, or does it carry SC-exclusive content? *(the 08-17
   confirmation was scoped to banlist and rotation, so this is still open)*
4. SC-native field data — anything on what people actually play locally

~~Does SC Standard run the same Block 2+ rotation?~~ — **yes**, 2026-08-17.
~~Is the SC banlist identical?~~ — **yes**, 2026-08-17.

## References

- [**SC official rules & Q&A**](https://www.onepiece-cardgame.cn/rules) — where SC rule and ruling
  updates land (Ping, 2026-08-17). The page is a JS SPA, but it is backed by a JSON API
  (`webadmin.windoent.com/op-public/rules/rulesinfo/webList`) and the PDFs are on a static host, so
  acquisition is automated: `tools/parse_rulings.py --check` / `--fetch`. Seven official documents,
  four of them Q&A tables → `data/rulings-sc.json`.
- **SC Comprehensive Rules `综合规则 Ver.1.2.0`** — via the API above. **This supersedes the EN PDF
  below as the engine-conformance target**, being both official and SC-native.
- **SC tournament rules `官方公认赛赛事守则 V1.6.0`** — via the API above. The regional authority for
  format questions; the no-side-deck rule was originally verified against the EN manual.
- [Comprehensive Rules PDF (EN)](https://asia-en.onepiece-cardgame.com/pdf/rule_comprehensive.pdf) — the EN equivalent, kept for cross-checking
- [Limitless One Piece](https://onepiece.limitlesstcg.com/) — tournament data backbone
- [tcg-engines](https://github.com/TheCardGoat/tcg-engines) — forked engine base
- [vegapull-records](https://github.com/Coko7/vegapull-records) — card data (stale: EN cut Apr 2025)
