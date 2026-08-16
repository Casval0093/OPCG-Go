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
| Validation | Per-card assertion tests → Comprehensive Rules conformance → meta calibration |
| Deck constraints | No preference constraints; budget cap on acquisition (ceiling TBD) |

## Format context

**Rotation is live since 2026-04-01.** Standard is Block 2+ only. Block 1 (OP01–OP04, ST01–ST09) is dead.
Blocks: 1 = OP01–04, 2 = OP05–08, 3 = OP09–12.

Banned: Gecko Moria (OP06-086), Jinbe (OP07-045), Kingdom Come (EB01-059), Ice Age (OP02-117).
*SC-specific confirmation pending.*

**EN OP16 field (Limitless):** B/Y Nami 23.5% · G/B Luffy 22.9% · P Enel 22.7% · then a cliff to
P/Y Rosinante 9.9%. Top three ≈ 69% of the field.

## Known blockers

- `onepiece-cardgame.cn` (official SC) is robots-blocked to automated fetch. SC-official banlist,
  card DB and schedule must come from mirrors, community sources, or Ping directly.
- Limitless `/decks/matchups` returned HTTP 500 on first attempt; retry needed for calibration data.

## Open inputs needed

1. Authorize `Casval0093/OPCG-Go` in the session's git sources — cloning works, pushing is blocked by the credential proxy. No PAT needed.
2. Acquisition budget ceiling (RMB)
3. Does SC Standard currently run the same Block 2+ rotation?
4. Is the SC banlist identical to the four cards above?
5. Is SC OP17 the same list as JP/EN OP17, or does it carry SC-exclusive content?
6. Target event and date (店赛 / 标准对战会 / 旗舰赛), and whether it is Bo1 or Bo3

## References

- [Comprehensive Rules PDF](https://asia-en.onepiece-cardgame.com/pdf/rule_comprehensive.pdf) — engine conformance target
- [Limitless One Piece](https://onepiece.limitlesstcg.com/) — tournament data backbone
- [tcg-engines](https://github.com/TheCardGoat/tcg-engines) — forked engine base
- [vegapull-records](https://github.com/Coko7/vegapull-records) — card data (stale: EN cut Apr 2025)
