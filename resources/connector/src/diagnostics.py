"""
Allowlisted local diagnostics for Stata recovery (PowerShell / filesystem / env).

Coding-agent style: when Stata fails, inspect directories, packages, and the machine
using a fixed allowlist only — never free-form shell from the LLM or API.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any


# Only these PowerShell snippets may run (no user-controlled free shell)
_PS_ALLOWLIST: dict[str, str] = {
    "pwd": "Get-Location | Select-Object -ExpandProperty Path",
    "env_stata": (
        "@('STATA_HOME','STATA_EDITION','STATA_VERSION','STATA_PATH','PATH',"
        "'PLUS','PERSONAL','ADO') | "
        "ForEach-Object { \"$_=$([Environment]::GetEnvironmentVariable($_,'Process'))\" }"
    ),
    "where_stata": (
        "Get-Command stata*,StataMP-64,StataSE-64,StataBE-64 -ErrorAction SilentlyContinue | "
        "Select-Object -ExpandProperty Source"
    ),
    "stata_program_files": (
        "$roots = @("
        "  ${env:ProgramFiles},"
        "  ${env:ProgramFiles(x86)},"
        "  'C:\\Program Files',"
        "  'C:\\Program Files (x86)'"
        "); "
        "foreach ($r in $roots) { "
        "  if (-not $r) { continue }; "
        "  Get-ChildItem -Path $r -Directory -ErrorAction SilentlyContinue | "
        "    Where-Object { $_.Name -match 'Stata' } | "
        "    ForEach-Object { $_.FullName } "
        "}"
    ),
    "python_ok": "python --version 2>&1; py -3 --version 2>&1",
    "disk_free": (
        "Get-PSDrive -PSProvider FileSystem | "
        "Select-Object Name, "
        "@{N='FreeGB';E={[math]::Round($_.Free/1GB,2)}}, "
        "@{N='UsedGB';E={[math]::Round($_.Used/1GB,2)}} | "
        "Format-Table -AutoSize | Out-String"
    ),
    "ado_paths": (
        "$candidates = @("
        "  (Join-Path $env:USERPROFILE 'ado'),"
        "  (Join-Path $env:USERPROFILE 'Documents\\Stata'),"
        "  (Join-Path $env:APPDATA 'Stata'),"
        "  (Join-Path $env:LOCALAPPDATA 'Stata')"
        "); "
        "foreach ($c in $candidates) { "
        "  if (Test-Path $c) { "
        "    Write-Output \"EXISTS $c\"; "
        "    Get-ChildItem $c -ErrorAction SilentlyContinue | Select-Object -First 20 Name | "
        "      ForEach-Object { Write-Output ('  ' + $_.Name) } "
        "  } else { Write-Output \"MISSING $c\" } "
        "}"
    ),
    "temp_writable": (
        "$t = Join-Path $env:TEMP ('bantuity_probe_' + [guid]::NewGuid().ToString('N').Substring(0,8)); "
        "try { "
        "  New-Item -ItemType File -Path $t -Force | Out-Null; "
        "  'TEMP_WRITABLE=1 path=' + $t; "
        "  Remove-Item $t -Force -ErrorAction SilentlyContinue "
        "} catch { 'TEMP_WRITABLE=0 err=' + $_.Exception.Message }"
    ),
    "ps_version": "$PSVersionTable.PSVersion.ToString()",
}


def _run_ps(script: str, timeout: float = 25.0) -> dict[str, Any]:
    try:
        completed = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                script,
            ],
            capture_output=True,
            text=True,
            timeout=timeout,
            encoding="utf-8",
            errors="replace",
        )
        return {
            "ok": completed.returncode == 0,
            "stdout": (completed.stdout or "")[:4000],
            "stderr": (completed.stderr or "")[:1500],
            "returncode": completed.returncode,
        }
    except Exception as e:
        return {"ok": False, "stdout": "", "stderr": str(e), "returncode": -1}


def _list_dir(path: Path, *, max_entries: int = 100, recursive_depth: int = 0) -> list[dict[str, Any]]:
    if not path.is_dir():
        return []
    out: list[dict[str, Any]] = []
    try:
        entries = sorted(path.iterdir(), key=lambda p: p.name.lower())
        for p in entries[:max_entries]:
            try:
                item: dict[str, Any] = {
                    "name": p.name,
                    "path": str(p).replace("\\", "/"),
                    "is_dir": p.is_dir(),
                    "bytes": p.stat().st_size if p.is_file() else None,
                }
                if recursive_depth > 0 and p.is_dir():
                    item["children"] = _list_dir(p, max_entries=40, recursive_depth=recursive_depth - 1)
                out.append(item)
            except OSError:
                continue
    except OSError:
        return []
    return out


def _flatten_listing(entries: list[dict[str, Any]], prefix: str = "") -> list[str]:
    flat: list[str] = []
    for e in entries:
        rel = f"{prefix}{e.get('name', '')}" if not prefix else f"{prefix}/{e.get('name', '')}"
        if not prefix:
            rel = str(e.get("path") or e.get("name") or "")
        flat.append(rel.replace("\\", "/"))
        kids = e.get("children") or []
        if kids:
            name = e.get("name") or ""
            flat.extend(_flatten_listing(kids, name if not prefix else f"{prefix}/{name}"))
    return flat


def _extract_paths_from_code(code: str) -> list[str]:
    paths = re.findall(
        r'["\']([^"\']+\.(?:csv|dta|xlsx|xls|txt|do|log|png|smcl|gph))["\']',
        code or "",
        re.I,
    )
    # also bare use foo.dta patterns
    paths += re.findall(
        r"\b(?:use|import\s+delimited|import\s+excel|insheet)\s+([A-Za-z0-9_./\\-]+\.(?:csv|dta|xlsx|xls|txt))",
        code or "",
        re.I,
    )
    return list(dict.fromkeys(paths))[:40]


def collect_diagnostics(
    *,
    work_dir: Path,
    job: dict[str, Any],
    error_message: str | None = None,
    log_text: str | None = None,
) -> dict[str, Any]:
    """
    Safe local diagnosis after a Stata failure.
    Used by the recovery agent to fix paths / missing packages / env issues.
    """
    work_dir = Path(work_dir).resolve()
    diags: dict[str, Any] = {
        "work_dir": str(work_dir),
        "work_dir_exists": work_dir.is_dir(),
        "work_dir_listing": _list_dir(work_dir, recursive_depth=1),
        "datasets_dir": None,
        "project_files": [],
        "referenced_paths": _extract_paths_from_code(job.get("code") or ""),
        "path_checks": {},
        "powershell": {},
        "stata_which": shutil.which("StataMP-64")
        or shutil.which("StataSE-64")
        or shutil.which("StataBE-64")
        or shutil.which("stata"),
        "cwd": os.getcwd(),
        "error_message": (error_message or "")[:1000],
        "log_tail": (log_text or "")[-2500:],
        "permissions": {
            "agent_diagnostics": True,
            "allowlisted_powershell_only": True,
            "no_arbitrary_shell": True,
            "stage_datasets": True,
            "inspect_directories": True,
            "inspect_ado_paths": True,
            "inspect_disk": True,
            "auto_recovery_requeue": True,
        },
    }

    # Nested Datasets under work dir (after staging)
    ds = work_dir / "Datasets"
    ds_listing = _list_dir(ds, recursive_depth=1) if ds.is_dir() else []
    diags["datasets_dir"] = {
        "path": str(ds),
        "exists": ds.is_dir(),
        "listing": ds_listing,
    }
    diags["project_files"] = _flatten_listing(ds_listing) + _flatten_listing(
        diags["work_dir_listing"]
    )

    # Parent WORK root (sibling job folders sometimes share Datasets)
    parent = work_dir.parent
    if parent.is_dir():
        shared_ds = parent / "Datasets"
        if shared_ds.is_dir():
            diags["shared_datasets"] = {
                "path": str(shared_ds),
                "listing": _list_dir(shared_ds, recursive_depth=1),
            }

    # Check each path referenced in the do-file
    for ref in diags["referenced_paths"]:
        candidates = [
            work_dir / ref,
            work_dir / Path(ref).name,
            work_dir / "Datasets" / Path(ref).name,
            Path(ref) if Path(ref).is_absolute() else None,
        ]
        found = None
        for c in candidates:
            if c is None:
                continue
            try:
                if c.exists():
                    found = str(c)
                    break
            except OSError:
                continue
        diags["path_checks"][ref] = {
            "exists": found is not None,
            "resolved": found,
        }

    # Allowlisted PowerShell probes only
    for key, script in _PS_ALLOWLIST.items():
        diags["powershell"][key] = _run_ps(script)

    # Classify quick hints for the API without LLM
    hints: list[str] = []
    blob = f"{error_message or ''}\n{log_text or ''}".lower()
    if "not found" in blob or "r(601)" in blob or "r(603)" in blob:
        hints.append("file_not_found")
    if "unrecognized command" in blob or "r(199)" in blob:
        hints.append("missing_command_or_ado")
    if "type mismatch" in blob or "r(109)" in blob:
        hints.append("type_mismatch")
    if "invalid syntax" in blob or "r(198)" in blob:
        hints.append("syntax")
    if "insufficient memory" in blob or "r(909)" in blob:
        hints.append("memory")
    if "already defined" in blob or "r(110)" in blob:
        hints.append("already_defined")
    if "permission" in blob or "access is denied" in blob:
        hints.append("permission_denied")
    if not diags["datasets_dir"]["exists"]:
        hints.append("datasets_folder_missing_in_work_dir")
    missing_refs = [
        ref for ref, chk in diags["path_checks"].items() if not chk.get("exists")
    ]
    if missing_refs:
        hints.append("referenced_files_missing_on_disk")
        diags["missing_referenced_files"] = missing_refs
    if not diags.get("stata_which") and not (
        diags.get("powershell", {}).get("where_stata", {}).get("stdout") or ""
    ).strip():
        hints.append("stata_binary_not_on_path")

    diags["local_hints"] = list(dict.fromkeys(hints))
    return diags
