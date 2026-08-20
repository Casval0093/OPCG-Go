#!/usr/bin/env python3
"""Cross-process canonical environment hashing through the Node encoder."""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
HASH_CLI = REPO_ROOT / "environment" / "hash_cli.mjs"
HASH_PATTERN = re.compile(r"sha256:[0-9a-f]{64}\Z")


def canonical_hash(value: object) -> str:
    """Return the Node canonical hash for a JSON-domain Python value."""
    try:
        payload = json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf8")
    except (TypeError, ValueError) as error:
        raise ValueError("canonical_hash_requires_json_domain") from error

    completed = subprocess.run(
        ["node", str(HASH_CLI)],
        input=payload,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
        shell=False,
    )
    try:
        response = json.loads(completed.stdout)
    except (TypeError, json.JSONDecodeError) as error:
        raise RuntimeError("environment_hash_invalid_cli_output") from error
    if (
        not isinstance(response, dict)
        or set(response) != {"sha256"}
        or not isinstance(response["sha256"], str)
        or HASH_PATTERN.fullmatch(response["sha256"]) is None
    ):
        raise RuntimeError("environment_hash_invalid_cli_output")
    return response["sha256"]
