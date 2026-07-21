"""Background job worker: poll Plotex and/or Copilot APIs and run Stata."""

from __future__ import annotations

import threading
import time
import traceback
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx

from src.config import AppConfig, ProductConfig, load_config
from src.diagnostics import collect_diagnostics
from src.runner import run_job
from src.staging import stage_job_files

LogFn = Callable[[str], None]
StatusFn = Callable[[str, dict[str, Any]], None]


class ConnectorWorker:
    def __init__(
        self,
        *,
        on_log: LogFn | None = None,
        on_status: StatusFn | None = None,
    ) -> None:
        self._on_log = on_log or (lambda _m: None)
        self._on_status = on_status or (lambda _p, _s: None)
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._cfg = load_config()
        self._stata_ok = False
        self._stata_info: dict[str, Any] = {}
        self._busy = False

    @property
    def config(self) -> AppConfig:
        return self._cfg

    def reload_config(self) -> AppConfig:
        self._cfg = load_config()
        return self._cfg

    def log(self, message: str) -> None:
        self._on_log(message)

    def stop(self) -> None:
        self._stop.set()

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="bantuity-worker", daemon=True)
        self._thread.start()

    def is_running(self) -> bool:
        return bool(self._thread and self._thread.is_alive() and not self._stop.is_set())

    def init_stata(self) -> dict[str, Any]:
        if self._cfg.stata_path:
            import os

            os.environ["STATA_PATH"] = self._cfg.stata_path
        if self._cfg.stata_edition:
            import os

            os.environ["STATA_EDITION"] = self._cfg.stata_edition
        from src.stata_env import require_stata_ready

        info = require_stata_ready()
        self._stata_ok = True
        self._stata_info = info
        self._on_status("stata", {"ok": True, "info": info})
        return info

    def _headers(self, product: ProductConfig) -> dict[str, str]:
        return {
            "X-Connector-Secret": product.secret,
            "X-User-Id": product.user_id,
            "Content-Type": "application/json",
        }

    def _heartbeat(self, client: httpx.Client, product: ProductConfig) -> None:
        try:
            client.post(
                f"{product.api_url}/api/v1/connector/heartbeat",
                headers=self._headers(product),
                timeout=15.0,
            )
        except Exception:
            pass

    def _post_result(
        self,
        client: httpx.Client,
        product: ProductConfig,
        job_id: str,
        result: Any,
        *,
        diagnostics: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
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
        r = client.post(
            f"{product.api_url}/api/v1/connector/result",
            json=payload,
            headers=self._headers(product),
            timeout=180.0,
        )
        r.raise_for_status()
        try:
            return r.json() if r.content else {}
        except Exception:
            return {}

    def _handle_job(
        self,
        client: httpx.Client,
        product: ProductConfig,
        job: dict[str, Any],
        work: Path,
    ) -> None:
        job_id = str(job.get("job_id") or "")
        self._busy = True
        self._on_status(
            product.id,
            {"ok": True, "busy": True, "job_id": job_id, "message": "Running analysis on Stata…"},
        )
        self.log(f"{product.name}: running job {job_id[:8]}…")
        job_work = work / job_id
        job_work.mkdir(parents=True, exist_ok=True)
        try:
            # Agent permissions: stage datasets + allowlisted diagnostics on failure
            perms = job.get("permissions") or {}
            if perms.get("stage_datasets", True) and (
                job.get("dataset_files") or job.get("project_id")
            ):
                try:
                    staged = stage_job_files(
                        job=job,
                        work_dir=job_work,
                        api=product.api_url,
                        headers=self._headers(product),
                    )
                    self.log(
                        f"{product.name}: staged {len(staged.get('staged') or [])} file(s)"
                        + (
                            f" (errors={len(staged.get('errors') or [])})"
                            if staged.get("errors")
                            else ""
                        )
                    )
                except Exception as e:
                    self.log(f"{product.name}: staging skipped: {e}")

            result = run_job(job, work)
            diagnostics: dict[str, Any] = {}
            if result.status != "success" and perms.get("diagnostics", True):
                self.log(f"{product.name}: collecting local diagnostics (dirs / PowerShell)…")
                try:
                    diagnostics = collect_diagnostics(
                        work_dir=job_work,
                        job=job,
                        error_message=result.error_message,
                        log_text=result.log_text,
                    )
                    hints = diagnostics.get("local_hints") or []
                    if hints:
                        self.log(f"{product.name}: diagnostic hints: {', '.join(map(str, hints))}")
                except Exception as e:
                    diagnostics = {"error": f"diagnostics failed: {e}"}
                    self.log(f"{product.name}: diagnostics error: {e}")

            api_resp = self._post_result(
                client, product, job_id, result, diagnostics=diagnostics
            )
            if result.status == "success":
                n = len(result.figures or [])
                self.log(f"{product.name}: finished OK ({n} figure(s)).")
            else:
                self.log(
                    f"{product.name}: finished with error: {result.error_message or 'see log'}"
                )
                if api_resp.get("status") == "requeued":
                    self.log(
                        f"{product.name}: auto-recovery requeued "
                        f"(attempt {api_resp.get('attempt')}) — will pick up fixed job"
                    )
                    self._on_status(
                        product.id,
                        {
                            "ok": True,
                            "busy": False,
                            "last_status": "requeued",
                            "message": "Auto-recovery: re-running fixed do-file…",
                        },
                    )
                    return
            self._on_status(
                product.id,
                {
                    "ok": True,
                    "busy": False,
                    "last_status": result.status,
                    "message": "Ready",
                },
            )
        except Exception as e:
            self.log(f"{product.name}: job failed: {e}")
            self.log(traceback.format_exc()[-500:])
            self._on_status(product.id, {"ok": True, "busy": False, "message": str(e)})
        finally:
            self._busy = False

    def _poll_once(self, client: httpx.Client, product: ProductConfig, work: Path) -> None:
        self._heartbeat(client, product)
        r = client.get(
            f"{product.api_url}/api/v1/connector/next",
            headers=self._headers(product),
            timeout=60.0,
        )
        r.raise_for_status()
        job = r.json().get("job")
        self._on_status(
            product.id,
            {
                "ok": True,
                "busy": self._busy,
                "message": "Connected" if not self._busy else "Running analysis…",
            },
        )
        if job:
            self._handle_job(client, product, job, work)

    def _run(self) -> None:
        try:
            self.log("Starting Bantuity Stata…")
            self.init_stata()
            self.log("Stata is ready on this computer.")
        except Exception as e:
            self._stata_ok = False
            self._on_status("stata", {"ok": False, "message": str(e)})
            self.log(f"Stata not ready: {e}")
            self.log("Install or license Stata 17+, then click Restart.")
            return

        work = (app_root_work := Path(self._cfg.work_dir))
        if not work.is_absolute():
            from src.config import app_root

            work = (app_root() / work).resolve()
        work.mkdir(parents=True, exist_ok=True)

        poll = max(1.0, float(self._cfg.poll_seconds or 2))
        with httpx.Client() as client:
            while not self._stop.is_set():
                self._cfg = load_config()
                products = self._cfg.enabled_products()
                if not products:
                    self.log("No product linked yet. Open Settings to add Plotex or Copilot.")
                    for _ in range(int(poll * 2)):
                        if self._stop.is_set():
                            return
                        time.sleep(0.5)
                    continue
                for product in products:
                    if self._stop.is_set():
                        return
                    try:
                        # Health check occasionally via heartbeat/next
                        self._poll_once(client, product, work)
                    except Exception as e:
                        self._on_status(
                            product.id,
                            {"ok": False, "message": str(e)},
                        )
                        self.log(f"{product.name}: connection issue — {e}")
                # Sleep between rounds
                for _ in range(int(poll * 2)):
                    if self._stop.is_set():
                        return
                    time.sleep(0.5)

        self.log("Stopped.")


def headless_main() -> None:
    """CLI fallback without GUI."""
    stop = threading.Event()

    def on_log(m: str) -> None:
        print(f"[bantuity] {m}")

    w = ConnectorWorker(on_log=on_log)
    w.start()
    try:
        while w.is_running():
            time.sleep(0.5)
    except KeyboardInterrupt:
        w.stop()
        print("[bantuity] stopped")
