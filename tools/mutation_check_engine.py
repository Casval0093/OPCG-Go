#!/usr/bin/env python3
"""Prove the Phase 1 engine guards can FAIL. Run from the repo root; ~5 min.

    python3 tools/mutation_check_engine.py            # exit 1 if an expected kill survives

The fourth mutation harness in this repo and NOT interchangeable with the other three:
`mutation_check.py` and `mutation_sweep.py` mutate CARD ENCODINGS, `mutation_check_arena.py` mutates
`arena/log.test.ts`, and this one mutates the ENGINE PATCHES in `tools/patch_engine.py` plus the
counter policy they install, checking that `sim/puzzles.test.ts` notices.

Each mutant is either a PATCH REVERT -- rebuild that file from its pristine upstream copy with every
OTHER patch for the file applied -- or a one-line source mutation of the vendored
`counter-policy.ts`. For each: mutate, run the puzzle suite, record which named test went red,
restore from a snapshot taken before anything was touched, and compare against what the mutant was
expected to kill. One mutant is expected to SURVIVE and says so; see docs/simulation.md.

Two bugs in the first version of this file, both worth remembering because they are the failure mode
it exists to catch:
  * reverting by "replace the patched text with the anchor" is wrong for a patch that makes TWO
    replacements (bot-harness.ts) -- it left the import behind, the `already` marker was gone, and
    the next apply added a SECOND import. Every run after that failed at transform time, and
  * the verdict parser did not strip ANSI, so it found no failure names and reported SURVIVED for
    nine mutants while the suite was red for an unrelated reason.
A harness whose check cannot see red is exactly the defect it is meant to find, so this one asserts
its own baseline is green before reading any mutant.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(".")
ENG = os.path.join(ROOT, "vendor/tcg-engines/submodules/one-piece/packages/engine")
POLICY_REL = "src/automation/counter-policy.ts"
POLICY = os.path.join(ENG, POLICY_REL)
ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")

sys.path.insert(0, os.path.join(ROOT, "tools"))
import patch_engine as pe  # noqa: E402

PROBE = "neither player may attack on their own first turn"
COUNTER = "counterPlay (prompt resolver, not scored as policy)"
SURFACES = "the prompt resolver never blocks, and always activates a [Trigger]"
ABILITY = "hasEncodedAbility counts every ability-bearing collection, and only those"
PUZZLES = "puzzles"
HANDPOWER = "hand-card power is printed power, so the two hand reads stay printed"
TESTS = [PROBE, COUNTER, SURFACES, ABILITY, PUZZLES, HANDPOWER, "fixture integrity",
         "no ladder strategy can choose an attack target",
         "drainPrompts resolves a real multi-prompt cascade (not just the no-op branch)"]

MUTANTS = [
    ("revert: first-turn attack ban", "revert", "neither player may attack", [PROBE]),
    ("revert: fixture allowFirstTurnAttacks", "revert", "mid-game fixture is not turn 1", [PROBE]),
    ("revert: counter step wired to the policy", "revert", "resolve the counter step", [COUNTER]),
    ("policy: accept counter sets that do NOT flip the battle", "sub",
     ("if (counter >= needed && cost <= activeDon", "if (counter >= 0 && cost <= activeDon"), [COUNTER]),
    ("policy: never tank -- counter whenever a set exists", "sub",
     ('return empty("tank", { ...context, needed });', 'return spend("within-horizon");'), [COUNTER]),
    ("policy: prefer the LARGEST sufficient set", "sub",
     ("if (a.length !== b.length) return a.length < b.length;",
      "if (a.length !== b.length) return a.length > b.length;"), [COUNTER]),
    ("policy: ignore the enabled:false master switch", "sub",
     ('if (!config.enabled) return empty("disabled");', 'if (false) return empty("disabled");'), [COUNTER]),
    ("policy: misname the avgCost env var", "sub",
     ('avgCost: "OPCG_COUNTER_AVG_COST"', 'avgCost: "OPCG_COUNTER_AVG_COST_TYPO"'), [COUNTER]),
    # The hasEncodedAbility clauses, one mutant each. Codex named `keywords` and `permanentEffects`
    # on PR #24 and missed `replacementEffects`, so that clause gets its own mutant: a fix that
    # covered only the two reported collections has to fail here.
    ("policy: hasEncodedAbility ignores keywords ([Blocker] bodies)", "sub",
     ("(effects.keywords?.length ?? 0) > 0 ||", "false ||"), [ABILITY]),
    ("policy: hasEncodedAbility ignores permanentEffects", "sub",
     ("(effects.permanentEffects?.length ?? 0) > 0 ||", "false ||"), [ABILITY]),
    ("policy: hasEncodedAbility ignores replacementEffects (the one Codex missed)", "sub",
     ("(effects.replacementEffects?.length ?? 0) > 0\n", "false\n"), [ABILITY]),
    ("policy: hasEncodedAbility counts deckBuildingRules as an ability", "sub",
     ("(effects.replacementEffects?.length ?? 0) > 0\n",
      "(effects.replacementEffects?.length ?? 0) > 0 ||\n    (effects.deckBuildingRules?.length ?? 0) > 0\n"),
     [ABILITY]),
    ("policy: hasEncodedAbility calls an effect-less card ability-bearing", "sub",
     ("if (!effects) return false;", "if (!effects) return true;"), [ABILITY]),
    # The printed-power fix. A revert, not a `sub`: `sub` only reaches counter-policy.ts, and the whole point of
    # this mutant is that reverting the helper to printed power has to turn `puzzles` red via
    # `lethal-effective-power-attacker` -- the one puzzle in the file whose answer is not readable
    # off the printed cards.
    ("revert: policy reads printed power, not getCardPower", "revert",
     "the policy compared PRINTED power", [PUZZLES]),
    ("policy: drop the lethal override only", "sub",
     ("if (config.lethalOverride && life === 0) return spend",
      "if (config.lethalOverride && life === -1) return spend"), []),
]

TOUCHED = sorted({p["relpath"] for p in pe.PATCHES} | {POLICY_REL})
OUTPUT = tempfile.mkdtemp(prefix="mutation-check-engine-out-")
snapshot = tempfile.mkdtemp(prefix="mutation-check-engine-")
for rel in TOUCHED:
    src = os.path.join(ENG, rel)
    if os.path.exists(src):
        dst = os.path.join(snapshot, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)


def restore() -> None:
    for rel in TOUCHED:
        src = os.path.join(snapshot, rel)
        dst = os.path.join(ENG, rel)
        if os.path.exists(src):
            shutil.copy2(src, dst)
        elif os.path.exists(dst):
            os.remove(dst)
    check = subprocess.run([sys.executable, "tools/patch_engine.py", "--check"], cwd=ROOT,
                           capture_output=True, text=True)
    if check.returncode != 0:
        raise SystemExit("restore left the tree unpatched:\n" + check.stdout + check.stderr)


def revert_patch(needle: str) -> None:
    """Rebuild the patch's file from upstream with every OTHER patch for that file applied."""
    matches = [p for p in pe.PATCHES if needle.lower() in p["name"].lower()]
    if len(matches) != 1:
        raise SystemExit(f"{len(matches)} patches match {needle!r}")
    target = matches[0]
    rel = target["relpath"]
    if "create" in target:
        if os.path.exists(os.path.join(ENG, rel)):
            os.remove(os.path.join(ENG, rel))
        return
    git = subprocess.run(
        ["git", "show", f"HEAD:submodules/one-piece/packages/engine/{rel}"],
        cwd=os.path.join(ROOT, "vendor/tcg-engines"), capture_output=True, text=True,
    )
    if git.returncode != 0:
        raise SystemExit(f"cannot read pristine {rel}: {git.stderr}")
    source = git.stdout
    for other in pe.PATCHES:
        if other is target or other["relpath"] != rel or "create" in other:
            continue
        source = other["apply"](source)
    with open(os.path.join(ENG, rel), "w", encoding="utf-8") as fh:
        fh.write(source)


def run_suite(tag: str) -> tuple[int, str]:
    env = dict(os.environ, SIM_PUZZLES="1", SIM_ROOT=ROOT, SIM_RUN="1", NO_COLOR="1")
    proc = subprocess.run(
        ["./node_modules/.bin/vp", "test", "run", "tests/cards/puzzles.test.ts", "--reporter=verbose"],
        cwd=ENG, env=env, capture_output=True, text=True,
    )
    text = ANSI.sub("", proc.stdout + proc.stderr)
    with open(os.path.join(OUTPUT, f"mutant-{tag}.txt"), "w", encoding="utf-8") as fh:
        fh.write(text)
    return proc.returncode, text


def red_tests(text: str) -> set[str]:
    out = set()
    for name in TESTS:
        # verbose reporter marks a failing case with a leading x/× and repeats it in a FAIL line.
        if re.search(r"^\s*[x×✗]\s+tests/cards/puzzles\.test\.ts > " + re.escape(name) + r"\s*$",
                     text, re.M):
            out.add(name)
        if re.search(r"FAIL\s+tests/cards/puzzles\.test\.ts > " + re.escape(name) + r"\s*$", text, re.M):
            out.add(name)
    return out


baseline_code, baseline_text = run_suite("baseline")
baseline_red = red_tests(baseline_text)
if baseline_code != 0 or baseline_red:
    raise SystemExit(f"baseline is not green (exit {baseline_code}, red {sorted(baseline_red)}) -- "
                     "fix that before reading any mutant")
print("baseline: green\n")

rows = []
for label, kind, payload, expected in MUTANTS:
    if kind == "revert":
        revert_patch(payload)
    else:
        needle, sub = payload
        source = open(POLICY, encoding="utf-8").read()
        if source.count(needle) != 1:
            restore()
            raise SystemExit(f"{label}: site appears {source.count(needle)} times: {needle!r}")
        open(POLICY, "w", encoding="utf-8").write(source.replace(needle, sub, 1))

    tag = re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")
    code, text = run_suite(tag)
    red = red_tests(text)
    restore()

    if expected:
        killed = bool(red & set(expected))
        verdict = "KILLED" if killed else "SURVIVED"
    else:
        verdict = "SURVIVED (expected)" if code == 0 else f"KILLED (unexpected: {sorted(red)})"
    rows.append((label, code, sorted(red), verdict))
    print(f"{verdict:24} exit={code}  {label}")
    for r in sorted(red):
        print(f"{'':26} red: {r}")

print("\nsummary")
for label, code, red, verdict in rows:
    print(f"  {verdict:24} {label}  (red: {', '.join(red) or 'none'})")
print(f"\nper-mutant output: {OUTPUT}/mutant-*.txt")

survivors = [label for label, _code, _red, verdict in rows if verdict == "SURVIVED"]
if survivors:
    print("\nA SURVIVING MUTANT IS A GUARD THAT CANNOT FAIL:", file=sys.stderr)
    for s in survivors:
        print(f"  {s}", file=sys.stderr)
sys.exit(1 if survivors else 0)
