"""Headless service entrypoint used by Bantuity Desktop (no console UI)."""

from __future__ import annotations

import sys
import time

from src.worker import ConnectorWorker


def main() -> None:
    print("[bantuity-stata] service starting", flush=True)

    def on_log(msg: str) -> None:
        print(f"[bantuity-stata] {msg}", flush=True)

    def on_status(product: str, payload: dict) -> None:
        ok = payload.get("ok")
        message = payload.get("message") or ""
        print(f"[bantuity-stata] status {product}: ok={ok} {message}", flush=True)

    worker = ConnectorWorker(on_log=on_log, on_status=on_status)
    worker.start()
    try:
        while worker.is_running():
            time.sleep(0.5)
        # If Stata failed at init, keep process alive briefly so desktop can read logs
        time.sleep(2)
    except KeyboardInterrupt:
        worker.stop()
        print("[bantuity-stata] stopped", flush=True)
        sys.exit(0)


if __name__ == "__main__":
    main()
