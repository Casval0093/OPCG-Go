# Upstream-ready findings for `TheCardGoat/tcg-engines`

Prepared 2026-08-19.

## Status

| Finding | State |
|---|---|
| 1 — search-to-hand slot gate | **SENT.** PR <https://github.com/TheCardGoat/tcg-engines/pull/216> — ready for review, `MERGEABLE`, 2 files, +56/−3 |
| 2 — 1972 per-card tests never run | **SENT.** Issue <https://github.com/TheCardGoat/tcg-engines/issues/217> |

Ping authorised sending 2026-08-19 and delegated the issue/promote calls.

**Reviewed 2026-08-19 after sending: Ping asked whether #216 could be withdrawn, then decided to
keep both open. Do not re-litigate this.** The question was about the destination being a
third-party repo, not about the work. Two facts settled it:

- **Nothing of this project went upstream.** #216 is exactly two files, both upstream's own paths:
  their `src/effects/resolution.ts` (the one-line fix) and a new
  `tests/cards/OP12/086-koala.test.ts` built from *their* OP12 cards. No decklists, research data,
  matchup matrix, OP15/OP16 encodings, `patch_engine.py`, or `CLAUDE.md`. **Keep that boundary on
  any future upstream contribution.**
- **Withdrawal buys almost nothing.** Closing a PR or issue does not delete it — the record stays
  permanently public, the author cannot remove it, and the notifications and bot comments already
  went out. Only the fork is truly deletable. (Operational note if it ever is withdrawn: close the
  PR *before* deleting the fork, or the diff may become unviewable.)

**#216 was opened as a draft and later promoted to ready for review.** The draft was to satisfy
`CONTRIBUTING.md` ("Open an issue or draft PR for behavior changes with broad impact"); it was
promoted once #217 carried the one genuinely open design question, leaving a small, validated,
conservative diff. Reversible — it can be converted back to draft.

**Temper expectations.** The public repo is an export mirror: of 211 PRs, the recent merged ones are
all `eduardomoroni` / `TheCardGoat-BOT` "Public sync" commits with no external-contributor PRs in
that history, and only 5 issues have ever been opened. Silence is the likely outcome.

**The Finding 2 numbers in the original staging text below were WRONG and are corrected in #217.**
They were measured in our tree, whose `tests/cards/` carries ~212 grafted OP15/OP16 files. Pristine
upstream: 2065 under `src/cards/`, 1384 under `tests/cards/`, `1384 + 4 = 1388` (exactly the stock
suite's file count), 26 basenames overlapping, **1972** orphaned. Enabling `src/cards/OP12/**` adds
+100 files / +132 tests, all passing. **Measure upstream facts in a clean clone, never in `vendor/`.**

Fork: <https://github.com/Casval0093/tcg-engines>, branch `fix/search-to-hand-slot-gate`, commit
`bf3931b6c`. Opened as a **draft** because `CONTRIBUTING.md` says to: *"Open an issue or draft PR for
behavior changes with broad impact."* 171 encodings qualifies. It is draft on purpose — do not
promote it to ready-for-review without deciding that is what you want.

The PR was built and validated in a **clean clone of upstream**, not in `vendor/`: our tree carries
the grafted OP15/OP16 cards, the copied sim test files and both local patches, so a gate run there
would have proved nothing about the PR. Validation in the clean clone: `pnpm run ci:one-piece:check`
10/10 tasks, `vp check` clean on both files, engine suite 2631 → 2632 (verified by removing the new
test file and re-counting, so the added test is provably in the run).

The rest of this file is the original staging record, kept because it is the argument the PR makes.

Context for why this directory exists at all: Ping decided 2026-08-17 that the `orderCards` fix
**stays local** (`docs/plans/encode-op15-op16.md`), which makes `tools/patch_engine.py` permanent
infrastructure. That decision was about `orderCards`. Finding 1 below is a different bug with a
materially different argument — it breaks 152 of *upstream's own* cards — so it is worth re-asking.
Finding 2 is not a bug at all, it is why nobody noticed.

---

## Finding 1 — a search that reveals to HAND is gated on open CHARACTER slots

**File:** `packages/engine/src/effects/resolution.ts`, `case "effectSearchSelection"`.

`effectSearchSelection` rejects a selection when

```js
selectedIds.filter((id) => cardType(id) === "character").length > openCharacterSlots
```

and it applies that test to **every** search, regardless of `revealDestination`. Adding a card to
your hand does not need a board slot, so with a full character area (0 open slots) the engine
refuses every Character it just offered.

**The two halves of the same feature disagree.** Prompt creation in `effects/actions.ts` folds
`openCharacterSlots` into `destinationCapacity` **only** when `revealDestination === "character"`;
resolution applies it unconditionally. So the prompt marks a card `enabled: true` and lists it in
`resolutionContext.eligibleIds`, and then resolution refuses that exact card.

**Reproduced on your own card and your own harness — `OP12-086` Koala** (`revealDestination: "hand"`,
`remainderPosition: "trash"`). Four bodies down, Koala takes the fifth slot, `[On Play]` looks at 3:

```
prompt options : Karasu enabled:true | Nico Robin enabled:true | Koala enabled:false
eligibleIds    : [card-000022 Karasu, card-000023 Nico Robin]
characterArea  : [c26, c27, c28, c29, c21]        <- full, 0 open slots
resolvePrompt  : selectedIds: ['card-000023']     <- Nico Robin, enabled:true, in eligibleIds
result         : accepted: false, "Prompt resolution could not be applied."
```

The filters are not involved: `eligibleIds` is correct throughout, and the refused card is in it.

**Blast radius: 171 of the 185 card definitions with a `search` action reveal to hand.** It bites
whenever such a search would put a Character into a hand while the board is full — common in real
games, invisible in tests that start from an empty board (every existing search test does).

**Fix:** `search-to-hand-slot-gate.patch` in this directory — gate the slot test on the destination,
mirroring `actions.ts`. One expression. The `playableEligibleIds` membership test on the line above
still constrains a hand reveal, so nothing is loosened for `revealDestination === "character"`.

**Regression test:** `086-koala.test.ts.snippet`. A/B against the stock engine: fails with
`MoveFailedError: Move resolvePrompt failed: Prompt resolution could not be applied.`, passes with
the patch. Full engine suite is unaffected either way.

---

## Finding 2 — 1953 per-card test files are never executed

Not a bug, but it is the reason Finding 1 survived, and it is probably worth its own issue.

`packages/engine/vite.config.ts` sets:

```js
test: { include: [
  "tests/card-coverage.test.ts", "tests/index.test.ts", "tests/test-engine.test.ts",
  "tests/cards/**/*.test.ts", "src/automation/bot-harness.test.ts",
] }
```

`src/cards/**/*.test.ts` is not covered. Measured:

> **SUPERSEDED — these were measured in our contaminated tree. Correct pristine figures are in the
> Status block above and in issue #217. Kept only to show what the error was.**

| | count (WRONG for upstream) |
|---|---|
| test files under `src/cards/` | 2065 |
| test files under `tests/cards/` | ~~1600~~ → 1384 |
| `1600 + 4` named files | ~~1604~~ → **1388** |
| basenames present in both trees | ~~45~~ → 26 |
| basenames only under `src/cards/` | ~~1953~~ → **1972** |

So this is not a completed migration with leftovers; 1953 cards' tests have no running counterpart.
**They are not broken, either** — temporarily adding `"src/cards/OP12/**/*.test.ts"` to `include`
took the suite from 1601 → 1701 files and 3370 → 3503 tests, **all passing**. They are simply not
wired in. `OP12-086` Koala's own test file is one of the 1953, which is exactly why a full board was
never exercised against a hand-reveal search.

Cheapest change with real yield: add `"src/cards/**/*.test.ts"` to `include`. Worth doing set by set
if a bulk run turns up pre-existing failures in sets other than OP12 (only OP12 was sampled here).

---

## Already sent — how it was assembled

Finding 1 is PR #216; the commands below are the record of how, not a to-do.

```bash
gh repo fork TheCardGoat/tcg-engines --clone=false
git clone https://github.com/Casval0093/tcg-engines.git      # clean tree, NOT vendor/
cd tcg-engines && git checkout -b fix/search-to-hand-slot-gate
git apply /path/to/OPCG-Go/docs/upstream/search-to-hand-slot-gate.patch
# regression test placed at packages/engine/tests/cards/OP12/086-koala.test.ts --
# NOT at the src/cards path in 086-koala.test.ts.snippet, which vite.config.ts does not run
cd submodules/one-piece && pnpm install --ignore-scripts && pnpm run ci-check
```

**If Finding 2 is ever filed as an issue, note it is unfiled today** — PR #216 carries it only as a
closing note, which is easy for a reviewer to skip.
