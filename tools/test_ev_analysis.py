#!/usr/bin/env python3
"""Regression lock for the LEGACY EV command (Task 12).

Two independent things are pinned here, and they are pinned for opposite reasons.

1. The MATHEMATICS must not move. `data/op16-matchup-matrix.json` is a historical EN
   artifact; relabelling it is a provenance change, not a data change, so the six
   field-weighted EV values it produced before this branch must still be produced
   afterwards, to 1e-6. If a "harmless" edit to the matrix or to `field_ev()` moves one
   of them, that is a silent rewriting of the project's own record.

2. The PROVENANCE must be impossible to lose. The command has to say, in
   machine-readable form and before it prints a single number, that this evidence is
   `legacy_unverified`, EN-sourced, `historical_only`, covers 88.29% of the field with
   11.71% unmodelled, and is not eligible to become an Environment. The last of those is
   enforced for real by the environment layer (Task 6's `buildManifest`), so the final
   test in this file delegates to the Node assertion that proves it, rather than
   restating the claim in Python where nothing could check it.

Run with the main checkout's interpreter (this worktree has no .venv):

    "/path/to/OPCG-Go/.venv/bin/python" -m unittest tools.test_ev_analysis -v
"""

from __future__ import annotations

import ast
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "tools"))

import ev_analysis  # noqa: E402  (path is set immediately above)

MATRIX = REPO_ROOT / "data" / "op16-matchup-matrix.json"
EV_ANALYSIS = REPO_ROOT / "tools" / "ev_analysis.py"
E2E_TEST = REPO_ROOT / "tests" / "environment-e2e.test.mjs"

# The exact values the command produced before Task 12 relabelled its input.
LEGACY_FIELD_EV = {
    "Nami": 55.22451013704836,
    "Luffy": 46.310318269339675,
    "Enel": 48.71719334012913,
    "Rosinante": 46.57283950617284,
    "Teach": 52.82052327556915,
    "Hancock": 49.154094461433914,
}
TOLERANCE = 1e-6

# The provenance block, exactly. Not a subset: the whole object, with these types.
EXPECTED_PROVENANCE = {
    "evidenceStatus": "legacy_unverified",
    "sourceEdition": "EN",
    "applicability": "historical_only",
    "coveredFieldPct": 88.29,
    "unmodelledFieldPct": 11.71,
    "environmentEligible": False,
}

# The one-line marker the command prints its provenance object behind.
PROVENANCE_MARKER = "legacy-provenance: "

# A relative artifact path and nothing that merely contains a slash: prose says "SC/latest".
PATH_LITERAL = re.compile(r"[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.*-]+)+")

# The Node test that proves the environment layer refuses this artifact. Named here so a
# rename breaks this test loudly instead of silently matching nothing.
E2E_REJECTION_TEST_NAME = (
    "the legacy EN matrix is refused as native AND as proxy environment evidence"
)


def _module_imports(path: Path) -> set[str]:
    """Every module name `path` imports, at any statement depth."""
    tree = ast.parse(path.read_text(encoding="utf8"))
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            names.add(node.module or "")
    return names


def _path_like_literals(path: Path) -> set[str]:
    """Every path-shaped string the module can actually act on.

    Docstrings are excluded on purpose: prose may name `environment/` while explaining the
    boundary. What matters is which paths the CODE can open, so only executable string
    constants are collected.
    """
    tree = ast.parse(path.read_text(encoding="utf8"))
    docstrings = {
        node.body[0].value
        for node in ast.walk(tree)
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
        and node.body
        and isinstance(node.body[0], ast.Expr)
        and isinstance(node.body[0].value, ast.Constant)
        and isinstance(node.body[0].value.value, str)
    }
    return {
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and PATH_LITERAL.fullmatch(node.value)
        and node not in docstrings
    }


def _run_legacy_command(*extra: str) -> str:
    """Invoke the command the way an operator does, and return its stdout."""
    result = subprocess.run(
        [sys.executable, str(EV_ANALYSIS), "--no-nash", *extra],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, f"command failed: {result.stderr}"
    return result.stdout


class LegacyMathematicsUnchanged(unittest.TestCase):
    """Relabelling provenance must not perturb a single computed number."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.blob, cls.names, cls.matrix, cls.shares = ev_analysis.load(str(MATRIX))
        cls.ev = ev_analysis.field_ev(cls.matrix, cls.shares)

    def test_six_field_ev_values_are_unchanged_within_1e_6(self) -> None:
        computed = dict(zip(self.names, (float(value) for value in self.ev)))
        self.assertEqual(sorted(computed), sorted(LEGACY_FIELD_EV))
        for leader, expected in LEGACY_FIELD_EV.items():
            self.assertAlmostEqual(computed[leader], expected, delta=TOLERANCE, msg=leader)

    def test_the_matrix_is_still_internally_consistent(self) -> None:
        self.assertEqual(ev_analysis.check_consistency(self.names, self.matrix), [])

    def test_the_covered_share_still_sums_to_88_29(self) -> None:
        self.assertAlmostEqual(float(self.shares.sum()), 88.29, delta=TOLERANCE)


class LegacyProvenanceIsDeclaredInTheData(unittest.TestCase):
    """The artifact itself carries its own permanent labels."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.blob = json.loads(MATRIX.read_text(encoding="utf8"))

    def test_meta_declares_permanent_legacy_provenance(self) -> None:
        meta = self.blob["_meta"]
        self.assertEqual(meta["evidence_status"], "legacy_unverified")
        self.assertEqual(meta["source_edition"], "EN")
        self.assertEqual(meta["applicability"], "historical_only")
        self.assertIs(meta["environment_eligible"], False)

    def test_the_unmodelled_remainder_is_still_declared_in_the_data(self) -> None:
        self.assertAlmostEqual(
            self.blob["unmodelled_field"]["share_pct"], 11.71, delta=TOLERANCE
        )


class LegacyProvenanceIsPrintedBeforeAnyNumber(unittest.TestCase):
    """The default command cannot be read without reading its provenance first."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.stdout = _run_legacy_command()

    def _provenance(self) -> dict:
        lines = [line for line in self.stdout.splitlines() if line.startswith(PROVENANCE_MARKER)]
        self.assertEqual(len(lines), 1, "expected exactly one machine-readable provenance line")
        return json.loads(lines[0][len(PROVENANCE_MARKER):])

    def test_stdout_carries_exactly_the_six_required_labels(self) -> None:
        self.assertEqual(self._provenance(), EXPECTED_PROVENANCE)

    def test_environment_eligibility_is_a_json_false_not_a_string(self) -> None:
        # "false" would read as truthy to any consumer that does not special-case it.
        self.assertIs(self._provenance()["environmentEligible"], False)

    def test_provenance_precedes_consistency_ev_and_every_other_line(self) -> None:
        marker = self.stdout.index(PROVENANCE_MARKER)
        for later in ("matrix consistency", "covered field", "FIELD-WEIGHTED EV"):
            self.assertIn(later, self.stdout)
            self.assertLess(marker, self.stdout.index(later), later)

    def test_the_coverage_line_states_the_unmodelled_remainder_alongside_it(self) -> None:
        # A coverage figure printed on its own reads as the whole field. The covered and
        # the unmodelled share must appear together, on one line, or this goes red.
        coverage_lines = [
            line for line in self.stdout.splitlines()
            if "covered field" in line and not line.startswith(PROVENANCE_MARKER)
        ]
        self.assertEqual(len(coverage_lines), 1, self.stdout)
        self.assertIn("88.29", coverage_lines[0])
        self.assertIn("11.71", coverage_lines[0])

    def test_coverage_and_remainder_account_for_the_whole_field(self) -> None:
        provenance = self._provenance()
        total = provenance["coveredFieldPct"] + provenance["unmodelledFieldPct"]
        self.assertAlmostEqual(total, 100.0, delta=TOLERANCE)
        self.assertGreater(provenance["unmodelledFieldPct"], 0.0)

    def test_the_ev_table_still_prints_its_six_leaders(self) -> None:
        for leader, expected in LEGACY_FIELD_EV.items():
            self.assertRegex(self.stdout, rf"{leader}\s+{expected:.2f}%")

    def test_an_explicit_matrix_path_takes_the_same_labelled_route(self) -> None:
        stdout = _run_legacy_command("--matrix", str(MATRIX))
        self.assertIn(PROVENANCE_MARKER, stdout)

    def test_sensitivity_still_runs_behind_the_same_labels(self) -> None:
        stdout = _run_legacy_command("--sensitivity", "Teach")
        self.assertLess(stdout.index(PROVENANCE_MARKER), stdout.index("SENSITIVITY"))


class LegacyCommandStaysOutOfTheEnvironmentLayer(unittest.TestCase):
    """Step 3's boundary: environment data is never routed through this command."""

    def test_it_imports_nothing_beyond_its_declared_dependencies(self) -> None:
        allowed = {"__future__", "argparse", "json", "sys", "numpy", "scipy.optimize"}
        self.assertEqual(_module_imports(EV_ANALYSIS) - allowed, set())

    def test_the_only_path_it_can_open_is_the_legacy_matrix(self) -> None:
        # Not a prose grep: the executable string constants only. Adding a read of any
        # environment artifact (data/sources, data/derived, data/environment-aliases)
        # turns this red, because the set below is exact.
        self.assertEqual(_path_like_literals(EV_ANALYSIS), {"data/op16-matchup-matrix.json"})


class WeakenedProvenanceIsRefused(unittest.TestCase):
    """"Permanently legacy" is enforced by the tool, not left to whoever edits the JSON."""

    def _run_with(self, mutate) -> subprocess.CompletedProcess:
        blob = json.loads(MATRIX.read_text(encoding="utf8"))
        mutate(blob)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "matrix.json"
            path.write_text(json.dumps(blob), encoding="utf8")
            return subprocess.run(
                [sys.executable, str(EV_ANALYSIS), "--no-nash", "--matrix", str(path)],
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
                check=False,
            )

    def test_an_unmutated_copy_still_runs(self) -> None:
        # Non-vacuity: the refusals below must come from the mutation, not from the copy.
        result = self._run_with(lambda blob: None)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(PROVENANCE_MARKER, result.stdout)

    def test_claiming_environment_eligibility_is_refused(self) -> None:
        result = self._run_with(
            lambda blob: blob["_meta"].__setitem__("environment_eligible", True)
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("environment_eligible", result.stderr)

    def test_upgrading_the_evidence_status_is_refused(self) -> None:
        result = self._run_with(
            lambda blob: blob["_meta"].__setitem__("evidence_status", "verified")
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("evidence_status", result.stderr)

    def test_relabelling_the_source_edition_as_sc_is_refused(self) -> None:
        # The single most dangerous forgery this artifact enables: an EN matrix wearing an SC label.
        result = self._run_with(lambda blob: blob["_meta"].__setitem__("source_edition", "SC"))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("source_edition", result.stderr)

    def test_claiming_current_applicability_is_refused(self) -> None:
        result = self._run_with(lambda blob: blob["_meta"].__setitem__("applicability", "current"))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("applicability", result.stderr)

    def test_every_required_label_is_pinned_to_a_value_not_merely_required(self) -> None:
        # `REQUIRED_META_LABELS` only checks PRESENCE. A label that is present but weakened is the
        # actual risk, so every required label must also appear in PINNED_META_VALUES -- otherwise
        # the "refuses to run if those labels are weakened" claim in CLAUDE.md,
        # docs/environment-data.md and the artifact's own provenance_note is false for the gap.
        self.assertEqual(
            sorted(ev_analysis.PINNED_META_VALUES),
            sorted(ev_analysis.REQUIRED_META_LABELS),
        )

    def test_weakening_any_one_of_the_four_labels_is_refused(self) -> None:
        weakened = {
            "evidence_status": "verified",
            "source_edition": "SC",
            "applicability": "current",
            "environment_eligible": True,
        }
        self.assertEqual(sorted(weakened), sorted(ev_analysis.REQUIRED_META_LABELS))
        for label, value in weakened.items():
            with self.subTest(label=label):
                result = self._run_with(lambda blob, k=label, v=value: blob["_meta"].__setitem__(k, v))
                self.assertNotEqual(result.returncode, 0, f"{label} -> {value!r} was accepted")
                self.assertIn(label, result.stderr)

    def test_deleting_a_provenance_label_is_refused(self) -> None:
        result = self._run_with(lambda blob: blob["_meta"].pop("applicability"))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("applicability", result.stderr)

    def test_deleting_the_unmodelled_remainder_is_refused(self) -> None:
        result = self._run_with(lambda blob: blob.pop("unmodelled_field"))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unmodelled", result.stderr)


class LegacyMatrixCannotBecomeAnEnvironment(unittest.TestCase):
    """The claim `environmentEligible: false` is enforced, not merely printed.

    Delegated to the Node assertion because Task 6's `buildManifest` is the thing that
    actually refuses the artifact, and only it can prove the refusal.

    `--test-name-pattern` is a vacuity trap and it was measured, not assumed: with a pattern
    that matches nothing, `node --test` prints `1..0`, counts the FILE itself as one passing
    test (`# pass 1`) and exits 0. So neither the exit status nor the pass count can tell a
    real run from a no-op. The named test's own `ok` line is what is checked instead, which is
    the one thing a rename or a deletion cannot leave behind.
    """

    def test_build_manifest_refuses_it_as_native_and_as_proxy_evidence(self) -> None:
        self.assertTrue(E2E_TEST.is_file(), f"missing {E2E_TEST.name}")
        result = subprocess.run(
            [
                "node",
                "--test",
                f"--test-name-pattern={re.escape(E2E_REJECTION_TEST_NAME)}",
                str(E2E_TEST),
            ],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
            env={**os.environ, "NODE_OPTIONS": ""},
        )
        combined = f"{result.stdout}\n{result.stderr}"
        self.assertEqual(result.returncode, 0, combined)
        self.assertIsNotNone(re.search(r"^# fail 0$", combined, re.M), combined)
        # `1..0` is node's own report that the pattern selected nothing at all.
        self.assertIsNone(re.search(r"^1\.\.0$", combined, re.M), f"the pattern matched nothing:\n{combined}")
        passed = re.escape(E2E_REJECTION_TEST_NAME)
        self.assertIsNotNone(
            re.search(rf"^\s*ok \d+ - {passed}$", combined, re.M),
            f"the named Node test never reported a pass:\n{combined}",
        )


if __name__ == "__main__":
    unittest.main()
