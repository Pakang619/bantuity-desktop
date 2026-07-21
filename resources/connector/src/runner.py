"""Save temp scripts and invoke executor."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from src.executor import RunResult, run_do_file


def run_job(job: dict[str, Any], work_root: Path) -> RunResult:
    job_id = job["job_id"]
    work = work_root / job_id
    work.mkdir(parents=True, exist_ok=True)
    do_path = work / "main.do"
    do_path.write_text(job.get("code") or "", encoding="utf-8")
    return run_do_file(do_path, work)
