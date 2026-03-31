"""Configuration dataclass for Stress Test (parameter sensitivity)."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class StressTestConfig:
    """All tuneable knobs for a stress-test run.

    Parameters
    ----------
    strategy_id : int
        Strategy code to test.
    test_name : str
        Human-readable label for this test run.
    param_overrides : dict
        Multi-param grid (cartesian product).
        Each key is a param path, value is either:
        - ``{"min": float, "max": float, "step": float}`` for range specs
        - ``{"type": "list", "values": [...]}`` for explicit value lists
    single_overrides : dict
        One-at-a-time sweeps (same spec format as param_overrides).
        Each param is swept independently while others stay at defaults.
    start_date : str
        Backtest start date (YYYY-MM-DD).
    end_date : str
        Backtest end date (YYYY-MM-DD).
    max_parallel : int
        Maximum concurrent backtest workers.
    timeout_per_variation : int
        Timeout in seconds for each individual backtest subprocess.
    """

    strategy_id: int = 0
    test_name: str = "unnamed"
    param_overrides: dict = field(default_factory=dict)
    single_overrides: dict = field(default_factory=dict)
    start_date: str = ""
    end_date: str = ""
    max_parallel: int = 4
    timeout_per_variation: int = 300

    def __post_init__(self) -> None:
        if self.max_parallel < 1:
            raise ValueError("max_parallel must be >= 1")
        if self.timeout_per_variation < 1:
            raise ValueError("timeout_per_variation must be >= 1")
