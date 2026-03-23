# Tasks: Backtest Result View Enhancements (Phase 10.3)

## Phase 1: Foundation (Dependencies & Types)

- [x] 1.1 Install `recharts` in `frontend/package.json` — run `npm install recharts` inside the frontend container (or add to `dependencies` and rebuild)
- [x] 1.2 Add optional metric fields to `BacktestMetrics` in `frontend/src/types/backtest.ts` — add `return_pct?: number`, `max_drawdown_pct?: number`, `initial_equity?: number` before the `[key: string]: unknown` index signature

## Phase 2: Core Implementation (Metric Cards)

- [x] 2.1 Replace "Net PnL" card with "Return / DD" ratio card in `MetricsGrid` (`frontend/src/components/strategies/BacktestPanel.tsx`, line 94) — read `metrics.return_pct` and `metrics.max_drawdown_pct` from the JSONB; compute `ratio = return_pct / max_drawdown_pct`; display with 2 decimal places; show "N/A" if either field is missing/undefined or `max_drawdown_pct` is zero; color green if ratio > 1, red otherwise
- [x] 2.2 Replace "Max Drawdown" (absolute currency) card with "Max DD %" card in `MetricsGrid` (`frontend/src/components/strategies/BacktestPanel.tsx`, line 96) — read `metrics.max_drawdown_pct`; display with `formatPercent()`; if field is absent, try computing from `abs(max_drawdown) / initial_equity * 100`; final fallback: show "N/A"; keep red coloring

## Phase 3: Equity Curve Chart

- [x] 3.1 Create `EquityCurveChart` component inside `frontend/src/components/strategies/BacktestPanel.tsx` — import `ResponsiveContainer`, `LineChart`, `Line`, `XAxis`, `YAxis`, `Tooltip`, `CartesianGrid` from `recharts`; compute cumulative PnL by sorting trades by `exit_date` and accumulating `trade.pnl`; render a line chart with date on X-axis and cumulative PnL on Y-axis; style axis text with `text-text-muted` color; style the line with the accent color; format tooltip values with `formatCurrency`
- [x] 3.2 Add `showEquityCurve` toggle state and button in `JobResultsView` (`frontend/src/components/strategies/BacktestPanel.tsx`, line ~104) — add `const [showEquityCurve, setShowEquityCurve] = useState(false)`; render a toggle button between `MetricsGrid` and the trades toggle (same styling pattern: `text-xs text-text-muted hover:text-text-secondary` with `ChevronDown`/`ChevronUp` icon); conditionally render `<EquityCurveChart trades={trades} />` when toggled; only show the toggle button when `trades.length > 0`

## Phase 4: Verification

- [ ] 4.1 Build check — run `npm run build` inside the frontend container; confirm zero TypeScript errors and zero build warnings related to the changes
- [ ] 4.2 Visual check — load a completed backtest in the browser; verify: (a) "Return / DD" card shows ratio or "N/A", (b) "Max DD %" card shows percentage or "N/A", (c) Win Rate / Sharpe / Total Trades cards are unchanged, (d) equity curve chart is hidden by default, (e) toggle button shows/hides the chart, (f) chart renders cumulative PnL line correctly from trades data
- [ ] 4.3 Edge case check — verify behavior with: (a) a backtest that has zero trades (no chart toggle should appear), (b) metrics missing `return_pct`/`max_drawdown_pct` fields (cards show "N/A"), (c) `max_drawdown_pct` is zero (Return/DD card shows "N/A" to avoid division by zero)
