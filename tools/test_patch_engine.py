#!/usr/bin/env python3
"""Regression tests for tools/patch_engine.py.

The point of these is the EXIT CODE. `--check` used to print `PENDING` and return 0, so wiring it
into CI would have gated on nothing: an unpatched engine passed. Every test here asserts the
status code, not just the wording, because the wording is not what a gate reads.

Stdlib unittest only, matching the other tools' tests.
"""

from __future__ import annotations

import contextlib
import io
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import patch_engine  # noqa: E402


def run(*argv: str) -> tuple[int, str]:
    """Run main() with argv, returning (exit code, stdout+stderr)."""
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = patch_engine.main(list(argv))
    return code, out.getvalue() + err.getvalue()


class PatchEngineTest(unittest.TestCase):
    def setUp(self) -> None:
        # The engine dir is one level DOWN inside the temp dir, not the temp dir itself, because one
        # patch's relpath is `../types/src/effect/action.ts` -- it deliberately escapes the engine
        # root, since packages/types is a sibling of packages/engine. With the engine AT the temp
        # root that path resolved outside mkdtemp, so the fixture wrote into $TMPDIR/types/... : it
        # survived cleanup and, worse, was a single shared path that concurrent runs of this suite
        # would fight over. This repo runs tools concurrently on purpose.
        self.root = tempfile.mkdtemp(prefix="patch-engine-test-")
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.engine = os.path.join(self.root, "engine")
        os.makedirs(self.engine, exist_ok=True)

    def read(self, relpath: str) -> str:
        with open(os.path.join(self.engine, relpath), encoding="utf-8") as fh:
            return fh.read()

    def snapshot(self) -> dict[str, str]:
        # A CREATE patch's file does not exist until it is applied, so absence is a state to record
        # rather than an error -- test_check_does_not_write compares snapshots across a --check run.
        out: dict[str, str] = {}
        for p in patch_engine.PATCHES:
            path = os.path.join(self.engine, p["relpath"])
            out[p["relpath"]] = self.read(p["relpath"]) if os.path.exists(path) else "<absent>"
        return out

    def write(self, relpath: str, text: str) -> None:
        path = os.path.join(self.engine, relpath)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)

    def seed_stock(self) -> None:
        """An engine with every anchor present and no patch applied.

        Two independent reasons the naive "one file per patch, write its anchor" loop is wrong, and
        both are load-bearing.

        A CREATE patch is seeded by NOT writing its file: absent is its unpatched state, and writing
        a stub there would make the tool refuse to overwrite it (which is the point of
        test_create_refuses_to_overwrite_a_foreign_file).

        Anchors are GROUPED BY FILE. Several files now carry more than one patch --
        `src/effects/actions.ts` carries three and `src/shared.ts`, `src/effects/permanent.ts`,
        `../types/src/effect/action.ts` and `src/automation/bot-harness.ts` two apiece. Writing one
        file per patch let the last one win and silently deleted the earlier anchor, so those patches
        reported FAILED and three tests here went red the moment a second patch landed on a file that
        already had one.
        """
        anchors: dict[str, list[str]] = {}
        for patch in patch_engine.PATCHES:
            if "create" in patch:
                continue
            anchors.setdefault(patch["relpath"], []).append(patch["anchor"])
        for relpath, texts in anchors.items():
            body = "\n".join(f"{text}\nafter\n" for text in texts)
            self.write(relpath, f"before\n{body}")

    def create_patches(self) -> list[dict]:
        return [p for p in patch_engine.PATCHES if "create" in p]

    # --- the gate -------------------------------------------------------------------------

    def test_check_exits_nonzero_when_a_patch_is_pending(self) -> None:
        self.seed_stock()
        code, text = run("--check", "--engine", self.engine)
        self.assertIn("PENDING", text)
        # This is the bug: it used to be 0, so CI would have accepted an unpatched engine.
        self.assertEqual(code, 1)
        # EVERY patch has to be PENDING, and none FAILED or MISSING. Asserting only that the word
        # PENDING appears somewhere is what let a broken fixture pass: a `seed_stock` that clobbers
        # one anchor per shared file still reports PENDING for the survivors, so the two failures
        # it caused showed up two tests later and looked like a patch_engine bug rather than a
        # fixture bug.
        self.assertEqual(text.count("PENDING"), len(patch_engine.PATCHES), text)
        self.assertNotIn("FAILED", text)
        self.assertNotIn("MISSING", text)

    def test_check_exits_zero_only_once_every_patch_is_applied(self) -> None:
        self.seed_stock()
        self.assertEqual(run("--engine", self.engine)[0], 0)  # apply
        code, text = run("--check", "--engine", self.engine)
        self.assertNotIn("PENDING", text)
        self.assertEqual(code, 0)

    def test_check_does_not_write(self) -> None:
        self.seed_stock()
        before = self.snapshot()
        run("--check", "--engine", self.engine)
        self.assertEqual(self.snapshot(), before)

    # --- failure modes that already gated, re-pinned so the rewrite kept them ---------------

    def test_missing_file_fails_in_both_modes(self) -> None:
        self.seed_stock()
        os.remove(os.path.join(self.engine, patch_engine.PATCHES[0]["relpath"]))
        for extra in ([], ["--check"]):
            code, text = run(*extra, "--engine", self.engine)
            self.assertIn("MISSING", text)
            self.assertEqual(code, 1)

    def test_moved_anchor_fails_rather_than_silently_no_opping(self) -> None:
        first = patch_engine.PATCHES[0]
        self.seed_stock()
        self.write(first["relpath"], "upstream refactored this away\n")
        code, text = run("--engine", self.engine)
        self.assertIn("FAILED", text)
        self.assertEqual(code, 1)

    def test_absent_engine_fails(self) -> None:
        code, _ = run("--check", "--engine", os.path.join(self.engine, "nope"))
        self.assertEqual(code, 1)

    # --- applying -------------------------------------------------------------------------

    def test_apply_is_idempotent(self) -> None:
        self.seed_stock()
        self.assertEqual(run("--engine", self.engine)[0], 0)
        applied = self.snapshot()
        code, text = run("--engine", self.engine)
        self.assertEqual(code, 0)
        self.assertIn("already applied", text)
        self.assertEqual(self.snapshot(), applied)

    def test_apply_makes_each_patch_detectable_as_applied(self) -> None:
        self.seed_stock()
        run("--engine", self.engine)
        for patch in patch_engine.PATCHES:
            source = self.read(patch["relpath"])
            # `already` is how every later run recognises the patch; if apply() does not produce
            # it, the tool re-patches forever and idempotence is a lie.
            self.assertIn(patch["already"], source, patch["name"])

    # --- CREATE patches: a file upstream does not have, so there is no anchor to verify ----------

    def test_create_patch_is_pending_then_written(self) -> None:
        self.seed_stock()
        creates = self.create_patches()
        self.assertTrue(creates, "no CREATE patch in PATCHES — this suite would assert nothing")
        code, text = run("--check", "--engine", self.engine)
        for patch in creates:
            self.assertIn(patch["name"], text)
            self.assertFalse(os.path.exists(os.path.join(self.engine, patch["relpath"])))
        self.assertEqual(code, 1)

        self.assertEqual(run("--engine", self.engine)[0], 0)
        for patch in creates:
            source = self.read(patch["relpath"])
            self.assertEqual(source, patch["create"])
            self.assertIn(patch["already"], source)
        self.assertEqual(run("--check", "--engine", self.engine)[0], 0)

    def test_create_patch_apply_is_idempotent(self) -> None:
        self.seed_stock()
        run("--engine", self.engine)
        before = self.snapshot()
        code, text = run("--engine", self.engine)
        self.assertEqual(code, 0)
        self.assertIn("already applied", text)
        self.assertEqual(self.snapshot(), before)

    def test_create_refuses_to_overwrite_a_foreign_file(self) -> None:
        self.seed_stock()
        for patch in self.create_patches():
            self.write(patch["relpath"], "someone else's file\n")
        code, text = run("--engine", self.engine)
        self.assertIn("FAILED", text)
        self.assertEqual(code, 1)
        # And it really did not write: the foreign content survives.
        for patch in self.create_patches():
            self.assertEqual(self.read(patch["relpath"]), "someone else's file\n")


if __name__ == "__main__":
    unittest.main()
