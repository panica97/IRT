import { useMemo, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from 'recharts';
import {
  ShieldCheck, BarChart3, Table, ArrowUpDown, CheckCircle2, XCircle,
  ChevronDown, Grid3X3, Award, ListChecks,
} from 'lucide-react';
import type { StressTestMetrics, StressTestVariation } from '../../types/backtest';

// ─── Constants ─────────────────────────────────────────────────────

const HEATMAP_METRICS: { key: string; label: string; lowerIsBetter: boolean }[] = [
  { key: 'total_pnl', label: 'Net PnL', lowerIsBetter: false },
  { key: 'profit_factor', label: 'Profit Factor', lowerIsBetter: false },
  { key: 'max_drawdown_pct', label: 'Max DD%', lowerIsBetter: true },
  { key: 'win_rate', label: 'Win Rate', lowerIsBetter: false },
  { key: 'sharpe_ratio', label: 'Sharpe', lowerIsBetter: false },
];

interface MetricDef {
  key: string;
  label: string;
  format: (v: number) => string;
  higherIsBetter: boolean | null;
}

const RESULT_METRICS: MetricDef[] = [
  { key: 'total_pnl', label: 'Total PnL', format: v => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), higherIsBetter: true },
  { key: 'win_rate', label: 'Win Rate', format: v => v.toFixed(1) + '%', higherIsBetter: true },
  { key: 'profit_factor', label: 'Profit Factor', format: v => v.toFixed(2), higherIsBetter: true },
  { key: 'sharpe_ratio', label: 'Sharpe', format: v => v.toFixed(2), higherIsBetter: true },
  { key: 'sortino_ratio', label: 'Sortino', format: v => v.toFixed(2), higherIsBetter: true },
  { key: 'max_drawdown', label: 'Max DD', format: v => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), higherIsBetter: false },
  { key: 'max_drawdown_pct', label: 'Max DD%', format: v => v.toFixed(2) + '%', higherIsBetter: false },
  { key: 'return_drawdown_ratio', label: 'Return/DD', format: v => v.toFixed(2), higherIsBetter: true },
  { key: 'total_trades', label: 'Trades', format: v => String(Math.round(v)), higherIsBetter: null },
  { key: 'sqn', label: 'SQN', format: v => v.toFixed(2), higherIsBetter: true },
  { key: 'annualized_return_pct', label: 'Annual%', format: v => v.toFixed(2) + '%', higherIsBetter: true },
];

const METRIC_WEIGHTS: Record<string, number> = {
  sharpe_ratio: 0.25,
  profit_factor: 0.25,
  win_rate: 0.15,
  max_drawdown_pct: 0.15,
  return_drawdown_ratio: 0.10,
  sortino_ratio: 0.10,
};

const METRIC_RANGES: Record<string, [number, number]> = {
  sharpe_ratio: [-2.0, 3.0],
  profit_factor: [0.5, 3.0],
  win_rate: [0.0, 100.0],
  max_drawdown_pct: [0.0, 50.0],
  return_drawdown_ratio: [0.0, 5.0],
  sortino_ratio: [-2.0, 4.0],
};

const INVERTED_METRICS = new Set(['max_drawdown_pct']);

const WEIGHT_DISPLAY_NAMES: Record<string, string> = {
  sharpe_ratio: 'Sharpe Ratio',
  profit_factor: 'Profit Factor',
  win_rate: 'Win Rate',
  max_drawdown_pct: 'Max Drawdown %',
  return_drawdown_ratio: 'Return/DD Ratio',
  sortino_ratio: 'Sortino Ratio',
};

// ─── Helpers ────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}$${value.toFixed(2)}`;
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function getMetricVal(metrics: Record<string, number>, key: string): number | null {
  const v = metrics[key];
  return v != null ? v : null;
}

function formatParamLabel(path: string): string {
  return path.split('.').pop() || path;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function normalizeMetric(value: number | null | undefined, key: string): number {
  if (value == null) return 0;
  const range = METRIC_RANGES[key];
  if (!range) return 0;
  const [lo, hi] = range;
  if (hi <= lo) return 0;
  const clamped = Math.max(lo, Math.min(hi, value));
  let norm = (clamped - lo) / (hi - lo);
  if (INVERTED_METRICS.has(key)) norm = 1 - norm;
  return norm * 100;
}

/**
 * Interpolate between red, white, and green.
 * norm: 0 = bad, 1 = good
 */
function colorScale(norm: number): string {
  const n = Math.max(0, Math.min(1, norm));
  let r: number, g: number, b: number;
  if (n < 0.5) {
    const ratio = n * 2;
    r = 239; g = Math.round(68 + (255 - 68) * ratio); b = Math.round(68 + (255 - 68) * ratio);
  } else {
    const ratio = (n - 0.5) * 2;
    r = Math.round(255 - (255 - 34) * ratio); g = Math.round(255 - (255 - 197) * ratio); b = Math.round(255 - (255 - 94) * ratio);
  }
  return `rgb(${r},${g},${b})`;
}

const tooltipStyle = {
  backgroundColor: 'var(--color-surface-2)',
  border: '1px solid var(--color-border)',
  borderRadius: '0.375rem',
  fontSize: '0.75rem',
};

// ─── Sub-phase 9: Robustness Verdict ────────────────────────────────

interface VerdictCriterion {
  name: string;
  passed: boolean;
  actual: string;
  threshold: string;
}

function computeVerdict(completed: StressTestVariation[]): VerdictCriterion[] {
  if (completed.length === 0) return [];

  // 1. Profitable: >=70% positive total_pnl
  const positivePnl = completed.filter(v => (v.metrics.total_pnl ?? 0) > 0).length;
  const profitablePct = (positivePnl / completed.length) * 100;

  // 2. Median Sharpe > 1.0
  const sharpeVals = completed.map(v => v.metrics.sharpe_ratio).filter((v): v is number => v != null).sort((a, b) => a - b);
  const medianSharpe = median(sharpeVals);

  // 3. Sharpe Outliers: >=95% with Sharpe >= 0
  const nonNegSharpe = sharpeVals.filter(v => v >= 0).length;
  const sharpeOutliersPct = sharpeVals.length > 0 ? (nonNegSharpe / sharpeVals.length) * 100 : 0;

  // 4. Max Drawdown: all < 25%
  const ddVals = completed.map(v => {
    if (v.metrics.max_drawdown_pct != null) return Math.abs(v.metrics.max_drawdown_pct);
    return 100;
  });
  const worstDD = Math.max(...ddVals);

  // 5. Avg Profit Factor > 1.5
  const pfVals = completed.map(v => v.metrics.profit_factor).filter((v): v is number => v != null);
  const avgPF = pfVals.length > 0 ? pfVals.reduce((s, v) => s + v, 0) / pfVals.length : 0;

  // 6. PnL Stability: stdev < 50% of mean (auto-fail if mean <= 0)
  const pnlVals = completed.map(v => v.metrics.total_pnl).filter((v): v is number => v != null);
  let pnlStabilityPassed = false;
  let pnlStabilityActual = 'N/A';
  if (pnlVals.length >= 2) {
    const meanPnl = pnlVals.reduce((s, v) => s + v, 0) / pnlVals.length;
    if (meanPnl <= 0) {
      pnlStabilityActual = 'mean<=0';
    } else {
      const variance = pnlVals.reduce((s, v) => s + (v - meanPnl) ** 2, 0) / (pnlVals.length - 1);
      const stdev = Math.sqrt(variance);
      const ratio = (stdev / meanPnl) * 100;
      pnlStabilityPassed = ratio < 50;
      pnlStabilityActual = ratio.toFixed(1) + '%';
    }
  }

  return [
    { name: 'Profitable', passed: profitablePct >= 70, actual: profitablePct.toFixed(1) + '%', threshold: '>=70%' },
    { name: 'Median Sharpe', passed: medianSharpe > 1.0, actual: medianSharpe.toFixed(2), threshold: '>1.0' },
    { name: 'Sharpe Outliers', passed: sharpeOutliersPct >= 95, actual: sharpeOutliersPct.toFixed(1) + '%', threshold: '>=95%' },
    { name: 'Max Drawdown', passed: worstDD < 25, actual: worstDD.toFixed(1) + '%', threshold: '<25%' },
    { name: 'Avg Profit Factor', passed: avgPF > 1.5, actual: avgPF.toFixed(2), threshold: '>1.5' },
    { name: 'PnL Stability', passed: pnlStabilityPassed, actual: pnlStabilityActual, threshold: '<50%' },
  ];
}

function VerdictSection({ variations }: { variations: StressTestVariation[] }) {
  const completed = useMemo(() => variations.filter(v => v.status === 'completed'), [variations]);
  const criteria = useMemo(() => computeVerdict(completed), [completed]);
  const passedCount = criteria.filter(c => c.passed).length;

  if (criteria.length === 0) return null;

  let summaryColor: string;
  if (passedCount >= 5) summaryColor = 'text-green-400';
  else if (passedCount >= 3) summaryColor = 'text-amber-400';
  else summaryColor = 'text-red-400';

  return (
    <div className="border border-border rounded-lg p-4 bg-surface-1/30">
      <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
        <ListChecks size={14} />
        Robustness Verdict
      </h3>
      <div className={`text-sm font-bold mb-3 ${summaryColor}`}>
        {passedCount}/6 criteria passed
      </div>
      <div className="space-y-1.5">
        {criteria.map((c) => (
          <div key={c.name} className="flex items-center gap-2 text-xs">
            {c.passed
              ? <CheckCircle2 size={14} className="text-green-400 shrink-0" />
              : <XCircle size={14} className="text-red-400 shrink-0" />
            }
            <span className="text-text-secondary w-28">{c.name}</span>
            <span className={`font-semibold w-16 text-right ${c.passed ? 'text-green-400' : 'text-red-400'}`}>
              {c.actual}
            </span>
            <span className="text-text-muted">{c.threshold}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Robustness Score Badge ─────────────────────────────────────────

function RobustnessBadge({ robustness }: { robustness: StressTestMetrics['robustness'] }) {
  const score = robustness.score;

  let bgClass: string;
  let textClass: string;
  let label: string;

  if (score >= 80) {
    bgClass = 'bg-green-500/20 border-green-500/40';
    textClass = 'text-green-400';
    label = 'Robust';
  } else if (score >= 60) {
    bgClass = 'bg-emerald-500/20 border-emerald-500/40';
    textClass = 'text-emerald-400';
    label = 'Moderate';
  } else if (score >= 40) {
    bgClass = 'bg-amber-500/20 border-amber-500/40';
    textClass = 'text-amber-400';
    label = 'Weak';
  } else {
    bgClass = 'bg-red-500/20 border-red-500/40';
    textClass = 'text-red-400';
    label = 'Fragile';
  }

  return (
    <div className={`border rounded-lg p-4 ${bgClass}`}>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className={`text-3xl font-bold ${textClass}`}>
            {score.toFixed(0)}
          </div>
          <div className={`px-3 py-1 rounded-full text-sm font-semibold ${bgClass} ${textClass}`}>
            {label}
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm text-text-secondary">
          <span>Profitable: <span className="font-semibold text-text-primary">{formatPercent(robustness.profitable_pct)}</span></span>
          <span>Positive Sharpe: <span className="font-semibold text-text-primary">{formatPercent(robustness.positive_sharpe_pct)}</span></span>
          <span>Low DD: <span className="font-semibold text-text-primary">{formatPercent(robustness.low_drawdown_pct)}</span></span>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-phase 11: Score Breakdown ──────────────────────────────────

interface BreakdownData {
  contributions: { name: string; weight: string; contribution: string }[];
  meanMetricScore: number;
  consistencyBonus: number;
  deviationImpacts: { param: string; avgDelta: number }[];
}

function computeBreakdown(
  completed: StressTestVariation[],
  config?: StressTestMetrics['config'],
): BreakdownData | null {
  if (completed.length === 0) return null;

  const aggContrib: Record<string, number> = {};
  for (const k of Object.keys(METRIC_WEIGHTS)) aggContrib[k] = 0;

  const variationScores: number[] = [];
  for (const v of completed) {
    let score = 0;
    for (const [mk, weight] of Object.entries(METRIC_WEIGHTS)) {
      const raw = v.metrics[mk] ?? null;
      const norm = normalizeMetric(raw, mk);
      const contribution = norm * weight;
      aggContrib[mk] += contribution;
      score += contribution;
    }
    variationScores.push(score);
  }

  const n = completed.length;
  for (const k of Object.keys(aggContrib)) aggContrib[k] /= n;

  const meanScore = variationScores.reduce((s, v) => s + v, 0) / n;

  // Consistency bonus
  let consistencyBonus = 100;
  if (variationScores.length > 1 && meanScore > 0) {
    const variance = variationScores.reduce((s, v) => s + (v - meanScore) ** 2, 0) / (variationScores.length - 1);
    const stdDev = Math.sqrt(variance);
    const cvVal = stdDev / meanScore;
    consistencyBonus = 100 * Math.max(0, 1 - cvVal);
  }

  const contributions = Object.entries(aggContrib)
    .map(([key, val]) => ({
      name: WEIGHT_DISPLAY_NAMES[key] || key,
      weight: (METRIC_WEIGHTS[key] * 100).toFixed(0),
      contribution: val.toFixed(1),
    }))
    .sort((a, b) => parseFloat(b.contribution) - parseFloat(a.contribution));

  // Deviation impact
  const deviationImpacts: { param: string; avgDelta: number }[] = [];
  const baseParams = config?.base_params;
  const paramRanges = config?.param_ranges;
  if (baseParams && paramRanges) {
    for (const paramKey of Object.keys(paramRanges)) {
      const baseVal = baseParams[paramKey];
      if (baseVal == null) continue;
      const baseVariations = completed.filter(v => Math.abs((v.params[paramKey] ?? 0) - baseVal) < 0.001);
      const nonBaseVariations = completed.filter(v => Math.abs((v.params[paramKey] ?? 0) - baseVal) >= 0.001);
      if (baseVariations.length === 0 || nonBaseVariations.length === 0) continue;
      const baseAvgPnl = baseVariations.reduce((s, v) => s + (v.metrics.total_pnl ?? 0), 0) / baseVariations.length;
      const nonBaseAvgPnl = nonBaseVariations.reduce((s, v) => s + (v.metrics.total_pnl ?? 0), 0) / nonBaseVariations.length;
      deviationImpacts.push({
        param: formatParamLabel(paramKey),
        avgDelta: nonBaseAvgPnl - baseAvgPnl,
      });
    }
    deviationImpacts.sort((a, b) => Math.abs(b.avgDelta) - Math.abs(a.avgDelta));
  }

  return { contributions, meanMetricScore: meanScore, consistencyBonus, deviationImpacts };
}

function ScoreBreakdown({ stress }: { stress: StressTestMetrics }) {
  const [open, setOpen] = useState(false);

  const completed = useMemo(
    () => stress.variations.filter(v => v.status === 'completed'),
    [stress.variations],
  );

  const breakdown = useMemo(
    () => computeBreakdown(completed, stress.config),
    [completed, stress.config],
  );

  if (!breakdown) return null;

  const maxDelta = breakdown.deviationImpacts.length > 0
    ? Math.max(...breakdown.deviationImpacts.map(d => Math.abs(d.avgDelta)))
    : 1;

  return (
    <div className="border border-border rounded-lg bg-surface-1/30">
      <button
        className="w-full flex items-center gap-2 p-4 text-sm font-semibold text-text-primary hover:text-text-secondary transition-colors"
        onClick={() => setOpen(!open)}
      >
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-0' : '-rotate-90'}`} />
        <Award size={14} />
        Score Breakdown
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          {/* Summary metrics */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="border border-border rounded p-2">
              <p className="text-text-muted">Avg Metric Score</p>
              <p className="text-lg font-bold text-text-primary">{breakdown.meanMetricScore.toFixed(1)}</p>
            </div>
            <div className="border border-border rounded p-2">
              <p className="text-text-muted">Consistency Bonus</p>
              <p className="text-lg font-bold text-text-primary">{breakdown.consistencyBonus.toFixed(1)}</p>
            </div>
          </div>

          {/* Weighted contributions table */}
          <div>
            <h4 className="text-xs font-semibold text-text-secondary mb-2">Weighted Contributions</h4>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-text-muted">
                  <th className="text-left py-1">Metric</th>
                  <th className="text-right py-1">Weight%</th>
                  <th className="text-right py-1">Contribution</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.contributions.map((c) => (
                  <tr key={c.name} className="border-t border-border/50">
                    <td className="py-1 text-text-secondary">{c.name}</td>
                    <td className="py-1 text-right text-text-muted">{c.weight}%</td>
                    <td className="py-1 text-right text-accent font-medium">+{c.contribution}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Deviation Impact */}
          {breakdown.deviationImpacts.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-text-secondary mb-2">Deviation Impact (PnL)</h4>
              <div className="space-y-1.5">
                {breakdown.deviationImpacts.map((imp) => {
                  const isPositive = imp.avgDelta >= 0;
                  const barWidth = Math.min(100, (Math.abs(imp.avgDelta) / maxDelta) * 100);
                  return (
                    <div key={imp.param} className="flex items-center gap-2 text-xs">
                      <span className="w-24 text-text-secondary truncate">{imp.param}</span>
                      <div className="flex-1 h-3 bg-surface-2/50 rounded overflow-hidden">
                        <div
                          className={`h-full rounded ${isPositive ? 'bg-green-500/60' : 'bg-red-500/60'}`}
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                      <span className={`w-20 text-right font-medium ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                        {isPositive ? '+' : ''}${imp.avgDelta.toFixed(0)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Summary Card ───────────────────────────────────────────────────

function StressSummaryCard({ summary }: { summary: StressTestMetrics['summary'] }) {
  const bgClass = summary.failed > 0 ? 'border-amber-500/30 bg-amber-500/5' : 'border-green-500/30 bg-green-500/5';

  return (
    <div className={`border rounded-lg p-4 ${bgClass}`}>
      <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
        <ShieldCheck size={14} />
        Test Summary
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <p className="text-xs text-text-muted mb-1">Total Variations</p>
          <p className="text-lg font-bold text-text-primary">{summary.total_variations}</p>
        </div>
        <div>
          <p className="text-xs text-text-muted mb-1">Completed</p>
          <p className="text-lg font-bold text-green-400">{summary.completed}</p>
        </div>
        <div>
          <p className="text-xs text-text-muted mb-1">Failed</p>
          <p className={`text-lg font-bold ${summary.failed > 0 ? 'text-red-400' : 'text-text-primary'}`}>{summary.failed}</p>
        </div>
        <div>
          <p className="text-xs text-text-muted mb-1">Duration</p>
          <p className="text-lg font-bold text-text-primary">{summary.duration_seconds.toFixed(1)}s</p>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-phase 8: Sensitivity Heatmap ───────────────────────────────

function SensitivityHeatmap({ stress }: { stress: StressTestMetrics }) {
  const paramKeys = useMemo(
    () => Object.keys(stress.config?.param_ranges || {}),
    [stress.config],
  );

  const [xParam, setXParam] = useState('');
  const [yParam, setYParam] = useState('');
  const [metricKey, setMetricKey] = useState('total_pnl');

  // Initialize selectors
  useMemo(() => {
    if (paramKeys.length >= 2) {
      if (!xParam || !paramKeys.includes(xParam)) setXParam(paramKeys[0]);
      if (!yParam || !paramKeys.includes(yParam) || yParam === paramKeys[0]) setYParam(paramKeys[1]);
    } else if (paramKeys.length === 1) {
      if (!xParam || !paramKeys.includes(xParam)) setXParam(paramKeys[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramKeys]);

  const yOptions = useMemo(() => paramKeys.filter(p => p !== xParam), [paramKeys, xParam]);

  const completed = useMemo(
    () => stress.variations.filter(v => v.status === 'completed'),
    [stress.variations],
  );

  const metricDef = HEATMAP_METRICS.find(m => m.key === metricKey);
  const lowerIsBetter = metricDef?.lowerIsBetter ?? false;

  // ── Single-param bar chart (when only 1 parameter) ──

  const barChartData = useMemo(() => {
    if (paramKeys.length !== 1) return null;
    const param = paramKeys[0];
    const points: { paramVal: string; value: number }[] = [];
    for (const v of completed) {
      const pVal = v.params[param];
      const mVal = v.metrics[metricKey];
      if (pVal != null && mVal != null) {
        points.push({ paramVal: String(pVal), value: mVal });
      }
    }
    points.sort((a, b) => Number(a.paramVal) - Number(b.paramVal));
    return points;
  }, [completed, paramKeys, metricKey]);

  // ── Multi-param heatmap grid (when >= 2 parameters) ──

  const heatmapData = useMemo(() => {
    if (paramKeys.length < 2 || !xParam || !yParam || xParam === yParam) return null;

    const ranges = stress.config?.param_ranges || {};
    const xValues = [...new Set(ranges[xParam] || [])].sort((a, b) => a - b);
    const yValues = [...new Set(ranges[yParam] || [])].sort((a, b) => a - b);

    const valMap = new Map<string, { value: number; params: Record<string, number> }>();
    for (const v of completed) {
      if (xParam in v.params && yParam in v.params) {
        const mval = v.metrics[metricKey];
        if (mval != null) {
          valMap.set(`${v.params[xParam]}|${v.params[yParam]}`, { value: mval, params: v.params });
        }
      }
    }

    let minVal = Infinity, maxVal = -Infinity;
    for (const entry of valMap.values()) {
      if (entry.value < minVal) minVal = entry.value;
      if (entry.value > maxVal) maxVal = entry.value;
    }
    if (minVal === Infinity) { minVal = 0; maxVal = 0; }

    return { xValues, yValues, valMap, minVal, maxVal };
  }, [completed, paramKeys, xParam, yParam, metricKey, stress.config]);

  if (paramKeys.length === 0) return null;

  return (
    <div className="border border-border rounded-lg p-4 bg-surface-1/30 space-y-3">
      <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
        <Grid3X3 size={14} />
        {paramKeys.length >= 2 ? 'Sensitivity Heatmap' : 'Sensitivity Bar Chart'}
      </h3>

      {/* Selectors */}
      <div className="flex flex-wrap gap-3">
        {paramKeys.length >= 2 && (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-text-muted uppercase tracking-wider">X-axis</label>
              <select
                className="bg-surface-2 border border-border rounded px-2 py-1 text-xs text-text-primary"
                value={xParam}
                onChange={(e) => {
                  setXParam(e.target.value);
                  if (e.target.value === yParam) {
                    const alt = paramKeys.find(p => p !== e.target.value);
                    if (alt) setYParam(alt);
                  }
                }}
              >
                {paramKeys.map(pk => (
                  <option key={pk} value={pk}>{formatParamLabel(pk)}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-text-muted uppercase tracking-wider">Y-axis</label>
              <select
                className="bg-surface-2 border border-border rounded px-2 py-1 text-xs text-text-primary"
                value={yParam}
                onChange={(e) => setYParam(e.target.value)}
              >
                {yOptions.map(pk => (
                  <option key={pk} value={pk}>{formatParamLabel(pk)}</option>
                ))}
              </select>
            </div>
          </>
        )}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-text-muted uppercase tracking-wider">Metric</label>
          <select
            className="bg-surface-2 border border-border rounded px-2 py-1 text-xs text-text-primary"
            value={metricKey}
            onChange={(e) => setMetricKey(e.target.value)}
          >
            {HEATMAP_METRICS.map(m => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Single-param bar chart */}
      {paramKeys.length === 1 && barChartData && barChartData.length > 0 && (
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={barChartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="paramVal"
              tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
              label={{ value: formatParamLabel(paramKeys[0]), position: 'insideBottom', offset: -5, fontSize: 10, fill: 'var(--color-text-muted)' }}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
              tickFormatter={(v: number) => metricKey === 'total_pnl' ? formatCurrency(v) : v.toFixed(1)}
            />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="value" name={metricDef?.label || metricKey}>
              {barChartData.map((entry, idx) => {
                const vals = barChartData.map(d => d.value);
                const min = Math.min(...vals);
                const max = Math.max(...vals);
                const range = max - min || 1;
                let norm = (entry.value - min) / range;
                if (lowerIsBetter) norm = 1 - norm;
                return <Cell key={idx} fill={colorScale(norm)} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}

      {/* Multi-param heatmap grid */}
      {paramKeys.length >= 2 && heatmapData && (
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse">
            <thead>
              <tr>
                <th className="px-1 py-1 text-text-muted text-[10px]">
                  {formatParamLabel(yParam)} \ {formatParamLabel(xParam)}
                </th>
                {heatmapData.xValues.map(xv => (
                  <th key={xv} className="px-2 py-1 text-text-muted font-medium text-center">{xv}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...heatmapData.yValues].reverse().map(yv => (
                <tr key={yv}>
                  <td className="px-2 py-1 text-text-muted font-medium">{yv}</td>
                  {heatmapData.xValues.map(xv => {
                    const entry = heatmapData.valMap.get(`${xv}|${yv}`);
                    if (!entry) {
                      return (
                        <td key={xv} className="px-2 py-2 text-center text-text-muted border border-border/30">
                          —
                        </td>
                      );
                    }
                    const { minVal, maxVal } = heatmapData;
                    const range = maxVal - minVal || 1;
                    let norm = (entry.value - minVal) / range;
                    if (lowerIsBetter) norm = 1 - norm;
                    const bgColor = colorScale(norm);

                    // Determine text color based on background brightness
                    const textColor = norm > 0.3 && norm < 0.7 ? '#1a1a2e' : '#f0f0f0';

                    // Format value
                    let displayVal: string;
                    if (metricKey === 'total_pnl') displayVal = '$' + entry.value.toFixed(0);
                    else if (metricKey === 'win_rate' || metricKey === 'max_drawdown_pct') displayVal = entry.value.toFixed(1) + '%';
                    else displayVal = entry.value.toFixed(2);

                    const tooltipText = Object.entries(entry.params)
                      .map(([k, val]) => `${formatParamLabel(k)}=${val}`)
                      .join(', ') + ` | ${metricDef?.label || metricKey}: ${displayVal}`;

                    return (
                      <td
                        key={xv}
                        className="px-2 py-2 text-center font-mono text-[10px] border border-border/30 cursor-default"
                        style={{ backgroundColor: bgColor, color: textColor }}
                        title={tooltipText}
                      >
                        {displayVal}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {paramKeys.length >= 2 && xParam === yParam && (
        <p className="text-xs text-text-muted text-center py-4">Select different parameters for X and Y axes</p>
      )}
    </div>
  );
}

// ─── Sub-phase 10: Enhanced Results Table ───────────────────────────

function EnhancedResultsTable({ variations, config }: { variations: StressTestVariation[]; config?: StressTestMetrics['config'] }) {
  const [rankBy, setRankBy] = useState('total_pnl');

  const completed = useMemo(
    () => variations.filter(v => v.status === 'completed'),
    [variations],
  );

  const rankableMetrics = useMemo(() => RESULT_METRICS.filter(m => m.higherIsBetter !== null), []);

  // Sort
  const sorted = useMemo(() => {
    const metricDef = RESULT_METRICS.find(m => m.key === rankBy);
    const higherIsBetter = metricDef?.higherIsBetter ?? true;
    return [...completed].sort((a, b) => {
      const valA = getMetricVal(a.metrics, rankBy);
      const valB = getMetricVal(b.metrics, rankBy);
      if (valA == null && valB == null) return 0;
      if (valA == null) return 1;
      if (valB == null) return -1;
      return higherIsBetter ? valB - valA : valA - valB;
    });
  }, [completed, rankBy]);

  // Best/worst per column
  const extremes = useMemo(() => {
    if (completed.length < 2) return null;
    const result: Record<string, { best: number; worst: number }> = {};
    for (const m of RESULT_METRICS) {
      if (m.higherIsBetter === null) continue;
      const vals = completed.map(v => getMetricVal(v.metrics, m.key)).filter((v): v is number => v != null);
      if (vals.length < 2) continue;
      if (m.higherIsBetter) {
        result[m.key] = { best: Math.max(...vals), worst: Math.min(...vals) };
      } else {
        result[m.key] = { best: Math.min(...vals), worst: Math.max(...vals) };
      }
    }
    return result;
  }, [completed]);

  function extremeClass(key: string, value: number | null): string {
    if (value == null || !extremes) return '';
    const ext = extremes[key];
    if (!ext || ext.best === ext.worst) return '';
    if (value === ext.best) return 'text-green-400 font-bold';
    if (value === ext.worst) return 'text-red-400 font-bold';
    return '';
  }

  if (completed.length === 0) {
    return (
      <div className="border border-border rounded-lg p-6 bg-surface-1/30 text-center">
        <p className="text-sm text-text-muted">No completed variations</p>
      </div>
    );
  }

  const baseParams = config?.base_params || {};

  return (
    <div className="border border-border rounded-lg bg-surface-1/30">
      <div className="p-4 pb-2 flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <Table size={14} />
          Results ({completed.length} variations)
        </h3>
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-text-muted uppercase tracking-wider">Rank by</label>
          <select
            className="bg-surface-2 border border-border rounded px-2 py-1 text-xs text-text-primary"
            value={rankBy}
            onChange={(e) => setRankBy(e.target.value)}
          >
            {rankableMetrics.map(m => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="max-h-[500px] overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-surface-2/50 sticky top-0">
            <tr>
              <th className="text-left px-2 py-2 text-text-muted font-medium">#</th>
              <th className="text-left px-2 py-2 text-text-muted font-medium">Params</th>
              {RESULT_METRICS.map(m => (
                <th
                  key={m.key}
                  className={`text-right px-2 py-2 text-text-muted font-medium cursor-pointer hover:text-text-secondary transition-colors select-none ${rankBy === m.key ? 'text-accent' : ''}`}
                  onClick={() => setRankBy(m.key)}
                >
                  <span className="inline-flex items-center gap-0.5">
                    {m.label}
                    {rankBy === m.key && <ArrowUpDown size={8} className="text-accent" />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((v, idx) => {
              const pnl = v.metrics.total_pnl ?? 0;
              const isProfitable = pnl >= 0;

              // Format params column with short labels
              const paramsStr = Object.entries(v.params)
                .map(([k, val]) => {
                  const short = formatParamLabel(k);
                  const base = baseParams[k];
                  const isBase = base != null && Math.abs(val - base) < 0.0001;
                  return `${short}=${val}${isBase ? '*' : ''}`;
                })
                .join(', ');

              return (
                <tr
                  key={v.name}
                  className={`border-t border-border/50 ${isProfitable ? 'hover:bg-green-500/5' : 'hover:bg-red-500/5'}`}
                >
                  <td className="px-2 py-1.5 text-text-muted">{idx + 1}</td>
                  <td className="px-2 py-1.5 text-text-secondary font-mono text-[10px] max-w-[200px] truncate" title={paramsStr}>
                    {paramsStr}
                  </td>
                  {RESULT_METRICS.map(m => {
                    const val = getMetricVal(v.metrics, m.key);
                    if (val == null) {
                      return (
                        <td key={m.key} className="px-2 py-1.5 text-right text-text-muted">—</td>
                      );
                    }
                    return (
                      <td key={m.key} className={`px-2 py-1.5 text-right ${extremeClass(m.key, val)}`}>
                        {m.format(val)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Single-Param Sensitivity Charts (existing, kept) ───────────────

function SingleParamChart({ paramName, variations }: { paramName: string; variations: StressTestVariation[] }) {
  const data = useMemo(() => {
    const comp = variations.filter((v) => v.status === 'completed');
    return comp
      .map((v) => ({
        paramValue: v.params[paramName] ?? 0,
        total_pnl: v.metrics.total_pnl ?? 0,
        sharpe_ratio: v.metrics.sharpe_ratio ?? 0,
      }))
      .sort((a, b) => a.paramValue - b.paramValue);
  }, [variations, paramName]);

  if (data.length === 0) return null;

  return (
    <div className="border border-border rounded-lg p-4 bg-surface-1/30">
      <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
        <BarChart3 size={14} />
        {paramName}
      </h3>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis
            dataKey="paramValue"
            tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
            tickLine={false}
            label={{ value: paramName, position: 'insideBottom', offset: -5, fontSize: 10, fill: 'var(--color-text-muted)' }}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
            tickLine={false}
            tickFormatter={(v: number) => formatCurrency(v)}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            labelFormatter={(label) => `${paramName}: ${label}`}
            formatter={(value, name) => [
              name === 'total_pnl' ? formatCurrency(Number(value)) : Number(value).toFixed(2),
              name === 'total_pnl' ? 'Total PnL' : 'Sharpe',
            ]}
          />
          <Bar dataKey="total_pnl" name="total_pnl">
            {data.map((entry, idx) => {
              const vals = data.map(d => d.total_pnl);
              const min = Math.min(...vals);
              const max = Math.max(...vals);
              const range = max - min || 1;
              const norm = (entry.total_pnl - min) / range;
              return <Cell key={idx} fill={colorScale(norm)} />;
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function SingleParamCharts({ singleVariations }: { singleVariations: Record<string, StressTestVariation[]> }) {
  const paramNames = Object.keys(singleVariations);
  if (paramNames.length === 0) return null;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
        <BarChart3 size={14} />
        Single-Parameter Sensitivity
      </h3>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {paramNames.map((name) => (
          <SingleParamChart key={name} paramName={name} variations={singleVariations[name]} />
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

export default function StressTestReport({ stress }: { stress: StressTestMetrics }) {
  return (
    <div className="space-y-6">
      {/* Sub-phase 9: Robustness Verdict */}
      <VerdictSection variations={stress.variations} />

      {/* Robustness Score */}
      <RobustnessBadge robustness={stress.robustness} />

      {/* Sub-phase 11: Score Breakdown (expandable) */}
      <ScoreBreakdown stress={stress} />

      {/* Summary */}
      <StressSummaryCard summary={stress.summary} />

      {/* Sub-phase 8: Sensitivity Heatmap */}
      <SensitivityHeatmap stress={stress} />

      {/* Sub-phase 10: Enhanced Results Table */}
      <EnhancedResultsTable variations={stress.variations} config={stress.config} />

      {/* Single-Param Sensitivity Charts */}
      {stress.single_variations && Object.keys(stress.single_variations).length > 0 && (
        <SingleParamCharts singleVariations={stress.single_variations} />
      )}
    </div>
  );
}
