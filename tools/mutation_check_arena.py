#!/usr/bin/env python3
"""Mutation check for the arena decision log's test suite.

Why this exists as a committed tool rather than a one-off I ran once:

CLAUDE.md records that tests which cannot fail are this project's most frequent defect -- task 2
shipped three of them, each with the right name, the right comment, and no power to detect the thing
it claimed to cover, and two review rounds missed some. `tools/mutation_check.py` exists for the card
encodings for exactly that reason. `arena/log.test.ts` makes the same class of promise about the
decision corpus, so it gets the same instrument.

Each mutant below breaks ONE behaviour that one named test claims to cover. A mutant that survives
(suite still green) means that test is vacuous, and this script exits 1 naming it.

    python3 tools/mutation_check_arena.py
    python3 tools/mutation_check_arena.py --list

Stdlib only, matching bootstrap.sh's constraint: no venv needed.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SUITE = "arena/log.test.ts"


@dataclass(frozen=True)
class Mutant:
    """One deliberate defect. `find` must appear EXACTLY once in `path`, or the mutant is stale."""

    name: str
    path: str
    find: str
    replace: str
    # The test whose failure proves the mutant was caught. Recorded so a surviving mutant names the
    # vacuous test rather than just "something is wrong".
    covered_by: str


MUTANTS: tuple[Mutant, ...] = (
    Mutant(
        name="buffered-writes",
        path="arena/log.ts",
        find="""    let written = 0;
    while (written < payload.length) {
      written += writeSync(fd, payload, written, payload.length - written);
    }""",
        replace="    buffered.push(payload.toString());",
        covered_by="a record is on disk BEFORE the log is closed",
    ),
    Mutant(
        name="tear-never-reported",
        path="arena/log.ts",
        find="  const torn = tail.trim().length > 0;",
        replace="  const torn = false;",
        covered_by="a torn final line is reported",
    ),
    Mutant(
        name="unknown-type-counted-as-known",
        path="arena/log.ts",
        find="      unknown++;\n      continue;",
        replace="      entries.push(parsed);\n      continue;",
        covered_by="a record of an unknown type is counted, not thrown",
    ),
    Mutant(
        name="write-after-close-silently-dropped",
        path="arena/log.ts",
        find='    if (!open) throw new Error("decision log is closed");',
        replace="    if (!open) return;",
        covered_by="writing to a closed log throws",
    ),
    Mutant(
        name="contested-ignores-author",
        path="arena/log.ts",
        find='      (d.author !== "heuristic" && (d.reason ?? "").trim().length > 0),',
        replace='      ((d.reason ?? "").trim().length > 0),',
        covered_by="contested ignores a heuristic's reason",
    ),
    Mutant(
        name="position-key-ignores-menu",
        path="arena/log.ts",
        find="  return stableFingerprint([position, menu.map((m) => m.label)]);",
        replace="  return stableFingerprint([position]);",
        covered_by="positionKey is stable across key order and moves with the menu",
    ),
    Mutant(
        name="menu-keeps-nulls",
        path="arena/log.ts",
        find="  if (choice.note) out.note = choice.note;",
        replace="  out.note = choice.note as string;",
        covered_by="menuOf keeps the fields a policy needs and drops the nulls",
    ),
    Mutant(
        name="sink-drops-the-game-index",
        path="arena/log.ts",
        find="    decision: (entry) => writer.decision({ game, ...entry }),",
        replace="    decision: (entry) => writer.decision({ game: 0, ...entry }),",
        covered_by="sinkFor stamps the game index",
    ),
    Mutant(
        name="transcript-hides-refusals",
        path="arena/log.ts",
        find="""    for (const rejection of entry.rejections) {
      out.push(`         REFUSED [${rejection.i}] ${short(rejection.label, 60)} \\u2014 ${short(rejection.reason, 90)}`);
    }
    if (options.verbose) {""",
        replace="    if (options.verbose) {",
        covered_by="the transcript shows the pick, the forced steps, an abort and its refusals",
    ),
    Mutant(
        name="summarise-authors-by-agent-name",
        path="arena/log.ts",
        find="  for (const d of all) byAuthor.set(d.author, (byAuthor.get(d.author) ?? 0) + 1);",
        replace='  for (const d of all) byAuthor.set(d.agent.startsWith("human") ? "human" : "model", '
        '(byAuthor.get(d.agent.startsWith("human") ? "human" : "model") ?? 0) + 1);',
        covered_by="summarise reports authorship",
    ),
    Mutant(
        name="stamp-keeps-colons",
        path="arena/log.ts",
        find='  return now.toISOString().replace(/\\.\\d+Z$/, "").replace(/:/g, "-");',
        replace='  return now.toISOString().replace(/\\.\\d+Z$/, "");',
        covered_by="logStamp is filename-safe",
    ),
    Mutant(
        name="no-mkdir",
        path="arena/log.ts",
        find="  mkdirSync(dirname(path), { recursive: true });\n  const fd = openSync(path, \"a\");",
        replace='  const fd = openSync(path, "a");',
        covered_by="openDecisionLog creates the directory it was pointed at",
    ),
    Mutant(
        name="corrupt-middle-line-is-fatal",
        path="arena/log.ts",
        find="""    } catch {
      corrupt++;
      continue;
    }""",
        replace="""    } catch (error) {
      throw error;
    }""",
        covered_by="a corrupt MIDDLE line is skipped and counted, not fatal",
    ),
    Mutant(
        name="default-path-drops-the-pid",
        path="arena/log.ts",
        find='  return resolve(root, "arena/logs", `${logStamp(now)}-${pid}.jsonl`);',
        replace='  return resolve(root, "arena/logs", `${logStamp(now)}.jsonl`);',
        covered_by="the default log path cannot collide between two runs in the same second",
    ),
    Mutant(
        name="out-of-range-request-hidden",
        path="arena/log.ts",
        find="    if (entry.requestedIndex !== null) {",
        replace="    if (false) {",
        covered_by="an out-of-range request is recorded separately",
    ),
    Mutant(
        name="truncate-instead-of-append",
        path="arena/log.ts",
        find='  const fd = openSync(path, "a");',
        replace='  const fd = openSync(path, "w");',
        covered_by="an append reopens rather than truncates",
    ),
)

# NOT MUTATED, deliberately: the short-write LOOP inside `write` (writeSync can return fewer bytes than
# asked and does not retry). A regular-file write does not come back short in practice, so a test
# claiming to cover it would pass with the loop deleted -- i.e. it would be exactly the vacuous test
# this harness exists to catch. The loop stays as documented defence, with no coverage claimed for it.
#
# `buffered-writes` needs a declaration to push into, or it is a compile error rather than a mutant.
PRELUDE = {
    "buffered-writes": (
        "  const fd = openSync(path, \"a\");",
        "  const fd = openSync(path, \"a\");\n  const buffered: string[] = [];",
    ),
}


def run_suite() -> tuple[bool, str]:
    proc = subprocess.run(
        ["node", "--test", SUITE],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    return proc.returncode == 0, proc.stdout + proc.stderr


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list", action="store_true", help="print the mutants and exit")
    parser.add_argument("--only", default="", help="run one mutant by name")
    args = parser.parse_args()

    if args.list:
        for mutant in MUTANTS:
            print(f"{mutant.name:38} {mutant.path:16} <- {mutant.covered_by}")
        return 0

    baseline_green, output = run_suite()
    if not baseline_green:
        print("BASELINE IS RED -- fix the suite before mutating it.\n")
        print(output[-3000:])
        return 2
    print(f"baseline: {SUITE} green\n")

    survivors: list[Mutant] = []
    selected = [m for m in MUTANTS if not args.only or m.name == args.only]
    if not selected:
        print(f"no mutant named {args.only!r}")
        return 2

    for mutant in selected:
        target = ROOT / mutant.path
        original = target.read_text()
        occurrences = original.count(mutant.find)
        if occurrences != 1:
            print(f"STALE  {mutant.name}: anchor appears {occurrences} times in {mutant.path}")
            survivors.append(mutant)
            continue

        mutated = original.replace(mutant.find, mutant.replace)
        if mutant.name in PRELUDE:
            find, replace = PRELUDE[mutant.name]
            mutated = mutated.replace(find, replace, 1)
        target.write_text(mutated)
        try:
            green, _ = run_suite()
        finally:
            target.write_text(original)

        if green:
            print(f"SURVIVED  {mutant.name}  -- '{mutant.covered_by}' cannot detect it")
            survivors.append(mutant)
        else:
            print(f"caught    {mutant.name}")

    print()
    if survivors:
        print(f"{len(survivors)} of {len(selected)} mutant(s) survived -- those tests are vacuous.")
        return 1
    print(f"all {len(selected)} mutant(s) caught: every test can fail.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
