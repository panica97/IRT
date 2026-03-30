"""Monkey Test Engine Runner -- invokes the monkey-test runner as a subprocess and parses output.

The runner is called via its CLI with ``--metrics-json``, which causes
it to emit a JSON block delimited by markers in stdout (same protocol as
the backtest engine and MC runner):

    ###METRICS_JSON_START###{...json...}###METRICS_JSON_END###

Progress updates are emitted as:

    ###MC_PROGRESS###{"completed": N, "total": M}###MC_PROGRESS_END###

This module builds the CLI command, runs the subprocess, and extracts the
parsed metrics dict.
"""

import json
import logging
import re
import subprocess
from pathlib import Path
from typing import Any, Callable, Optional

from worker.config import Config
from worker.engine import METRICS_END, METRICS_START, _resolve_python, _sanitize_for_json

logger = logging.getLogger("irt-worker.monkey-engine")

# Monkey test timeout: 1 hour (faster than MC, but room for 5000 sims)
MONKEY_TIMEOUT = 3600

# Progress markers (same as MC runner emits)
PROGRESS_START = "###MC_PROGRESS###"
PROGRESS_END = "###MC_PROGRESS_END###"


def run_monkey_test(
    job: dict,
    strategies_path: str,
    config: Config,
    progress_callback: Optional[Callable[[int, int], None]] = None,
) -> dict:
    """Run the monkey-test runner subprocess and return parsed metrics.

    Parameters
    ----------
    job : dict
        Backtest job dict with ``draft_strat_code``, ``start_date``, ``end_date``,
        ``n_simulations``, ``monkey_mode``.
    strategies_path : str
        Path to directory containing the strategy JSON file.
    config : Config
        Worker configuration (hist_data_path).
    progress_callback : callable, optional
        Called with (completed, total) as progress markers are parsed.

    Returns
    -------
    dict
        Parsed metrics/summary dict from monkey-test runner output.

    Raises
    ------
    RuntimeError
        On subprocess timeout, non-zero exit, missing markers, or JSON parse error.
    """
    strat_code = job["draft_strat_code"]
    n_simulations = job.get("n_simulations") or 1000
    monkey_mode = job.get("monkey_mode") or "A"
    start_date = job.get("start_date", "")
    end_date = job.get("end_date", "")

    python_exe = _resolve_python()

    # Resolve runner path relative to this file, same pattern as mc_engine
    runner_path = str(
        Path(__file__).resolve().parent.parent
        / "packages"
        / "monkey-test"
        / "runner.py"
    )

    cmd = [
        python_exe,
        runner_path,
        "--strategy", str(strat_code),
        "--n-sims", str(n_simulations),
        "--mode", monkey_mode,
        "--start", start_date,
        "--end", end_date,
        "--hist-data-path", config.hist_data_path,
        "--strategies-path", strategies_path,
        "--metrics-json",
        "--save",
    ]

    logger.info("Running monkey test: %s", " ".join(cmd))

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=MONKEY_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError(
            f"Monkey test timed out after {MONKEY_TIMEOUT}s"
        )

    # Parse progress markers from stdout (best-effort, for logging)
    if progress_callback and result.stdout:
        for m in re.finditer(
            re.escape(PROGRESS_START) + r"(.+?)" + re.escape(PROGRESS_END),
            result.stdout,
        ):
            try:
                progress = json.loads(m.group(1).strip())
                progress_callback(progress["completed"], progress["total"])
            except (json.JSONDecodeError, KeyError):
                pass

    # Log stderr for debugging
    if result.stderr:
        for line in result.stderr.strip().splitlines()[-20:]:
            logger.debug("monkey stderr: %s", line)

    # Check exit code
    if result.returncode != 0:
        stderr_tail = result.stderr[-2000:] if result.stderr else "(no stderr)"
        raise RuntimeError(
            f"Monkey test runner exited with code {result.returncode}: {stderr_tail}"
        )

    # Parse metrics from stdout markers
    match = re.search(
        re.escape(METRICS_START) + r"(.+?)" + re.escape(METRICS_END),
        result.stdout,
        re.DOTALL,
    )
    if not match:
        stdout_tail = result.stdout[-500:] if result.stdout else "(no stdout)"
        raise RuntimeError(
            f"No metrics markers found in monkey test stdout. Tail: {stdout_tail}"
        )

    raw_json = match.group(1).strip()
    try:
        metrics = json.loads(raw_json)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"Failed to parse monkey test metrics JSON: {exc}. Raw: {raw_json[:500]}"
        )

    # Sanitize NaN/Inf values
    metrics = _sanitize_for_json(metrics)

    logger.info(
        "Monkey test completed for strat_code=%d — %d keys in metrics",
        strat_code,
        len(metrics) if isinstance(metrics, dict) else 0,
    )
    return metrics
