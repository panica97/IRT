"""Extract trade parameters from a trades.parquet file.

Reads the parquet produced by the backtest engine and returns the
parameters needed to configure the monkey simulations (n_trades,
holding_distribution, max_bars, direction, period).
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any, Dict, List


def _read_parquet(path: str):
    """Read a parquet file using polars (fallback to pandas)."""
    try:
        import polars as pl

        df = pl.read_parquet(path)
        return df.to_dicts()
    except ImportError:
        import pandas as pd

        df = pd.read_parquet(path)
        return df.to_dict(orient="records")


def extract_trade_params(trades: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Derive monkey-test parameters from a list of trade dicts.

    Expected fields per trade:
        entry_date, exit_date, side, bars_held, pnl, cumulative_pnl

    Returns dict with:
        n_trades, holding_distribution, max_bars, direction, period_start,
        period_end, trade_pnls
    """
    if not trades:
        raise ValueError("No trades to extract parameters from")

    # --- bars_held distribution ---
    holding: List[int] = []
    for t in trades:
        bh = t.get("bars_held")
        if bh is not None:
            try:
                holding.append(int(bh))
            except (ValueError, TypeError):
                pass

    if not holding:
        raise ValueError("No valid bars_held values found in trades")

    max_bars = max(holding)

    # --- direction (majority vote) ---
    side_counts: Dict[str, int] = {}
    for t in trades:
        s = str(t.get("side", t.get("direction", ""))).lower().strip()
        if s in ("long", "short"):
            side_counts[s] = side_counts.get(s, 0) + 1
    if not side_counts:
        raise ValueError("Could not determine trade direction from 'side' column")
    direction = max(side_counts, key=side_counts.get)  # type: ignore[arg-type]

    # --- period ---
    entry_dates: List[str] = []
    exit_dates: List[str] = []
    for t in trades:
        ed = t.get("entry_date")
        xd = t.get("exit_date")
        if ed is not None:
            entry_dates.append(str(ed))
        if xd is not None:
            exit_dates.append(str(xd))

    period_start = min(entry_dates) if entry_dates else None
    period_end = max(exit_dates) if exit_dates else None

    # --- P&L list ---
    pnls: List[float] = []
    for t in trades:
        p = t.get("pnl")
        if p is not None and not (isinstance(p, float) and (math.isnan(p) or math.isinf(p))):
            pnls.append(float(p))

    return {
        "n_trades": len(trades),
        "holding_distribution": holding,
        "max_bars": max_bars,
        "direction": direction,
        "period_start": period_start,
        "period_end": period_end,
        "trade_pnls": pnls,
    }


def extract_from_parquet(parquet_path: str) -> Dict[str, Any]:
    """Convenience: read parquet then extract parameters."""
    records = _read_parquet(parquet_path)
    return extract_trade_params(records)
