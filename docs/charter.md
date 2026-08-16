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
| Objective function | Field-weighted expected match win rate vs the real SC field, split by play/draw |
| Role of that objective | **Diagnostic, not selective** (2026-08-17). It forecasts the field and arms a tripwire; it does not choose the archetype. Tripwire is qualitative: structural deficiency is decisional, a points gap is not. See `CLAUDE.md`. |
| Validation | Per-card assertion tests → Comprehensive Rules conformance → meta calibration |
| Deck constraints | No preference constraints; budget cap on acquisition (ceiling TBD) |

## Format context

**Rotation is live since 2026-04-01.** Standard is Block 2+ only. Block 1 (OP01–OP04, ST01–ST09) is dead.
Blocks: 1 = OP01–04, 2 = OP05–08, 3 = OP09–12.

Banned: Gecko Moria (OP06-086), Jinbe (OP07-045), Kingdom Come (EB01-059), Ice Age (OP02-117).
*SC-specific confirmation pending.*

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

## Open inputs needed

1. Acquisition budget ceiling (RMB)
2. Does SC Standard currently run the same Block 2+ rotation?
3. Is the SC banlist identical to the four cards above?
4. Is SC OP17 the same list as JP/EN OP17, or does it carry SC-exclusive content?
5. Target event and date (店赛 / 标准对战会 / 旗舰赛), and whether it is Bo1 or Bo3

## References

- [Comprehensive Rules PDF](https://asia-en.onepiece-cardgame.com/pdf/rule_comprehensive.pdf) — engine conformance target
- [Limitless One Piece](https://onepiece.limitlesstcg.com/) — tournament data backbone
- [tcg-engines](https://github.com/TheCardGoat/tcg-engines) — forked engine base
- [vegapull-records](https://github.com/Coko7/vegapull-records) — card data (stale: EN cut Apr 2025)
