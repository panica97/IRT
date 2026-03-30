"""Aggregate N simulation results and compare to the real strategy.

Produces the final result dict matching the JSONB schema expected by
the frontend / database.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List

import numpy as np


def aggregate_results(
    sim_results: List[Dict[str, float]],
    real_metrics: Dict[str, float],
    *,
    mode: str,
    n_trades_requested: int,
    histogram_bins: int = 30,
) -> Dict[str, Any]:
    """Build the full monkey-test result payload.

    Parameters
    ----------
    sim_results : list[dict]
        One metrics dict per simulation (from :func:`simulator.simulate_one`).
    real_metrics : dict
        Metrics of the real strategy.
    mode : str
        "A" or "B".
    n_trades_requested : int
        Original n_trades from the real strategy.
    histogram_bins : int
        Number of bins for distribution histograms.

    Returns
    -------
    dict matching the JSONB storage schema.
    """
    warnings: List[str] = []

    if not sim_results:
        return {
            "mode": mode,
            "n_simulations": 0,
            "n_trades_requested": n_trades_requested,
            "n_trades_actual": 0,
            "real_strategy": real_metrics,
            "distribution": {},
            "percentile": None,
            "p_value": None,
            "warnings": ["No simulations completed"],
        }

    # Collect per-metric arrays
    metric_keys = ["return_dd", "net_profit", "win_rate", "profit_factor"]
    arrays: Dict[str, np.ndarray] = {}
    for key in metric_keys:
        vals = []
        for r in sim_results:
            v = r.get(key, 0.0)
            if isinstance(v, float) and (math.isinf(v) or math.isnan(v)):
                continue
            vals.append(v)
        arrays[key] = np.array(vals, dtype=np.float64) if vals else np.array([], dtype=np.float64)

    # Actual trades placed (may be fewer than requested due to overlap)
    actual_counts = [r.get("n_trades_actual", 0) for r in sim_results]
    median_actual = int(np.median(actual_counts)) if actual_counts else 0
    if median_actual < n_trades_requested:
        warnings.append(
            f"Median trades placed ({median_actual}) < requested ({n_trades_requested}). "
            f"Period may be too short for {n_trades_requested} non-overlapping trades."
        )

    # --- Primary metric: return_dd ---
    rdd_arr = arrays.get("return_dd", np.array([]))
    real_rdd = real_metrics.get("return_dd", 0.0)
    # Sanitize real_rdd for comparison
    if isinstance(real_rdd, float) and (math.isinf(real_rdd) or math.isnan(real_rdd)):
        real_rdd_safe = 0.0
    else:
        real_rdd_safe = real_rdd

    if len(rdd_arr) > 0:
        percentile = float(np.sum(rdd_arr <= real_rdd_safe)) / len(rdd_arr) * 100.0
        p_value = float(np.sum(rdd_arr >= real_rdd_safe)) / len(rdd_arr)
    else:
        percentile = None
        p_value = None

    # --- Distributions (histogram-ready lists) ---
    distribution: Dict[str, List[float]] = {}
    for key in metric_keys:
        arr = arrays.get(key, np.array([]))
        distribution[key] = arr.tolist() if len(arr) > 0 else []

    # --- Histogram bins for return_dd ---
    histogram: Dict[str, Any] = {}
    if len(rdd_arr) > 0:
        counts, bin_edges = np.histogram(rdd_arr, bins=histogram_bins)
        histogram["return_dd"] = {
            "counts": counts.tolist(),
            "bin_edges": bin_edges.tolist(),
        }

    return _sanitize_for_json({
        "mode": mode,
        "n_simulations": len(sim_results),
        "n_trades_requested": n_trades_requested,
        "n_trades_actual": median_actual,
        "real_strategy": real_metrics,
        "distribution": distribution,
        "histogram": histogram,
        "percentile": percentile,
        "p_value": p_value,
        "warnings": warnings,
    })


def _sanitize_for_json(obj: Any) -> Any:
    """Replace NaN / Inf with None so the output is valid JSON."""
    if isinstance(obj, dict):
        return {k: _sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_for_json(v) for v in obj]
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    if isinstance(obj, np.floating):
        v = float(obj)
        return None if (math.isnan(v) or math.isinf(v)) else v
    if isinstance(obj, (np.integer,)):
        return int(obj)
    return obj
