"""Simulate P&L for a single set of random entries on real close prices.

Each trade's P&L = (close[exit] - close[entry]) * direction_sign.
"""

from __future__ import annotations

from typing import Dict, List, Tuple

import numpy as np

try:
    from .metrics import compute_metrics
except ImportError:
    from metrics import compute_metrics  # type: ignore[no-redef]


def simulate_one(
    ohlc_closes: np.ndarray,
    entries: List[Tuple[int, int, int]],
    direction: str,
) -> Dict[str, float]:
    """Run one monkey simulation and return its metrics.

    Parameters
    ----------
    ohlc_closes : np.ndarray
        1-D array of close prices for the full simulation period.
    entries : list of (entry_idx, exit_idx, holding_bars)
        Trade placements from :func:`generator.generate_random_entries`.
    direction : str
        ``"long"`` or ``"short"``.

    Returns
    -------
    dict with metric keys (see :func:`metrics.compute_metrics`) plus
    ``n_trades_actual``.
    """
    if not entries:
        return {
            "net_profit": 0.0,
            "max_drawdown": 0.0,
            "return_dd": 0.0,
            "win_rate": 0.0,
            "profit_factor": 0.0,
            "n_trades_actual": 0,
        }

    sign = 1.0 if direction == "long" else -1.0

    pnls = np.empty(len(entries), dtype=np.float64)
    for i, (entry_idx, exit_idx, _) in enumerate(entries):
        pnls[i] = (ohlc_closes[exit_idx] - ohlc_closes[entry_idx]) * sign

    equity_curve = np.cumsum(pnls)

    result = compute_metrics(pnls, equity_curve)
    result["n_trades_actual"] = len(entries)
    return result
