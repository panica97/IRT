"""Compute performance metrics from trade P&L and equity curve.

All heavy lifting uses numpy for speed.
"""

from __future__ import annotations

from typing import Dict

import numpy as np


def compute_metrics(trades_pnl: np.ndarray, equity_curve: np.ndarray) -> Dict[str, float]:
    """Return a dict of performance metrics.

    Parameters
    ----------
    trades_pnl : np.ndarray
        1-D array of per-trade P&L values.
    equity_curve : np.ndarray
        1-D cumulative equity curve (starts at 0 or first trade P&L).

    Returns
    -------
    dict with keys: net_profit, max_drawdown, return_dd, win_rate, profit_factor
    """
    net_profit = float(np.sum(trades_pnl))

    # Max drawdown (peak-to-trough on equity curve)
    if len(equity_curve) > 0:
        running_max = np.maximum.accumulate(equity_curve)
        drawdowns = running_max - equity_curve
        max_drawdown = float(np.max(drawdowns)) if len(drawdowns) > 0 else 0.0
    else:
        max_drawdown = 0.0

    # Return / Drawdown (primary metric)
    if max_drawdown > 0:
        return_dd = net_profit / max_drawdown
    else:
        # No drawdown: if profitable, infinite edge; otherwise 0
        return_dd = float("inf") if net_profit > 0 else 0.0

    # Win rate
    n_total = len(trades_pnl)
    if n_total > 0:
        win_rate = float(np.sum(trades_pnl > 0)) / n_total
    else:
        win_rate = 0.0

    # Profit factor = gross_profit / abs(gross_loss)
    gross_profit = float(np.sum(trades_pnl[trades_pnl > 0]))
    gross_loss = float(np.sum(trades_pnl[trades_pnl < 0]))
    if gross_loss < 0:
        profit_factor = gross_profit / abs(gross_loss)
    else:
        profit_factor = float("inf") if gross_profit > 0 else 0.0

    return {
        "net_profit": net_profit,
        "max_drawdown": max_drawdown,
        "return_dd": return_dd,
        "win_rate": win_rate,
        "profit_factor": profit_factor,
    }
