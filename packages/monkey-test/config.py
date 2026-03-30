"""Configuration dataclass for Monkey Test."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class MonkeyTestConfig:
    """All tuneable knobs for a monkey-test run."""

    # Number of random-entry simulations to generate
    n_simulations: int = 1000

    # "A" = sample holding period from empirical distribution
    # "B" = always hold max_bars
    mode: str = "A"

    # Trade direction inferred from real trades ("long" or "short")
    direction: str = "long"

    # Histogram resolution for distribution output
    histogram_bins: int = 30

    # Random seed (None = non-deterministic)
    seed: int | None = None

    # Progress reporting interval (every N simulations)
    progress_every: int = 50

    def __post_init__(self) -> None:
        if self.mode not in ("A", "B"):
            raise ValueError(f"mode must be 'A' or 'B', got '{self.mode}'")
        if self.direction not in ("long", "short"):
            raise ValueError(f"direction must be 'long' or 'short', got '{self.direction}'")
        if self.n_simulations < 1:
            raise ValueError("n_simulations must be >= 1")
