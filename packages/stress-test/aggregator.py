"""Result aggregation and robustness scoring for stress test.

Computes robustness metrics across all parameter variations:
- profitable_pct: percentage of variations with positive net profit
- positive_sharpe_pct: percentage with positive Sharpe ratio
- low_drawdown_pct: percentage with max drawdown below threshold
- score: average of the three percentages (0..1)
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple


# Max drawdown threshold for "low drawdown" metric (50%)
LOW_DD_THRESHOLD = 50.0


def aggregate_results(
    variations: List[Dict[str, Any]],
    param_names: List[str],
    param_values: Dict[str, List[Any]],
    single_param_values: Optional[Dict[str, List[Any]]] = None,
) -> Dict[str, Any]:
    """Aggregate stress-test results into a summary with robustness score.

    Parameters
    ----------
    variations : list[dict]
        Each dict has ``{"name", "params", "metrics", "status"}``.
    param_names : list[str]
        Names of multi-grid parameters.
    param_values : dict
        ``{param_name: [values...]}`` for multi-grid params.
    single_param_values : dict, optional
        ``{param_name: [values...]}`` for single-sweep params.

    Returns
    -------
    dict
        Full result dict with robustness metrics, multi/single breakdowns,
        param_ranges, and test_type label.
    """
    single_param_values = single_param_values or {}

    # Separate multi-grid and single-sweep results
    multi_results: List[Dict[str, Any]] = []
    single_results: Dict[str, List[Dict[str, Any]]] = {}

    for var in variations:
        sweep_param = var.get("_sweep_param")
        if sweep_param:
            single_results.setdefault(sweep_param, []).append(var)
        else:
            multi_results.append(var)

    # Compute robustness on ALL variations combined
    all_ok = [v for v in variations if v.get("status") == "ok"]
    robustness = _compute_robustness(all_ok)

    # Compute per-group robustness
    multi_robustness = _compute_robustness(
        [v for v in multi_results if v.get("status") == "ok"]
    )

    single_robustness: Dict[str, Dict[str, Any]] = {}
    for param_name, results in single_results.items():
        ok_results = [v for v in results if v.get("status") == "ok"]
        single_robustness[param_name] = _compute_robustness(ok_results)

    # Determine test_type
    has_multi = len(multi_results) > 0
    has_single = len(single_results) > 0
    if has_multi and has_single:
        test_type = "dual_mode"
    elif has_single:
        test_type = "single_param"
    else:
        test_type = "multi_param"

    # Build param_ranges config
    param_ranges: Dict[str, Any] = {}
    for name in param_names:
        if name in param_values:
            param_ranges[name] = {
                "values": param_values[name],
                "count": len(param_values[name]),
            }
    for name in single_param_values:
        param_ranges[name] = {
            "values": single_param_values[name],
            "count": len(single_param_values[name]),
            "sweep": "single",
        }

    return {
        "test_type": test_type,
        "total_variations": len(variations),
        "successful_variations": len(all_ok),
        "failed_variations": len(variations) - len(all_ok),
        "robustness": robustness,
        "multi_grid": {
            "count": len(multi_results),
            "robustness": multi_robustness,
            "results": multi_results,
        },
        "single_sweeps": {
            param_name: {
                "count": len(results),
                "robustness": single_robustness.get(param_name, {}),
                "results": results,
            }
            for param_name, results in single_results.items()
        },
        "param_ranges": param_ranges,
        "all_results": variations,
    }


def _compute_robustness(ok_results: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Compute robustness metrics for a set of successful variations.

    Returns
    -------
    dict
        ``{"profitable_pct", "positive_sharpe_pct", "low_drawdown_pct", "score", "n"}``
    """
    n = len(ok_results)
    if n == 0:
        return {
            "profitable_pct": 0.0,
            "positive_sharpe_pct": 0.0,
            "low_drawdown_pct": 0.0,
            "score": 0.0,
            "n": 0,
        }

    profitable = 0
    positive_sharpe = 0
    low_drawdown = 0

    for var in ok_results:
        metrics = var.get("metrics", {})

        # Net profit check
        net_profit = metrics.get("net_profit", metrics.get("total_pnl", 0))
        if net_profit is not None and net_profit > 0:
            profitable += 1

        # Sharpe ratio check
        sharpe = metrics.get("sharpe_ratio", metrics.get("sharpe", 0))
        if sharpe is not None and sharpe > 0:
            positive_sharpe += 1

        # Max drawdown check (as percentage, lower is better)
        max_dd = metrics.get("max_drawdown_pct", metrics.get("max_dd_pct", 0))
        if max_dd is None:
            max_dd = 0
        if abs(max_dd) < LOW_DD_THRESHOLD:
            low_drawdown += 1

    profitable_pct = profitable / n
    positive_sharpe_pct = positive_sharpe / n
    low_drawdown_pct = low_drawdown / n
    score = (profitable_pct + positive_sharpe_pct + low_drawdown_pct) / 3.0

    return {
        "profitable_pct": round(profitable_pct, 4),
        "positive_sharpe_pct": round(positive_sharpe_pct, 4),
        "low_drawdown_pct": round(low_drawdown_pct, 4),
        "score": round(score, 4),
        "n": n,
    }
