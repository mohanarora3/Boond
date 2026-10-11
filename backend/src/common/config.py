"""Loads the JSON config files. All policy numbers come from here."""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

CONFIG_DIR = Path(os.environ.get("BOOND_CONFIG_DIR", Path(__file__).resolve().parents[2] / "config"))


@lru_cache(maxsize=None)
def _load(name: str) -> dict[str, Any]:
    with open(CONFIG_DIR / name, encoding="utf-8") as f:
        return json.load(f)


def rules() -> dict[str, Any]:
    return _load("delhi_rules.json")


def structures() -> dict[str, Any]:
    return _load("structures.json")
