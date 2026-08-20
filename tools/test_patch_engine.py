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

        Anchors are seeded via `patch_anchors`, i.e. EVERY anchor a patch needs and not just its
        primary one. Seeding only the primary was silently wrong: a multi-edit patch's secondary
        `str.replace` then found nothing and no-opped, the patch still wrote its marker, and these
        apply tests passed while the file was half-patched. The tests were resting on the bug
        `replace_once` now raises for. Codex flagged the production side of this on PR #28.
        """
        anchors: dict[str, list[str]] = {}
        for patch in patch_engine.PATCHES:
            if "create" in patch:
                continue
            for anchor in patch_engine.patch_anchors(patch):
                anchors.setdefault(patch["relpath"], []).append(anchor)
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
            # Every marker, not just the first: a multi-edit patch declares one per edit, and
            # checking only the first is the defect this suite now covers.
            for marker in patch_engine.applied_markers(patch):
                self.assertIn(marker, source, patch["name"])
            for marker in patch_engine.absent_markers(patch):
                self.assertNotIn(marker, source, patch["name"])

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

    # --- every edit of a multi-edit patch is verified (Codex, PR #28) ------------------------
    #
    # The defect these cover: a patch that made several edits chained bare `str.replace` calls, and
    # `str.replace` with a target that is absent is a SILENT no-op. Only the primary anchor was
    # verified and only the first edit's marker was checked, so a secondary anchor that upstream had
    # reworded left its edit undone while the tool printed `applied` and every later `--check`
    # printed `ok`. For the permanent-lookup patch that is invisible to the engine suite too,
    # because the narrowing is result-preserving -- the optimisation would simply be gone.

    def multi_edit_patch(self) -> dict:
        for patch in patch_engine.PATCHES:
            if len(patch_engine.patch_anchors(patch)) > 1:
                return patch
        raise AssertionError("no multi-edit patch to test against")

    def test_every_multi_edit_patch_declares_a_marker_per_anchor(self) -> None:
        """The invariant that keeps the fix from rotting.

        A future patch that adds a second anchor but keeps one `already` string would reintroduce
        exactly the reported defect, and nothing else here would notice.
        """
        for patch in patch_engine.PATCHES:
            anchors = len(patch_engine.patch_anchors(patch))
            markers = len(patch_engine.applied_markers(patch)) + len(
                patch_engine.absent_markers(patch)
            )
            self.assertGreaterEqual(
                markers,
                anchors,
                f"{patch['name']}: {anchors} anchor(s) but only {markers} marker(s) — a "
                f"half-applied file would report ok",
            )

    def test_moved_secondary_anchor_fails_and_writes_nothing(self) -> None:
        patch = self.multi_edit_patch()
        self.seed_stock()
        secondary = patch_engine.patch_anchors(patch)[1]
        before = self.read(patch["relpath"])
        self.assertIn(secondary, before)
        self.write(patch["relpath"], before.replace(secondary, "upstream reworded this", 1))

        code, text = run("--engine", self.engine)
        self.assertIn("FAILED", text)
        self.assertIn(patch["name"], text)
        self.assertEqual(code, 1)
        # The decisive part: no marker was written, so a later --check cannot call this applied.
        after = self.read(patch["relpath"])
        for marker in patch_engine.applied_markers(patch):
            self.assertNotIn(marker, after, patch["name"])

    def test_partially_applied_patch_is_failed_not_ok(self) -> None:
        """The state the single-marker check used to call `ok`."""
        patch = self.multi_edit_patch()
        markers = patch_engine.applied_markers(patch)
        self.assertGreater(len(markers), 1, patch["name"])
        self.seed_stock()
        # Only the FIRST edit's marker present -- what the old code wrote after a silent no-op.
        self.write(patch["relpath"], self.read(patch["relpath"]) + "\n" + markers[0] + "\n")

        code, text = run("--check", "--engine", self.engine)
        self.assertIn("PARTIALLY applied", text)
        self.assertIn(patch["name"], text)
        self.assertEqual(code, 1)

    def test_replace_once_raises_unless_there_is_exactly_one_match(self) -> None:
        with self.assertRaises(patch_engine.PatchAnchorError):
            patch_engine.replace_once("no anchor here", "ANCHOR", "fix")
        with self.assertRaises(patch_engine.PatchAnchorError):
            patch_engine.replace_once("ANCHOR and ANCHOR", "ANCHOR", "fix")
        self.assertEqual(patch_engine.replace_once("a ANCHOR b", "ANCHOR", "fix"), "a fix b")

    def test_replace_every_raises_only_when_nothing_matches(self) -> None:
        with self.assertRaises(patch_engine.PatchAnchorError):
            patch_engine.replace_every("no id here", "oldId", "newId")
        self.assertEqual(patch_engine.replace_every("oldId oldId", "oldId", "newId"), "newId newId")

    def test_anchor_description_names_the_distinctive_line(self) -> None:
        """A failure message reading 'try {' identifies nothing, which is why this is asserted."""
        self.assertEqual(
            patch_engine.describe_anchor("try {\n  const somethingDistinctive = 1;\n"),
            "const somethingDistinctive = 1;",
        )


if __name__ == "__main__":
    unittest.main()
