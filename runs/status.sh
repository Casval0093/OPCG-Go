#!/usr/bin/env bash
# Aggregate the sweep so far.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python3 - "$ROOT" <<'PY'
import glob, json, os, sys, collections
root = sys.argv[1]
TOT = {"EB01":42,"EB02":50,"EB03":52,"OP01":77,"OP02":79,"OP03":72,"OP04":84,"OP05":93,
       "OP06":94,"OP07":84,"OP08":94,"OP09":82,"OP10":97,"OP11":91,"OP12":80,"OP13":77,
       "OP14EB04":121,"PRB01":7,"PRB02":43}
rows=[]; m=k=0; surv=[]; st=collections.Counter()
for f in sorted(glob.glob(os.path.join(root,"runs","*.jsonl"))):
    s=os.path.basename(f)[:-6]; done=0; sm=sk=0
    for line in open(f, encoding="utf-8"):
        d=json.loads(line); st[d["status"]]+=1
        if d["status"] in ("no-mutants",): continue
        done+=1; sm+=d["mutants"]; sk+=d["killed"]
        for lab in d["survivors"]: surv.append((d["card"],lab))
    rows.append((s,done,TOT.get(s,0),sk,sm)); m+=sm; k+=sk
print(f"{'set':10} {'cards':>12} {'mutants killed':>16}")
for s,done,tot,sk,sm in rows:
    pct=f"{100*done/tot:.0f}%" if tot else "-"
    print(f"{s:10} {done:5}/{tot:<5} {pct:>3}  {sk:5}/{sm:<5}")
print(f"{'TOTAL':10} {sum(r[1] for r in rows):5}/{sum(TOT.values()):<5}      {k:5}/{m:<5}"
      f"   ({100*k/m:.1f}% killed)" if m else "")
print("statuses:", dict(st))
print(f"survivors so far: {len(surv)}")
PY
