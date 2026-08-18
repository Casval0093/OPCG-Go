# Upstream-ready findings for `TheCardGoat/tcg-engines`

Prepared 2026-08-19. **Nothing here has been sent.** No fork, no branch, no PR, no issue — opening
those publishes under Ping's GitHub identity, which is his call to make, not this repo's. Everything
below is staged so that sending it is a copy-paste, and so that *not* sending it costs nothing.

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

| | count |
|---|---|
| test files under `src/cards/` | 2065 |
| test files under `tests/cards/` | 1600 |
| `1600 + 4` named files | **1604 — exactly the file count the suite reports** |
| basenames present in both trees | 45 |
| basenames only under `src/cards/` (no counterpart anywhere) | **1953** |

So this is not a completed migration with leftovers; 1953 cards' tests have no running counterpart.
**They are not broken, either** — temporarily adding `"src/cards/OP12/**/*.test.ts"` to `include`
took the suite from 1601 → 1701 files and 3370 → 3503 tests, **all passing**. They are simply not
wired in. `OP12-086` Koala's own test file is one of the 1953, which is exactly why a full board was
never exercised against a hand-reveal search.

Cheapest change with real yield: add `"src/cards/**/*.test.ts"` to `include`. Worth doing set by set
if a bulk run turns up pre-existing failures in sets other than OP12 (only OP12 was sampled here).

---

## To send it (Ping's call)

```bash
gh repo fork TheCardGoat/tcg-engines --clone --remote
cd tcg-engines && git checkout -b fix/search-to-hand-slot-gate
git apply /path/to/OPCG-Go/docs/upstream/search-to-hand-slot-gate.patch
# then paste 086-koala.test.ts.snippet into the Koala test file, per its header note
```
