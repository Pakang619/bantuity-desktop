"""Locate and initialize licensed local Stata via PyStata (no mocks)."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Optional, Tuple

# Common Windows install roots (newest first)
_CANDIDATE_ROOTS = [
    Path(r"C:\Program Files\StataNow19"),
    Path(r"C:\Program Files\Stata19"),
    Path(r"C:\Program Files\Stata18"),
    Path(r"C:\Program Files\Stata17"),
    Path(r"C:\Program Files\Stata16"),
    Path(r"C:\Program Files (x86)\Stata18"),
    Path(r"C:\Program Files (x86)\Stata17"),
]

_EDITION_MAP = {
    "se": "se",
    "mp": "mp",
    "be": "be",
    "ic": "be",  # legacy
}


def resolve_stata_home() -> Path:
    env = (os.getenv("STATA_PATH") or os.getenv("STATA_HOME") or "").strip().strip('"')
    if env:
        p = Path(env)
        if not p.exists():
            raise FileNotFoundError(f"STATA_PATH does not exist: {p}")
        return p
    for root in _CANDIDATE_ROOTS:
        if root.exists():
            return root
    raise FileNotFoundError(
        "Stata installation not found. Set STATA_PATH in connector/.env "
        r'e.g. STATA_PATH=C:\Program Files\StataNow19'
    )


def resolve_edition(home: Path) -> str:
    env = (os.getenv("STATA_EDITION") or "").strip().lower()
    if env in _EDITION_MAP:
        return _EDITION_MAP[env]
    # Detect from executable names
    for name, ed in (
        ("StataMP-64.exe", "mp"),
        ("StataSE-64.exe", "se"),
        ("StataBE-64.exe", "be"),
        ("StataMP.exe", "mp"),
        ("StataSE.exe", "se"),
        ("StataBE.exe", "be"),
    ):
        if (home / name).exists():
            return ed
    return "se"


def pystata_utilities_dir(home: Path) -> Path:
    utilities = home / "utilities"
    if not (utilities / "pystata").is_dir():
        raise FileNotFoundError(
            f"PyStata not found under {utilities}. "
            "Install Stata with PyStata utilities (Stata 17+)."
        )
    return utilities


_INITIALIZED = False
_STATA_VERSION: Optional[str] = None
_STATA_HOME: Optional[Path] = None


def init_stata() -> Tuple[Path, str, str]:
    """
    Initialize PyStata against licensed Stata.
    Returns (home, edition, version_string).
    Raises on any failure — never simulates.
    """
    global _INITIALIZED, _STATA_VERSION, _STATA_HOME
    if _INITIALIZED and _STATA_HOME is not None:
        return _STATA_HOME, resolve_edition(_STATA_HOME), _STATA_VERSION or "unknown"

    home = resolve_stata_home()
    edition = resolve_edition(home)
    utilities = pystata_utilities_dir(home)
    util_str = str(utilities)
    if util_str not in sys.path:
        sys.path.insert(0, util_str)

    try:
        from pystata import config as stconfig  # type: ignore
    except ImportError as e:
        raise ImportError(
            f"Cannot import pystata from {utilities}. "
            "Use the same Python bitness as Stata (usually 64-bit)."
        ) from e

    # config.init(edition) starts Stata automation
    stconfig.init(edition)

    version = "unknown"
    try:
        from pystata import stata  # type: ignore

        # Capture version via Stata
        stata.run("display c(stata_version)")
        version = f"Stata {edition.upper()} @ {home}"
    except Exception:
        version = f"Stata {edition.upper()} @ {home}"

    _INITIALIZED = True
    _STATA_VERSION = version
    _STATA_HOME = home
    print(f"[stata] initialized home={home} edition={edition}")
    return home, edition, version


def require_stata_ready() -> dict:
    """Probe used at connector startup — hard fail if not ready."""
    home, edition, version = init_stata()
    from pystata import stata  # type: ignore

    stata.run("display 2+2")
    return {
        "ok": True,
        "stata_home": str(home),
        "edition": edition,
        "version": version,
        "pystata": str(pystata_utilities_dir(home) / "pystata"),
    }
