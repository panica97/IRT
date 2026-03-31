"""Single-variation executor for stress test.

Runs one backtest with parameter overrides via subprocess, following the
same pattern as ``worker/engine.py`` (subprocess + JSON marker protocol).
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, Optional

# Marker constants (must match backtest engine output)
METRICS_START = "###METRICS_JSON_START###"
METRICS_END = "###METRICS_JSON_END###"


def _resolve_python() -> str:
    """Resolve the Python executable from the IRT .venv.

    Uses the same approach as ``worker/engine.py``: look for a .venv
    at the IRT project root, fall back to sys.executable.
    """
    irt_root = Path(__file__).resolve().parent.parent.parent
    venv_python = irt_root / ".venv" / (
        "Scripts" if os.name == "nt" else "bin"
    ) / ("python.exe" if os.name == "nt" else "python")
    if venv_python.is_file():
        return str(venv_python)
    return sys.executable


def _resolve_engine_main() -> str:
    """Resolve the path to ``packages/backtest-engine/main.py``."""
    engine_main = (
        Path(__file__).resolve().parent.parent / "backtest-engine" / "main.py"
    )
    return str(engine_main)


def execute_variation(
    strategy_id: int,
    overrides: Dict[str, Any],
    start_date: str,
    end_date: str,
    hist_data_path: str,
    strategies_path: str,
    timeout: int = 300,
    variation_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Execute a single backtest variation with parameter overrides.

    Writes the overrides to a temp JSON file, calls the backtest engine
    as a subprocess, and parses the metrics from stdout markers.

    Parameters
    ----------
    strategy_id : int
        Strategy code.
    overrides : dict
        Parameter overrides ``{param_path: value}``.
    start_date, end_date : str
        Backtest date range (YYYY-MM-DD).
    hist_data_path : str
        Path to historical data folder.
    strategies_path : str
        Path to strategies folder.
    timeout : int
        Subprocess timeout in seconds.
    variation_name : str, optional
        Human-readable label for this variation.

    Returns
    -------
    dict
        ``{"name": str, "params": dict, "metrics": dict, "status": str}``
        where status is ``"ok"`` or ``"error"``.
    """
    name = variation_name or _build_variation_name(overrides)
    python_exe = _resolve_python()
    engine_main_path = _resolve_engine_main()

    # Write overrides to a temp file
    override_file = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, prefix="stress_override_"
        ) as f:
            json.dump(overrides, f)
            override_file = f.name

        cmd = [
            python_exe,
            engine_main_path,
            "--mode", "single",
            "--strategy", str(strategy_id),
            "--param-overrides", override_file,
            "--start", start_date,
            "--end", end_date,
            "--hist-data-path", hist_data_path,
            "--strategies-path", strategies_path,
            "--metrics-json",
        ]

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            return {
                "name": name,
                "params": overrides,
                "metrics": {},
                "status": "error",
                "error": f"Timeout after {timeout}s",
            }

        if result.returncode != 0:
            stderr_tail = result.stderr[-500:] if result.stderr else "(no stderr)"
            return {
                "name": name,
                "params": overrides,
                "metrics": {},
                "status": "error",
                "error": f"Exit code {result.returncode}: {stderr_tail}",
            }

        # Parse metrics from stdout markers
        match = re.search(
            re.escape(METRICS_START) + r"(.+?)" + re.escape(METRICS_END),
            result.stdout,
            re.DOTALL,
        )
        if not match:
            stdout_tail = result.stdout[-500:] if result.stdout else "(no stdout)"
            return {
                "name": name,
                "params": overrides,
                "metrics": {},
                "status": "error",
                "error": f"No metrics markers in stdout. Tail: {stdout_tail}",
            }

        raw_json = match.group(1).strip()
        try:
            metrics = json.loads(raw_json)
        except json.JSONDecodeError as exc:
            return {
                "name": name,
                "params": overrides,
                "metrics": {},
                "status": "error",
                "error": f"JSON parse error: {exc}",
            }

        return {
            "name": name,
            "params": overrides,
            "metrics": metrics,
            "status": "ok",
        }

    finally:
        # Clean up temp file
        if override_file:
            try:
                os.unlink(override_file)
            except OSError:
                pass


def _build_variation_name(overrides: Dict[str, Any]) -> str:
    """Build a human-readable name from parameter overrides."""
    if not overrides:
        return "baseline"
    parts = []
    for path, value in overrides.items():
        # Use last segment of dotted path for brevity
        short_key = path.rsplit(".", 1)[-1] if "." in path else path
        parts.append(f"{short_key}={value}")
    return ", ".join(parts)
