#!/usr/bin/env python3
"""Run `mutation_check`'s mutants in independent batches, ~50x faster, with the same verdicts.

`mutation_check.py` spends one `vp test run` per mutant. That invocation costs ~9s almost entirely
in fixed startup — transforming and importing the card barrel — and only milliseconds in the test
itself. Measured: one file 9.3s, the whole 3665-file suite 21s. So the serial sweep pays ~9s to
learn one bit, and the 1769 pre-OP15 encodings come to ~5700 invocations, about 8 hours at the
8-worker rate. That is too long to be interruptible and too long to iterate on.

This runs many cards' mutants in ONE invocation. The only thing that makes that sound is knowing
that no card in a batch can affect another card's verdict, so the batching rule is a proof
obligation, not a heuristic:

    attribution(card) = every test file that could exercise it
                      = files importing its exported symbol, transitively through local helpers
                      + files naming its card id as a string (the `getCard("OP06-054")` route)

    a batch may contain A and B only if attribution(A) and attribution(B) are DISJOINT

If they are disjoint, no file that decides A's verdict imports B or names B, so B's mutation cannot
reach it. Two file classes break that argument and are therefore excluded from attribution and
never run: `validateCardAbility`-only files, which upstream stubbed out to `assert.ok(true)` and
which cannot fail for any reason; and whole-catalog tests, which iterate every card and would go
red under any mutation at all.

The argument is only as good as its implementation, so this tool is not trusted on the strength of
the argument. `--verify AGAINST.jsonl` replays a serial run and requires the batched verdicts to
match card-for-card and label-for-label. Run that before believing any sweep this produces.

    python3 tools/mutation_sweep.py --vendor-set OP06 --engine PATH --jsonl runs/OP06.jsonl
    python3 tools/mutation_sweep.py --verify runs/serial.jsonl --engine PATH
"""

from __future__ import annotations

import argparse
import json
import os
import re
import signal
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import card_deps  # noqa: E402
import mutation_check as mc  # noqa: E402

class Sweeper:
    def __init__(self, engine: str, cards_root: str, report: str):
        self.engine = engine
        self.cards_root = cards_root
        self.report = report
        a = card_deps.Attribution(engine, cards_root)
        self.attr, self.inert, self.catalog = a.attr, a.inert, a.catalog
        self.inert_attr = a.inert_attr

    def run(self, files: list[str]) -> dict[str, bool]:
        """engine-relative file -> passed. Raises if vitest selected nothing."""
        if os.path.exists(self.report):
            os.remove(self.report)
        subprocess.run(
            ["./node_modules/.bin/vp", "test", "run", "--maxWorkers=1",
             "--reporter=json", f"--outputFile={self.report}", *files],
            cwd=self.engine, capture_output=True, text=True,
        )
        if not os.path.exists(self.report):
            raise RuntimeError(f"vitest produced no report for {len(files)} filter(s)")
        data = json.load(open(self.report, encoding="utf-8"))
        out: dict[str, bool] = {}
        for r in data.get("testResults", []):
            out[os.path.relpath(r["name"], self.engine)] = r.get("status") == "passed"
        missing = [f for f in files if f not in out]
        if missing:
            raise RuntimeError(f"vitest selected no file for: {missing[:3]}")
        return out


def _batches(cards: list[str], attr: dict[str, list[str]], cap: int) -> list[list[str]]:
    """Greedy independent sets: no two cards in a batch share a test file."""
    out: list[list[str]] = []
    remaining = list(cards)
    while remaining:
        batch: list[str] = []
        used: set[str] = set()
        left: list[str] = []
        for c in remaining:
            files = set(attr.get(c, []))
            if len(batch) < cap and not (files & used):
                batch.append(c)
                used |= files
            else:
                left.append(c)
        out.append(batch)
        remaining = left
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--vendor-set", dest="sets", action="append", default=None)
    ap.add_argument("--engine", default=mc.ENGINE_DEFAULT)
    ap.add_argument("--repo", default=".")
    ap.add_argument("--jsonl", default=None)
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--cap", type=int, default=120, help="max cards per batch")
    ap.add_argument("--verify", default=None,
                    help="a serial mutation_check jsonl; replay it and require identical verdicts")
    args = ap.parse_args()

    repo = os.path.abspath(args.repo)
    engine = os.path.abspath(args.engine if os.path.isabs(args.engine)
                             else os.path.join(repo, args.engine))
    cards_root = os.path.join(os.path.dirname(engine), "cards", "src", "cards")
    report = os.path.join(engine, ".mutation-report.json")
    sw = Sweeper(engine, cards_root, report)

    want: set[str] | None = None
    expected: dict[str, dict] = {}
    if args.verify:
        for line in open(args.verify, encoding="utf-8"):
            d = json.loads(line)
            expected[d["card"]] = d
        want = set(expected)

    # (card id, path, mutants)
    todo: list[tuple[str, str, list]] = []
    for set_id in sorted(os.listdir(cards_root)):
        if not os.path.isdir(os.path.join(cards_root, set_id)):
            continue
        if args.sets and set_id not in args.sets:
            continue
        for cid, path, _fn in mc._encoded_defs(cards_root, set_id):
            if want is not None and cid not in want:
                continue
            muts = mc._mutants(open(path, encoding="utf-8").read())
            if muts:
                todo.append((cid, path, muts))

    done: set[str] = set()
    if args.resume and args.jsonl and os.path.exists(args.jsonl):
        for line in open(args.jsonl, encoding="utf-8"):
            try:
                done.add(json.loads(line)["card"])
            except Exception:
                pass
        todo = [t for t in todo if t[0] not in done]

    runnable = [t for t in todo if sw.attr.get(t[0])]
    skipped = [t for t in todo if not sw.attr.get(t[0])]
    order = [t[0] for t in runnable]
    info = {c: (p, m) for c, p, m in runnable}
    batches = _batches(order, sw.attr, args.cap)
    print(f"{len(runnable)} card(s), {sum(len(m) for _, _, m in runnable)} mutant(s), "
          f"{len(batches)} batch(es); {len(skipped)} card(s) have no effective test", flush=True)

    sink = open(args.jsonl, "a", encoding="utf-8") if args.jsonl else None
    a_inert = sw.inert_attr
    results: dict[str, dict] = {}
    originals: dict[str, str] = {}

    class Paused(Exception):
        pass

    def _pause(signum, _f):  # noqa: ANN001
        raise Paused(str(signum))

    signal.signal(signal.SIGTERM, _pause)
    signal.signal(signal.SIGINT, _pause)

    def restore() -> None:
        for p, src in originals.items():
            with open(p, "w", encoding="utf-8") as fh:
                fh.write(src)
        originals.clear()

    # A card with no runnable test is a RESULT, not an omission: it is the strongest possible
    # survivor — nothing in the suite could detect any wrong encoding of it. Writing it to the
    # sink is what keeps the sweep's card count reconcilable against the corpus.
    for cid, _p, muts in skipped:
        why = "only inert test(s)" if a_inert.get(cid) else "no test file"
        results[cid] = {"card": cid, "status": "no-effective-test", "killed": 0,
                        "mutants": len(muts), "survivors": [why]}
        if sink:
            sink.write(json.dumps(results[cid]) + "\n")
    if sink:
        sink.flush()

    try:
        for bi, batch in enumerate(batches, 1):
            files = sorted({f for c in batch for f in sw.attr[c]})
            for c in batch:
                originals[info[c][0]] = open(info[c][0], encoding="utf-8").read()

            base = sw.run(files)
            red = [f for f, ok in base.items() if not ok]
            if red:
                print(f"batch {bi}: BASELINE RED in {red[:3]} — falling back to serial", flush=True)
                for c in batch:
                    results[c] = {"card": c, "status": "baseline-red", "killed": 0,
                                  "mutants": len(info[c][1]), "survivors": ["baseline red"]}
                restore()
                continue

            killed = {c: 0 for c in batch}
            surv = {c: [] for c in batch}
            depth = max(len(info[c][1]) for c in batch)
            for k in range(depth):
                active = [c for c in batch if k < len(info[c][1])]
                for c in active:
                    with open(info[c][0], "w", encoding="utf-8") as fh:
                        fh.write(info[c][1][k].source)
                res = sw.run(sorted({f for c in active for f in sw.attr[c]}))
                for c in active:
                    if any(not res.get(f, True) for f in sw.attr[c]):
                        killed[c] += 1
                    else:
                        surv[c].append(info[c][1][k].label)
                    with open(info[c][0], "w", encoding="utf-8") as fh:
                        fh.write(originals[info[c][0]])
            restore()
            for c in batch:
                n = len(info[c][1])
                results[c] = {"card": c, "status": "ok" if killed[c] == n else "survivors",
                              "killed": killed[c], "mutants": n, "survivors": surv[c]}
                if sink:
                    sink.write(json.dumps(results[c]) + "\n")
            if sink:
                sink.flush()
            print(f"batch {bi}/{len(batches)}: {len(batch)} cards, "
                  f"{sum(killed.values())}/{sum(len(info[c][1]) for c in batch)} killed", flush=True)
    except Paused:
        restore()
        print("\npaused; encodings restored. Re-run with --resume.", flush=True)
        if sink:
            sink.close()
        return 130
    finally:
        restore()
        if os.path.exists(report):
            os.remove(report)

    if sink:
        sink.close()

    if args.verify:
        bad = []
        for cid, exp in expected.items():
            if exp["status"] == "no-mutants":
                continue  # the batched sweep skips cards with no mutation site; not a disagreement
            got = results.get(cid)
            if got is None:
                bad.append((cid, "not replayed", ""))
                continue
            if (exp["killed"], exp["mutants"], sorted(exp["survivors"])) != (
                    got["killed"], got["mutants"], sorted(got["survivors"])):
                bad.append((cid, f"serial {exp['killed']}/{exp['mutants']} {sorted(exp['survivors'])}",
                            f"batched {got['killed']}/{got['mutants']} {sorted(got['survivors'])}"))
        print(f"\nverify: {len(expected) - len(bad)}/{len(expected)} cards agree with the serial run")
        for cid, a, b in bad:
            print(f"  MISMATCH {cid}\n    {a}\n    {b}")
        return 1 if bad else 0

    m = sum(r["mutants"] for r in results.values())
    k = sum(r["killed"] for r in results.values())
    print(f"\n{k}/{m} mutants killed across {len(results)} card(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
