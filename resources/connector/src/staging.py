"""Stage project datasets into the job work directory before Stata runs."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx


def stage_job_files(
    *,
    job: dict[str, Any],
    work_dir: Path,
    api: str,
    headers: dict[str, str],
) -> dict[str, Any]:
    """
    Download dataset files listed on the job into work_dir/Datasets/.
    Job may include:
      - dataset_files: ["Datasets/foo.csv"]
      - project_id
    Always creates Datasets/, Code/, Outputs/ so do-files have a stable layout.
    """
    work_dir = Path(work_dir)
    ds_dir = work_dir / "Datasets"
    ds_dir.mkdir(parents=True, exist_ok=True)
    (work_dir / "Code").mkdir(exist_ok=True)
    (work_dir / "Outputs").mkdir(exist_ok=True)
    (work_dir / "Logs").mkdir(exist_ok=True)

    files = list(job.get("dataset_files") or [])
    project_id = job.get("project_id") or ""
    staged: list[str] = []
    errors: list[str] = []

    if not project_id:
        return {
            "staged": staged,
            "errors": errors,
            "skipped": True,
            "reason": "no_project_id",
            "layout": ["Datasets", "Code", "Outputs", "Logs"],
        }

    if not files:
        return {
            "staged": staged,
            "errors": errors,
            "skipped": True,
            "reason": "no_dataset_files_on_job",
            "layout": ["Datasets", "Code", "Outputs", "Logs"],
        }

    api = api.rstrip("/")
    with httpx.Client(timeout=120.0) as client:
        for rel in files:
            rel = str(rel).replace("\\", "/").lstrip("/")
            if ".." in rel.split("/"):
                errors.append(f"blocked path {rel}")
                continue
            # Always land under work_dir preserving Datasets/...
            dest = work_dir / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            url = f"{api}/api/v1/connector/files/{project_id}/{rel}"
            try:
                r = client.get(url, headers=headers)
                if r.status_code != 200:
                    # Fallback: projects files route (some deployments)
                    url2 = f"{api}/api/v1/projects/{project_id}/files/{rel}"
                    r = client.get(url2, headers=headers)
                r.raise_for_status()
                dest.write_bytes(r.content)
                staged.append(rel)
                # Also copy basename into Datasets/ for naive `use foo.dta`
                base = Path(rel).name
                alias = ds_dir / base
                if not alias.exists() or alias.resolve() != dest.resolve():
                    try:
                        if dest.resolve() != alias.resolve():
                            alias.write_bytes(dest.read_bytes())
                            staged.append(f"Datasets/{base}")
                    except OSError:
                        pass
            except Exception as e:
                errors.append(f"{rel}: {e}")

    return {
        "staged": list(dict.fromkeys(staged)),
        "errors": errors,
        "skipped": False,
        "layout": ["Datasets", "Code", "Outputs", "Logs"],
    }
