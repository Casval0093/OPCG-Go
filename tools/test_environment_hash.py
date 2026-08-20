#!/usr/bin/env python3
"""Cross-process tests for tools.environment_hash."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


TOOLS_ROOT = Path(__file__).resolve().parent
REPO_ROOT = TOOLS_ROOT.parent
sys.path.insert(0, str(TOOLS_ROOT))

import environment_hash  # noqa: E402


class EnvironmentHashTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        with (REPO_ROOT / "data" / "hash-vectors" / "environment-v1.json").open(
            encoding="utf8",
        ) as handle:
            document = json.load(handle)
        cls.vectors = document["vectors"]

    def test_shared_vectors_match_node_hashes(self) -> None:
        self.assertEqual(len(self.vectors), 4)
        for vector in self.vectors:
            with self.subTest(vector=vector["name"]):
                self.assertEqual(environment_hash.canonical_hash(vector["input"]), vector["sha256"])

    def test_non_finite_number_is_rejected_before_spawning_node(self) -> None:
        with patch.object(environment_hash.subprocess, "run") as run:
            with self.assertRaises(ValueError):
                environment_hash.canonical_hash({"n": float("nan")})
            run.assert_not_called()

    def test_bridge_uses_fixed_node_argv_without_a_shell(self) -> None:
        expected = "sha256:" + "0" * 64
        completed = type("Completed", (), {"stdout": json.dumps({"sha256": expected}).encode("utf8")})()
        with patch.object(environment_hash.subprocess, "run", return_value=completed) as run:
            self.assertEqual(environment_hash.canonical_hash({"a": 1}), expected)

        args, kwargs = run.call_args
        self.assertEqual(args, (["node", str(environment_hash.HASH_CLI)],))
        self.assertIs(kwargs["shell"], False)
        self.assertTrue(kwargs["check"])
        self.assertEqual(kwargs["stdout"], environment_hash.subprocess.PIPE)
        self.assertEqual(kwargs["stderr"], environment_hash.subprocess.PIPE)


if __name__ == "__main__":
    unittest.main()
