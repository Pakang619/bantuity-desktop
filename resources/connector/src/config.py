"""Load / save multi-product connector config (Plotex + Copilot)."""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from dotenv import load_dotenv


@dataclass
class ProductConfig:
    id: str  # plotex | copilot
    name: str
    api_url: str
    secret: str
    user_id: str
    enabled: bool = True

    def ok(self) -> bool:
        return bool(self.api_url.strip() and self.secret.strip() and self.user_id.strip())


@dataclass
class AppConfig:
    products: list[ProductConfig] = field(default_factory=list)
    poll_seconds: float = 2.0
    work_dir: str = "./work"
    stata_edition: str = "se"
    stata_path: str = ""

    def enabled_products(self) -> list[ProductConfig]:
        return [p for p in self.products if p.enabled and p.ok()]


PRODUCT_META = {
    "plotex": {"name": "Plotex", "default_api": "https://plotex-api.onrender.com"},
    "copilot": {"name": "Copilot", "default_api": "https://stata-copilot-api.onrender.com"},
}


def app_root() -> Path:
    """Install / package root (parent of src/)."""
    return Path(__file__).resolve().parent.parent


def config_path() -> Path:
    return app_root() / "config.json"


def load_dotenv_files() -> None:
    root = app_root()
    for name in (".env", "connector.env"):
        p = root / name
        if p.is_file():
            load_dotenv(p, override=False)


def _product_from_env(product_id: str, api_keys: list[str]) -> ProductConfig | None:
    api = ""
    for k in api_keys:
        api = (os.getenv(k) or "").strip()
        if api:
            break
    secret = (os.getenv("CONNECTOR_SECRET") or "").strip()
    user_id = (os.getenv("USER_ID") or "").strip()
    if not (api and secret and user_id):
        return None
    meta = PRODUCT_META[product_id]
    return ProductConfig(
        id=product_id,
        name=meta["name"],
        api_url=api.rstrip("/"),
        secret=secret,
        user_id=user_id,
        enabled=True,
    )


def _product_from_bootstrap(data: dict[str, Any]) -> ProductConfig | None:
    api = (data.get("api_url") or "").strip().rstrip("/")
    secret = (data.get("connector_secret") or "").strip()
    user_id = (data.get("user_id") or "").strip()
    if not (api and secret and user_id):
        return None
    product = (data.get("product") or "").strip().lower()
    if product not in PRODUCT_META:
        # Infer from URL
        low = api.lower()
        if "plotex" in low or "figure-studio" in low:
            product = "plotex"
        else:
            product = "copilot"
    meta = PRODUCT_META[product]
    return ProductConfig(
        id=product,
        name=meta["name"],
        api_url=api,
        secret=secret,
        user_id=user_id,
        enabled=True,
    )


def load_config() -> AppConfig:
    load_dotenv_files()
    root = app_root()
    cfg = AppConfig(
        poll_seconds=float(os.getenv("POLL_SECONDS") or "2"),
        work_dir=os.getenv("WORK_DIR") or "./work",
        stata_edition=(os.getenv("STATA_EDITION") or "se").strip() or "se",
        stata_path=(os.getenv("STATA_PATH") or os.getenv("STATA_HOME") or "").strip(),
    )

    path = config_path()
    if path.is_file():
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            products = []
            for item in raw.get("products") or []:
                if not isinstance(item, dict):
                    continue
                pid = str(item.get("id") or "copilot")
                meta = PRODUCT_META.get(pid, {"name": pid.title()})
                products.append(
                    ProductConfig(
                        id=pid,
                        name=str(item.get("name") or meta["name"]),
                        api_url=str(item.get("api_url") or "").rstrip("/"),
                        secret=str(item.get("secret") or ""),
                        user_id=str(item.get("user_id") or ""),
                        enabled=bool(item.get("enabled", True)),
                    )
                )
            cfg.products = products
            if raw.get("poll_seconds") is not None:
                cfg.poll_seconds = float(raw["poll_seconds"])
            if raw.get("work_dir"):
                cfg.work_dir = str(raw["work_dir"])
            if raw.get("stata_edition"):
                cfg.stata_edition = str(raw["stata_edition"])
            if raw.get("stata_path") is not None:
                cfg.stata_path = str(raw["stata_path"])
            if cfg.products:
                return cfg
        except Exception:
            pass

    # Migrate bootstrap.json / .env into products
    products: list[ProductConfig] = []
    by_id: dict[str, ProductConfig] = {}

    boot = root / "bootstrap.json"
    if boot.is_file():
        try:
            data = json.loads(boot.read_text(encoding="utf-8"))
            p = _product_from_bootstrap(data if isinstance(data, dict) else {})
            if p:
                by_id[p.id] = p
        except Exception:
            pass

    # Env may describe either product
    plotex = _product_from_env(
        "plotex",
        ["PLOTEX_API_URL", "FIGURE_STUDIO_API_URL"],
    )
    copilot = _product_from_env("copilot", ["COPILOT_API_URL"])
    # If only generic URL keys set, use bootstrap product or both defaults carefully
    if plotex:
        by_id["plotex"] = plotex
    if copilot:
        # Avoid duplicating same URL as plotex under wrong name
        if "plotex" in by_id and copilot.api_url == by_id["plotex"].api_url:
            pass
        else:
            by_id["copilot"] = copilot

    # Single .env without product-specific URL: assign via bootstrap product
    if not by_id:
        api = (
            os.getenv("PLOTEX_API_URL")
            or os.getenv("COPILOT_API_URL")
            or os.getenv("FIGURE_STUDIO_API_URL")
            or ""
        ).strip()
        secret = (os.getenv("CONNECTOR_SECRET") or "").strip()
        user_id = (os.getenv("USER_ID") or "").strip()
        if api and secret and user_id:
            low = api.lower()
            pid = "plotex" if ("plotex" in low or "figure" in low) else "copilot"
            meta = PRODUCT_META[pid]
            by_id[pid] = ProductConfig(
                id=pid,
                name=meta["name"],
                api_url=api.rstrip("/"),
                secret=secret,
                user_id=user_id,
                enabled=True,
            )

    cfg.products = list(by_id.values())
    if cfg.products:
        save_config(cfg)
    return cfg


def save_config(cfg: AppConfig) -> None:
    path = config_path()
    payload = {
        "products": [asdict(p) for p in cfg.products],
        "poll_seconds": cfg.poll_seconds,
        "work_dir": cfg.work_dir,
        "stata_edition": cfg.stata_edition,
        "stata_path": cfg.stata_path,
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def upsert_product(cfg: AppConfig, product: ProductConfig) -> AppConfig:
    others = [p for p in cfg.products if p.id != product.id]
    others.append(product)
    cfg.products = others
    save_config(cfg)
    return cfg


def import_bootstrap_file(path: Path, cfg: AppConfig | None = None) -> AppConfig:
    cfg = cfg or load_config()
    data = json.loads(path.read_text(encoding="utf-8"))
    product = _product_from_bootstrap(data)
    if not product:
        raise ValueError("bootstrap.json is missing api_url, connector_secret, or user_id")
    return upsert_product(cfg, product)
