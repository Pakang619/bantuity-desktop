"""
Local Connector — production bridge to FastAPI + licensed Stata.

  python -m src.connector

Agent-style permissions (allowlisted only):
  - stage project datasets into work_dir/Datasets/
  - collect PowerShell + filesystem diagnostics on failure
  - post diagnostics so the API can auto-recover and requeue (up to max retries)
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

load_dotenv(ROOT / ".env")

from src.diagnostics import collect_diagnostics
from src.runner import run_job
from src.staging import stage_job_files
from src.stata_env import require_stata_ready

API = (
    os.getenv("COPILOT_API_URL")
    or os.getenv("PLOTEX_API_URL")
    or os.getenv("FIGURE_STUDIO_API_URL")
    or "http://127.0.0.1:8300"
).rstrip("/")
SECRET = (os.getenv("CONNECTOR_SECRET") or "").strip()
USER_ID = (os.getenv("USER_ID") or "").strip()
POLL = float(os.getenv("POLL_SECONDS") or "2")
USE_WS = (os.getenv("USE_WEBSOCKET") or "true").lower() in ("1", "true", "yes")
# Agent permissions (coding-agent style; allowlisted diagnostics only)
ALLOW_DIAGNOSTICS = (os.getenv("ALLOW_DIAGNOSTICS") or "true").lower() in (
    "1",
    "true",
    "yes",
)
ALLOW_STAGE_DATASETS = (os.getenv("ALLOW_STAGE_DATASETS") or "true").lower() in (
    "1",
    "true",
    "yes",
)
WORK = Path(os.getenv("WORK_DIR") or str(ROOT / "work")).resolve()
WORK.mkdir(parents=True, exist_ok=True)


def headers() -> dict[str, str]:
    return {
        "X-Connector-Secret": SECRET,
        "X-User-Id": USER_ID,
        "Content-Type": "application/json",
    }


def post_result(job_id: str, result, *, diagnostics: dict | None = None) -> dict:
    payload = {
        "job_id": job_id,
        "status": result.status,
        "log_text": result.log_text,
        "stata_version": result.stata_version,
        "duration_ms": result.duration_ms,
        "error_message": result.error_message,
        "figures": result.figures,
        "metadata": getattr(result, "metadata", None) or {},
        "diagnostics": diagnostics or {},
    }
    with httpx.Client(timeout=180.0) as client:
        r = client.post(f"{API}/api/v1/connector/result", json=payload, headers=headers())
        r.raise_for_status()
        data = r.json() if r.content else {}
        print(
            f"[connector] result posted job={job_id} status={result.status} "
            f"api_status={data.get('status')}"
        )
        if data.get("status") == "requeued":
            print(
                f"[connector] API auto-recovery requeued "
                f"attempt={data.get('attempt')} note={data.get('note')!r}"
            )
        return data


def handle_job(job: dict) -> None:
    """
    Run Stata job with staging + diagnostics.
    API may requeue on error (auto-recovery); connector will pick up the next job.
    """
    job_id = job["job_id"]
    print(f"[connector] running job={job_id}")
    work = WORK / job_id
    work.mkdir(parents=True, exist_ok=True)

    perms = job.get("permissions") or {}
    do_stage = ALLOW_STAGE_DATASETS and perms.get("stage_datasets", True)
    do_diag = ALLOW_DIAGNOSTICS and perms.get("diagnostics", True)

    if do_stage:
        try:
            staged = stage_job_files(
                job=job, work_dir=work, api=API, headers=headers()
            )
            print(f"[connector] staged files: {staged}")
        except Exception as e:
            print(f"[connector] staging error (continuing): {e}")

    result = run_job(job, WORK)
    print(
        f"[connector] finished status={result.status} "
        f"ms={result.duration_ms} err={result.error_message!r}"
    )

    diagnostics: dict = {}
    if result.status != "success" and do_diag:
        try:
            diagnostics = collect_diagnostics(
                work_dir=work,
                job=job,
                error_message=result.error_message,
                log_text=result.log_text,
            )
            print(
                f"[connector] diagnostics hints={diagnostics.get('local_hints')} "
                f"paths={list((diagnostics.get('path_checks') or {}).keys())[:6]}"
            )
        except Exception as e:
            diagnostics = {"error": f"diagnostics failed: {e}"}

    post_result(job_id, result, diagnostics=diagnostics)


def poll_loop() -> None:
    print(f"[connector] poll mode API={API} user={USER_ID}")
    print(
        f"[connector] permissions diagnostics={ALLOW_DIAGNOSTICS} "
        f"stage_datasets={ALLOW_STAGE_DATASETS}"
    )
    with httpx.Client(timeout=60.0) as client:
        while True:
            try:
                r = client.get(f"{API}/api/v1/connector/next", headers=headers())
                r.raise_for_status()
                job = r.json().get("job")
                if job:
                    handle_job(job)
                else:
                    time.sleep(POLL)
            except KeyboardInterrupt:
                raise
            except Exception as e:
                print(f"[connector] poll error: {e}")
                time.sleep(POLL)


async def ws_loop() -> None:
    import websockets

    url = (
        API.replace("https://", "wss://").replace("http://", "ws://")
        + f"/api/v1/connector/ws?secret={SECRET}&user_id={USER_ID}"
    )
    print(f"[connector] websocket → {API}")
    print(
        f"[connector] permissions diagnostics={ALLOW_DIAGNOSTICS} "
        f"stage_datasets={ALLOW_STAGE_DATASETS}"
    )
    while True:
        try:
            async with websockets.connect(url, ping_interval=20, open_timeout=30) as ws:
                print("[connector] connected to API")
                async for raw in ws:
                    msg = json.loads(raw)
                    if msg.get("type") == "job":
                        await asyncio.to_thread(handle_job, msg["job"])
                    elif msg.get("type") == "ping":
                        await ws.send(json.dumps({"type": "pong"}))
        except KeyboardInterrupt:
            raise
        except Exception as e:
            print(f"[connector] ws error: {e}; reconnect in 3s")
            await asyncio.sleep(3)


def main() -> None:
    print("[connector] Bantuity Stata Connector (production + auto-recovery)")
    if not SECRET:
        print("FATAL: set CONNECTOR_SECRET in connector/.env")
        sys.exit(1)
    if not USER_ID:
        print("FATAL: set USER_ID in connector/.env (from web login /api/v1/me)")
        sys.exit(1)

    try:
        info = require_stata_ready()
        print(f"[connector] Stata ready: {info}")
    except Exception as e:
        print(f"FATAL: Stata/PyStata not ready: {e}")
        sys.exit(2)

    try:
        r = httpx.get(f"{API}/api/v1/health", timeout=10.0)
        r.raise_for_status()
        print(f"[connector] API health: {r.json()}")
    except Exception as e:
        print(f"FATAL: cannot reach API at {API}: {e}")
        sys.exit(3)

    print(f"[connector] work_dir={WORK}")
    print(
        "[connector] agent permissions: "
        "diagnostics=allowlisted_ps+fs, stage_datasets=on, auto_recovery=API"
    )
    if USE_WS:
        try:
            asyncio.run(ws_loop())
        except KeyboardInterrupt:
            print("[connector] stopped")
        return
    try:
        poll_loop()
    except KeyboardInterrupt:
        print("[connector] stopped")


if __name__ == "__main__":
    main()
