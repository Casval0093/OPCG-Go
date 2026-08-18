# The arena — playtest ground for decks that survived the simulator

**Status 2026-08-18: playable.** Browser board with card images, human seat, scripted anchor, and an
LLM council all run end to end. The council's network path is wired and typechecked but has **not been
exercised against the live API** — see "What is not done".

```bash
./scripts/arena.sh --serve --north scripted --deck-south sim/decks/ace-op16.json   # you on Ace vs the heuristic
./scripts/arena.sh --show-prompt --north players/deepseek-flash.json               # what a model sees; costs nothing
./scripts/arena.sh --games 20 --integrity                                          # hidden-info audit + branching
./scripts/arena.sh --serve --north players/deepseek-flash.json                     # you vs a DeepSeek council
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
- **No decision bank.** `GameRecord.decisions` captures every non-forced decision with its reason and
  its disagreement set, and `replayMatch(config, commands)` makes each one exactly reconstructable —
  but nothing yet stores, features, or retrieves them, so the learning loop is not closed.
- **Play quality is unmeasured.** The scripted mirror is 5–5 over 10 games, which is a symmetry check,
  not a skill test.
