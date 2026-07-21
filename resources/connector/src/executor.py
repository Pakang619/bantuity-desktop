"""PyStata Engine — real licensed Stata only. No mocks or simulations."""

from __future__ import annotations

import base64
import csv
import json
import re
import time
import traceback
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from src.stata_env import init_stata


@dataclass
class RunResult:
    status: str  # success | error
    log_text: str = ""
    stata_version: Optional[str] = None
    duration_ms: int = 0
    error_message: Optional[str] = None
    figures: list[dict[str, Any]] = field(default_factory=list)
    # Aggregate metadata (legacy); prefer per-figure metadata on each figure
    metadata: dict[str, Any] = field(default_factory=dict)


_GRAPH_EXPORT_RE = re.compile(
    r"""graph\s+export\s+("([^"]+)"|'([^']+)'|([^\s,]+))\s*(,.*)?$""",
    re.IGNORECASE,
)


def _safe_stem(name: str) -> str:
    stem = Path(name).stem
    return re.sub(r"[^A-Za-z0-9._-]+", "_", stem)[:80] or "figure"


def inject_plotex_snapshots(code: str) -> str:
    """After each graph export, snapshot current data for Plotex series metadata."""
    lines = code.splitlines()
    out: list[str] = []
    out.append("* --- Plotex: per-graph data snapshots (auto-injected) ---")
    for line in lines:
        out.append(line)
        m = _GRAPH_EXPORT_RE.search(line.strip())
        if not m:
            continue
        fname = m.group(2) or m.group(3) or m.group(4) or "figure.png"
        stem = _safe_stem(fname)
        # Capture data state immediately after export (before later collapse/clear)
        out.append("quietly {")
        out.append("    preserve")
        out.append("    capture keep if _n <= 500")
        out.append(f'    capture export delimited using "plotex_meta_{stem}.csv", replace')
        out.append(
            f'    capture file open __px using "plotex_meta_{stem}.marker", write replace text'
        )
        out.append(f'    capture file write __px ("{fname}")')
        out.append("    capture file close __px")
        out.append("    restore")
        out.append("}")
    return "\n".join(out) + "\n"


def _detect_graph_type_from_name_or_code(name: str, code: str) -> str:
    """Classify Stata graph family for metadata (aligned with Plotex bfs.detect_graph_type)."""
    blob = f"{name} {code}".lower()
    rules = [
        (r"\bgraph\s+combine\b|\bgrc1leg\b", "combine"),
        (r"\bspmap\b|\bgeoplot\b|\bmaptile\b|\btmap\b", "map"),
        (r"\bsts\s+graph\b|\bkaplan\b", "km"),
        (r"\bsts\s+cumhaz\b|\bcumhaz\b", "cumhaz"),
        (r"\bcoefplot\b|forest\s*plot|\bmetan\b|\badmetan\b", "forest"),
        (r"\broccomp\b|\blroc\b|\broctab\b|\broc\b", "roc"),
        (r"\bmarginsplot\b", "margins"),
        (r"\bfunnel\b|\bmetafunnel\b", "funnel"),
        (r"\bqnorm\b|\bqqplot\b|\bpnorm\b", "qqplot"),
        (r"\bciplot\b|\bserrbar\b", "ciplot"),
        (r"\bhistogram\b", "histogram"),
        (r"\bkdensity\b|density", "density"),
        (r"\bgraph\s+box\b|\bboxplot\b|\bbox\b", "boxplot"),
        (r"\bvioplot\b|\bviolin\b", "violin"),
        (r"\bstripplot\b|\bbeeswarm\b", "strip"),
        (r"\bsunflower\b", "sunflower"),
        (r"\bpyramid\b|\bpoppyramid\b", "pyramid"),
        (r"\bgraph\s+pie\b|\bpie\b", "pie"),
        (r"\bgraph\s+matrix\b", "matrix"),
        (r"\bgraph\s+dot\b|\bdot\b", "dot"),
        (r"\bgraph\s+hbar\b|\bhbar\b", "hbar"),
        (r"\bgraph\s+bar\b|\bbar\b", "bar"),
        (r"\bheatmap\b|\bheatplot\b|\bcontour\b", "heatmap"),
        (r"\blowess\b", "lowess"),
        (r"\blpoly\b", "lpoly"),
        (r"\btsline\b|\bxtline\b", "tsline"),
        (r"\bfunction\b", "function"),
        (r"\brcap\b|\brbar\b|\brspike\b", "rcap"),
        (r"\bspike\b|\bdropline\b", "spike"),
        (r"\bconnected\b", "connected"),
        (r"\brarea\b|\barea\b", "area"),
        (r"\bscatter\b", "scatter"),
        (r"\blfit\b|\bline\b|\btwoway\b", "line"),
    ]
    for pat, g in rules:
        if re.search(pat, blob):
            return g
    return "custom"


def _series_kind(graph_type: str) -> str:
    g = (graph_type or "line").lower()
    if g in ("bar", "hbar", "pie", "histogram", "pyramid"):
        return "bar"
    if g in ("km", "cumhaz"):
        return "step"
    if g in ("scatter", "dot", "sunflower", "strip", "qqplot", "forest", "funnel", "matrix", "custom"):
        return "scatter"
    if g in ("area", "density", "violin"):
        return "area"
    if g in ("connected",):
        return "connected"
    if g in ("spike", "rcap", "ciplot", "acf"):
        return "spike"
    return "line"


def _series_from_csv(csv_path: Path, *, graph_type: str, title: str) -> dict[str, Any]:
    if not csv_path.is_file():
        return {}
    try:
        with csv_path.open(newline="", encoding="utf-8", errors="replace") as f:
            reader = csv.DictReader(f)
            rows = list(reader)
            cols = [c for c in (reader.fieldnames or []) if c]
    except OSError:
        return {}
    if not rows or not cols:
        return {}

    def _num(v: Any) -> float | None:
        try:
            return float(str(v).strip())
        except (TypeError, ValueError):
            return None

    # Prefer classic x/y
    if "x" in cols and "y" in cols:
        xs, ys = [], []
        for r in rows:
            xv, yv = _num(r.get("x")), _num(r.get("y"))
            if xv is None or yv is None:
                continue
            xs.append(xv)
            ys.append(yv)
        if len(xs) >= 2:
            return {
                "graph_type": graph_type if graph_type != "bar" else "scatter",
                "title": title,
                "x_label": "x",
                "y_label": "y",
                "series": [
                    {
                        "id": "s1",
                        "name": "y",
                        "kind": _series_kind(graph_type),
                        "x": xs,
                        "y": ys,
                        "style": {},
                    }
                ],
                "n_rows_exported": len(xs),
                "source": "plotex_meta_csv",
            }

    # Categorical bar: first col labels, second numeric
    if len(cols) >= 2:
        lab_col, val_col = cols[0], cols[1]
        labs, vals = [], []
        numeric_labs = 0
        for r in rows:
            lab = str(r.get(lab_col, "")).strip()
            val = _num(r.get(val_col))
            if val is None or lab == "":
                continue
            if _num(lab) is not None:
                numeric_labs += 1
            labs.append(lab)
            vals.append(val)
        if len(vals) >= 1:
            # If both numeric → scatter/line
            if numeric_labs == len(labs) and len(labs) >= 2:
                xs = [float(x) for x in labs]
                return {
                    "graph_type": "scatter",
                    "title": title,
                    "x_label": lab_col,
                    "y_label": val_col,
                    "series": [
                        {
                            "id": "s1",
                            "name": val_col,
                            "kind": "scatter",
                            "x": xs,
                            "y": vals,
                            "style": {},
                        }
                    ],
                    "n_rows_exported": len(vals),
                    "source": "plotex_meta_csv",
                }
            return {
                "graph_type": "bar",
                "title": title,
                "x_label": lab_col,
                "y_label": val_col,
                "series": [
                    {
                        "id": "s1",
                        "name": val_col,
                        "kind": "bar",
                        "x": labs,
                        "y": vals,
                        "style": {},
                    }
                ],
                "n_rows_exported": len(vals),
                "source": "plotex_meta_csv",
            }
    return {}


def _guess_title_from_code(code: str) -> str:
    m = re.search(r'title\s*\(\s*"([^"]+)"', code, re.I)
    if m:
        return m.group(1)
    m = re.search(r"title\s*\(\s*'([^']+)'", code, re.I)
    if m:
        return m.group(1)
    return ""


def run_do_file(do_path: Path, work_dir: Path) -> RunResult:
    """Execute a .do file via PyStata against local licensed Stata."""
    started = time.time()
    log_path = work_dir / "session.log"
    do_path = do_path.resolve()
    work_dir.mkdir(parents=True, exist_ok=True)

    try:
        home, edition, version = init_stata()
        from pystata import stata  # type: ignore

        original = do_path.read_text(encoding="utf-8", errors="replace")
        injected = inject_plotex_snapshots(original)
        run_path = work_dir / "main_plotex.do"
        run_path.write_text(injected, encoding="utf-8")

        stata.run(f'cd "{work_dir.as_posix()}"')
        try:
            stata.run("capture log close _all")
        except Exception:
            pass
        stata.run(f'log using "{log_path.as_posix()}", replace text name(copilot)')

        status = "success"
        err: Optional[str] = None
        try:
            stata.run(f'do "{run_path.as_posix()}"')
        except Exception as e:
            status = "error"
            err = str(e)

        try:
            stata.run("capture log close copilot")
        except Exception:
            try:
                stata.run("capture log close _all")
            except Exception:
                pass

        log_text = ""
        if log_path.exists():
            log_text = log_path.read_text(encoding="utf-8", errors="replace")
        if not log_text.strip() and err:
            log_text = f"Stata error (no log captured):\n{err}\n{traceback.format_exc()}"

        figures: list[dict[str, Any]] = []
        for pattern in ("*.png", "*.svg", "*.pdf", "*.jpg", "*.jpeg"):
            for p in work_dir.glob(pattern):
                if p.name.startswith("plotex_"):
                    continue
                mime = {
                    ".png": "image/png",
                    ".svg": "image/svg+xml",
                    ".pdf": "application/pdf",
                    ".jpg": "image/jpeg",
                    ".jpeg": "image/jpeg",
                }.get(p.suffix.lower(), "application/octet-stream")
                gtype = _detect_graph_type_from_name_or_code(p.name, original)
                title = _guess_title_from_code(original) or Path(p.name).stem.replace("_", " ")
                stem = _safe_stem(p.name)
                meta = _series_from_csv(
                    work_dir / f"plotex_meta_{stem}.csv",
                    graph_type=gtype,
                    title=title,
                )
                if meta:
                    meta["graph_type"] = meta.get("graph_type") or gtype
                    meta["title"] = meta.get("title") or title
                else:
                    meta = {"graph_type": gtype, "title": title, "series": []}

                item: dict[str, Any] = {
                    "name": p.name,
                    "path": str(p),
                    "mime": mime,
                    "graph_type": meta.get("graph_type") or gtype,
                    "metadata": meta,
                }
                try:
                    raw = p.read_bytes()
                    if len(raw) <= 12_000_000:
                        item["content_base64"] = base64.b64encode(raw).decode("ascii")
                except OSError:
                    pass
                figures.append(item)

        # Aggregate metadata: prefer first figure with live series
        metadata: dict[str, Any] = {}
        for fig in figures:
            m = fig.get("metadata") or {}
            if m.get("series"):
                metadata = m
                break
        if not metadata and figures:
            metadata = figures[0].get("metadata") or {}

        return RunResult(
            status=status,
            log_text=log_text,
            stata_version=version or f"{home} ({edition})",
            duration_ms=int((time.time() - started) * 1000),
            error_message=err,
            figures=figures,
            metadata=metadata,
        )
    except Exception as e:
        return RunResult(
            status="error",
            log_text=traceback.format_exc(),
            duration_ms=int((time.time() - started) * 1000),
            error_message=str(e),
        )
