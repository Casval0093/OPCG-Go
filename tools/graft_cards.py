#!/usr/bin/env python3
"""Graft this repo's OP15/OP16 card definitions into the vendored engine.

`cards/OP15` and `cards/OP16` in this repo are the single source of truth
(docs/plans/encode-op15-op16.md, Global Constraint #1). The vendored engine
at vendor/ is gitignored and disposable -- OP15 and OP16 are directories
upstream does not ship, so this script owns
`vendor/tcg-engines/submodules/one-piece/packages/cards/src/cards/OP15` and
`.../OP16` outright and mirrors this repo's `cards/OP15|OP16` into them
exactly (including deleting a grafted file with no source counterpart, e.g.
after a rename). It then idempotently appends the export lines that top-level
`cards/index.ts` needs to pick the new sets up, and nothing else in that file
is touched.

Never hand-edit the grafted copy under vendor/ -- edit cards/ in this repo
and re-run this script.

Usage:
    ./.venv/bin/python tools/graft_cards.py
    ./.venv/bin/python tools/graft_cards.py --vendor-cards-root <path>   # for tests
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

SETS = ["OP15", "OP16"]
TYPE_DIRS = ["leaders", "characters", "events", "stages"]


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


def required_export_lines() -> list[str]:
    lines = []
    for set_id in SETS:
        for type_dir in TYPE_DIRS:
            lines.append(f'export * from "./{set_id}/{type_dir}/index.ts";')
    return lines


def append_missing_exports(index_path: str) -> list[str]:
    """Idempotently ensure `index_path` contains every line from
    required_export_lines(). Returns the list of lines actually appended
    (empty if the file already had all of them -- a true no-op rerun)."""
    with open(index_path, encoding="utf8") as f:
        content = f.read()
    existing_lines = set(content.splitlines())

    missing = [line for line in required_export_lines() if line not in existing_lines]
    if not missing:
        return []

    if content and not content.endswith("\n"):
        content += "\n"
    content += "\n".join(missing) + "\n"

    with open(index_path, "w", encoding="utf8") as f:
        f.write(content)
    return missing


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", default=DEFAULT_SOURCE_ROOT)
    parser.add_argument("--vendor-cards-root", default=DEFAULT_VENDOR_CARDS_ROOT)
    args = parser.parse_args()

    if not os.path.isdir(args.vendor_cards_root):
        print(
            f"vendor cards root not found: {args.vendor_cards_root}\n"
            f"(run this after `pnpm install`, from a bootstrapped vendor/ checkout)",
            file=sys.stderr,
        )
        return 1

    total_copied = total_deleted = total_unchanged = 0
    for set_id in SETS:
        src = os.path.join(args.source_root, set_id)
        if not os.path.isdir(src):
            print(f"source set not found, skipping: {src}", file=sys.stderr)
            continue
        dst = os.path.join(args.vendor_cards_root, set_id)
        copied, deleted, unchanged = sync_tree(src, dst)
        total_copied += copied
        total_deleted += deleted
        total_unchanged += unchanged
        print(f"{set_id}: {copied} copied, {deleted} deleted, {unchanged} unchanged -> {dst}")

    index_path = os.path.join(args.vendor_cards_root, "index.ts")
    appended = append_missing_exports(index_path)
    if appended:
        print(f"appended {len(appended)} export line(s) to {index_path}:")
        for line in appended:
            print(f"  + {line}")
    else:
        print(f"{index_path}: all export lines already present (no-op)")

    print(
        f"Graft complete: {total_copied} files copied, {total_deleted} deleted, "
        f"{total_unchanged} unchanged."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
