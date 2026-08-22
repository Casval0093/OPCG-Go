#!/usr/bin/env python3
"""Graft this repo's card definitions (and their tests) into the vendored engine.

`cards/OP15`, `cards/OP16` and `cards/ST30` in this repo are the single source
of truth for those sets. The vendored engine at vendor/ is gitignored and
disposable -- those directories are ones upstream does not ship, so this
script owns
`vendor/tcg-engines/submodules/one-piece/packages/cards/src/cards/<SET>`
outright and mirrors this repo's `cards/<SET>` into them exactly (including
deleting a grafted file with no source counterpart, e.g. after a rename). It
then idempotently appends the export lines that top-level `cards/index.ts`
needs to pick the new sets up, and nothing else in that file is touched.

ST12 and OP14EB04 already exist upstream. They are NOT in SETS: a full
`sync_tree` would delete every vendor sibling this repo does not also hold.
Those two get an overlay copy of the one missing file (plus the ST12
characters index this repo owns, because upstream has no `ST12/` directory
at all -- its ST12 printings live as reprints under PRB01/PRB02/OP10).

The same mirroring applies to this repo's `cards/tests/<SET>` -- synced onto
`vendor/tcg-engines/submodules/one-piece/packages/engine/tests/cards/<SET>`,
matching the flat-by-set convention the engine's own OP11-OP13 tests already
use. Overlay tests are copied the same way as overlay cards: one file, no
sibling deletes. A set with no tests yet is skipped, same as an as-yet-
unpopulated `cards/<SET>`.

Never hand-edit the grafted copy under vendor/ -- edit cards/ (or cards/tests/)
in this repo and re-run this script.

Usage:
    ./.venv/bin/python tools/graft_cards.py
    ./.venv/bin/python tools/graft_cards.py --vendor-cards-root <path> --vendor-tests-root <path>
        # --source-root / --tests-source-root also available; all four exist for tests of
        # this script, pointed at a scratch directory instead of the real vendor/ checkout.
"""

from __future__ import annotations

import argparse
import filecmp
import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_SOURCE_ROOT = os.path.join(REPO_ROOT, "cards")
DEFAULT_VENDOR_CARDS_ROOT = os.path.join(
    REPO_ROOT,
    "vendor",
    "tcg-engines",
    "submodules",
    "one-piece",
    "packages",
    "cards",
    "src",
    "cards",
)
DEFAULT_TESTS_SOURCE_ROOT = os.path.join(REPO_ROOT, "cards", "tests")
DEFAULT_VENDOR_TESTS_ROOT = os.path.join(
    REPO_ROOT,
    "vendor",
    "tcg-engines",
    "submodules",
    "one-piece",
    "packages",
    "engine",
    "tests",
    "cards",
)

# Full-tree sync. Vendor-owned sets (ST12, OP14EB04) must never join this list:
# sync_tree deletes destination files with no source counterpart.
SETS = ["OP15", "OP16", "ST30"]
TYPE_DIRS = ["leaders", "characters", "events", "stages"]

# Overlay: copy these files into an existing vendor set without deleting siblings.
OVERLAY_CARD_FILES = [
    "OP14EB04/characters/058-borsalino.ts",
    "OP14EB04/characters/058-borsalino.i18n.ts",
    "ST12/characters/010-emporio-ivankov.ts",
    "ST12/characters/010-emporio-ivankov.i18n.ts",
    "ST12/characters/index.ts",
]
OVERLAY_TEST_FILES = [
    "OP14EB04/058-borsalino.test.ts",
    "ST12/010-emporio-ivankov.test.ts",
]
# Append one export to an existing vendor index. Not a file replace.
OVERLAY_INDEX_LINES = [
    (
        "OP14EB04/characters/index.ts",
        'export { op14eb04Borsalino058 } from "./058-borsalino.ts";',
    ),
]
# Top-level cards/index.ts lines that SETS+TYPE_DIRS cannot produce (ST12 is
# overlay-only; ST30's existing type dirs come from required_export_lines).
OVERLAY_EXPORT_LINES = [
    'export * from "./ST12/characters/index.ts";',
]


def sync_tree(src_root: str, dst_root: str) -> tuple[int, int, int]:
    """Mirror src_root onto dst_root exactly: copy new/changed files, delete
    dst files with no src counterpart, leave identical files untouched (so
    reruns don't churn mtimes / build caches). Returns (copied, deleted,
    unchanged)."""
    copied = deleted = unchanged = 0

    src_files: set[str] = set()
    for dirpath, _dirnames, filenames in os.walk(src_root):
        rel_dir = os.path.relpath(dirpath, src_root)
        for name in filenames:
            rel_path = name if rel_dir == "." else os.path.join(rel_dir, name)
            src_files.add(rel_path)

    for rel_path in sorted(src_files):
        src_path = os.path.join(src_root, rel_path)
        dst_path = os.path.join(dst_root, rel_path)
        if os.path.exists(dst_path) and filecmp.cmp(src_path, dst_path, shallow=False):
            unchanged += 1
            continue
        os.makedirs(os.path.dirname(dst_path), exist_ok=True)
        with open(src_path, "rb") as fsrc, open(dst_path, "wb") as fdst:
            fdst.write(fsrc.read())
        copied += 1

    if os.path.isdir(dst_root):
        for dirpath, _dirnames, filenames in os.walk(dst_root):
            rel_dir = os.path.relpath(dirpath, dst_root)
            for name in filenames:
                rel_path = name if rel_dir == "." else os.path.join(rel_dir, name)
                if rel_path not in src_files:
                    os.remove(os.path.join(dirpath, name))
                    deleted += 1

    return copied, deleted, unchanged


def required_export_lines(source_root: str) -> list[str]:
    """Export lines for SETS, but only for type directories that actually exist.

    ST30 ships characters only. Emitting leaders/events/stages for it would
    append broken `export * from "./ST30/leaders/index.ts"` lines that the
    cards package cannot resolve."""
    lines = []
    for set_id in SETS:
        for type_dir in TYPE_DIRS:
            if os.path.isdir(os.path.join(source_root, set_id, type_dir)):
                lines.append(f'export * from "./{set_id}/{type_dir}/index.ts";')
    return lines


def all_export_lines(source_root: str) -> list[str]:
    return required_export_lines(source_root) + list(OVERLAY_EXPORT_LINES)


def overlay_files(
    source_root: str, dest_root: str, rel_paths: list[str], label: str
) -> tuple[int, int, list[str]]:
    """Copy each rel_path from source_root onto dest_root. Never deletes siblings.

    Returns (copied, unchanged, missing_sources). A missing source is a
    programming error in OVERLAY_* -- the caller should treat a non-empty
    missing list as a failed graft."""
    copied = unchanged = 0
    missing: list[str] = []
    for rel_path in rel_paths:
        src_path = os.path.join(source_root, rel_path)
        dst_path = os.path.join(dest_root, rel_path)
        if not os.path.isfile(src_path):
            missing.append(src_path)
            continue
        os.makedirs(os.path.dirname(dst_path), exist_ok=True)
        if os.path.exists(dst_path) and filecmp.cmp(src_path, dst_path, shallow=False):
            unchanged += 1
            continue
        with open(src_path, "rb") as fsrc, open(dst_path, "wb") as fdst:
            fdst.write(fsrc.read())
        copied += 1
        print(f"{label} overlay {rel_path}: copied -> {dst_path}")
    if unchanged:
        print(f"{label} overlay: {unchanged} unchanged")
    return copied, unchanged, missing


def append_line_to_file(path: str, line: str) -> bool:
    """Idempotently append `line` to `path`. Returns True if a line was written.

    Missing path is a failed overlay (vendor-owned index should already exist),
    not a create -- creating an index that lists only our card would hide the
    rest of the set from the barrel."""
    if not os.path.isfile(path):
        return False
    with open(path, encoding="utf8") as f:
        content = f.read()
    if line in content.splitlines():
        return False
    if content and not content.endswith("\n"):
        content += "\n"
    content += line + "\n"
    with open(path, "w", encoding="utf8") as f:
        f.write(content)
    return True


def append_missing_exports(index_path: str, source_root: str) -> list[str]:
    """Idempotently ensure `index_path` contains every line from
    all_export_lines(). Returns the list of lines actually appended
    (empty if the file already had all of them -- a true no-op rerun)."""
    with open(index_path, encoding="utf8") as f:
        content = f.read()
    existing_lines = set(content.splitlines())

    missing = [line for line in all_export_lines(source_root) if line not in existing_lines]
    if not missing:
        return []

    if content and not content.endswith("\n"):
        content += "\n"
    content += "\n".join(missing) + "\n"

    with open(index_path, "w", encoding="utf8") as f:
        f.write(content)
    return missing


def sync_set_trees(source_root: str, vendor_root: str, label: str) -> tuple[int, int, int]:
    """Sync source_root/<SET> onto vendor_root/<SET> for every SET in SETS, skipping (with
    a stderr note) any SET that has no source directory yet. Returns the totals across all
    SETS."""
    total_copied = total_deleted = total_unchanged = 0
    for set_id in SETS:
        src = os.path.join(source_root, set_id)
        if not os.path.isdir(src):
            print(f"{label} source set not found, skipping: {src}", file=sys.stderr)
            continue
        dst = os.path.join(vendor_root, set_id)
        copied, deleted, unchanged = sync_tree(src, dst)
        total_copied += copied
        total_deleted += deleted
        total_unchanged += unchanged
        print(f"{label} {set_id}: {copied} copied, {deleted} deleted, {unchanged} unchanged -> {dst}")
    return total_copied, total_deleted, total_unchanged


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", default=DEFAULT_SOURCE_ROOT)
    parser.add_argument("--vendor-cards-root", default=DEFAULT_VENDOR_CARDS_ROOT)
    parser.add_argument("--tests-source-root", default=DEFAULT_TESTS_SOURCE_ROOT)
    parser.add_argument("--vendor-tests-root", default=DEFAULT_VENDOR_TESTS_ROOT)
    args = parser.parse_args()

    if not os.path.isdir(args.vendor_cards_root):
        print(
            f"vendor cards root not found: {args.vendor_cards_root}\n"
            f"(run this after `pnpm install`, from a bootstrapped vendor/ checkout)",
            file=sys.stderr,
        )
        return 1

    if not os.path.isdir(args.vendor_tests_root):
        # Symmetric with the cards-root check above. Without it, a wrong or stale
        # --vendor-tests-root (or a vitest layout change upstream) would still get
        # `os.makedirs`'d into existence by sync_tree and "succeed" -- reporting files
        # copied into a directory vitest never scans, with no error to notice it by.
        print(
            f"vendor tests root not found: {args.vendor_tests_root}\n"
            f"(run this after `pnpm install`, from a bootstrapped vendor/ checkout)",
            file=sys.stderr,
        )
        return 1

    total_copied, total_deleted, total_unchanged = sync_set_trees(
        args.source_root, args.vendor_cards_root, "cards"
    )

    overlay_copied, overlay_unchanged, overlay_missing = overlay_files(
        args.source_root, args.vendor_cards_root, OVERLAY_CARD_FILES, "cards"
    )
    total_copied += overlay_copied
    total_unchanged += overlay_unchanged

    for rel_index, line in OVERLAY_INDEX_LINES:
        index_file = os.path.join(args.vendor_cards_root, rel_index)
        if append_line_to_file(index_file, line):
            print(f"appended overlay export to {index_file}:")
            print(f"  + {line}")
        elif not os.path.isfile(index_file):
            print(f"overlay index missing, cannot append: {index_file}", file=sys.stderr)
            overlay_missing.append(index_file)
        else:
            print(f"{index_file}: overlay export already present (no-op)")

    index_path = os.path.join(args.vendor_cards_root, "index.ts")
    appended = append_missing_exports(index_path, args.source_root)
    if appended:
        print(f"appended {len(appended)} export line(s) to {index_path}:")
        for line in appended:
            print(f"  + {line}")
    else:
        print(f"{index_path}: all export lines already present (no-op)")

    tests_copied, tests_deleted, tests_unchanged = sync_set_trees(
        args.tests_source_root, args.vendor_tests_root, "tests"
    )
    total_copied += tests_copied
    total_deleted += tests_deleted
    total_unchanged += tests_unchanged

    tests_overlay_copied, tests_overlay_unchanged, tests_overlay_missing = overlay_files(
        args.tests_source_root, args.vendor_tests_root, OVERLAY_TEST_FILES, "tests"
    )
    total_copied += tests_overlay_copied
    total_unchanged += tests_overlay_unchanged
    overlay_missing.extend(tests_overlay_missing)

    if overlay_missing:
        print("overlay source(s) missing:", file=sys.stderr)
        for path in overlay_missing:
            print(f"  {path}", file=sys.stderr)
        return 1

    print(
        f"Graft complete: {total_copied} files copied, {total_deleted} deleted, "
        f"{total_unchanged} unchanged."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
