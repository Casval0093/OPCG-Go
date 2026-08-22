#!/usr/bin/env python3
"""Tests for tools/graft_cards.py.

    ./.venv/bin/python -m unittest discover -s tools -p 'test_*.py' -v

The load-bearing contract is the split between SETS (full-tree sync, deletes
siblings) and OVERLAY_* (copy one file, leave vendor siblings alone). Putting
ST12 or OP14EB04 into SETS would wipe the rest of those upstream sets the next
time someone ran graft. These tests pin that split against a tempfile tree;
the real vendor/ checkout is never touched.

Stdlib unittest only, matching the other tools' tests.
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import graft_cards  # noqa: E402


def _write(path: str, body: str = "x\n") -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf8") as fh:
        fh.write(body)


class TestGraftSetsAreNotVendorOwned(unittest.TestCase):
    def test_st12_and_op14eb04_stay_out_of_SETS(self) -> None:
        # A SETS membership is a full sync_tree. That deletes every dest file
        # this repo does not also hold. Both of these sets already exist
        # upstream; overlay is the only legal way to add one file.
        self.assertNotIn("ST12", graft_cards.SETS)
        self.assertNotIn("OP14EB04", graft_cards.SETS)

    def test_st30_is_in_SETS_because_upstream_has_no_such_directory(self) -> None:
        self.assertIn("ST30", graft_cards.SETS)
        self.assertIn("OP15", graft_cards.SETS)
        self.assertIn("OP16", graft_cards.SETS)

    def test_overlay_lists_the_three_missing_print_confirm_files(self) -> None:
        self.assertIn("OP14EB04/characters/058-borsalino.ts", graft_cards.OVERLAY_CARD_FILES)
        self.assertIn("ST12/characters/010-emporio-ivankov.ts", graft_cards.OVERLAY_CARD_FILES)
        self.assertIn("ST12/characters/index.ts", graft_cards.OVERLAY_CARD_FILES)
        self.assertIn("OP14EB04/058-borsalino.test.ts", graft_cards.OVERLAY_TEST_FILES)
        self.assertIn("ST12/010-emporio-ivankov.test.ts", graft_cards.OVERLAY_TEST_FILES)


class TestRequiredExportLinesSkipMissingTypeDirs(unittest.TestCase):
    def test_st30_characters_only_does_not_emit_leaders_events_or_stages(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            _write(os.path.join(tmp, "ST30", "characters", "index.ts"), "export {};\n")
            lines = graft_cards.required_export_lines(tmp)
            self.assertEqual(lines, ['export * from "./ST30/characters/index.ts";'])

    def test_overlay_export_lines_are_appended_alongside_SETS(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            _write(os.path.join(tmp, "ST30", "characters", "index.ts"), "export {};\n")
            lines = graft_cards.all_export_lines(tmp)
            self.assertIn('export * from "./ST30/characters/index.ts";', lines)
            self.assertIn('export * from "./ST12/characters/index.ts";', lines)


class TestOverlayLeavesVendorSiblingsAlone(unittest.TestCase):
    def test_overlay_copies_one_file_and_does_not_delete_a_sibling(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "src")
            dst = os.path.join(tmp, "dst")
            sibling = "vendor sibling -- must survive\n"
            _write(os.path.join(dst, "OP14EB04", "characters", "036-foxy.ts"), sibling)
            _write(
                os.path.join(dst, "OP14EB04", "characters", "index.ts"),
                'export { op14eb04Foxy036 } from "./036-foxy.ts";\n',
            )
            _write(
                os.path.join(src, "OP14EB04", "characters", "058-borsalino.ts"),
                "export const op14eb04Borsalino058 = {};\n",
            )
            _write(
                os.path.join(src, "OP14EB04", "characters", "058-borsalino.i18n.ts"),
                "export const op14eb04Borsalino058I18n = {};\n",
            )

            copied, unchanged, missing = graft_cards.overlay_files(
                src,
                dst,
                [
                    "OP14EB04/characters/058-borsalino.ts",
                    "OP14EB04/characters/058-borsalino.i18n.ts",
                ],
                "cards",
            )
            self.assertEqual(missing, [])
            self.assertEqual(copied, 2)
            self.assertEqual(unchanged, 0)

            with open(os.path.join(dst, "OP14EB04", "characters", "036-foxy.ts"), encoding="utf8") as fh:
                self.assertEqual(fh.read(), sibling)
            with open(
                os.path.join(dst, "OP14EB04", "characters", "058-borsalino.ts"), encoding="utf8"
            ) as fh:
                self.assertIn("op14eb04Borsalino058", fh.read())

            index_path = os.path.join(dst, "OP14EB04", "characters", "index.ts")
            appended = graft_cards.append_line_to_file(
                index_path,
                'export { op14eb04Borsalino058 } from "./058-borsalino.ts";',
            )
            self.assertTrue(appended)
            with open(index_path, encoding="utf8") as fh:
                text = fh.read()
            self.assertIn('export { op14eb04Foxy036 } from "./036-foxy.ts";', text)
            self.assertIn('export { op14eb04Borsalino058 } from "./058-borsalino.ts";', text)

            # Second run is a no-op on both the files and the index line.
            copied2, unchanged2, missing2 = graft_cards.overlay_files(
                src,
                dst,
                [
                    "OP14EB04/characters/058-borsalino.ts",
                    "OP14EB04/characters/058-borsalino.i18n.ts",
                ],
                "cards",
            )
            self.assertEqual(missing2, [])
            self.assertEqual(copied2, 0)
            self.assertEqual(unchanged2, 2)
            self.assertFalse(
                graft_cards.append_line_to_file(
                    index_path,
                    'export { op14eb04Borsalino058 } from "./058-borsalino.ts";',
                )
            )

    def test_overlay_missing_source_is_reported_not_invented(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "src")
            dst = os.path.join(tmp, "dst")
            os.makedirs(src, exist_ok=True)
            copied, unchanged, missing = graft_cards.overlay_files(
                src, dst, ["ST12/characters/010-emporio-ivankov.ts"], "cards"
            )
            self.assertEqual(copied, 0)
            self.assertEqual(unchanged, 0)
            self.assertEqual(len(missing), 1)
            self.assertTrue(missing[0].endswith("ST12/characters/010-emporio-ivankov.ts"))

    def test_append_line_to_file_does_not_create_a_missing_vendor_index(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "OP14EB04", "characters", "index.ts")
            self.assertFalse(
                graft_cards.append_line_to_file(
                    path, 'export { op14eb04Borsalino058 } from "./058-borsalino.ts";'
                )
            )
            self.assertFalse(os.path.exists(path))


class TestSyncTreeStillDeletesOnSETS(unittest.TestCase):
    def test_sync_tree_deletes_a_dest_file_with_no_source_counterpart(self) -> None:
        # Contrast with overlay: this is why ST12/OP14EB04 cannot join SETS.
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "src")
            dst = os.path.join(tmp, "dst")
            _write(os.path.join(src, "014-mr-3-galdino.ts"), "ours\n")
            _write(os.path.join(dst, "014-mr-3-galdino.ts"), "ours\n")
            _write(os.path.join(dst, "099-upstream-only.ts"), "do not keep under SETS\n")
            copied, deleted, unchanged = graft_cards.sync_tree(src, dst)
            self.assertEqual(copied, 0)
            self.assertEqual(unchanged, 1)
            self.assertEqual(deleted, 1)
            self.assertFalse(os.path.exists(os.path.join(dst, "099-upstream-only.ts")))


if __name__ == "__main__":
    unittest.main()
