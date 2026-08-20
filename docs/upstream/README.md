# Upstream-ready findings for `TheCardGoat/tcg-engines`

Prepared 2026-08-19.

## Status

| Finding | State |
|---|---|
| 1 — search-to-hand slot gate | **SENT.** PR <https://github.com/TheCardGoat/tcg-engines/pull/216> — ready for review, `MERGEABLE`, 2 files, +56/−3 |
| 2 — 1972 per-card tests never run | **SENT.** Issue <https://github.com/TheCardGoat/tcg-engines/issues/217> |
| 3 — `getPermanentSetCost` evaluates conditions it discards | **LOCAL ONLY.** Carried as patch 8 in `tools/patch_engine.py`. Not sent, and not to be proposed — see the standing rule below. |

Ping authorised sending findings 1 and 2 on 2026-08-19 and delegated the issue/promote calls.
**That authorisation was specific to those two and does not carry forward.**

**STANDING RULE — no issues or PRs on external repos, and do not ask (Ping, 2026-08-19).** Verbatim:
*"本项目外部库不要发issue，未来也不要再问我"*. Findings from here on are recorded in this file and in
`CLAUDE.md`, and carried in `tools/patch_engine.py`. That local record **is** the deliverable. Do not
raise sending as a question, a "still outstanding" item, or a next action.

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

Cheapest change with real yield: add `"src/cards/**/*.test.ts"` to `include`.

> **UPDATE 2026-08-19 — the full enable has since been run and the "do it set by set" hedge is
> unnecessary.** We enabled *all* of `src/cards/**` locally (patch 3 in `tools/patch_engine.py`):
> **1601 → 3666 files, 3370 → 6078 tests, 0 failures, 89s → 87s.** Nothing fails and there is no
> measurable wall-clock cost. The surrounding text above reflects what issue #217 actually says,
> which was written from the OP12-only sample — **#217 has not been updated with this stronger
> evidence.**

---

## Finding 3 — `getPermanentSetCost` evaluates conditions it is about to discard

**File:** `packages/engine/src/effects/permanent.ts`, `getPermanentSetCost`.
**State: recorded here and carried as patch 8. Not sent. Not to be proposed.**

An upstream inefficiency that is a **correctness-preserving performance bug**, but a severe one: it
made this project's primary deck ~200x more expensive to simulate than every other deck, with a cost
**super-exponential in the number of copies in play**.

`getPermanentSetCost` loops every source in play and evaluates each permanent effect's `conditions`
**before** checking whether that effect has a `setCost` action at all. `getPermanentModifierTotal`,
40 lines above it in the same file, does the opposite — it builds `relevantActions` first and
`continue`s when empty. It is the **only one of the file's 14 condition-evaluating functions** that
pre-filters; the other 13 share the compute-then-discard shape. `getPermanentSetCost` is the one
measured to sit inside a cycle.

The cycle needs a card whose permanent effect carries a `cost` target-filter in its conditions.
`OP16-017` LittleOars Jr. is one: its only action is `modifyPower`, but its `notHasCard` condition
carries `{ filter: "cost", comparison: "gte", value: 8 }`.

```
getCardCost(C)
  -> getPermanentSetCost(C)
       -> evaluateConditions(source)             for EVERY permanentEffect of EVERY source in play,
                                                 including ones with no setCost action
            -> candidatePoolForTarget -> matchesTargetFilter   `filter: "cost"`
                 -> getCardCost(C')              a DIFFERENT instance -> re-entry
```

The existing re-entrancy guard is keyed `` `${type}:${targetInstanceId}` ``, so it breaks the
**direct** self-cycle but permits re-entry along every distinct permutation of sibling instances.
With S copies of the source and T targets the branching is (S × T) per level, hence (S × T)^depth.
Instrumented call counts for one `getCardPower` on a board of N copies:

| copies of OP16-017 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| `getCardCost` calls, stock | 2 | 52 | 2,034 | 126,224 | 11,450,650 |
| `getCardCost` calls, patched | 1 | 4 | 9 | 16 | 25 |

Patched is exactly N². **`getPermanentModifierTotal:power` is called exactly once at every N, before
and after** — the `modifyPower` on the card is a red herring; the blowup is entirely on the cost path.

**Fix:** the pre-filter, mirroring `getPermanentModifierTotal`. Three lines. It cannot change results:
for an effect with no `setCost` action the inner loop `continue`s on every action, so the effect could
never contribute a return value and the condition's result was discarded. `evaluateConditions` is a
pure read of state — there is no assignment to `state.*` anywhere in `conditions.ts` — which is the
same assumption `getPermanentModifierTotal` already relies on.

**Catalog exposure, measured across all 2,537 cards.** 12 permanent effects carry a `cost` filter.
After the patch, **no multi-copy character** pairs a `cost` filter with a cost-path action
(`setCost`/`modifyCost`), so the copies term that drives the blowup is gone. Two single-copy sources
remain — `OP05-097` (stage) and `OP10-042` (leader) — and both are structurally bounded, since one
source and the 5-slot character area cap the permutations at Σ P(5,k) = 325.

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
