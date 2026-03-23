## Exploration: backtest-result-view

### Current State

The backtest results UI is in `BacktestPanel.tsx`. When a completed backtest is expanded, `JobResultsView` renders a `MetricsGrid` with 5 metric cards and an optional trades table.

**Current MetricsGrid (5 cards in a responsive grid):**
1. **Net PnL** -- `formatCurrency(metrics.total_pnl)` with green/red coloring
2. **Win Rate** -- `formatPercent(metrics.win_rate)` (engine returns as percentage, e.g. 43.21)
3. **Max Drawdown** -- `formatCurrency(metrics.max_drawdown)` in red
4. **Sharpe Ratio** -- `metrics.sharpe_ratio.toFixed(2)`
5. **Total Trades** -- `metrics.total_trades ?? metrics.trade_count`

**Metrics available from the engine (via JSONB `metrics` field):**
- `total_pnl`, `win_rate`, `max_drawdown`, `sharpe_ratio`, `total_trades`, `profit_factor`, `sortino_ratio`, `trade_count`
- The metrics dict is stored as JSONB and has an `[key: string]: unknown` index signature, so additional engine fields may exist
- The engine output is dynamic -- the worker extracts whatever JSON the engine emits between `###METRICS_JSON_START###` and `###METRICS_JSON_END###` markers

**Key observation -- missing metrics for the 3 tasks:**
- There is NO `return_pct`, `max_drawdown_pct`, or `return_drawdown_ratio` in the current type definition or known engine output
- There is NO `initial_equity` or `final_equity` in the current type definition (they were in the original design doc but not in the implemented types)
- The engine may or may not return these fields -- since metrics are JSONB with dynamic keys, the frontend must handle their absence gracefully

**Trades data structure:**
- Each trade has: `entry_date`, `exit_date`, `direction` (long/short), `entry_price`, `exit_price`, `pnl`
- Trades are ordered chronologically and each has a `pnl` field
- Cumulative PnL equity curve CAN be computed client-side by accumulating `trade.pnl` across the trades array

**Charting libraries:**
- **No charting library is currently installed.** `package.json` has: React, React Router, React Query, Axios, Tailwind, Lucide, Geist font. No Recharts, Chart.js, D3, or similar.

### Affected Areas

- `frontend/src/components/strategies/BacktestPanel.tsx` -- modify `MetricsGrid` to replace Net PnL with Return/DD ratio, replace Max Drawdown with Max DD %, add equity curve chart with toggle
- `frontend/src/types/backtest.ts` -- add optional fields to `BacktestMetrics` for new metric names if engine provides them
- `frontend/package.json` -- add a charting library dependency

### Approaches

#### Task 1: Replace Net PnL with Return/Drawdown Ratio

1. **Compute client-side from existing metrics** -- Calculate `return_pct = total_pnl / initial_equity * 100`, `max_dd_pct = max_drawdown / initial_equity * 100`, ratio = `return_pct / max_dd_pct`. Falls back to "N/A" if initial_equity is missing.
   - Pros: No backend changes, works with current data
   - Cons: Requires `initial_equity` which may not be in the metrics JSONB; ratio is meaningless if drawdown is zero
   - Effort: Low

2. **Use engine-provided fields if available, fallback to N/A** -- Read `return_pct` and `max_drawdown_pct` from metrics if the engine provides them, compute ratio. If not present, show "N/A".
   - Pros: Clean, no assumptions about equity; ready when engine adds these fields
   - Cons: May show N/A until engine is updated
   - Effort: Low

**Recommendation for Task 1:** Approach 2 -- try to read `return_pct` and `max_drawdown_pct` from the metrics JSONB (the engine may already emit them). Compute ratio = `return_pct / max_drawdown_pct`. If either is missing/zero, show "N/A". The `[key: string]: unknown` index signature already allows this.

#### Task 2: Replace Max Drawdown absolute with Max Drawdown %

1. **Read `max_drawdown_pct` from metrics** -- If engine provides it, display directly. Otherwise compute from `max_drawdown / initial_equity * 100`.
   - Pros: Simple, accurate
   - Cons: Depends on engine providing the field or `initial_equity`
   - Effort: Low

2. **Always compute from absolute + initial_equity** -- `max_dd_pct = abs(max_drawdown) / initial_equity * 100`.
   - Pros: Deterministic if initial_equity exists
   - Cons: Relies on initial_equity being present
   - Effort: Low

**Recommendation for Task 2:** Same as Task 1 -- prefer engine-provided `max_drawdown_pct` with fallback. If unavailable, try computing from `max_drawdown` and `initial_equity`. Final fallback: show absolute value with "(abs)" suffix.

#### Task 3: PnL Equity Curve Chart

1. **Recharts (lightweight, React-native)** -- Popular React charting library. ~45KB gzipped. LineChart component fits the use case perfectly.
   - Pros: React-first, declarative, good Tailwind integration, responsive, simple API
   - Cons: Adds a dependency
   - Effort: Low-Medium

2. **Chart.js + react-chartjs-2** -- Canvas-based, widely used.
   - Pros: Very mature, large community
   - Cons: Heavier (~60KB), less "React-native" (imperative canvas), two packages needed
   - Effort: Medium

3. **SVG/Canvas from scratch** -- Build a simple line chart with raw SVG.
   - Pros: Zero dependencies
   - Cons: Much more code, reinventing the wheel, no interactivity (tooltips, zoom)
   - Effort: High

**Recommendation for Task 3:** Recharts. It is the most React-idiomatic option, lightweight, and its `<LineChart>` + `<Line>` + `<Tooltip>` + `<ResponsiveContainer>` pattern produces a clean equity curve with minimal code. The chart data is computed client-side from the trades array:

```typescript
const equityCurve = trades.reduce((acc, trade, i) => {
  const cumPnl = (acc[i]?.cumPnl ?? 0) + trade.pnl;
  return [...acc, { date: trade.exit_date, cumPnl }];
}, [{ date: trades[0]?.entry_date ?? '', cumPnl: 0 }]);
```

Hidden by default with a toggle button (same pattern as the existing "Show/Hide Trades" toggle).

### Recommendation

**Single approach for all 3 tasks:**

1. Install `recharts` as the only new dependency.
2. In `MetricsGrid`, replace the "Net PnL" card with "Return/DD" ratio card. Replace the "Max Drawdown" card with "Max DD %" card. Both read from the metrics JSONB with graceful fallbacks.
3. Add a new `EquityCurveChart` component below `MetricsGrid` in `JobResultsView`. Hidden by default, toggled with a button (same UX pattern as the trades table toggle). Computes cumulative PnL from the trades array.
4. Update `BacktestMetrics` type to include optional `return_pct`, `max_drawdown_pct`, and `initial_equity` fields.

**Files to change:**
- `frontend/package.json` -- add `recharts`
- `frontend/src/types/backtest.ts` -- add optional metric fields
- `frontend/src/components/strategies/BacktestPanel.tsx` -- modify MetricsGrid, add EquityCurveChart

**No backend changes needed.** All computation is client-side from existing data.

### Risks

- **Engine may not provide `return_pct` or `max_drawdown_pct`**: The JSONB metrics are dynamic and depend on the external engine. If these fields are absent, the Return/DD ratio and Max DD % cards will show "N/A". This is acceptable as a graceful degradation -- the cards will start working when the engine is updated.
- **Trades array could be empty**: If a backtest produces zero trades, the equity curve has nothing to render. Guard with a conditional render (same as existing trades table guard).
- **Recharts bundle size**: Adds ~45KB gzipped. Acceptable for a dashboard app that already loads React + React Query + Axios.
- **Cumulative PnL computation assumes trades are chronologically ordered**: The engine appears to return them in order, but this should be verified or explicitly sorted by `exit_date` before computing the curve.

### Ready for Proposal

Yes. The scope is well-defined (3 specific UI changes), the approach is straightforward (frontend-only, one new dependency), and risks are minimal. The orchestrator can proceed with `/sdd-propose` for `backtest-result-view`.
