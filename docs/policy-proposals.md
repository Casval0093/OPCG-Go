# Two proposals for a play policy worth trusting

The simulator runs complete 50-card decks now, so every game is a long chain of real decisions and
the *policy* decides what the win rates mean. `valueRanked` plays **legally** since the `orderCards`
fix, but how **well** it plays is unmeasured. These are the two routes, costed from measured
numbers rather than estimates.

## The arithmetic that constrains both

Measured, Mihawk Block 2+ mirror, 400 games: **119.9 commands per game**, median 9 turns, ~2 games/s
single-core.

Common random numbers earn their keep here. Paired, a 3-point effect needs roughly:

| discordant pairs | paired games per matchup |
|---|---|
| 5% | ~440 |
| 10% | ~870 |
| 20% | ~1,740 |

(A deliberately large swap produced 39% discordance; a 1–2 card tech slot will be far lower.) Call
it **~1,000 paired games per matchup**. One tech-slot question against the 6-archetype field, two
arms, is **~12,000 games**:

| policy | cost of one tech-slot question |
|---|---|
| heuristic, 1 core | ~1.7 h |
| heuristic, 8 cores | ~13 min |
| **LLM at every decision** | **~1.44 million model calls** |

**That last figure settles the design.** It is not a budget objection — the charter puts cost
outside the objective function — it is feasibility: latency, rate limits, and the fact that you
would re-pay it for every card you want to test. **An LLM cannot be the runtime policy at the
sample sizes the statistics demand.** Both proposals below are shaped by that.

---

## Proposal A — LLM tournament

A round-robin of complete decks with an LLM piloting both seats. **Its product is not the win
rates.** At feasible sample sizes (hundreds of games, not tens of thousands) the confidence
intervals are far too wide to rank decks. What it produces that nothing else does:

1. **A skill ceiling.** Play the same matchup with the LLM and with the heuristic. The gap is the
   number the audit has been missing — how much heuristic play distorts matchup results, which is
   the stated trigger for Option A/B over Option C.
2. **A decision corpus.** Every `(state, legal moves, choice, reason)` tuple, which is the training
   material for a cheap policy that *can* run at 12,000 games. This is the durable output.
3. **Error localisation.** Where the LLM and heuristic disagree, and by how much, tells you which
   heuristic rules to fix.

### Design

- **Gate the calls.** Only consult the LLM where the decision is real — more than one non-trivial
  legal move. Most of the 120 commands per game are forced. **This is the unmeasured number that
  swings cost 3–5×, and it should be measured before anything is built** (~20 lines on the existing
  `sim/prompt-diag.test.ts`, which already walks the loop manually).
- **Cache aggressively, and exploit CRN.** Key on the engine's own semantic fingerprint
  (`stableBotHash`, already used for cycle detection) plus the legal-move set. Under common random
  numbers, arms A and A′ play **identical games until the swapped card first matters** — that whole
  prefix is a cache hit. Pairing was adopted for variance reduction; it doubles as the single
  biggest cost lever here.
- **Structured output**: return an index into the legal-move list, plus a one-line reason for the
  corpus. Never free-form move text.
- **Tier by complexity**: a cheap model for low-branching decisions, a strong one for combat and
  end-of-turn lines.
- Feed it the same **SC rulings** the encodings use — the LLM will otherwise reason from the English
  printed text, which we have twice proved reads the wrong way.

### Honest limits

- Non-determinism fights reproducibility; cache and pin, and expect residual variance the CRN design
  cannot remove.
- An LLM that is *fluent* about a card is not necessarily *correct* about it. Grade it against the
  rulings corpus before trusting the corpus it produces.
- Scope discipline: this is a few hundred games. If it grows into the statistics engine, it has been
  misused.

---

## Proposal B — shallow search, with the LLM as referee (the cheap one)

Three steps, cheapest first, and **the first one is not a tuning problem but a defect**.

### B1. Fix arbitrary target selection

`resolveBotPromptCommand` currently answers `selectCards` / `selectTargets` with
`prompt.options.slice(0, count)` — **the first N options, with no evaluation at all.** Those are 149
and 16 of the 252 prompts in a 20-game sample. The bot is not choosing targets; it is taking
whatever the engine happened to list first. Similarly `confirm` always answers yes, so every
optional effect always fires.

This is the same class as the `orderCards` bug: not a weak heuristic, an *absent* one. Expect a
larger return than anything else on this list, for a day of work and zero per-call cost.

### B2. Measure the policy with an LLM referee — do not have it play

Sample ~200 decision points from real games. For each, show the LLM the state, the legal moves and
the bot's choice, and ask it to grade and name a better move if there is one.

**~200–1,000 calls total**, against 1.44 million for Proposal A. It answers the actually-open
question — *is the policy good enough that matchup numbers mean anything?* — and it answers it
before you spend anything on making the policy better. If the referee says the bot's choices are
mostly fine, the whole search/LLM programme is unnecessary and the heuristic can run the 12,000-game
sweeps today.

### B3. Shallow search, only if B2 says it is needed

The audit's Option C: depth-limited search, 20–50 rollouts, existing heuristic as the evaluator.
Pure CPU, no per-call cost, parallel across cores. Note the audit's throughput table is now known to
be about the wrong axis — policy legality was the binding constraint, not speed — so re-derive its
numbers from the current engine before committing.

---

## Recommendation

**B, in order, and A only if B plateaus.**

B1 first because arbitrary target selection is a defect rather than a limitation, and fixing defects
before tuning is nearly always right. B2 next because it costs a rounding error and tells you
whether any of the rest is necessary — this project's recurring failure mode has been building on
an unmeasured assumption, and "the heuristic is good enough / not good enough" is exactly that.

Proposal A stays worthwhile for one thing B cannot give: a **decision corpus** to distil a strong
cheap policy. But that only matters if B2 shows the heuristic is the bottleneck, so it should be
sequenced after the measurement, not before it.

**Step 0 for either: measure the branching factor** — decisions per game with more than one real
option. It is cheap, it is the number that swings Proposal A's cost by 3–5×, and both proposals are
currently costed without it.
