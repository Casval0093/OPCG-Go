# Research Findings — Verified Competitive Data

All leader text verified against `onepiece.limitlesstcg.com/cards/<ID>`, not aggregator summaries.
Last updated 2026-08-16.

## 1. Provenance and its limits

| Data | Source | Sample | Cut |
|---|---|---|---|
| Matchup matrix | opdecks.xyz — TCG Match Making ranked ladder | 213,084 games | 2026-07-16 |
| Metagame shares | Limitless — tournament results | not stated | current |

**These are different populations.** Shares are tournament, matchups are ladder. That seam is real.

**The ladder bias runs one direction:** it understates resource-rotation / value / control decks,
because ladder is Bo1, rewards speed, and the median ladder pilot plays complex decks worse than a
tournament field does. Aggro numbers are trustworthy; value-deck numbers are a **lower bound**.

No play/draw split is available. OPTCG turn-order asymmetry is severe — the first player skips their
draw and cannot attack on turn 1 — so all figures below are blended and hide real variance.

## 2. OP16 field and matchup matrix

Shares (Limitless): Nami 23.52 · G/B Luffy 22.91 · Enel 22.71 · Rosinante 9.88 · Teach 8.86 ·
Lucy 2.44 · Yamato 1.37 · Mihawk 1.02 · R Ace 0.87 · Hancock 0.41 · remainder <0.85 each.

Row leader's win % vs column. Internally consistent — every mirrored pair sums to 100.

| | Nami | Luffy | Enel | Rosinante | Teach | Hancock |
|---|---|---|---|---|---|---|
| **Nami** | 50.0 | 60.0 | 66.5 | 50.3 | **34.1** | 38.7 |
| **Luffy** | 40.0 | 50.0 | 36.9 | 55.1 | **67.6** | 51.5 |
| **Enel** | 33.5 | 63.1 | 50.0 | 60.2 | 35.4 | 58.0 |
| **Rosinante** | 49.7 | 44.9 | 39.8 | 50.0 | 56.0 | 49.5 |
| **Teach** | **65.9** | 32.4 | **64.6** | 44.0 | 50.0 | 64.6 |
| **Hancock** | 61.3 | 48.5 | 42.0 | 50.5 | 35.4 | 50.0 |

**A true rock-paper-scissors cycle: Luffy > Teach > Nami > Enel > Luffy.** No dominant deck, so field
composition — not raw power — decides the correct pick.

Machine-readable: `data/op16-matchup-matrix.json`. Regenerate analysis: `python3 tools/ev_analysis.py`.

## 3. Field-weighted EV and equilibrium

| Leader | EV vs field | Share | Nash | Verdict |
|---|---|---|---|---|
| Nami | **55.22%** | 23.52% | 26.27% | Best now; fragile |
| Teach | 52.82% | 8.86% | 15.09% | Underplayed, EV-flat |
| Hancock | 49.15% | 0.41% | 16.93% | Wildly underplayed, tiny sample |
| Enel | 48.72% | 22.71% | 2.15% | **Massively overplayed — a trap** |
| Rosinante | 46.57% | 9.88% | 0.00% | Overplayed |
| G/B Luffy | 46.31% | 22.91% | 39.56% | Underplayed by Nash, but sub-50 vs *this* field |

**Headline: ~45.6% of the field (Luffy + Enel) is playing sub-50% decks.** Enel is the single most
overplayed deck in the format — 25.7% actual against a 2.2% equilibrium.

Nami is the highest-EV pick but decays as Blackbeard/Teach rises; Teach holds ~52.1–52.8% across
every field composition tested. Sensitivity crossover depends on which decks donate share — roughly
16% if drawn from Enel+Luffy only, roughly 20% if drawn from the whole top tier.

## 4. Chosen archetypes — Ace and Mihawk

**Portgas.D.Ace — `OP16-001`** · Red · 5 Life · 5000 · trait *Whitebeard Pirates*
> [Activate: Main] [Once Per Turn] Up to 1 of your [Monkey.D.Luffy] Characters or up to 1 of your
> Characters with a type including "Whitebeard Pirates", with 8000 power or more, gains [Rush] during this turn.

Tempo leader. Conversion plan is: land a large Whitebeard body, attack immediately.

**Dracule Mihawk — `OP14-020`** · Green · 5 Life · 5000 · attribute *Slash* · Block 4
> If your opponent's Leader has the \<Slash\> attribute, this Leader gains +1000 power.
> [Activate: Main] [Once Per Turn] You may rest 1 of your cards: If there is a Character with a cost
> of 5 or more, set up to 3 of your DON!! cards as active. Then, you cannot play Character cards during this turn.

DON!! refund engine — converts an established big board into an oversized attack/counter turn. Gated
on already having a 5+ cost Character out, and the "no Characters this turn" clause is a real trap
for a new pilot.

Red and Green respectively: **two separate builds, no shared package.**

## 5. What OP17 gives them

Provisional — only ~135 OP17 cards revealed. Set releases EN 2026-08-28, SC ~2026-08-23.

**Ace — one real gain:**

| ID | Card | Relevance |
|---|---|---|
| **OP17-005** | Edward Newgate — 10c, **12000 power**, cost −4 if opponent has a 10000+ power Character | Effectively a 6-cost 12000 body, over Ace's 8000 threshold. Ace grants it [Rush]. **This is the thesis.** |

> **OP17-005 challenged and upheld, 2026-08-16.** A web-search summary claimed an additional
> On Play that sets your own single-colour Leader's base power to 8000 until the opponent's
> next end phase — a real cost, since it would shrink your own Leader. Checked against
> Limitless: **the aggregator is wrong and the row above stands.** This is the second time an
> aggregator has returned garbled text for a card in this project. Do not re-add that clause.
| OP17-009 | Rakuyo — 3c 2000, On Play K.O. up to 2 Characters with ≤2000 base power | Ungated |
| OP17-010 | Fossa — 1c 3000, Blocker +2000 if opponent has a 10000+ Character | Ungated |
| OP17-014 | Whitey Bay — 1c 1000, On Play K.O. ≤2000 base power | Ungated |
| OP17-018 | "Has The Power To Destroy The World!!" — Counter +4000 if you control 2+ 8000-power Characters | Ungated |

**Locked out** — gated on *"if your Leader is [Edward Newgate]"* by NAME, not by the Whitebeard
Pirates trait: OP17-013 Ace (his own card), OP17-003 Izo, OP17-007 Kouzuki Oden.
**Ace inherits the bodies; Newgate inherits the engine.**

Three WB cards key off *"opponent has a 10000+ power Character"* — the package punishes big-board
decks, so its value is metagame-dependent.

**Mihawk — nothing found.** No Mihawk card and no Cross Guild / Seven Warlords support in the
revealed pool. OP17's Green slot (OP17-020+) is Shanks / Red-Haired Pirates. Recheck when spoilers
complete; absence from spoilers is not absence from the set.

## 6. OP17 leaders

| ID | Leader | Color | Effect |
|---|---|---|---|
| OP17-001 | Edward Newgate | Red | On Opponent's Attack, once/turn: trash 1 card → Leader or 1 Character +4000 during that battle |
| OP17-020 | Shanks | Green | Discard or rest DON!! → lock opponent's rested Characters through their next refresh |
| OP17-039 | Rocks.D.Xebec | Blue | Not yet confirmed |
| OP17-058 | Kaido | Purple | Pay 1 DON!! → −2000 power to an opposing Character |
| OP17-079 | Monkey D. Luffy | — | Straw Hat / Elbaf, not yet detailed |
| OP17-099 | Charlotte.Linlin | Yellow | On attack, discard → opponent chooses: they discard+draw, or you discard+draw |

**Big Mom is a life-cycling attrition engine** — Cracker (OP17-104) and Katakuri (OP17-103) stock Life
from deck, which simultaneously gains life and plants Triggers; OP17-112 gives Trigger Characters
+4000 base power; Pudding (OP17-109) trashes surplus Triggers to draw 3; 3 Sweet Commanders
(OP17-114) does draw + add-to-Life + double debuff. Closed value loop, wins by attrition.

It is also **the archetype ladder data most understates** (see §1) *and* the hardest in the set to
pilot. If a future assessment uses ladder-derived numbers to rank it, adjust upward and say so.

## 7. Reference decklist — B/Y Marshall.D.Teach (`OP16-080`)

Kept as the best-documented meta list. 50 cards, all OP09/OP16, zero rotation exposure.

4× OP16-104 Catarina Devon · 4× OP16-106 Sanjuan Wolf · 4× OP16-108 Shiryu · 4× OP16-109 Doc Q ·
4× OP16-110 Vasco Shot · 4× OP16-119 Marshall.D.Teach · 4× OP09-086 Jesus Burgess ·
4× OP09-093 Marshall.D.Teach · 4× OP16-116 Zehahahahaha! · 4× OP09-096 My Era...Begins!! ·
4× OP09-099 Fullalead · 2× OP16-102 Avalo Pizarro · 2× OP16-103 Van Augur · 2× OP16-114 Laffitte

The three 2-ofs are the flex slots.

## Sources

- [Limitless — metagame](https://onepiece.limitlesstcg.com/decks) · [OP16-001 Ace](https://onepiece.limitlesstcg.com/cards/OP16-001) · [OP14-020 Mihawk](https://onepiece.limitlesstcg.com/cards/OP14-020)
- [OP16 win matrix, 213k games](https://opdecks.xyz/winmatrix/op16)
- [OP17 revealed cards](https://opdeckguide.com/cards-list/OP17/) · [OP17 card details](https://spellmana.com/op17-cards-one-piece-card-game/)
- [Official B/Y Teach deck](https://en.onepiece-cardgame.com/feature/deck/deck_107.php) · [Comprehensive Rules](https://asia-en.onepiece-cardgame.com/pdf/rule_comprehensive.pdf)
