#!/usr/bin/env python3
"""Phase 2.2 analysis: play/draw split per arm, and PAIRED differences between arms.

The four arms run identical seeds, decks, policies and game order, so game i in one arm and game i
in another begin identically. That makes a paired estimator available, which matters because the
effect being measured (a few points of play/draw gap) is small next to the ~7-point CI an
independent 400-game proportion carries.

Point estimator for a paired win-rate difference is the SAME one the harness already uses for deck
variants (`pairedDiff` in sim/matchup.sim.test.ts): per-index difference, normal-approximation CI,
pairs where either side never finished are SKIPPED rather than scored as losses. The gap difference
needs a paired BOOTSTRAP instead, because a gap is a difference of two proportions computed on
disjoint halves of the same run.
"""
import json, math, os, sys, random

random.seed(20260820)  # fixed: a bootstrap CI that moves between reads is not a measurement

# Defaults to the committed Phase 2 rows sitting beside this script; pass another directory to
# re-analyse a later run.
DATA_DIR = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))


def load(path):
    with open(path) as fh:
        d = json.load(fh)
    for key in ("baseline", "games", "results", "rows"):
        if isinstance(d.get(key), list) and d[key] and isinstance(d[key][0], dict) and "outcome" in d[key][0]:
            return d, d[key]
    for k, v in d.items():
        if isinstance(v, list) and v and isinstance(v[0], dict) and "outcome" in v[0]:
            return d, v
    raise SystemExit(f"{path}: no per-game array found; keys = {list(d)}")


def wilson(k, n):
    if n == 0:
        return (0.0, 0.0, 0.0)
    p = k / n
    z = 1.96
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (100 * p, 100 * max(0.0, c - h), 100 * min(1.0, c + h))


def summarise(rows):
    fin = [r for r in rows if r["outcome"] in ("win", "loss", "timeout")]
    wins = sum(1 for r in fin if r["outcome"] == "win")
    play = [r for r in fin if r["aOnPlay"]]
    draw = [r for r in fin if not r["aOnPlay"]]
    pw = sum(1 for r in play if r["outcome"] == "win")
    dw = sum(1 for r in draw if r["outcome"] == "win")
    return {
        "n": len(fin),
        "unfinished": len(rows) - len(fin),
        "overall": wilson(wins, len(fin)),
        "play": wilson(pw, len(play)),
        "draw": wilson(dw, len(draw)),
        "gap": (100 * pw / len(play) - 100 * dw / len(draw)) if play and draw else 0.0,
        "timeouts": sum(1 for r in fin if r["outcome"] == "timeout"),
        "turns": sum(r["turns"] for r in fin) / max(1, len(fin)),
        "cmds": sum(r["commands"] for r in fin) / max(1, len(fin)),
    }


def gap_of(rows):
    play = [r for r in rows if r["aOnPlay"]]
    draw = [r for r in rows if not r["aOnPlay"]]
    if not play or not draw:
        return 0.0
    pw = sum(1 for r in play if r["outcome"] == "win") / len(play)
    dw = sum(1 for r in draw if r["outcome"] == "win") / len(draw)
    return 100 * (pw - dw)


def paired_winrate(a, b):
    """The harness's own pairedDiff, recomputed here."""
    n = min(len(a), len(b))
    diffs, skipped = [], 0
    for i in range(n):
        if a[i]["outcome"] == "unfinished" or b[i]["outcome"] == "unfinished":
            skipped += 1
            continue
        diffs.append((1 if a[i]["outcome"] == "win" else 0) - (1 if b[i]["outcome"] == "win" else 0))
    if not diffs:
        return None
    m = len(diffs)
    mean = sum(diffs) / m
    var = sum((d - mean) ** 2 for d in diffs) / max(1, m - 1)
    se = math.sqrt(var / m)
    return {"mean": 100 * mean, "lo": 100 * (mean - 1.96 * se), "hi": 100 * (mean + 1.96 * se),
            "n": m, "discordant": sum(1 for d in diffs if d != 0), "skipped": skipped}


def paired_gap(a, b, iters=20000):
    """Paired bootstrap over game INDICES for the difference of play/draw gaps."""
    n = min(len(a), len(b))
    idx = [i for i in range(n)
           if a[i]["outcome"] != "unfinished" and b[i]["outcome"] != "unfinished"]
    if not idx:
        return None
    point = gap_of([a[i] for i in idx]) - gap_of([b[i] for i in idx])
    draws = []
    for _ in range(iters):
        s = [random.choice(idx) for _ in idx]
        draws.append(gap_of([a[i] for i in s]) - gap_of([b[i] for i in s]))
    draws.sort()
    return {"point": point, "lo": draws[int(0.025 * iters)], "hi": draws[int(0.975 * iters)],
            "n": len(idx)}


ARMS = {}
for name, fn in [("A", "armA-mihawk.json"), ("B", "armB-mihawk.json"),
                 ("C", "armC-mihawk.json"), ("D", "armD-mihawk.json"),
                 ("A-ace", "armA-ace.json"), ("B-ace", "armB-ace.json")]:
    p = os.path.join(DATA_DIR, fn)
    if os.path.exists(p):
        ARMS[name] = load(p)[1]

LABEL = {
    "A": "ban ON,  counters ON   (current engine)",
    "B": "ban OFF, counters ON   (isolates the attack ban)",
    "C": "ban ON,  counters OFF  (isolates the counter policy)",
    "D": "ban OFF, counters OFF  (the PRE-PHASE-1 engine)",
    "A-ace": "ban ON,  counters ON   (ace-op16, the primary deck)",
    "B-ace": "ban OFF, counters ON   (ace-op16, pre-fix rules)",
}

print("PER-ARM  (mihawk-green-proxy mirror, valueRanked both seats, seed 424242)\n")
hdr = f"{'arm':6} {'rules':38} {'n':>4} {'overall':>22} {'on play':>22} {'on draw':>22} {'gap':>8} {'TO':>4} {'turns':>6} {'cmds':>7}"
print(hdr)
print("-" * len(hdr))
S = {}
for k, rows in ARMS.items():
    s = summarise(rows)
    S[k] = s
    f = lambda t: f"{t[0]:.2f}% [{t[1]:.1f},{t[2]:.1f}]"
    print(f"{k:6} {LABEL[k]:38} {s['n']:>4} {f(s['overall']):>22} {f(s['play']):>22} "
          f"{f(s['draw']):>22} {s['gap']:>7.2f} {s['timeouts']:>4} {s['turns']:>6.1f} {s['cmds']:>7.1f}")

print("\nPAIRED DIFFERENCES  (same seeds, same seat order; only discordant pairs carry information)\n")
for x, y, what in [("A", "B", "the first-turn attack ban"),
                   ("A", "C", "the counter policy"),
                   ("D", "A", "all of Phase 1 together"),
                   ("C", "D", "the attack ban, with counters OFF"),
                   ("B", "D", "the counter policy, with the ban OFF"),
                   ("A-ace", "B-ace", "the attack ban ON THE PRIMARY DECK")]:
    if x not in ARMS or y not in ARMS:
        continue
    w = paired_winrate(ARMS[x], ARMS[y])
    g = paired_gap(ARMS[x], ARMS[y])
    print(f"{x} - {y}   ({what})")
    if w:
        print(f"   overall win rate  {w['mean']:+.2f} pts  95% CI [{w['lo']:+.2f}, {w['hi']:+.2f}]"
              f"   discordant {w['discordant']}/{w['n']}"
              + (f"   skipped {w['skipped']}" if w["skipped"] else ""))
    if g:
        sig = "SIGNIFICANT" if (g["lo"] > 0 or g["hi"] < 0) else "not significant"
        print(f"   play/draw GAP     {g['point']:+.2f} pts  95% CI [{g['lo']:+.2f}, {g['hi']:+.2f}]"
              f"   (paired bootstrap, n={g['n']})  {sig}")
    print()
