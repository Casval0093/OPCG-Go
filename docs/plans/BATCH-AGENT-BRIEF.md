# Batch agent brief — encoding OP15/OP16 card effects

Read this whole file before touching anything. It is the standing brief for one encoding batch; your
dispatch message gives you the workspace paths and your card list.

## Your workspace is isolated — keep it that way

You have your own git worktree and your own engine clone. Both exist because sharing either one has
already gone wrong on this project (`docs/plans/encode-op15-op16.md`): a concurrent session wrote into
the shared checkout and 486 of its files were swept into an unrelated commit, and two agents grafting
different card sets into one 766 MB engine overwrite each other.

- Work **only** inside the worktree path you were given. Never `cd` into another worktree, and never
  touch the repo root at `/Users/otbismarck/Documents/AI projects/OPCG-Go`.
- `cards/OP15` and `cards/OP16` in **your worktree** are the source of truth. `vendor/` is gitignored
  and disposable. **Never hand-edit a file under `vendor/`** — edit `cards/`, then re-graft.
- Commit to your own branch. Do not merge, rebase, or push.

## Read these first, in this order

1. **`cards/ENCODING.md`** — the accumulated reference. It contains five fully worked examples, the
   prompt-intent table, the harness gotchas, and the list of already-parked DSL gaps. Most of the ways
   this task goes wrong are already written down there. Do not skip it.
2. **`docs/plans/encode-op15-op16.md`** — the plan, especially "Global Constraints".
3. `cards/OP15/leaders/*.ts` and `cards/OP16/leaders/001-portgas-d-ace.ts` plus their tests in
   `cards/tests/` — real, reviewed examples of the output shape you are producing.

## For every card in your list

1. **Read the printed `effect` string in the generated `.ts` file.** Never an aggregator summary. If
   the text looks wrong, check `onepiece.limitlesstcg.com/cards/<ID>` (its `robots.txt` permits fetch).
2. **Check the rulings. This is mandatory, not advisory.**
   ```bash
   ./.venv/bin/python tools/parse_rulings.py --card OP16-104
   ```
   Read **past the Q&A to the quoted Simplified Chinese card text** at the head of each entry. The SC
   text is the specification and is often unambiguous where the English is not; the Q&A only pins the
   one boundary someone asked about. Skim `--card GENERAL` once for the core-rules answers.
   Rulings that **constrain the encoding** get asserted in the test. Rulings about timing or
   interaction the engine resolves generically do not — but be careful with that line: a ruling that
   looks generic is sometimes exposing a zone or filter scoped wrongly on this specific card.
3. **Find the closest existing encoded card before writing anything by hand.** Grep the whole vendored
   engine, not just recent sets — the closest analogue is often in an older one:
   ```bash
   grep -rln 'trigger: "onKo"' vendor/tcg-engines/submodules/one-piece/packages/cards/src/cards
   ```
4. **Never invent a DSL verb.** The whole vocabulary is
   `vendor/tcg-engines/submodules/one-piece/packages/types/src/effect/{action,condition,cost,target,primitives}.ts`.
5. **Write one test per card** in `cards/tests/OP15|OP16/<NNN>-<slug>.test.ts`, asserting observable
   game state through `OnePieceTestEngine`. A test that only checks the card was constructed is not a
   test. Aim each assertion at something that would **change if a filter, threshold, zone, or
   once-per-turn flag were wrong** — that is exactly what the mutation checker will probe.

## If an effect will not fit the DSL: park it, do not approximate

This is a settled decision, not a judgement call. Record the card ID and the **specific missing
primitive**, and move on. Never widen, narrow, or re-shape an effect to make a test pass.

- If **some** clauses of a card are encodable, encode those and add an inline `// PARKED --` comment
  above the `effects` block explaining precisely what is not encoded and why.
- If **no** clause is encodable, leave the card with **no `effects` block at all** and report it.
  Do not add an empty one. Note that such a card cannot document itself — `gen_card_defs.py` only
  preserves files that already have an `effects:` block, so its inline comment would be overwritten.
- Check the parked table in `cards/ENCODING.md` first: several gaps are already known (an attached-DON!!
  target filter, a `loseGame` action, a turn-number condition, an "activated an Event this turn"
  condition). If you hit one of those, say so by name rather than re-deriving it.

## Verification gate — all five, every time

Run from your own worktree and your own engine clone.

```bash
# 1. graft your cards + tests into YOUR engine clone
./.venv/bin/python tools/graft_cards.py

cd vendor/tcg-engines/submodules/one-piece/packages/engine
# 2. your batch's tests
./node_modules/.bin/vp test run tests/cards/OP16/
# 3. the whole pre-existing suite -- no regressions
./node_modules/.bin/vp test run
# 4. types and formatting, in BOTH packages
./node_modules/.bin/vp check
cd ../cards && ./node_modules/.bin/vp check
```

```bash
# 5. prove your tests can actually fail
./.venv/bin/python tools/mutation_check.py --set OP16 \
    --engine vendor/tcg-engines/submodules/one-piece/packages/engine
```

**A surviving mutant means the batch is not done.** It names a test that cannot fail on the thing it
claims to cover. Either the assertion is vacuous, or the fixtures satisfy the encoding either way, or
— the interesting case — the encoding carries a **redundant** filter/condition that no test could ever
kill, in which case the right fix is to simplify the encoding, not to bolt on a test. Budget ~40 s per
card for this step.

**`vp check --fix` round-trip hazard:** run from `packages/engine` it rewrites the *grafted copy* under
`vendor/`, which is gitignored and which the next `graft_cards.py` silently overwrites from `cards/`.
After any `--fix`, copy the fixed file back into `cards/…` and re-run `graft_cards.py` until it reports
`0 copied, 0 deleted`.

## Do not do these

- Do **not** edit `cards/ENCODING.md`. Every batch would conflict on it. Report your findings instead
  and they get consolidated centrally.
- Do **not** edit `docs/`, `tools/`, or any card outside your assigned list.
- Do **not** use an OP15/OP16 card as a *test fixture* expecting it to be inert. A card with no
  `effects` block is **unencoded, not vanilla** — it will start behaving when its own batch lands and
  break your test. Prefer pre-OP15 engine cards (OP01–OP14, EB, PRB, ST01); verify one is genuinely
  vanilla by checking it has no `effect` key at all, or `effect: "NULL"`.
- Do **not** report green over a failing or skipped step. If something cannot be made to pass, say so
  plainly with the output.

## Commit and report

Commit to your own branch with a message that explains the *reasoning*, not just the file list —
especially any ruling that reversed an obvious reading.

Then return a report containing:

1. **Encoded** — card IDs, one line each on anything non-obvious.
2. **Parked** — card ID, the exact clause, and the specific missing primitive.
3. **Rulings that changed an encoding** — ruling number, card, and what the English would have implied.
4. **Verification output, quoted** — the exact test-count line, the exact `mutation_check.py` summary
   line, and confirmation that both `vp check`s were clean. Quote the tool, do not paraphrase it.
5. **Engine limitations found** — behaviour the engine cannot produce, distinguished from DSL gaps.
6. **Anything that belongs in `cards/ENCODING.md`** — new gotchas, prompt intents, or precedents you
   had to discover. Write these as finished prose ready to paste.
