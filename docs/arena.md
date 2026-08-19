# The arena — playtest ground for decks that survived the simulator

**Status 2026-08-18: playable.** Browser board with card images, human seat, scripted anchor, and an
LLM council all run end to end. The council's network path is wired and typechecked but has **not been
exercised against the live API** — see "What is not done".

```bash
./scripts/arena.sh --serve --north scripted --deck-south sim/decks/ace-op16.json   # you on Ace vs the heuristic
./scripts/arena.sh --show-prompt --north players/deepseek-flash.json               # what a model sees; costs nothing
./scripts/arena.sh --games 20 --integrity                                          # hidden-info audit + branching
./scripts/arena.sh --serve --north players/deepseek-flash.json                     # you vs a DeepSeek council
./scripts/arena.sh --replay arena/logs/<file>.jsonl --contested                     # read your own game back
```

## Decks

`sim/decks/ace-op16.json` is a legal 50-card mono-red Ace list built from the encoded pool. Every
8000-or-more Whitebeard Pirates body in it is there because **ruling #961 binds Ace's 8000 threshold to
both clauses** — a 7000-power Whitebeard body gains nothing, so the trait alone does not make a Rush
target. `OP16-017` LittleOars Jr. (4-cost, 8000) is the cheapest legal target in the pool and the
deck's most important card. It is **not** a tuned competitive list: `docs/research-findings.md` records
the archetype but no 50-card list, so this is the Mihawk proxy's counterpart — legal, playable, and
honest about not being optimised. Measured: **10/10 games to a rules win**, no aborts, ~40.3
substantive decisions per seat per game, 10 games in 44 s.

## Where it sits

The batch simulator (`./scripts/simulate.sh`) narrows the field at 2–4 games/s. The arena playtests
what survives, with Ping in a seat. It is **not** a measurement instrument: an 8-player, 5-round Swiss
is 20 games, which cannot separate a 52% deck from a 55% one. Its products are a skill-ceiling probe, a
decision corpus, and practice.

## Architecture

A match server owns `MatchState`; every player is a client that receives a projection and returns an
index. Human, council, and heuristic are indistinguishable to the driver — the shape
[ryuu-play](https://github.com/keeshii/ryuu-play) uses, where a bot registers through the same
interface as a person.

```
arena/driver.ts      async match loop; owns MatchState, hands out projections only
arena/enumerate.ts   engine descriptors -> concrete legal choices (fixes 3 policy defects, below)
arena/features.ts    derived arithmetic, computed FROM THE VIEW so it cannot leak
arena/prompt.ts      board + card text + rulings-aware primer -> the model's input
arena/providers/     the vendor seam: types.ts (shared contract) · anthropic.ts · deepseek.ts
arena/agents/        human.ts (browser) · scripted.ts (anchor) · council.ts (LLM)
arena/server.ts      zero-dependency HTTP + SSE + image proxy/cache
arena/web/board.html both fields, card art, click-a-card-to-filter-moves
arena/log.ts         the decision corpus: append-only NDJSON, written per decision
arena/replay.ts      replayMatch — reconstruct a recorded game from (config, commands)
arena/integrity.ts   proves no seat can see hidden information — with a mutation probe
arena/branching.ts   decisions-per-game report
players/*.json       one file per entrant; names a model, never a credential
```

`arena/` in this repo is the source of truth. `scripts/arena.sh` copies it into the vendored engine;
never edit the grafted copy (`docs/plans/encode-op15-op16.md` Global Constraint #1).

## Why a separate driver instead of `runBotMatch`

Two measured reasons. `OnePieceBotStrategy` is **synchronous**, so a network call cannot be awaited
inside it. And `runBotMatch` hardcodes prompt resolution — `drainPendingPrompts` calls
`resolveBotPromptCommand` directly, so there is no seam for prompt answers, and prompts are 252 of
~890 resolutions per 20 games. Batch keeps using `runBotMatch`, at speed.

**Plain `node` runs the engine — no vitest, no build step.** Verified: `node arena/main.ts` resolves
`@tcg/op-cards` (2,537 cards) and `src/core.ts` under Node 22's native type stripping. The note in
`sim/matchup.sim.test.ts` that vitest is the only reliable way to reach the card registry is true for a
*test*, not for an entry point — and it matters, because vitest captures stdio.

One dependency boundary comes with that: `@tcg/bot-core` and `@tcg/engine-core` import `./x.js`
specifiers over `.ts` files, which vite rewrites and Node does not. So the arena may import from
`packages/engine/src/**` and `@tcg/op-cards`, but not those two — hence `arena/cycle.ts` reimplements
the loop guard. Its fingerprint is not comparable with the batch harness's; cycle detection is a
safety net, not a measured quantity.

## Three policy defects `enumerate.ts` fixes

All three are the `orderCards` class from CLAUDE.md — an *absent* branch, not a weak heuristic — and
all three are invisible to a win-rate table.

1. **Attack target was never chosen.** `getLegalCommands` emits one `declareAttack` descriptor per
   attacker carrying `targetIds: legalAttackTargets(...)`, and `commandFromDescriptor` takes
   `targetIds[0]`. `legalAttackTargets` builds `[defender.leaderInstanceId, ...restedCharacters]`
   (`src/battle.ts:737`), so **`targetIds[0]` is always the Leader**: every shipped strategy always
   face-hits and never removes a rested Character. `valueRankedStrategy` compounds it — it scores the
   attack by reading `targetIds[0]` too and adds +300 "because the target is a Leader", a bonus that is
   therefore unconditional.
2. **Targets were taken, not selected.** `resolveBotPromptCommand` answers `selectCards` and
   `selectTargets` with `options.slice(0, count)` — the first N in engine order, unevaluated. 165 of
   252 prompts in a 20-game sample.
3. **Optional effects always fired.** Every `confirm` was answered yes.

`scriptedAgent("faithful")` reproduces all three so arena results stay comparable with the batch
numbers in `docs/simulation.md`; `scriptedAgent("improved")` uses the real choice set. Comparing them
is the cheapest available measurement of what the defects cost.

A fourth is left unfixed and documented instead: `playCard` takes the first open character slot rather
than enumerating slots. OPTCG has no adjacency mechanics, so slot identity is cosmetic today.

### The engine offers prompt options it then refuses — and the driver now survives it

Found while testing the Ace deck: `OP16-118` Portgas.D.Ace's `[On Play]` ("Look at 5 cards from the top
of your deck; reveal **up to 1 card with a type including \"Whitebeard Pirates\"** and add it to your
hand") raises a `selectCards` prompt offering **Marco, Edward.Newgate, Vista, Edward.Newgate, Ramba** —
every one of them a Whitebeard Pirates card the effect permits — and the engine then rejects four of
the five with *"Prompt resolution could not be applied."* The target filter is evidently applied at
resolution rather than when the options are generated.

That cost **1 game in 10** as an `illegal-command` abort, and it exposed a real defect in the driver:
`runBotMatch`-style retrying re-asks the *same* agent against the *same* state, so a deterministic
policy resubmits a byte-identical illegal command until the cap. Two fixes, both general:

- A rejected choice is **removed from the menu** before the agent is re-asked, so a re-asked agent
  cannot repeat itself.
- For prompts the retry cap is the **menu size**, not a fixed 3. Each rejection strictly narrows the
  menu, so the loop is bounded and cannot spin — and if any legal option exists, it is reached.

Ace now completes 10/10 and Mihawk 10/10 (5–5 mirror). The driver plays through this class of encoding
gap instead of dying on it, and an abort that does happen names the prompt, its constraints and every
option offered, so the next one is diagnosable in a single run.

**The underlying mismatch is still there and is worth chasing** — it is exactly the trait-filter class
CLAUDE.md already records (`OP02-013_p3` misspells `"Whitebeard Piratess"`, the trait Ace keys on).

## The decision log

Every non-forced decision is written to `arena/logs/<timestamp>.jsonl` **as it is made**, with the
position it was made in, the whole menu it was chosen from, who chose, and why. This is
`docs/policy-proposals.md` §A2's "decision corpus — every `(state, legal moves, choice, reason)`
tuple", and it is also the review tool for a human game.

```bash
./scripts/arena.sh --serve --deck-south sim/decks/ace-op16.json      # logs by default
./scripts/arena.sh --replay arena/logs/2026-08-19T18-20-53.jsonl     # summary + transcript
./scripts/arena.sh --replay <file> --contested                       # only the positions that were hard
./scripts/arena.sh --replay <file> --verbose                         # include the moves NOT taken
./scripts/arena.sh --games 5 --verify-replay                         # does the record reproduce the game
./scripts/arena.sh --games 5 --no-log                                # opt out
node --test arena/log.test.ts                                        # 14 tests, no engine needed
python3 tools/mutation_check_arena.py                                # 13 mutants, all must be caught
```

### What was already there, and what was missing

`driver.ts` always built a `DecisionLog[]` and `main.ts` always wrote it — to a single
`arena/results/last-run.json`, **overwritten every run and written only after the last game
finished**. Four gaps, and the first is the one that mattered:

1. **A `--serve` session abandoned mid-game left nothing.** Ping's own games are the scarcest data
   this project will ever hold, and a human game is precisely the one someone walks away from.
2. **Run N+1 destroyed run N.** There was no corpus, only a most-recent snapshot.
3. **The position was not stored.** That is `(choice, reason)`, not the tuple above.
4. **A human's `reason` was hardcoded `null`** in `agents/human.ts`. So "record human decisions"
   recorded *which index*, never *why* — the half worth having.

`replayMatch(config, commands)`, cited in `docs/arena.md`, `arena/types.ts` and `arena/driver.ts` as
the property that made a stored decision "verifiable rather than merely recorded", **did not exist
anywhere in the tree.** That was the stated justification for gap 3. It exists now (`arena/replay.ts`),
and the log no longer leans on it: the position is stored inline, and replay *audits* the record
instead of being the only way to read it. `--verify-replay` folds each game's commands back over a
fresh match and compares — 2/2 and 1/1 reproduced exactly on ST01, and the check goes red when a single
command is dropped.

### NDJSON, flushed per decision

One JSON object per line, `writeSync` to an append-mode fd, no buffering. A killed process leaves a
**valid** file, short by at most one record, and `readLog` reports a torn final line rather than
hiding it. Measured, not assumed: a 40-game run `kill -9`'d at game 6 left **747 decisions and 6
complete games** readable, and `--replay` parsed it without complaint.

Record types: `run` (once), `game` (config included, so the log alone is replayable), `auto` (a forced
command — three fields, kept so a transcript is a readable game), `decision`, `abort`, `outcome`.

A **corrupt middle** line is skipped and counted (`corrupt`), not fatal. That is the same promise as
the torn tail, and only the tail honoured it at first — one bad line mid-file threw and denied access
to every intact decision around it. The default filename also carries the **pid**: `logStamp` has
one-second resolution and the writer appends by design, so without it two runs started in the same
second merged into one file with two `run` headers and two games both numbered `game: 1`.

### The position snapshot is `deriveFeatures`, and that is a security decision

`position` is the same feature block the agent was handed. Free — the driver already computes it — and
`features.ts` is derived **from the projection**, so it cannot contain hidden information and
`integrity.ts` proves that rather than asserting it. A logger that snapshotted `MatchState` would be a
second, unaudited path out of the projection boundary, which is what `driver.ts`'s `audit` hook warns
against in as many words. `--integrity` still PASSes with the log wired, and the mutation probe still
fires.

`positionKey` follows the same rule: a fingerprint of (position, menu labels) — the "fingerprint plus
the legal-move set" key `docs/policy-proposals.md` names for CRN caching, but computed from the
projection so it stays usable by something that will only ever hold a view. **It is not
`semanticState`'s hash and is not comparable with it.**

### `author` is a field, not a guess from the agent's name

Every decision records `human` / `model` / `heuristic`, and it is per-decision rather than per-agent
because the two differ: a council routes procedural decisions to the heuristic and **degrades** to it
on a refusal, a rate limit or an exhausted call budget. This doc already says a council that quietly
became a heuristic would void a tournament's standings; that fact is now in every row instead of only
in an end-of-run counter.

It is also what makes the corpus filterable, and one filter needed it. `contested` — the sampling
criterion for the bank — is *disagreement non-empty, or a non-heuristic author wrote a reason*.
Without `author` it would have been "has a reason", and `scriptedAgent` narrates **every** decision it
makes (`improved score 1210`), so a scripted game would have come back **100% contested**. Measured
after the fix: a scripted 2-game run reports `contested: 0`; a human game with 8 typed notes among 29
decisions reports `contested: 8`.

### The corpus invariant: `menu[chosenIndex]` is what was played

The driver falls back to option 0 when an agent answers out of range, so recording the agent's
*request* as `chosenIndex` produced rows whose `chosenIndex` was absent from their own `menu` —
self-contradictory, and exactly what a distilled policy would learn a wrong label→index mapping from.
`chosenIndex` is now the index actually applied, and the bad request is kept as `requestedIndex`
(`null` when the pick was honoured), which turns a corrupted row into a model-quality signal that the
transcript and `summarise` both surface. Verified with a stand-in agent that hallucinates index 999 on
every fifth decision: **2 out-of-range requests recorded, 0 rows whose `chosenIndex` is absent from
their menu.**

### Capturing a human's reason

The board carries an **optional** free-text note above the move list, sent with the click and cleared
after it. Optional is the design: at 60–110 substantive decisions per seat per game a mandatory box
would be abandoned by turn three, and an abandoned box that still submits is worse than none. That
makes a typed reason a signal in itself — it marks the positions Ping thought were worth a note, which
is exactly what `contested` reads.

Verified end to end by driving the seat over the same HTTP surface the browser uses (SSE stream →
`POST /api/choose {index, reason}`): 8 human decisions landed in the log with their notes and
`author: "human"`, alongside 21 correctly attributed to the scripted opponent.

Two incidental fixes came with it. The side panel was a 4-row CSS grid holding 5 children and laid out
correctly **only** because `#prompt` is `display:none` most of the time (a `display:none` element is not
a grid item); a sixth child would have stolen the flexible row from the move list, so it is flexbox now.
And `POST /api/choose` trims and caps the note at 600 characters server-side, because that is the
boundary an arbitrary POST reaches.

### `process.exit(0)` was discarding every audit's verdict

Found while checking that `--verify-replay` could fail. `main()` ended with `process.exit(0)`, which
overrides `process.exitCode`, and **both** audits in the file fail by setting that field — the replay
check and, already, the integrity checks. So `--integrity` has never been able to fail a run: a hard
hidden-information violation printed `FAIL` and exited 0. Now `process.exit(process.exitCode ?? 0)`,
verified red (1) against a mutated `replay.ts` and green (0) clean.

### Size, and what to keep

**~390 KB per ST01 game, ~690 KB per real Block 2+ game** (`mihawk-green-proxy`), the menu being most
of it. So Ping's 10–20 human games are ~14 MB and a 200-game council run is ~140 MB. `arena/logs/` is
therefore gitignored as working output; a game worth **keeping** — a human game, or a council game with
real dissent — gets copied to `arena/corpus/`, which is tracked.

Incidental and stated rather than buried: those two Mihawk games reported **112.5** substantive
decisions per seat per game against the **89.2** in the table below. Two games is not a measurement and
the branching table is not being revised — but do not assume the two figures are the same quantity
until someone re-runs it properly.

### Tests

`node --test arena/log.test.ts` — **17 tests**, and they run from a clean checkout with **no engine, no
vitest, no 767 MB clone**, because `log.ts` imports the engine's types with `import type` only and
Node's type stripping erases those lines. Mutation-checked by
`python3 tools/mutation_check_arena.py`: **16 mutants, 16 caught, 0 survivors.** CLAUDE.md records that
tests which cannot fail are this project's most frequent defect, so the harness is committed rather
than run once — a mutant that survives names the vacuous test, and a mutant whose anchor has moved is
reported STALE rather than passing quietly (that fired once, on the short-write fix, and is why the
anchor is current).

One thing is deliberately **not** mutated and therefore claims no coverage: the retry loop around
`writeSync`, which can return fewer bytes than asked and does not retry itself. A regular-file write
does not come back short in practice, so any test claiming to cover it would pass with the loop
deleted — i.e. it would be precisely the vacuous test the harness exists to catch. The loop stays as
documented defence.

**The LLM half of "human and LLM decisions" is verified without a live API call.** A stand-in agent
shaped exactly like `councilAgent`'s return value — `author: "model"`, a reason, a dissent set, and a
per-decision degrade — plays a real game through the real driver into the real log: **9 model-authored
decisions, 3 degraded from the same agent name and correctly attributed to `heuristic`, 3 carrying
dissent.** What that does not cover is the provider adapters themselves, which this change did not
touch and which CLAUDE.md records have never made a live call.

### Five defects found reviewing this change, all fixed

Reported and fixed before merge, listed because three were introduced by the change itself:

| defect | consequence |
|---|---|
| `features` hoisted to `null` for forced decisions | a forced choice the engine then refuses re-asks the agent, so a council would have re-chosen with `null` in place of every derived number — silent, and looks like a bad model answer |
| `chosenIndex` recorded the request, not the applied index | rows whose `chosenIndex` is absent from their own `menu` |
| default log path collided at one-second granularity | two runs in the same second merge into one file with duplicate game numbers |
| `readLog` threw on a corrupt middle line | one bad line denied access to the whole corpus |
| `verifyDecisionAnchors` exported, never called | dead code with an untested off-by-one tolerance that read as a guarantee — deleted |

## Integrity

`projectStateForSeat` hides the opponent's hand, both deck tops, and all Life cards. `--integrity`
audits every state of every game against the full `MatchState`.

**Checks 1–3 are exact and are the actual guarantee** — the zones never resolve a hidden card, so
`hand`, `deckTop` and `life` come back with `cardId: null`. All three decks PASS, and the mutation
probe (hand each seat its opponent's projection) fires `1-opponent-hand`, so the suite can fail. A
test that cannot fail is this project's most frequent defect; a PASS without that probe is worth
nothing.

**Check 4, the log, is advisory — and getting there took three false alarms worth recording**, because
each one looked like a real leak:

| attempt | result | why it was wrong |
|---|---|---|
| name substring | 146 "violations" on Ace | An OP16 effect legitimately **reveals from hand**; the log keeps that line forever while a *different copy* of the same card sits hidden later. |
| `sourceInstanceId` / `targetIds` | 1370 / 428 / 339 across all three decks | An instance id is an **opaque handle**. The projection refuses to resolve one for a card you cannot see, so knowing instance `abc123` moved tells a player nothing. |
| card-id substring | 871 on Mihawk | Two data-shaped causes: **63 of 2,537 cards embed their own id in their display name** ("Kikunojo - OP14-023"), and a card id names a card **type**, not a copy. |

The general result: **ids and names are both per-type, and a legal deck holds up to 4 copies, so no
text-based check can distinguish "the hidden copy was named" from "a visible copy was named."** An
exact log check does not exist. It is reported as an advisory count (97 on Ace, 1 on ST01, 0 on
Mihawk) and never fails a run — reporting it as a failure would train the next person to disable the
whole audit. If the residual ever needs closing, the fix is in the driver — hand agents a filtered
log — not a cleverer assertion.

Worth knowing operationally: the audit is quadratic in log length, so run it over a handful of games.
40 games with `--integrity` does not finish in a useful time; 4 games is ~400–800 states per seat and
takes seconds.

## Branching factor — "Step 0" from `docs/policy-proposals.md`, measured

| deck | substantive decisions / seat / game |
|---|---|
| ST01 starter | **56.4** |
| Mihawk green Block 2+ | **89.2** |

Three tiers, because "non-forced" is too generous to cost against: *forced* (one legal choice,
auto-played, never billed), *procedural* (setup throws, mulligan/keep, judge acknowledgements), and
*substantive* (everything else). The split is a judgement call, stated rather than hidden, because it
moves an LLM's per-game cost several-fold and every prior estimate assumed one silently.

`attachDon` is the largest single bucket at ~35% of decisions.

## The council

Ping's requirement was that one agent may not find the best play, so several should discuss. Per
substantive decision: N proposers with **distinct lenses** run concurrently, then an adjudicator
resolves. Three gates keep 89 decisions affordable without weakening the hard ones:

1. Forced decisions never reach an agent.
2. Procedural decisions go to the heuristic — deliberating over rock-paper-scissors is waste.
3. **Unanimous proposals skip the adjudicator.** Cost lands exactly on contested positions — and
   disagreement is then a free difficulty signal, marking the decisions worth storing in the bank
   without needing a critic pass.

Lenses are `tempo` (the 30-minute clock and the double-loss rule), `attrition` (resources and counter
math), and `rules` (read the printed text; name the clause that triggers). Distinct lenses beat N
identical proposers.

Every model call gets the card text of everything in play plus the seat's own hand. This is not
optional: ruling #961 says Ace's 8000 threshold binds to *both* clauses, so a 7000-power Whitebeard
Pirates Character does **not** gain [Rush] — the English text reads the other way, and a model without
the ruling plays a hallucinated Ace.

Degradation is loud. A refusal, malformed answer, out-of-range index, rate limit, or exhausted call
budget falls back to the heuristic and is counted, and the count is printed with
`*** those decisions were NOT made by the council ***`. A council that quietly became a heuristic
mid-tournament would void the standings.

**The field must be anchored.** A playbook tuned only against other LLMs learns to beat LLMs. Seed
`scripted` and Ping in every tournament — noting that `scripted:faithful` is handicapped in the three
specific ways above.

## Providers and API keys

A council member names a provider and a model; nothing above `arena/providers/` knows which vendor
answered. Two are implemented, and one council may mix them — see `players/mixed-vendor.json`, where
cheap DeepSeek proposers argue and an Opus adjudicator rules only on the contested positions.

```bash
echo 'ANTHROPIC_API_KEY=sk-ant-...' >> .env     # .env is gitignored
echo 'DEEPSEEK_API_KEY=sk-...'      >> .env
set -a; source .env; set +a
```

Keys are read from the environment and appear nowhere else — not in a player config, not in a game
record, not in a log line. `loadCouncil` rejects any config containing something key-shaped. Providers
are constructed lazily, so a DeepSeek-only tournament never needs an Anthropic key.

| | Anthropic | DeepSeek |
|---|---|---|
| Default model | `claude-opus-5` | `deepseek-v4-flash` (also `deepseek-v4-pro`) |
| Key | `ANTHROPIC_API_KEY`, or an `ant auth login` profile | `DEEPSEEK_API_KEY` (no profile fallback) |
| SDK | `@anthropic-ai/sdk` | `openai` — DeepSeek ships none and its docs prescribe this with a `baseURL` override |
| Structured output | `output_config.format` json_schema | **forced function call**, then `json_object` as a retry |
| Caching | `cache_control` breakpoint; **512-token minimum** | automatic prefix cache, no parameter, no minimum |
| Effort | `low`/`medium`/`high`/`xhigh`/`max` | `reasoning_effort` `low`/`high`/`max` — collapsed, and warned about |
| Sampling | `temperature` etc. are a **400** on Opus 5 | `temperature` and `top_p` accepted |

Four DeepSeek facts, verified against `api-docs.deepseek.com` on 2026-08-18 rather than assumed, each
of which changed the adapter:

1. **No strict schema.** `response_format` accepts `text` and `json_object` only. Since the docs also
   warn json_object "may occasionally return empty content", structure comes from a forced function
   call — the strongest guarantee the API offers — with json_object as a second attempt.
2. **Tools need telling.** The parameter reference notes tool use "requires explicit instruction", so
   the DeepSeek adapter appends a line naming the function. It lives in the adapter, not `prompt.ts`,
   so the Anthropic path is not polluted by a DeepSeek quirk.
3. **Caching is automatic** and reported as `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`.
   The stable/volatile prompt split still pays because matching is prefix-based, but there is no
   breakpoint to place and no minimum-prefix cliff. Those fields are untyped in the OpenAI SDK.
4. **Its Anthropic-compatible endpoint is deliberately unused.** `https://api.deepseek.com/anthropic`
   would let the Anthropic provider reach DeepSeek with one setting changed, but our Anthropic path
   depends on `output_config.format`, the `server-side-fallback` beta and `cache_control` — none of
   which a compatibility shim implements. It would fail in three places at once, and each failure
   would look like a bug in our code rather than an unsupported parameter.

**Prompt caching is the Anthropic cost lever.** The rules primer + playbook + lens is identical across
all ~89 decisions, so it sits in `system` behind a cache breakpoint with the board state after it.
Opus 5's minimum cacheable prefix is 512 tokens and below it caching silently no-ops, so the primer is
sized to clear it alone (~900 estimated tokens). `council.ts` warns per provider if successful calls
exceed five with zero cache reads.

## Card images

Derived, not stored: `https://en.onepiece-cardgame.com/images/cardlist/card/<CARD-ID>.png`. Verified
200 for `OP16-001`, `OP09-001` and `OP14-020` — the last two were never imported, so the pattern holds
for any id in the engine. ~175–200 KB each; a two-deck arena is ~100 ids ≈ 20 MB, lazily fetched
through `/img/` into `arena/.cache/images/` on first sight.

Not the engine's own `imageUrl`: those point at `www.optcgapi.com`, the one host CLAUDE.md records as
timing out on this machine (confirmed again — `curl` returns 000 after 10 s). Images are Bandai's:
local cache only, never committed, never redistributed. EN art for now; the board needs one URL per
card id, so an SC swap is a one-file change.

## What is not done

- **Neither provider has made a live call.** Both paths are typechecked and wired, and both have had
  their failure and degradation branches exercised (76 calls each, all 401, correctly attributed by
  provider), but no successful response has been parsed by either. The first real game is also the
  first test of the structured-output parse, the cache hit rate, and play quality — and for DeepSeek,
  of whether the forced function call comes back well-formed.
- **No Swiss runner.** Pairings, OMW% tiebreakers, byes, and the standings table are not written; the
  arena plays single matches today.
- **No clock.** Ping's call — not needed yet. The engine has no wall clock, so a 30-minute round
  would be modelled as a per-player chess clock in the driver, counting LLM latency.
- **The decision bank stores and reads back, but does not RETRIEVE.** Decisions are now persisted
  per decision with their position, menu, author and reason (see "The decision log"), and
  `replayMatch` exists, so the corpus is durable and verifiable. What is still missing is the second
  half of the learning loop: nothing *features* or *retrieves* a stored position — no nearest-position
  lookup, no distillation. `positionKey` is the intended index and is deliberately projection-derived
  so a retrieval path cannot become a leak, but nothing consumes it yet.
- **Play quality is unmeasured.** The scripted mirror is 5–5 over 10 games, which is a symmetry check,
  not a skill test.
