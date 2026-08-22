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
            with open(path, encoding="utf-8") as fh:
                muts = mc._mutants(fh.read())
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
    # Sort by mutant count so a batch's depth (its max) sits close to its members' average.
    # A batch costs (1 + depth) vitest runs; in corpus order one 17-mutant card sets the depth
    # for 15 near-empty neighbours, and on a slow host such a batch can exceed a bounded run
    # window outright. Sorting cuts total runs by ~40 %. Order-only: verdicts and the
    # disjointness invariant are unaffected, and recorded cards from an unsorted partial run
    # remain valid under --resume.
    runnable.sort(key=lambda t: len(t[2]))
    order = [t[0] for t in runnable]
    info = {c: (p, m) for c, p, m in runnable}
    batches = _batches(order, sw.attr, args.cap)
    print(f"{len(runnable)} card(s), {sum(len(m) for _, _, m in runnable)} mutant(s), "
          f"{len(batches)} batch(es); {len(skipped)} card(s) have no effective test", flush=True)

    sink = open(args.jsonl, "a", encoding="utf-8") if args.jsonl else None
    a_inert = sw.inert_attr
    results: dict[str, dict] = {}
    originals: dict[str, str] = {}

    # Mid-card progress, persisted per set: card -> {"k": next mutant index, "killed", "surv"}.
    # Records are only written per COMPLETED batch... was the old design, and it made a batch's
    # full depth payable inside ONE run window: a depth-17 batch is 18 vitest runs ≈ 4.5 min on
    # a slow host, longer than any bounded window, so every pause restarted it and its cards made
    # zero progress forever. Progress turns the per-card verdict loop resumable at any step. It
    # is verdict-neutral: a card's verdict for mutant k depends only on its own test files and
    # its own mutant, and every batch it runs inside is disjoint by construction.
    progress_path = (args.jsonl + ".progress.json") if args.jsonl else None
    progress: dict[str, dict] = {}
    if args.resume and progress_path and os.path.exists(progress_path):
        try:
            with open(progress_path, encoding="utf-8") as fh:
                progress = {c: p for c, p in json.load(fh).items() if c not in done}
        except Exception:
            progress = {}

    def save_progress() -> None:
        if not progress_path:
            return
        tmp = progress_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(progress, fh)
        os.replace(tmp, progress_path)

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
                with open(info[c][0], encoding="utf-8") as fh:
                    originals[info[c][0]] = fh.read()

            base = sw.run(files)
            red = {f for f, ok in base.items() if not ok}
            if red:
                # Quarantine only the cards that OWN a red file, and carry on with the rest of the
                # batch. An earlier version marked every card in the batch `baseline-red`, announced
                # a serial fallback it did not perform, and never wrote those records to the sink —
                # so one unrelated red file silently discarded up to 120 healthy cards' measurements
                # while the run still reported success. Batches are disjoint by construction, so a
                # red file belongs to exactly one card and the others are unaffected by it.
                hurt = [c for c in batch if red & set(sw.attr[c])]
                orphan = sorted(red - {f for c in batch for f in sw.attr[c]})
                print(f"batch {bi}: BASELINE RED in {len(red)} file(s); quarantining "
                      f"{len(hurt)} card(s), continuing with {len(batch) - len(hurt)}", flush=True)
                if orphan:
                    # A red file no batch member owns means the tree itself is dirty (a mutant left
                    # behind, a bad graft), not that one card's test is broken. Stop rather than
                    # score anything against it.
                    raise RuntimeError(
                        f"baseline red in file(s) no card in this batch owns: {orphan[:3]} — "
                        "the engine tree is dirty; re-clone it before trusting any verdict"
                    )
                for c in hurt:
                    bad = sorted(red & set(sw.attr[c]))
                    results[c] = {"card": c, "status": "baseline-red", "killed": 0,
                                  "mutants": len(info[c][1]),
                                  "survivors": [f"baseline red: {', '.join(bad)}"]}
                    progress.pop(c, None)
                    if sink:
                        sink.write(json.dumps(results[c]) + "\n")
                if sink:
                    sink.flush()
                for c in hurt:
                    originals.pop(info[c][0], None)
                batch = [c for c in batch if c not in hurt]
                if not batch:
                    restore()
                    continue

            killed = {c: int(progress.get(c, {}).get("killed", 0)) for c in batch}
            surv = {c: list(progress.get(c, {}).get("surv", [])) for c in batch}
            next_k = {c: int(progress.get(c, {}).get("k", 0)) for c in batch}
            recorded: set[str] = set()

            def record_card(c: str) -> None:
                """A card's verdict is final the moment its LAST mutant has run — a pause after
                that point must not discard it."""
                n = len(info[c][1])
                results[c] = {"card": c, "status": "ok" if killed[c] == n else "survivors",
                              "killed": killed[c], "mutants": n, "survivors": surv[c]}
                if sink:
                    sink.write(json.dumps(results[c]) + "\n")
                    sink.flush()
                progress.pop(c, None)
                save_progress()
                recorded.add(c)

            # Each step advances EVERY unfinished card by one mutant in a single vitest run.
            # Cards need not be at the same index: the run writes each card's own current
            # mutant, and the verdict is read back per card from its own files.
            while True:
                # Finalize terminal cards FIRST. `save_progress()` below persists `k` one step
                # before `record_card` writes the row, and the pause handler raises between any
                # two bytecodes, so a pause can land in that window with `k == depth` on disk and
                # no row. Such a card is in neither `done` (no row) nor `active` (`k` is not
                # `< depth`), so a resume that computed `active` first would drop it here and
                # every time after — silently, with exit 0. Recording from the sidecar is exact:
                # `killed`/`surv` were persisted alongside `k`.
                for c in batch:
                    if c not in recorded and next_k[c] == len(info[c][1]):
                        record_card(c)
                active = [c for c in batch
                          if c not in recorded and next_k[c] < len(info[c][1])]
                if not active:
                    break
                for c in active:
                    with open(info[c][0], "w", encoding="utf-8") as fh:
                        fh.write(info[c][1][next_k[c]].source)
                res = sw.run(sorted({f for c in active for f in sw.attr[c]}))
                for c in active:
                    if any(not res.get(f, True) for f in sw.attr[c]):
                        killed[c] += 1
                    else:
                        surv[c].append(info[c][1][next_k[c]].label)
                    with open(info[c][0], "w", encoding="utf-8") as fh:
                        fh.write(originals[info[c][0]])
                    next_k[c] += 1
                    progress[c] = {"k": next_k[c], "killed": killed[c], "surv": surv[c]}
                save_progress()
            restore()
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
