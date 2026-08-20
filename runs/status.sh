#!/usr/bin/env bash
# Aggregate the mutation sweep. Totals are derived from the corpus, not hardcoded, so a set that
# is only half swept reports as half swept instead of silently reporting 100%.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python3 - "$ROOT" <<'PY'
import glob, json, os, sys, collections
sys.path.insert(0, os.path.join(sys.argv[1], "tools"))
import card_deps as cd, mutation_check as mc
root = sys.argv[1]
C = os.path.join(root, "vendor/tcg-engines/submodules/one-piece/packages/cards/src/cards")
total = collections.Counter()
if os.path.isdir(C):
    for s in sorted(os.listdir(C)):
        if not os.path.isdir(os.path.join(C, s)):
            continue
        for _cid, p, _f in cd.encoded_defs(C, s):
            with open(p, encoding="utf-8") as fh:
                if mc._mutants(fh.read()):
                    total[s] += 1
rows = []
m = k = 0
st = collections.Counter()
surv = 0
for f in sorted(glob.glob(os.path.join(root, "runs", "*.jsonl"))):
    s = os.path.basename(f)[:-6]
    done = sm = sk = 0
    for line in open(f, encoding="utf-8"):
        d = json.loads(line)
        st[d["status"]] += 1
        if d["status"] == "no-mutants":
            continue
        done += 1
        sm += d["mutants"]
        sk += d["killed"]
        surv += len(d["survivors"])
    rows.append((s, done, total.get(s, 0), sk, sm))
    m += sm
    k += sk
print(f"{'set':10} {'cards':>13} {'mutants killed':>16}")
for s, done, tot, sk, sm in rows:
    pct = f"{100*done/tot:.0f}%" if tot else "  -"
    kp = f"{100*sk/sm:.0f}%" if sm else "  -"
    print(f"{s:10} {done:5}/{tot:<5} {pct:>4}  {sk:5}/{sm:<5} {kp:>4}")
if m:
    print(f"{'TOTAL':10} {sum(r[1] for r in rows):5}/{sum(total.values()):<5}"
          f"       {k:5}/{m:<5} {100*k/m:4.1f}% killed")
print("statuses:", dict(st))
print("survivor labels:", surv)
PY
