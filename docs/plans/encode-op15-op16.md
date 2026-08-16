# Plan — Encode OP15 + OP16 into the engine DSL

**Owner:** Ping Han · **Created:** 2026-08-17 · **Scope decided by Ping:** all of OP15 + OP16

## Why

`tools/ev_analysis.py` answers "which leader is best." Ping's actual question is **"which 1–2 cards
raise my win rate against the field I will face"** — marginal EV per *slot*. A leader-vs-leader
matchup matrix cannot express that: two 50-card lists differing by two cards are the same row.
Answering it needs card-granular simulation, which needs OP15/OP16 in the engine. The engine has
OP01–OP14, EB01–04, PRB01–02, ST01, DON and **nothing newer**.

## Where the output lives — reverses a charter decision

The charter locked *"Fork `TheCardGoat/tcg-engines`"*. **Ping reversed this on 2026-08-17:** card
definitions live in **this** repo under `cards/`, and a graft step copies them into the vendored
engine at bootstrap. No fork is created.

Rationale for the reversal is sound: OP15 and OP16 are **entirely new directories** upstream does
not have, so the only upstream file we touch is `packages/cards/src/cards/index.ts` — a handful of
idempotent `export *` lines. One repo, one review surface, no fork to maintain against an upstream
whose real development happens privately and lands in weekly bulk syncs (last public sync
2026-07-20, four weeks stale).

## Global Constraints

1. **`cards/` in this repo is the single source of truth.** `vendor/` is gitignored and destroyed
   by re-bootstrap. **Never edit a grafted copy under `vendor/`** — edit `cards/`, re-graft.
2. **Author from the imported JSON only** (`data/cards-OP15-en.json`, `data/cards-OP16-en.json`),
   which mirrors the official Bandai list. Never from an aggregator. If printed text looks wrong,
   check `onepiece.limitlesstcg.com/cards/<ID>` — its `robots.txt` permits fetch.
   *(The variant/base-text hazard in `CLAUDE.md` does not apply here: this dataset has **0**
   alternate-art printings. Verified.)*
3. **Match the engine's existing shape exactly.** Reference: `OP14-062` Gladius at
   `vendor/tcg-engines/submodules/one-piece/packages/cards/src/cards/OP14EB04/characters/062-gladius.ts`.
   Use the engine's existing DSL primitives. Do not invent new effect verbs; if an effect cannot be
   expressed, report it rather than approximating silently.
4. **Every encoded effect gets a test** that asserts observable game state via `OnePieceTestEngine`,
   following `packages/engine/tests/cards/OP13/004-shanks-op09-004-sp-silver.test.ts`.
   A test that only asserts the card was constructed is not a test.
5. **The engine's own 2631 tests must keep passing** after every task.
6. **Never approximate an effect to make a test pass.** An unencodable effect is a reported
   finding, not a silent simplification.

## Data

238 cards, 223 with printed effects, 0 alternate arts.

| Set | leader | character | event | stage | total | with effect |
|---|---|---|---|---|---|---|
| OP15 | 6 | 93 | 19 | 1 | 119 | 113 |
| OP16 | 6 | 95 | 16 | 2 | 119 | 110 |

Rarities present: `C UC R SR SEC L` — all valid `OPRarity`.
Attributes present: `Strike Slash Ranged Wisdom Special` and `""` (omit the field when empty).

**JSON → engine field mapping** (note the renames):

| JSON | engine | note |
|---|---|---|
| `colors` | `color` | **renamed**, stays an array |
| `attribute: "Special"` | `attribute: "special"` | **lowercased**; `""` → omit |
| `counter: null` / `cost: null` | omit the key | leaders have no cost |
| `effect` | `effect` **and** `i18n.en.effect` | duplicated by design |
| `imageUrl` | `printings[0].imageUrl` **and** `i18n.en.imageUrl` | |
| — | `canonicalId` | equals `id` (no variants in this set) |
| — | `slug` | `<kebab-name>/<lowercase-id>` |
| — | `setId` | `"OP15"` / `"OP16"` |

Export symbol pattern, from the Gladius reference: `op14eb04Gladius062` = lowercased set + PascalCase
name + collector number → here `op16PortgasDAce001`.

---

## Task 1 — Generator, graft step, bootstrap integration

Build the mechanical pipeline. **No effect encoding in this task.**

- `tools/gen_card_defs.py` — reads the two JSON files, writes into `cards/OP15/` and `cards/OP16/`:
  - `<type>/<NNN>-<slug>.ts` — every mechanical field plus the `effect` **text**, and **no
    `effects` block**
  - `<type>/<NNN>-<slug>.i18n.ts`
  - `<type>/index.ts` re-exporting the set/type's cards
  - Idempotent: re-running overwrites cleanly and never duplicates an export.
  - **Must not overwrite an existing `effects` block** — later tasks add those by hand, and the
    generator will be re-run. Preserve hand-authored `effects` on regeneration, or refuse to
    overwrite a file that has one. State which approach you chose.
- `tools/graft_cards.py` (or `.sh`) — copies `cards/OP15`, `cards/OP16` into
  `vendor/.../packages/cards/src/cards/`, and **idempotently** appends the six
  `export * from "./OP15/leaders/index.ts";`-style lines to that package's `cards/index.ts`.
  Re-running must be a no-op.
- Wire graft into `scripts/bootstrap.sh` after `pnpm install`, before the test run.

**Verify:** `./scripts/bootstrap.sh` completes, the engine typechecks with 238 new cards present,
and the suite still reports **2631 passed**. Report the exact test line.

## Task 2 — Test harness and reference encodings

- Establish `cards/tests/OP15|OP16/` in this repo, grafted to
  `packages/engine/tests/cards/OP15|OP16/`. Extend the graft step to carry tests.
- Hand-encode **five** cards chosen to span distinct trigger families — at minimum `onPlay`,
  `activateMain`, `onKo`, an attack-triggered effect, and a `counter` event — each with a passing
  test. These become the reference set every later task copies.
- Write `cards/ENCODING.md`: the five worked examples, the DSL primitives used, and the mapping
  table above.

**Verify:** 2631 + 5 tests passing. Report the exact line.

## Tasks 3–18 — Encode effects in batches

Each task: encode every effect in its batch, one test per card, all passing. Batches are grouped so
one agent sees mechanically related cards.

| Task | Batch | Cards |
|---|---|---|
| 3 | OP15 leaders | 6 |
| 4 | OP15 events + stage | 20 |
| 5–10 | OP15 characters, 6 batches | ~87 |
| 11 | OP16 leaders | 6 |
| 12 | OP16 events + stages | 18 |
| 13–18 | OP16 characters, 6 batches | ~86 |

**Priority within the batches:** `OP16-001` Ace and the B/Y Teach reference list (§7 of
`docs/research-findings.md`) are the cards that unblock the first real experiment. Task 11 and
Task 13 should take them first.

**Per-task verification:** every new test passes and the pre-existing 2631 still pass. Report
counts. Any effect that cannot be expressed in the existing DSL is reported as a finding with the
card ID and the specific missing primitive — never approximated.

## Definition of done

- 238 cards in `cards/`, 223 with `effects` blocks and per-card tests
- `./scripts/bootstrap.sh` from a clean clone produces a working engine with OP15/OP16 registered
- `python3 tools/coverage_report.py` reports 0 gaps across OP15/OP16
- A list of any effects the DSL could not express
