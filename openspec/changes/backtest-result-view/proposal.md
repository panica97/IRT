# Proposal: Backtest Result View Enhancements (Phase 10.3)

## Intent

The current backtest results UI displays raw absolute metrics (Net PnL, Max Drawdown in dollars) that are not normalized and hard to compare across strategies with different capital sizes. Traders need ratio-based metrics (Return/Drawdown ratio, Max DD %) for meaningful cross-strategy comparison. Additionally, there is no visual representation of the PnL evolution over time -- an equity curve chart is the standard way to assess strategy behavior at a glance.

## Scope

### In Scope
- Replace the "Net PnL" metric card with a "Return / Drawdown" ratio card
- Replace the "Max Drawdown" (absolute) metric card with a "Max DD %" card
- Add a PnL equity curve line chart, hidden by default with a toggle button
- Install `recharts` as charting dependency
- Add optional metric fields to `BacktestMetrics` type (`return_pct`, `max_drawdown_pct`, `initial_equity`)

### Out of Scope
- Backend/engine changes to emit new metric fields (frontend handles absence gracefully)
- Interactive chart features beyond basic tooltip (zoom, pan, annotations)
- Additional chart types (drawdown curve, trade distribution histogram)
- Modifying the existing trades table or other metric cards (Win Rate, Sharpe, Total Trades)

## Approach

Frontend-only change across 3 files, no backend modifications required.

1. **Metric cards**: Read `return_pct` and `max_drawdown_pct` from the metrics JSONB (the engine may already emit them via the dynamic `[key: string]: unknown` index). Compute `return_drawdown_ratio = return_pct / max_drawdown_pct`. If either field is missing or drawdown is zero, display "N/A" with a tooltip explaining the field is not available from the engine. The absolute values (Net PnL, Max DD) remain accessible via the existing `total_pnl` and `max_drawdown` fields if needed for tooltips.

2. **Equity curve chart**: Install `recharts` (~45KB gzipped). Add an `EquityCurveChart` component that computes cumulative PnL client-side from the trades array (sort by `exit_date`, accumulate `pnl`). Render using `<ResponsiveContainer>` + `<LineChart>` + `<Line>` + `<Tooltip>`. Hidden by default behind a toggle button, following the same UX pattern as the existing "Show/Hide Trades" toggle.

3. **Type updates**: Add optional fields to `BacktestMetrics` interface for forward compatibility with engine updates.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `frontend/package.json` | Modified | Add `recharts` dependency |
| `frontend/src/types/backtest.ts` | Modified | Add optional `return_pct`, `max_drawdown_pct`, `initial_equity` fields to `BacktestMetrics` |
| `frontend/src/components/strategies/BacktestPanel.tsx` | Modified | Replace 2 metric cards in `MetricsGrid`, add `EquityCurveChart` component with toggle in `JobResultsView` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Engine does not provide `return_pct` or `max_drawdown_pct` | High | Graceful fallback to "N/A"; cards auto-activate when engine adds fields |
| Trades array is empty (zero trades backtest) | Low | Conditional render -- hide chart toggle when no trades exist |
| Trades not chronologically ordered | Low | Explicitly sort by `exit_date` before computing cumulative PnL |
| Recharts bundle size (~45KB gzip) | Low | Acceptable for dashboard app already loading React + React Query + Axios |

## Rollback Plan

1. Revert the 3 modified files (`BacktestPanel.tsx`, `backtest.ts`, `package.json`) to their pre-change state via `git checkout`
2. Run `npm install` in the frontend container to remove `recharts` from `node_modules`
3. Rebuild the frontend container: `docker compose up -d --build frontend`

No database migrations or backend changes to revert.

## Dependencies

- `recharts` npm package (new frontend dependency, ~45KB gzipped)
- No backend or database dependencies

## Success Criteria

- [ ] "Net PnL" card replaced with "Return / DD" ratio card showing computed ratio or "N/A"
- [ ] "Max Drawdown" card replaced with "Max DD %" card showing percentage or "N/A"
- [ ] PnL equity curve chart renders correctly from trades data when toggled visible
- [ ] Chart is hidden by default; toggle button follows existing "Show/Hide Trades" UX pattern
- [ ] All 3 remaining metric cards (Win Rate, Sharpe Ratio, Total Trades) are unaffected
- [ ] Frontend builds without errors (`npm run build`)
- [ ] Graceful handling when metrics fields are absent (no crashes, shows "N/A")
