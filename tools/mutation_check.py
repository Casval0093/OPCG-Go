#!/usr/bin/env python3
"""Prove a card's tests can actually fail.

Task 2 shipped three assertions that could not fail — a test with the right name, the right
comment, and no power to detect the defect it claimed to cover:

  * two `zone: "character"` conditions that silently excluded the Leader; both tests stayed green
    under the wrong encoding
  * a name filter that a trait filter would have satisfied equally
  * a `cardCategory` filter whose test used an Event, which the engine had already excluded
    upstream, so the filter was never consulted

All three were found by hand, by reverting the encoding and watching for a red test. That does not
scale to 220 cards. This automates it: perturb the encoding, re-run only that card's tests, and
require them to go red. A mutant that SURVIVES is a test that cannot fail.

    python3 tools/mutation_check.py --set OP16                 # every encoded OP16 card
    python3 tools/mutation_check.py --card OP16-029            # one card
    python3 tools/mutation_check.py --set OP16 --engine PATH   # against a private engine clone
    python3 tools/mutation_check.py --vendor-set OP06          # an UPSTREAM set, in vendor/

`--set` is for a set whose encoding this repo owns (OP15/OP16): the repo copy is pristine and
mutants are written into the engine's copy. `--vendor-set` is for the 1769 pre-OP15 encodings the
vendored engine owns, where there is no second copy — the original is held in memory and written
back in a `finally`, so an interrupted run does not leave a mutant behind. Their tests are found by
reading every `.test.ts` for the card id rather than by deriving a filename, because upstream files
the same card under three different naming conventions.

Exit 1 if any mutant survives. Wire it into a batch's own verification so the batch proves its
tests rather than asserting they are fine.

The operators below are deliberately narrow. They mutate the *decision surface* — the filters,
thresholds, zones and once-per-turn flags that encode a ruling — and not the effect's shape. A
broad mutation engine would spend most of its runtime generating mutants no test should be expected
to catch, and the point here is signal about ruling conformance, not a coverage percentage.
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

ENGINE_DEFAULT = "vendor/tcg-engines/submodules/one-piece/packages/engine"
# The cards package is deliberately NOT a constant: it is resolved as a sibling of whichever engine
# --engine selects. A repo-relative constant here is what made mutants land in the wrong tree while
# the tests ran in a clone, reporting every mutant as a survivor.
TYPES = ("leaders", "characters", "events", "stages")


class Mutant:
    def __init__(self, label: str, source: str):
        self.label = label
        self.source = source


def _at(src: str, offset: int) -> str:
    """1-based line number of an offset. Two mutation sites can otherwise produce identical
    labels — Ace has `value: 8000` twice, one per clause — and a report that cannot say which
    one survived sends you looking in the wrong place."""
    return f"L{src.count(chr(10), 0, offset) + 1}"


def _mask_comments(src: str) -> str:
    """Blank out comment bodies, preserving length so offsets still index into the original.

    Without this the site finder matches code-shaped text inside comments. It really happened:
    `057-captain-buggy-s-our-savior.ts` documents its own fix as "`zone: \"field\"`, not
    `zone: \"character\"`" two lines above the real condition, so the first match was prose. The
    tool mutated a comment, nothing changed, the test passed, and it was reported as a surviving
    mutant — a false accusation against a test that was in fact load-bearing.
    """
    out = list(src)
    for m in re.finditer(r"//[^\n]*|/\*.*?\*/", src, re.S):
        for i in range(m.start(), m.end()):
            if out[i] != "\n":
                out[i] = " "
    return "".join(out)


def _filter_spans(scan: str) -> list[tuple[int, int, str]]:
    """Every `{ filter: "..." ... }` object, as (start, end, filter name).

    `end` swallows a following comma so deleting the span leaves valid TypeScript in both the
    inline (`[{ a }, { b }]`) and block layouts. Nested braces are matched properly, so a filter
    containing an object literal is removed whole rather than clipped.
    """
    spans = []
    for m in re.finditer(r'\{\s*filter:\s*"(\w+)"', scan):
        depth = 0
        i = m.start()
        while i < len(scan):
            if scan[i] == "{":
                depth += 1
            elif scan[i] == "}":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        if depth != 0:
            continue  # unbalanced; skip rather than emit a mutant that will not compile
        end = i + 1
        j = end
        while j < len(scan) and scan[j] in " \t":
            j += 1
        if j < len(scan) and scan[j] == ",":
            end = j + 1
        spans.append((m.start(), end, m.group(1)))
    return spans


def _close_brace(scan: str, open_i: int) -> int | None:
    """Index just past the `}` matching the `{` at open_i, or None if unbalanced."""
    depth = 0
    i = open_i
    while i < len(scan):
        if scan[i] == "{":
            depth += 1
        elif scan[i] == "}":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return None


def _effects_spans(scan: str) -> list[tuple[int, int]]:
    r"""(start, end) brace spans of each card-level `effects: { … }` body.

    The new operators are scoped to this body: unscoped, the card's own `name:`, its printings'
    `id:` and `artVariants[].type:` all become false mutation sites (see
    docs/mutation-operators.md). `\beffects:\s*{` matches only the CardEffects block — neither
    `effect: "…"` text fields nor the nested `effects: [` action arrays, and `\b` keeps
    `permanentEffects:`/`replacementEffects:` from matching.
    """
    spans = []
    for m in re.finditer(r"\beffects:\s*\{", scan):
        open_i = scan.index("{", m.start())
        end = _close_brace(scan, open_i)
        if end is not None:
            spans.append((open_i, end))
    return spans


def _innermost_object(scan: str, pos: int) -> tuple[int, int] | None:
    """Brace span of the innermost `{ … }` enclosing `pos`.

    The type-validity guards have to key on the enclosing OBJECT's own keys — not a character
    window — because e.g. a `player:` site and the `self: true` that forbids flipping it are
    siblings in the same `Target` object (docs/mutation-operators.md, "Type-validity traps").
    """
    stack: list[int] = []
    home: int | None = None
    for i in range(pos):
        if scan[i] == "{":
            stack.append(i)
        elif scan[i] == "}":
            if stack:
                stack.pop()
    if not stack:
        return None
    home = stack[-1]
    end = _close_brace(scan, home)
    return (home, end) if end is not None else None


def _swallow_comma(scan: str, end: int) -> int:
    """Extend a deletion span past a following comma, so deleting an array element or an object
    member leaves valid TypeScript in both the inline and block layouts. Inline whitespace after
    the comma goes too, so `[ "a", "b" ]` narrows to `[ "b" ]`, not `[  "b" ]`. Newlines are
    kept: the next element's indentation is its own."""
    j = end
    while j < len(scan) and scan[j] in " \t":
        j += 1
    if j < len(scan) and scan[j] == ",":
        j += 1
        while j < len(scan) and scan[j] in " \t":
            j += 1
        return j
    return end


def _mutants(src: str) -> list[Mutant]:
    """Generate perturbations of a card's encoding, each targeting a real past defect.

    Sites are located in a comment-masked copy and applied to the real source, so offsets line up
    but prose is never mutated.

    Operators 6–11 (the widened set, adopted from docs/mutation-operators.md ranks 1–6) are
    scoped to the card-level `effects: { … }` body; operators 1–5 predate the scoping and are
    left byte-identical so their numbers remain comparable to the 2026-08-19 baseline.
    """
    out: list[Mutant] = []
    scan = _mask_comments(src)
    spans = _effects_spans(scan)

    def scoped(pos: int) -> bool:
        return any(s <= pos < e for s, e in spans)

    # 1. Delete each filter object. Catches "this filter is never consulted" — the cardCategory
    #    case, and any filter a test's fixtures happen to satisfy either way.
    #
    #    Brace-matched rather than regexed to a line shape. An earlier version required the closing
    #    `}` to be followed by an optional comma and a newline, which silently skipped the inline
    #    form `filters: [{ filter: "name", value: "Bunkov" }]` — the exact shape both decisive name
    #    filters in this set use. The tool reported "all mutants killed" while never testing whether
    #    a name restriction was protected at all: the tool had the very blind spot it exists to find.
    for start, end, name in _filter_spans(scan):
        out.append(
            Mutant(f"delete filter:{name} @{_at(src, start)}", src[:start] + src[end:])
        )

    # 2. Flip comparisons. `eq` -> `gte` is the exact shape of ruling #962: "power 8000" means
    #    exactly 8000, and a `gte` encoding reads naturally but is wrong.
    for frm, to in (("gte", "lte"), ("lte", "gte"), ("eq", "gte")):
        needle = f'comparison: "{frm}"'
        for m in re.finditer(re.escape(needle), scan):
            out.append(
                Mutant(
                    f"comparison {frm}->{to} @{_at(src, m.start())}",
                    src[: m.start()] + f'comparison: "{to}"' + src[m.end() :],
                )
            )

    # 3. Perturb numeric thresholds by one power step. OPTCG power is quantised to 1000, so this
    #    is the smallest change that can alter which bodies qualify.
    for m in re.finditer(r"value:\s*(\d{3,6})\b", scan):
        v = int(m.group(1))
        if v < 1000:
            continue
        out.append(
            Mutant(
                f"value {v}->{v - 1000} @{_at(src, m.start())}",
                src[: m.start()] + f"value: {v - 1000}" + src[m.end() :],
            )
        )

    # 4. Narrow the zone. This is the C1/C2 defect verbatim: `field` includes the Leader,
    #    `character` does not, and rulings #979/#993 turn on exactly that.
    for m in re.finditer(r'zone: "field"', scan):
        out.append(
            Mutant(
                f'zone field->character @{_at(src, m.start())}',
                src[: m.start()] + 'zone: "character"' + src[m.end() :],
            )
        )

    # 5. Drop the once-per-turn guard. `finditer`, not `search`: a card can carry more than one
    #    such guard (OP12-081 has two) and mutating only the first silently under-reports the gap.
    for m in re.finditer(r"oncePerTurn: true", scan):
        out.append(
            Mutant(
                f"drop oncePerTurn @{_at(src, m.start())}",
                src[: m.start()] + "oncePerTurn: false" + src[m.end() :],
            )
        )

    # ── Widened set (docs/mutation-operators.md ranks 1–6, adopted 2026-08-21) ──
    # Each models a defect class the original five cannot reach; together they take the
    # zero-mutant population from ~20 % of the corpus to ~2 cards.

    # 6. Flip player scoping. "KO one of your opponent's Characters" encoded as `self` is
    #    invisible to every operator above, and player: is the second-largest decision site in
    #    the corpus (~3,400). Two exclusions, both keyed on the innermost enclosing object:
    #    a `self: true` Target already pins the side (flipping `player` there is half a defect),
    #    and a `shuffleDeck` action's `player` flip is an EQUIVALENT mutant — the opponent's
    #    deck order is as unknown to the test as your own.
    for m in re.finditer(r'player:\s*"(self|opponent)"', scan):
        if not scoped(m.start()):
            continue
        obj = _innermost_object(scan, m.start())
        body = scan[obj[0] : obj[1]] if obj else ""
        if re.search(r"\bself:\s*true\b", body) or "shuffleDeck" in body:
            continue
        frm, to = m.group(1), "opponent" if m.group(1) == "self" else "self"
        out.append(
            Mutant(
                f"player {frm}->{to} @{_at(src, m.start())}",
                src[: m.start()] + f'player: "{to}"' + src[m.end() :],
            )
        )

    # 7. Delete a condition object — the "gate no test consults" shape of operator 1, in the
    #    `conditions:` / `condition:` spelling. Two guards, both from the type declarations:
    #    `ConditionalAction.predicate` is a REQUIRED Condition, so a `{ condition: … }` object
    #    that is the value of a `predicate:` key must be skipped (deleting it breaks the build,
    #    and deleting the key breaks it worse); and in the singular form the object is the value
    #    of an OPTIONAL `condition:` key, so the key must go with the object — deleting the
    #    object alone emits `condition: ,`.
    for m in re.finditer(r'\{\s*condition:\s*"(\w+)"', scan):
        if not scoped(m.start()):
            continue
        end = _close_brace(scan, m.start())
        if end is None:
            continue
        key = re.search(r"(\w+)\s*:\s*$", scan[: m.start()])
        if key:
            if key.group(1) == "predicate":
                continue
            # Singular `condition: { … }` (or any other key): remove key AND object.
            start, stop = key.start(1), _swallow_comma(scan, end)
        else:
            # Array element under `conditions: [ … ]`.
            start, stop = m.start(), _swallow_comma(scan, end)
        out.append(
            Mutant(f"delete condition:{m.group(1)} @{_at(src, start)}", src[:start] + src[stop:])
        )

    # 8. Negative values: sign flip, plus one power step for debuffs of 1000+. Operator 3's
    #    regex cannot match a leading `-`, so every debuff in the corpus went unmutated — the
    #    exact field where tools/variant_audit.py found 16 printings that lost their `−`.
    for m in re.finditer(r"value:\s*(-\d{1,6})\b", scan):
        if not scoped(m.start()):
            continue
        v = int(m.group(1))
        out.append(
            Mutant(
                f"value {v}->{-v} @{_at(src, m.start())}",
                src[: m.start()] + f"value: {-v}" + src[m.end() :],
            )
        )
        if -v >= 1000:
            stepped = v + 1000  # -3000 -> -2000: one power step towards zero
            out.append(
                Mutant(
                    f"value {v}->{stepped} @{_at(src, m.start())}",
                    src[: m.start()] + f"value: {stepped}" + src[m.end() :],
                )
            )

    # 9. Narrow `zones: […]` by dropping "leader". This is operator 4's real target in the
    #    spelling the corpus actually uses: `Target` declares `zones: Zone[]` and the
    #    Leader-inclusion distinction (rulings #979/#993, the C1/C2 defect) lives on the
    #    ~270 `["leader", "character"]` sites, not on the 27 singular `zone:` ones. Narrowing
    #    only — widening is rejected (the Leader is not a legal object for ko/trash/return, so
    #    the widened mutant is exactly equivalent), and dropping `"leader"` from a `Zone[]` is
    #    always type-valid.
    for m in re.finditer(r"zones:\s*\[([^\]]*)\]", scan):
        if not scoped(m.start()):
            continue
        members = re.findall(r'"([^"]+)"', m.group(1))
        if "leader" not in members or len(members) < 2:
            continue
        lm = re.search(r'"leader"', m.group(1))
        assert lm is not None
        a, b = m.start(1) + lm.start(), m.start(1) + lm.end()
        rest = scan[b : m.end() - 1]
        if rest.lstrip().startswith(","):
            # leader is not the last element: remove it and the following comma
            b = _swallow_comma(scan, b)
            while a > m.start(1) and scan[a - 1] in " \t":
                a -= 1  # keep `["character"]` rather than `[ "character"]`
        else:
            # leader is last: remove the preceding comma too
            a = scan.rfind(",", m.start(1), a)
        out.append(
            Mutant(
                f'zones drop "leader" @{_at(src, a)}',
                src[:a] + src[b:],
            )
        )

    # 10. Lower an `amount:` by one (N ≥ 2), outside `upTo` blocks. Models "up to 2" encoded as
    #     "up to 1" — or exactly-2 as exactly-1. The widening direction is rejected: raising an
    #     upper bound the fixture does not saturate is unobservable, so only the narrowing
    #     direction can be killed. An `upTo: true` sibling means the amount is already an upper
    #     bound the test may not saturate; skip those sites rather than manufacture survivors.
    for m in re.finditer(r"amount:\s*(\d+)", scan):
        if not scoped(m.start()):
            continue
        n = int(m.group(1))
        if n < 2:
            continue
        obj = _innermost_object(scan, m.start())
        if obj and re.search(r"\bupTo:\s*true\b", scan[obj[0] : obj[1]]):
            continue
        out.append(
            Mutant(
                f"amount {n}->{n - 1} @{_at(src, m.start())}",
                src[: m.start()] + f"amount: {n - 1}" + src[m.end() :],
            )
        )

    # 11. Drop one keyword from a `keywords: […]` grant — a missing or spurious [Blocker] /
    #     [Rush]. One mutant per member, so a two-keyword grant is checked on both halves.
    for m in re.finditer(r"keywords:\s*\[([^\]]*)\]", scan):
        if not scoped(m.start()):
            continue
        for km in re.finditer(r'"([^"]+)"', m.group(1)):
            kw = km.group(1)
            a, b = m.start(1) + km.start(), m.start(1) + km.end()
            rest = scan[b : m.end() - 1]
            if rest.lstrip().startswith(","):
                b = _swallow_comma(scan, b)
                while a > m.start(1) and scan[a - 1] in " \t":
                    a -= 1
            else:
                prev = scan.rfind(",", m.start(1), a)
                if prev != -1:
                    a = prev
            out.append(
                Mutant(
                    f'keywords drop "{kw}" @{_at(src, a)}',
                    src[:a] + src[b:],
                )
            )

    return out

class Task:
    """One card to mutation-check.

    `read_path` holds the pristine encoding; `write_path` is where mutants are written for the
    engine to compile. For OP15/OP16 those differ — the repo owns the encoding and `vendor/` is a
    disposable copy — and for an upstream set they are the same file, which is why the original is
    always kept in memory and written back rather than re-copied from a source that may not exist.
    """

    def __init__(self, card_id: str, read_path: str, write_path: str, tests: list[str],
                 inert: list[str] | None = None):
        self.card_id = card_id
        self.read_path = read_path
        self.write_path = write_path
        self.tests = tests
        self.inert = inert or []


_encoded_defs = card_deps.encoded_defs


CARD_ID_RE = card_deps.CARD_ID_RE


def _test_index(engine: str, cards_root: str) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    """(real, inert) attribution — see tools/card_deps.py for why it is by imported symbol."""
    a = card_deps.Attribution(engine, cards_root)
    return a.attr, a.inert_attr


def _tasks(repo: str, engine: str, cards_root: str, repo_sets: list[str],
           vendor_sets: list[str], only: str | None) -> list[Task]:
    tasks: list[Task] = []
    index, inert = _test_index(engine, cards_root) if vendor_sets else ({}, {})

    for set_id in repo_sets:
        for card_id, path, fn in _encoded_defs(os.path.join(repo, "cards"), set_id):
            if only and card_id != only:
                continue
            rel = os.path.relpath(path, os.path.join(repo, "cards"))
            test = os.path.join(repo, "cards", "tests", set_id, fn.replace(".ts", ".test.ts"))
            tests = []
            if os.path.exists(test):
                tests = [os.path.join("tests", "cards", set_id, fn.replace(".ts", ".test.ts"))]
            tasks.append(Task(card_id, path, os.path.join(cards_root, rel), tests))

    for set_id in vendor_sets:
        for card_id, path, _fn in _encoded_defs(cards_root, set_id):
            if only and card_id != only:
                continue
            tasks.append(Task(card_id, path, path, index.get(card_id, []), inert.get(card_id, [])))
    return tasks


NO_FILES = re.compile(r"No test files found")
FILE_COUNT = re.compile(r"Test Files.*?\((\d+)\)")


def _run_tests(engine: str, rel_tests: list[str]) -> tuple[bool, int]:
    """(tests passed, number of test FILES vitest actually selected).

    The file count is the load-bearing half. `vp test run` treats each argument as a substring
    filter over discovered paths; a filter that matches nothing exits non-zero with
    "No test files found", which a returncode-only check reads as a red test — i.e. as a killed
    mutant. A run that selected 0 files proves nothing and must never be scored.
    """
    proc = subprocess.run(
        # --maxWorkers=1 is a throughput setting, not a correctness one. vitest defaults its pool
        # to one worker per core, so eight concurrent sweeps fork ~80 workers onto 10 cores and
        # thrash: measured 8-way, one file each, 24s constrained against a load average north of 20
        # unconstrained. Aggregate throughput is ~0.33 runs/s either way, but constrained leaves the
        # machine usable.
        ["./node_modules/.bin/vp", "test", "run", "--maxWorkers=1", *rel_tests],
        cwd=engine,
        capture_output=True,
        text=True,
    )
    out = proc.stdout + proc.stderr
    if NO_FILES.search(out):
        return (proc.returncode == 0, 0)
    m = FILE_COUNT.search(out)
    n = int(m.group(1)) if m else (len(rel_tests) if proc.returncode == 0 else 0)
    return (proc.returncode == 0, n)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--set", dest="sets", action="append", default=None,
                    help="a set the REPO owns the encoding for: OP15 / OP16")
    ap.add_argument("--vendor-set", dest="vendor_sets", action="append", default=None,
                    help="a set the vendored engine owns: OP01..OP14EB04, EB01-03, PRB01/02, ST01")
    ap.add_argument("--card", default=None, help="a single card id, e.g. OP16-029")
    ap.add_argument("--engine", default=ENGINE_DEFAULT, help="engine root (use a clone when parallel)")
    ap.add_argument("--repo", default=".", help="repo root")
    ap.add_argument("--jsonl", default=None, help="append one JSON record per card, for aggregation")
    ap.add_argument("--resume", action="store_true",
                    help="skip cards already recorded in --jsonl")
    ap.add_argument("--max-cards", type=int, default=None,
                    help="stop cleanly after N cards, so a sweep runs in bounded, resumable batches")
    args = ap.parse_args()

    repo = os.path.abspath(args.repo)
    engine = os.path.join(repo, args.engine) if not os.path.isabs(args.engine) else args.engine
    engine = os.path.abspath(engine)
    if not os.path.isdir(engine):
        print(f"engine not found: {engine} — run ./scripts/bootstrap.sh", file=sys.stderr)
        return 1

    # Mutants must be written into the cards package of the SELECTED engine. Deriving this from
    # `repo` instead broke the documented parallel-clone workflow outright: with `--engine` pointing
    # at a private clone, mutations landed in the repo's vendor tree while the tests ran against the
    # clone's untouched encodings, so every mutant was reported as a survivor. `packages/cards` is a
    # sibling of `packages/engine`, so resolve it from there.
    cards_root = os.path.join(os.path.dirname(engine), "cards", "src", "cards")
    if not os.path.isdir(cards_root):
        print(f"cards package not found next to the engine: {cards_root}", file=sys.stderr)
        return 1

    repo_sets = args.sets or ([] if args.vendor_sets else ["OP15", "OP16"])
    vendor_sets = args.vendor_sets or []
    tasks = _tasks(repo, engine, cards_root, repo_sets, vendor_sets, args.card)
    if not tasks:
        print("no hand-authored encodings found — nothing to check")
        return 0

    done: set[str] = set()
    if args.resume and args.jsonl and os.path.exists(args.jsonl):
        with open(args.jsonl, encoding="utf-8") as fh:
            for line in fh:
                try:
                    done.add(json.loads(line)["card"])
                except Exception:
                    pass
        tasks = [t for t in tasks if t.card_id not in done]
        print(f"resuming: {len(done)} card(s) already recorded, {len(tasks)} to go")

    if args.max_cards is not None:
        tasks = tasks[: args.max_cards]

    sink = open(args.jsonl, "a", encoding="utf-8") if args.jsonl else None

    # A mutant lives on disk only between the write and the next write-back. For an upstream set
    # that file is the ONLY copy of the encoding, so a plain SIGTERM — which is what pausing a
    # batch sends — would terminate without running the `finally` and leave the tree mutated. The
    # handler below re-raises as an exception so the `finally` runs, and `pending` covers the
    # window before the try block is entered.
    pending: dict[str, tuple[str, str]] = {}

    class Paused(Exception):
        pass

    def _pause(signum, _frame):  # noqa: ANN001
        raise Paused(f"signal {signum}")

    def _restore_pending() -> None:
        for path, original in pending.items():
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(original)

    signal.signal(signal.SIGTERM, _pause)
    signal.signal(signal.SIGINT, _pause)
    survivors: list[tuple[str, str]] = []
    total = 0
    unverifiable = 0

    def record(card_id: str, status: str, killed: int, n: int, labels: list[str]) -> None:
        if sink:
            sink.write(json.dumps({"card": card_id, "status": status, "killed": killed,
                                   "mutants": n, "survivors": labels}) + "\n")
            sink.flush()

    for t in tasks:
        with open(t.read_path, encoding="utf-8") as fh:
            original = fh.read()
        muts = _mutants(original)

        if not t.tests:
            why = (f"only inert test(s): {', '.join(t.inert)}" if t.inert else "no test file")
            print(f"{t.card_id}: {'NO EFFECTIVE TEST' if t.inert else 'NO TEST FILE'} — cannot verify")
            survivors.append((t.card_id, why))
            record(t.card_id, "no-effective-test" if t.inert else "no-test", 0, len(muts), [why])
            continue
        if not muts:
            # The operators found no decision surface: no filter, threshold, zone or once-per-turn
            # flag to perturb. Not a pass and not a failure — report it separately so a run over
            # a whole set cannot be quoted as "every encoding verified".
            print(f"-- {t.card_id}: 0 mutants (no decision surface this tool can perturb)")
            unverifiable += 1
            record(t.card_id, "no-mutants", 0, 0, [])
            continue

        # A baseline run guards against reporting "all mutants killed" when the suite was already
        # red for an unrelated reason — or when the filter selected nothing at all.
        with open(t.write_path, "w", encoding="utf-8") as fh:
            fh.write(original)
        ok, nfiles = _run_tests(engine, t.tests)
        if nfiles == 0:
            print(f"{t.card_id}: FILTER MATCHED NO FILES ({t.tests}) — cannot verify")
            survivors.append((t.card_id, "filter matched no files"))
            record(t.card_id, "no-files", 0, len(muts), ["filter matched no files"])
            continue
        if not ok:
            print(f"{t.card_id}: BASELINE FAILS — fix the test before mutation-checking")
            survivors.append((t.card_id, "baseline red"))
            record(t.card_id, "baseline-red", 0, len(muts), ["baseline red"])
            continue

        killed = 0
        mine: list[str] = []
        pending[t.write_path] = original
        try:
            for mut in muts:
                total += 1
                with open(t.write_path, "w", encoding="utf-8") as fh:
                    fh.write(mut.source)
                ok, nfiles = _run_tests(engine, t.tests)
                if nfiles == 0:
                    survivors.append((t.card_id, f"{mut.label} [no files]"))
                    mine.append(f"{mut.label} [no files]")
                elif ok:
                    survivors.append((t.card_id, mut.label))
                    mine.append(mut.label)
                else:
                    killed += 1
        except Paused:
            _restore_pending()
            print(f"\npaused during {t.card_id}; encoding restored. Re-run with --resume.", flush=True)
            if sink:
                sink.close()
            return 130
        finally:
            # Always put the real encoding back. For an upstream set this file is the only copy.
            with open(t.write_path, "w", encoding="utf-8") as fh:
                fh.write(original)
            pending.pop(t.write_path, None)

        mark = "ok " if killed == len(muts) else "!! "
        print(f"{mark}{t.card_id}: {killed}/{len(muts)} mutants killed", flush=True)
        record(t.card_id, "ok" if killed == len(muts) else "survivors", killed, len(muts), mine)

    if sink:
        sink.close()
    print(f"\n{total - len([s for s in survivors if not s[1].startswith(('no test', 'baseline', 'filter'))])}"
          f"/{total} mutants killed across {len(tasks)} card(s)")
    if unverifiable:
        print(f"{unverifiable} card(s) produced 0 mutants — NOT verified, just unperturbable")
    if survivors:
        print("\nSURVIVORS — these tests cannot fail on the thing they claim to cover:")
        for card_id, label in survivors:
            print(f"  {card_id}  {label}")
        print("\nEither the assertion is vacuous, or the fixtures satisfy the encoding either way.")
        return 1
    print("every mutant killed — each encoding's tests are load-bearing")
    return 0


if __name__ == "__main__":
    sys.exit(main())
