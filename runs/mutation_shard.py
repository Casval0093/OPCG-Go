#!/usr/bin/env python3
"""Run `mutation_check.py` over OP15/OP16 in parallel across APFS engine clones, then aggregate.

WHY THIS EXISTS, stated correctly. `tools/mutation_sweep.py` DOES cover OP15/OP16 -- runs/sweep_all.sh
already launches both through it -- so the first version of this docstring was wrong to say it does
not. The real distinction is which COPY of the encoding is treated as the source of truth.
`--vendor-set` reads and mutates the encoding in the grafted `vendor/` tree and attributes tests by
imported symbol; `--set` reads the pristine encoding from `cards/` and derives the test path from the
card filename, which is the documented-correct path for the two sets this repo owns
(docs/plans/encode-op15-op16.md, Global Constraint #1). Only `--set` has no batched implementation,
and serially it is ~4-5 hours for 213 cards -- ~4 vitest runs each at ~12s, transform/import
dominating. Corroborated by the actual run: 5 workers, 14:35 to 15:36, ~5 core-hours.

Two consequences worth knowing. The `--vendor-set` sweep SKIPS zero-mutant cards rather than
recording them, so its files hold 94/86 cards where these hold 105/108; and it cannot see a test
file that exists in `cards/tests/` but not in the graft.

WHAT IT IS NOT. It is not a new verdict path. Every card is checked by invoking
`tools/mutation_check.py --card <id>` -- the tool's own code, one process per card -- so the
verdicts are the tool's, card for card, and the only thing this file decides is which worker runs
which card. That matters because the sweep tool had to earn trust with `--verify`; this one does not
need to, because it does not batch and it does not reimplement anything.

    ./runs/mutation_shard.py --clones .mut/w1 .mut/w2 .mut/w3      # run
    ./runs/mutation_shard.py --aggregate                            # report from runs/mut-OP1*.jsonl

Each clone is a full engine tree made with `cp -Rc vendor/tcg-engines DEST` (APFS copy-on-write:
~11s, near-zero disk). One PER WORKER is mandatory, not an optimisation -- mutation_check writes the
mutant into the cards package next to the engine it is told to use, so two workers sharing a tree
overwrite each other's mutants and every verdict becomes noise.

`--aggregate` is the gate. It exits 1 unless every encoded card in both sets has a record and every
record is `ok` or `no-mutants`, and it prints the `no-mutants` count separately: those cards are
UNVERIFIED rather than passing -- the five operators found no filter, threshold, zone or
once-per-turn flag to perturb -- and a run must never be quoted as "every encoding verified".
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "tools"))
import card_deps  # noqa: E402

SETS = ("OP15", "OP16")


def _cards() -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for set_id in SETS:
        for card_id, _path, _fn in card_deps.encoded_defs(os.path.join(REPO, "cards"), set_id):
            out.append((set_id, card_id))
    return sorted(out)


def _jsonl(set_id: str) -> str:
    # `runs/<SET>.jsonl`, the naming runs/README.md documents and runs/status.sh globs. An earlier
    # version wrote `runs/mut-<SET>.jsonl` and that was a real defect, not a cosmetic one: status.sh
    # keys the set name off the basename, so `mut-OP15` became a set with a ZERO denominator, its
    # mutants were added to the TOTAL numerator, and the aggregate read 3750/5372 instead of
    # 3208/4830. It also left two competing result files per set with nothing saying which was true.
    # These results supersede the `--vendor-set` sweep's: same cards, same operators, same verdicts,
    # but the `--set` path is the documented-correct one for the two sets this repo OWNS (it reads
    # the encoding from cards/ rather than from the grafted copy) and it records zero-mutant cards
    # instead of skipping them.
    return os.path.join(REPO, "runs", f"{set_id}.jsonl")


def _records() -> list[dict]:
    recs: list[dict] = []
    for set_id in SETS:
        path = _jsonl(set_id)
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line:
                    recs.append(json.loads(line))
    return recs


def aggregate() -> int:
    recs = _records()
    # Last record wins, so a re-run of one card supersedes its earlier verdict rather than
    # double-counting it. The files are append-only by design (mutation_check opens them "a").
    by_card = {r["card"]: r for r in recs}
    expected = {card_id for _set, card_id in _cards()}
    missing = sorted(expected - set(by_card))
    extra = sorted(set(by_card) - expected)

    ok = [r for r in by_card.values() if r["status"] == "ok"]
    unperturbable = [r for r in by_card.values() if r["status"] == "no-mutants"]
    bad = [r for r in by_card.values() if r["status"] not in ("ok", "no-mutants")]

    mutants = sum(r["mutants"] for r in by_card.values())
    killed = sum(r["killed"] for r in by_card.values())
    print(f"cards expected {len(expected)}  recorded {len(by_card)}")
    print(f"  ok              {len(ok)}")
    print(f"  no-mutants      {len(unperturbable)}   <- UNVERIFIED, not passing")
    print(f"  other           {len(bad)}")
    print(f"mutants {killed}/{mutants} killed")
    if extra:
        print(f"\nrecords for cards not currently encoded ({len(extra)}): {', '.join(extra)}")
    if missing:
        print(f"\nMISSING records ({len(missing)}): {', '.join(missing)}")
    for r in bad:
        print(f"  {r['card']}  {r['status']}  survivors={r['survivors']}")
    if missing or bad:
        print("\nNOT a pass.")
        return 1
    print("\nevery recorded mutant killed; no card is missing a record")
    return 0


def run(clones: list[str], fresh: bool) -> int:
    cards = _cards()
    print(f"{len(cards)} encoded card(s) across {'+'.join(SETS)}, {len(clones)} worker(s)",
          flush=True)
    engines = []
    for clone in clones:
        engine = os.path.join(clone, "submodules/one-piece/packages/engine")
        if not os.path.isdir(engine):
            print(f"not an engine clone: {engine}\n"
                  f"make one with: cp -Rc vendor/tcg-engines {clone}", file=sys.stderr)
            return 1
        engines.append(os.path.realpath(engine))
    if len(set(engines)) != len(engines):
        print("two workers were given the SAME engine clone. mutation_check writes its mutant into\n"
              "the cards package beside the engine it is told to use, so a shared tree makes the\n"
              "workers overwrite each other's mutants and every verdict becomes noise.",
              file=sys.stderr)
        return 1

    done = set() if fresh else {r["card"] for r in _records() if r["status"] in ("ok", "no-mutants")}
    if fresh:
        for set_id in SETS:
            path = _jsonl(set_id)
            if os.path.exists(path):
                os.replace(path, path + ".prev")
        print("fresh run: previous results moved aside to <SET>.jsonl.prev", flush=True)
    elif done:
        print(f"resuming: {len(done)} card(s) already recorded", flush=True)
    todo = [(s, c) for s, c in cards if c not in done]
    shards = [todo[i :: len(engines)] for i in range(len(engines))]
    lock = threading.Lock()
    failed: list[str] = []

    def work(index: int) -> None:
        for set_id, card_id in shards[index]:
            proc = subprocess.run(
                [sys.executable, "tools/mutation_check.py", "--set", set_id, "--card", card_id,
                 "--engine", engines[index], "--jsonl", _jsonl(set_id)],
                cwd=REPO, capture_output=True, text=True,
            )
            with lock:
                head = next((l for l in proc.stdout.splitlines() if l.strip()),
                            proc.stderr.strip()[:120])
                print(f"[{index}] {card_id} exit={proc.returncode} :: {head}", flush=True)
                if proc.returncode != 0:
                    failed.append(card_id)

    threads = [threading.Thread(target=work, args=(i,)) for i in range(len(engines))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    print(f"\nall shards complete; {len(failed)} card(s) exited non-zero", flush=True)
    return aggregate()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--clones", nargs="+", default=None,
                    help="one APFS engine clone per worker (cp -Rc vendor/tcg-engines DEST)")
    ap.add_argument("--fresh", action="store_true",
                    help="ignore and set aside existing results instead of resuming; without this a "
                         "re-run of an already-complete set verifies NOTHING")
    ap.add_argument("--aggregate", action="store_true",
                    help="report and gate on runs/mut-OP15.jsonl + mut-OP16.jsonl; no runs")
    args = ap.parse_args(argv)
    if args.aggregate:
        return aggregate()
    if not args.clones:
        ap.error("pass --clones, or --aggregate to report on an existing run")
    return run(args.clones, args.fresh)


if __name__ == "__main__":
    sys.exit(main())
