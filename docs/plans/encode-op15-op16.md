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
3. **Check `data/rulings-sc.json` before encoding any card. This is mandatory, not advisory.**
   1,358 official Simplified Chinese rulings covering 893 cards — **61 OP15 cards and 51 OP16
   cards**, i.e. the ones in this plan. Rulings are the *specification* for the edge cases the DSL
   has to get right: what a threshold means, which of two simultaneous effects resolves first,
   whether a qualifier binds to one clause or both.
   ```bash
   ./.venv/bin/python tools/parse_rulings.py --card OP16-001
   ```
   Two already found, both of which change an encoding:
   - **`OP16-001` Ace** — "8000 power or more" binds to **both** the Monkey.D.Luffy clause and the
     Whitebeard Pirates clause. A 7000-power Whitebeard Character does **not** gain [Rush]
     (ruling #961: 不能). The English printed text is genuinely ambiguous; the ruling is not.
   - **`OP16-002` / `OP16-003`** — "a Character card with 8000 power" means **exactly 8000**, not
     ≤7000 and not ≥9000 (rulings #962, #963). That is `eq`, not `gte`. Assume this reading for
     every "power N" phrasing unless a ruling says otherwise.
   Rulings under `card_id: "GENERAL"` are core-rules answers (e.g. a Character whose power drops to
   0 or less **stays on the field**) — read them once before starting.
4. **Match the engine's existing shape exactly.** Reference: `OP14-062` Gladius at
   `vendor/tcg-engines/submodules/one-piece/packages/cards/src/cards/OP14EB04/characters/062-gladius.ts`.
   Use the engine's existing DSL primitives. Do not invent new effect verbs; if an effect cannot be
   expressed, report it rather than approximating silently.
5. **Every encoded effect gets a test** that asserts observable game state via `OnePieceTestEngine`,
   following `packages/engine/tests/cards/OP13/004-shanks-op09-004-sp-silver.test.ts`.
   A test that only asserts the card was constructed is not a test.
6. **The engine's own suite must keep passing** after every task. It is a moving baseline —
   2632 before Task 2, 2648 after — so report the exact line rather than matching a number.
7. **Never approximate an effect to make a test pass.** An unencodable effect is a reported
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
and the suite still passes. Report the exact test line rather than an expected number.

## Decisions settled before Task 2 — 2026-08-17

**Test depth: rulings-conformant, scoped.** (Ping delegated this one.) A per-card test asserts the
printed behaviour, **and** where a ruling *constrains the encoding*, asserts the ruling too. It does
not duplicate rulings about timing or interaction that the engine resolves generically — many of the
167 are exactly that. 112 of 238 cards carry rulings.

Chosen over printed-text-only because that is the weaker option in the specific way this project
keeps getting burned: an encoding can be **wrong and green** under printed text alone. It already
would have been, twice — `OP16-001`'s 8000 threshold binds to *both* clauses (ruling #961), and
"a Character card with 8000 power" means *exactly* 8000 (#962/#963). Both read naturally the other
way in English. Roughly 1.5–2x the effort, buying the only defence against the error class that has
actually occurred here.

**Unencodable effects: park, do not extend the DSL yet.** Record the card and the missing primitive,
move on. Revisit once the parked list is complete. A DSL extension cannot be scoped from one card
and can be from thirty, and parking is reversible where a badly-scoped primitive is not.

**Concurrency: one git worktree and branch per batch, never the shared checkout.** Not theoretical —
a concurrent session already wrote into the shared tree mid-task and 486 of its files were swept into
an unrelated commit. A worktree per batch is exactly what prevents that.

**The `orderCards` fix stays local — Ping, 2026-08-17: do not send it upstream.** `tools/patch_engine.py`
is therefore permanent, not a stopgap. It already fails loudly when its anchor text moves, which is
the behaviour that matters now that it must survive upstream drift indefinitely.

## Task 2 — Test harness and reference encodings

- Establish `cards/tests/OP15|OP16/` in this repo, grafted to
  `packages/engine/tests/cards/OP15|OP16/`. Extend the graft step to carry tests.
- Hand-encode these **five**, each with passing tests. They become the reference every later task
  copies, so they are chosen to span both the trigger families and the card types, and **all five
  carry SC rulings** so the reference set *demonstrates* the rulings workflow rather than describing
  it:

  | Card | Type | Family | Why this one |
  |---|---|---|---|
  | `OP16-001` Portgas.D.Ace | leader | `activateMain` | The primary archetype's leader, and ruling #961 is the canonical "printed text reads the other way" case |
  | `OP16-002` Izo | character | `onPlay` + optional cost | Ruling #962: "8000 power" is `eq`, not `gte` — the encoding hinges on it |
  | `OP16-014` Marco | character | replacement / `onKo` | Replacement effects are among the harder shapes; Whitebeard |
  | `OP16-029` Antlerkov | character | `whenAttacking` | Condition on a *named* other card |
  | `OP16-057` Captain Buggy's Our Saviour | event | `counter` | The only family with no Character example; conditional counter |
- Write `cards/ENCODING.md`: the five worked examples, the DSL primitives used, and the mapping
  table above.

**Verify:** the pre-existing suite plus the new tests all pass. Report the exact line.

## Verification every batch runs on itself — added 2026-08-17

Two problems surfaced running Task 2 that would have made Tasks 3–18 unaffordable. Both are solved;
neither needs deciding again.

**Vacuous tests. `python3 tools/mutation_check.py --set OP16` is now part of a batch's own
verification, not an optional extra.** Task 2 shipped *three* assertions that could not fail — a
test with the right name, the right comment, and no power to detect the defect it claimed to cover.
All three were caught by hand, by reverting the encoding and watching for a red test, which does not
scale to 220 cards. The tool perturbs the decision surface — filters, thresholds, zones,
once-per-turn — reruns only that card's tests, and requires them to go red. A surviving mutant is a
test that cannot fail. It exits 1, so a batch cannot report green over one.

It pays for itself immediately: run against the five reviewed reference cards it found **three more
gaps on `OP16-001` Ace** that two review rounds had missed. Nothing asserted that the [Rush] grant
is *restricted* to the two clauses at all — an encoding granting [Rush] to any 8000-power Character
would have passed every test in the file. Now every mutant dies.

That count moved once already for a reason worth knowing: the first version of the tool
reported 24/24 while silently skipping inline `filters: [{ ... }]` objects, which is the shape
both decisive name filters use. Fixed, it finds 27 and kills all of them. **Quote the tool's
output, not a remembered number** — a mutation count is a property of the tool, not the cards.

Budget ~40 s per card, so a 15-card batch costs ~10 minutes.

**Parallelism. Give each batch its own engine with `cp -Rc`.** `vendor/` is 766 MB and shared, so two
agents grafting different card sets into one engine overwrite each other. APFS copy-on-write makes a
private clone cost **~8 seconds and almost no disk** until written:

```bash
cp -Rc vendor/tcg-engines "$WORKTREE/vendor/tcg-engines"     # ~8s, blocks shared until modified
python3 tools/mutation_check.py --set OP16 --engine "$WORKTREE/vendor/.../packages/engine"
```

Verified: a clone runs the OP16 suite clean. So the batch rule is a **git worktree *and* an engine
clone per batch** — no shared mutable state at all.

## Tasks 3–18 — Encode effects in batches

Each task: encode every effect in its batch, one test per card, all passing. Batches are grouped so
one agent sees mechanically related cards.

**Batches are now colour-grouped, and the exact card lists are settled** (below). Colour is the right
axis because an archetype's cards interact with each other — one agent holding a whole colour sees the
"if you have [Name]" pairs and the shared trait filters, which is where the mis-encodings cluster.

Counts exclude the 5 Task-2 reference cards and the 15 genuinely vanilla Characters
(OP15: 6, OP16: 9 — no printed effect at all, nothing to encode).

| Task | Batch | Cards | Status |
|---|---|---|---|
| 3 | OP15 leaders | 6 (5 encoded, `OP15-058` fully parked) | **done** — see Task 4's combined gate |
| 4 | OP15 events + stage | 20 | **done** — 94 tests (OP15 total), 74/74 mutants killed |
| 11 + 12 | OP16 leaders (5) + stages (2) + events (15) | 22 | **done** — 20 encoded, 5 clauses parked |
| 13 | OP16 yellow characters | 13 | **done** — 2 clauses parked; 9 are the B/Y Teach list |
| 14 | OP16 black characters | 17 | **done** — nothing parked |
| 15 | OP16 red characters | 14 | dispatched — `003 005 006 007 008 009 010 011 012 013 015 017 018 118` |
| 16 | OP16 green characters | 12 | **done** — 1 clause parked (OP16-034); full sweep 185/185 + 17 hand mutants |
| 17 | OP16 blue characters | 14 | **done** — nothing parked; full sweep 189/189 mutants |
| 18 | OP16 purple characters | 13 | **done** — nothing parked; 56 hand mutants (7 of 13 cards are invisible to the tool) |
| 5 | OP15 red characters | 15 | `003 004 005 006 007 008 009 010 011 012 013 014 015 017 018` |
| 6 | OP15 green characters | 13 | `023 024 025 026 027 028 029 031 032 033 034 035 036` |
| 7 | OP15 blue characters | 13 | `040 041 042 043 044 045 046 047 048 050 051 052 053` |
| 8 | OP15 purple characters | 15 | `059 060 061 063 064 065 066 067 068 069 070 071 072 073 118` |
| 9 | OP15 black characters | 15 | `079 080 081 082 083 084 085 086 087 088 090 091 092 093 094` |
| 10 | OP15 yellow characters | 16 | `099 100 101 102 103 104 105 106 108 109 110 111 112 113 114 119` |

**Round order — OP16 before OP15, decided 2026-08-18.** The plan numbers OP15's characters first
(Tasks 5–10), but they are deferred behind OP16's. Completing OP16 completes the set the critical path
actually needs — `OP16-001` Ace's own archetype and the B/Y `OP16-080` Teach reference list — whereas
OP15's 87 characters are opponents that cannot be fielded until their own set is done either way.
Nothing depends on OP15 first; the task numbering is not a dependency order.

**How a batch is dispatched.** One agent per batch, several agents at a time, each in its own git
worktree with its own copy-on-write engine clone — `./scripts/new_encode_worktree.sh <batch-name>`
creates both and proves the clone grafts. The standing instructions are
`docs/plans/BATCH-AGENT-BRIEF.md`; a dispatch adds only the workspace paths, the card list, the
priority order within the batch, and any card-specific warnings. Agents commit to their own branch and
never merge — branches are collected centrally, which is safe because the batches are disjoint file
sets. **Agents must not edit `cards/ENCODING.md`**: every batch would conflict on it, so they report
findings and those are consolidated centrally.

**How a batch is collected.** Do not trust the agent's report on its own — the whole reason
`mutation_check.py` exists is that this project's most frequent defect is a check that looks like it
passed. Re-run the gate centrally:

```bash
git merge --no-ff claude/encode-<batch>          # disjoint files, so conflicts should be none
./.venv/bin/python tools/graft_cards.py
cd vendor/.../packages/engine && ./node_modules/.bin/vp test run     # whole suite
./node_modules/.bin/vp check && (cd ../cards && ./node_modules/.bin/vp check)
# then, and only once nothing else is running against this clone:
./.venv/bin/python tools/mutation_check.py --set OP16 --engine <path> > /tmp/mut.txt 2>&1; echo "EXIT=$?"
```

A conflict here means the batches were not disjoint after all — stop and work out why rather than
resolving it, because overlapping batches mean two agents encoded the same card differently.

Consolidate each agent's reported findings into `cards/ENCODING.md` and its parked clauses into the
parked table, then delete the worktree (`git worktree remove <path>`).

**Priority within the batches:** `OP16-001` Ace and the B/Y Teach reference list (§7 of
`docs/research-findings.md`) are the cards that unblock the first real experiment. Task 11 and
Task 13 should take them first.

**Per-task verification:** every new test passes, the pre-existing suite still passes, `vp check`
is clean, and **`tools/mutation_check.py` reports every mutant killed for the batch's cards**. A
batch with a surviving mutant is not done — the survivor names a test that cannot fail. Any effect that cannot be expressed in the existing DSL is reported as a finding with the
card ID and the specific missing primitive — never approximated.

## Definition of done

- 238 cards in `cards/`, 223 with `effects` blocks and per-card tests
- `./scripts/bootstrap.sh` from a clean clone produces a working engine with OP15/OP16 registered
- `python3 tools/coverage_report.py` reports 0 gaps across OP15/OP16
- A list of any effects the DSL could not express

## Overnight run — 2026-08-18, unattended

Ping is asleep; work continues unattended until 08:00. The loop is:

1. Wait for a batch agent to report (round 2: OP16 red / green / blue / purple).
2. `git merge --no-ff claude/encode-<batch>` — conflicts should be impossible, since batches are
   disjoint file sets. A conflict means they were not, and is a **stop-and-diagnose**, not a resolve.
3. Re-graft, run the full suite and both `vp check`s. Fix formatting round-trips back into `cards/`.
4. Bank the batch's reported lessons into `cards/ENCODING.md` and its parked clauses into
   `data/parked-clauses.json`. Agents never edit those two files, so this is the only path in.
5. When all four are merged, **one** isolated `mutation_check.py --set OP16` run — never concurrent
   with anything else touching that clone, and never piped to `tail` when reading the exit code.
6. Then dispatch round 3, the six OP15 character batches, the same way.

**Boundaries held while unattended.** Everything stays local: commits on `claude/tasks-3-18-78c831`
only. **No push, no PR, no remote of any kind**, and nothing outside this worktree and the batch
worktrees. Agent branches are merged but never deleted until their work is verified in the merge.
No engine primitives are built — the parked-don't-extend decision stands and is not mine to reverse
overnight.

**What gets escalated rather than worked around**, i.e. left for the morning with the work stopped at
a clean commit: a merge conflict, a suite regression that is not a formatting round-trip, a surviving
mutant that hand-mutation confirms is real, or any card whose printed text contradicts its ruling in a
way not already covered in `cards/ENCODING.md`.
