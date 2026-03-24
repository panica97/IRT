# Synthetic Data (Monte Carlo) — Phase 12

**Status:** Planned
**Started:** —
**SDD Change:** synthetic-data-monte-carlo
**Parent Phase:** Phase 12 from Master Plan

---

## Goal

Generate synthetic price data using Monte Carlo simulation to test strategies beyond historical data. This validates whether a strategy's edge is statistically robust or merely a product of curve-fitting to specific market conditions. The same backtest engine from Phase 10 is reused, but fed synthetic candles instead of real ones.

## Sub-phases

| # | Task | Route | SDD Status | Status |
|---|------|-------|------------|--------|
| 12.1 | **Worker Unification** — Use Ops Platform worker as base, port IRT-specific features into it. Scope: timeframe remapping (bridge.py remap_timeframe + validate_remapped_json), trades parquet extraction, debug mode (JSON save), simple/complete mode distinction as job types, adapt IRT API to Ops worker job decomposition model, update docker-compose to unified worker, verify existing simple + complete backtests still work. | /sdd-new | — | Planned |
| 2 | Monte Carlo price generator (GBM-based synthetic OHLCV candle generation) | /sdd-ff | — | Planned |
| 2 | Simulation configuration (number of runs, volatility params, distribution settings) | /sdd-new | — | Planned |
| 3 | Synthetic dataset storage (persist generated datasets for reproducibility) | /sdd-new | — | Planned |
| 4 | Worker integration (run batch Monte Carlo backtests as background jobs) | /sdd-new | — | Planned |
| 5 | API endpoints for synthetic runs (trigger, status, parameter config) | quick fix | — | Planned |
| 6 | Frontend synthetic data panel (configure MC params, trigger runs, view distributions) | /sdd-new | — | Planned |

## Decisions Log

| Date | Decision | Why | Impact |
|------|----------|-----|--------|
| — | — | — | — |

## SDD Progress

_No SDD phases started yet._

## Notes

- Geometric Brownian Motion (GBM) is the standard starting point for synthetic price generation
- Should support configurable parameters: drift, volatility, number of paths, time horizon
- Each Monte Carlo run produces N synthetic price series; the strategy is backtested on each
- Results are stored as a distribution (not a single outcome) for statistical analysis in Phase 12
- Consider seeding for reproducibility of specific runs
- The worker from Phase 10 is reused — this phase extends it, not replaces it
