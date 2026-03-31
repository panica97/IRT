"""Stress Test runner -- main orchestrator and CLI entry point.

Sweeps strategy parameters and runs backtests for each variation to assess
parameter sensitivity / robustness.

Usage::

    python -m packages.stress_test.runner \
        --strategy 1001 \
        --config path/to/stress_config.json \
        --hist-data-path /path/to/hist_data \
        --strategies-path /path/to/Strategies \
        --metrics-json \
        --save
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Dict, List

# ---------------------------------------------------------------------------
# Ensure packages/ and the stress-test dir are on sys.path so both sibling
# packages (backtest-engine, ibkr-core) and local modules are importable.
# The on-disk directory is ``stress-test`` (hyphen), but Python imports need
# underscores.  We add the directory itself so ``import grid`` works,
# and also the parent packages/ dir for sibling access.
# ---------------------------------------------------------------------------
_PACKAGES_DIR = str(Path(__file__).resolve().parent.parent)
_SELF_DIR = str(Path(__file__).resolve().parent)
for _p in (_PACKAGES_DIR, _SELF_DIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sanitize_for_json(obj: Any) -> Any:
    """Replace NaN/Inf float values with None for valid JSON."""
    if isinstance(obj, dict):
        return {k: _sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_for_json(v) for v in obj]
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    # Handle numpy types if numpy is available
    try:
        import numpy as np
        if isinstance(obj, (np.floating,)):
            v = float(obj)
            return None if (math.isnan(v) or math.isinf(v)) else v
        if isinstance(obj, (np.integer,)):
            return int(obj)
    except ImportError:
        pass
    return obj


def _report_progress(completed: int, total: int) -> None:
    """Emit a progress marker that the worker can parse."""
    print(
        f'###MC_PROGRESS###'
        f'{{"completed": {completed}, "total": {total}}}'
        f'###MC_PROGRESS_END###',
        flush=True,
    )


# ---------------------------------------------------------------------------
# Core run logic
# ---------------------------------------------------------------------------

def run_stress_test(
    strategy_id: int,
    config_data: Dict[str, Any],
    hist_data_path: str,
    strategies_path: str,
) -> Dict[str, Any]:
    """Execute a full stress-test run and return the result dict.

    Steps
    -----
    1. Parse config and build work items (multi-grid + single sweeps).
    2. Execute all variations in parallel via ThreadPoolExecutor.
    3. Aggregate results with robustness scoring.
    """
    from config import StressTestConfig
    from grid import build_multi_grid, build_single_sweeps, _expand_spec
    from executor import execute_variation
    from aggregator import aggregate_results

    t0 = time.time()

    # Build config
    cfg = StressTestConfig(
        strategy_id=strategy_id,
        test_name=config_data.get("test_name", "unnamed"),
        param_overrides=config_data.get("param_overrides", {}),
        single_overrides=config_data.get("single_overrides", {}),
        start_date=config_data.get("start_date", ""),
        end_date=config_data.get("end_date", ""),
        max_parallel=config_data.get("max_parallel", 4),
        timeout_per_variation=config_data.get("timeout_per_variation", 300),
    )

    print(f"[StressTest] Strategy: {cfg.strategy_id}", flush=True)
    print(f"[StressTest] Test name: {cfg.test_name}", flush=True)
    print(f"[StressTest] Period: {cfg.start_date} to {cfg.end_date}", flush=True)

    # ---- 1. Build work items ----
    multi_grid = build_multi_grid(cfg.param_overrides)
    single_sweeps = build_single_sweeps(cfg.single_overrides)

    total_variations = len(multi_grid) + len(single_sweeps)
    print(f"[StressTest] Grid variations: {len(multi_grid)}", flush=True)
    print(f"[StressTest] Single sweeps: {len(single_sweeps)}", flush=True)
    print(f"[StressTest] Total variations: {total_variations}", flush=True)

    if total_variations == 0:
        return {
            "error": "No variations to run — check param_overrides and single_overrides",
            "total_variations": 0,
        }

    # Build work items list: (overrides_dict, variation_name, sweep_param_or_None)
    work_items: List[tuple] = []
    for i, overrides in enumerate(multi_grid):
        name = f"grid_{i:04d}"
        work_items.append((overrides, name, None))
    for overrides, param_name in single_sweeps:
        val = list(overrides.values())[0]
        name = f"single_{param_name}={val}"
        work_items.append((overrides, name, param_name))

    # ---- 2. Execute variations in parallel ----
    print(f"[StressTest] Starting execution with {cfg.max_parallel} workers...",
          flush=True)

    completed_count = 0
    results: List[Dict[str, Any]] = [{}] * len(work_items)

    def _run_one(index: int, overrides: dict, name: str, sweep_param: str | None):
        result = execute_variation(
            strategy_id=cfg.strategy_id,
            overrides=overrides,
            start_date=cfg.start_date,
            end_date=cfg.end_date,
            hist_data_path=hist_data_path,
            strategies_path=strategies_path,
            timeout=cfg.timeout_per_variation,
            variation_name=name,
        )
        if sweep_param:
            result["_sweep_param"] = sweep_param
        return index, result

    with ThreadPoolExecutor(max_workers=cfg.max_parallel) as pool:
        futures = {
            pool.submit(_run_one, i, overrides, name, sweep_param): i
            for i, (overrides, name, sweep_param) in enumerate(work_items)
        }

        for future in as_completed(futures):
            idx, result = future.result()
            results[idx] = result
            completed_count += 1

            status = result.get("status", "?")
            print(
                f"[StressTest] [{completed_count}/{total_variations}] "
                f"{result.get('name', '?')} -> {status}",
                flush=True,
            )
            _report_progress(completed_count, total_variations)

    exec_duration = time.time() - t0
    print(f"[StressTest] All variations done in {exec_duration:.1f}s", flush=True)

    # ---- 3. Aggregate ----
    # Build param_names and param_values for multi-grid
    param_names = list(cfg.param_overrides.keys())
    param_values = {
        name: _expand_spec(cfg.param_overrides[name])
        for name in param_names
    }
    single_param_values = {
        name: _expand_spec(cfg.single_overrides[name])
        for name in cfg.single_overrides
    }

    summary = aggregate_results(
        variations=results,
        param_names=param_names,
        param_values=param_values,
        single_param_values=single_param_values,
    )

    # Add metadata
    summary["test_name"] = cfg.test_name
    summary["strategy_id"] = cfg.strategy_id
    summary["start_date"] = cfg.start_date
    summary["end_date"] = cfg.end_date
    summary["duration_seconds"] = round(time.time() - t0, 2)

    total_ok = summary.get("successful_variations", 0)
    score = summary.get("robustness", {}).get("score", 0)
    print(
        f"[StressTest] Complete. "
        f"{total_ok}/{total_variations} succeeded, "
        f"robustness score={score:.4f}",
        flush=True,
    )

    return summary


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Stress Test -- parameter sensitivity analysis",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--strategy", type=int, required=True,
                        help="Strategy ID to test")
    parser.add_argument("--config", type=str, required=True,
                        help="Path to stress test config JSON file")
    parser.add_argument("--hist-data-path", type=str, required=True,
                        help="Path to historical data folder")
    parser.add_argument("--strategies-path", type=str, required=True,
                        help="Path to strategies folder")
    parser.add_argument("--start", type=str, default=None,
                        help="Override start date (YYYY-MM-DD)")
    parser.add_argument("--end", type=str, default=None,
                        help="Override end date (YYYY-MM-DD)")
    parser.add_argument("--metrics-json", action="store_true",
                        help="Output JSON result via stdout markers")
    parser.add_argument("--save", action="store_true",
                        help="Save config and results to disk")
    parser.add_argument("--output-dir", type=str, default=None,
                        help="Output directory (used with --save)")

    args = parser.parse_args()

    # Load config
    config_path = Path(args.config)
    if not config_path.is_file():
        print(f"[StressTest] FATAL: Config file not found: {config_path}", flush=True)
        sys.exit(1)

    with open(config_path, "r") as f:
        config_data = json.load(f)

    # CLI overrides for dates
    if args.start:
        config_data["start_date"] = args.start
    if args.end:
        config_data["end_date"] = args.end

    print(f"{'=' * 60}")
    print("Stress Test -- Parameter Sensitivity Analysis")
    print(f"{'=' * 60}")
    print(f"  Strategy:    {args.strategy}")
    print(f"  Config:      {args.config}")
    print(f"  Period:      {config_data.get('start_date', '?')} to {config_data.get('end_date', '?')}")
    print(f"  Test name:   {config_data.get('test_name', 'unnamed')}")
    print(f"{'=' * 60}")

    try:
        result = run_stress_test(
            strategy_id=args.strategy,
            config_data=config_data,
            hist_data_path=args.hist_data_path,
            strategies_path=args.strategies_path,
        )
    except Exception as exc:
        print(f"[StressTest] FATAL: {exc}", flush=True)
        sys.exit(1)

    # Human-readable summary
    robustness = result.get("robustness", {})
    print(f"\n{'=' * 60}")
    print("Stress Test Results")
    print(f"{'=' * 60}")
    print(f"  Test type:         {result.get('test_type', '?')}")
    print(f"  Total variations:  {result.get('total_variations', 0)}")
    print(f"  Successful:        {result.get('successful_variations', 0)}")
    print(f"  Failed:            {result.get('failed_variations', 0)}")
    print(f"  Robustness:")
    print(f"    Profitable %%:    {robustness.get('profitable_pct', 0):.2%}")
    print(f"    Pos. Sharpe %%:   {robustness.get('positive_sharpe_pct', 0):.2%}")
    print(f"    Low drawdown %%:  {robustness.get('low_drawdown_pct', 0):.2%}")
    print(f"    Score:           {robustness.get('score', 0):.4f}")
    print(f"  Duration:          {result.get('duration_seconds', 0):.1f}s")
    print(f"{'=' * 60}\n")

    if args.metrics_json:
        clean = _sanitize_for_json(result)
        json_str = json.dumps(clean, default=str)
        print(f"###METRICS_JSON_START###{json_str}###METRICS_JSON_END###", flush=True)

    if args.save:
        output_dir = args.output_dir or str(Path.cwd() / "stress_results")
        out_path = Path(output_dir)
        out_path.mkdir(parents=True, exist_ok=True)

        # Save config
        config_file = out_path / "config.json"
        with open(config_file, "w") as f:
            json.dump(config_data, f, indent=2)
        print(f"Config saved to: {config_file}")

        # Save results
        result_file = out_path / "results.json"
        clean = _sanitize_for_json(result)
        with open(result_file, "w") as f:
            json.dump(clean, f, indent=2, default=str)
        print(f"Results saved to: {result_file}")


if __name__ == "__main__":
    main()
