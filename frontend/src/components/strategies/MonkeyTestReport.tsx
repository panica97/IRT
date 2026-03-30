import { useMemo, useCallback } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, Cell, CartesianGrid,
} from 'recharts';
import { AlertTriangle, Shuffle, Table, BarChart3 } from 'lucide-react';
import type { MonkeyTestMetrics } from '../../types/backtest';

// ─── Helpers ────────────────────────────────────────────────────────

interface HistogramBin {
  binStart: number;
  binEnd: number;
  label: string;
  count: number;
}

function buildHistogramBins(values: number[], nBins: number = 20, labelPrefix: string = ''): HistogramBin[] {
  if (!values || values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [{ binStart: min, binEnd: max, label: `${labelPrefix}${Number(min).toFixed(1)}`, count: values.length }];

  const binWidth = (max - min) / nBins;
  const result: HistogramBin[] = [];
  for (let i = 0; i < nBins; i++) {
    const binStart = min + i * binWidth;
    const binEnd = i === nBins - 1 ? max + 0.01 : min + (i + 1) * binWidth;
    const count = values.filter(v => v >= binStart && v < binEnd).length;
    result.push({
      binStart,
      binEnd,
      label: `${labelPrefix}${Number(binStart).toFixed(1)}`,
      count,
    });
  }
  return result;
}

function computeP50(arr: number[]): number {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil(0.5 * sorted.length) - 1);
  return sorted[idx];
}

function formatCurrency(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}$${value.toFixed(2)}`;
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

const tooltipStyle = {
  backgroundColor: 'var(--color-surface-2)',
  border: '1px solid var(--color-border)',
  borderRadius: '0.375rem',
  fontSize: '0.75rem',
};

// ─── P-value Badge ──────────────────────────────────────────────────

function PValueBadge({ pValue, percentile }: { pValue: number; percentile: number }) {
  let bgClass: string;
  let textClass: string;
  let label: string;

  if (pValue < 0.01) {
    bgClass = 'bg-green-500/20 border-green-500/40';
    textClass = 'text-green-400';
    label = 'Very Strong Edge';
  } else if (pValue < 0.05) {
    bgClass = 'bg-emerald-500/20 border-emerald-500/40';
    textClass = 'text-emerald-400';
    label = 'Solid Edge';
  } else if (pValue < 0.10) {
    bgClass = 'bg-amber-500/20 border-amber-500/40';
    textClass = 'text-amber-400';
    label = 'Weak Edge';
  } else {
    bgClass = 'bg-red-500/20 border-red-500/40';
    textClass = 'text-red-400';
    label = 'No Evidence of Edge';
  }

  return (
    <div className={`border rounded-lg p-4 ${bgClass}`}>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className={`text-2xl font-bold ${textClass}`}>
            p = {pValue.toFixed(4)}
          </div>
          <div className={`px-3 py-1 rounded-full text-sm font-semibold ${bgClass} ${textClass}`}>
            {label}
          </div>
        </div>
        <div className="text-sm text-text-secondary">
          Beats <span className={`font-bold ${textClass}`}>{percentile.toFixed(1)}%</span> of random simulations
        </div>
      </div>
    </div>
  );
}

// ─── Histogram ──────────────────────────────────────────────────────

function MonkeyHistogram({ monkey }: { monkey: MonkeyTestMetrics }) {
  const returnDDValues = monkey.distribution.return_dd;
  const realValue = monkey.real_strategy.return_dd;

  const bins = useMemo(
    () => buildHistogramBins(returnDDValues, 20),
    [returnDDValues],
  );

  const closestBinLabel = useCallback((val: number) => {
    if (bins.length === 0) return undefined;
    return bins.reduce((closest, b) =>
      Math.abs(b.binStart - val) < Math.abs(closest.binStart - val) ? b : closest
    , bins[0]).label;
  }, [bins]);

  if (bins.length === 0) {
    return (
      <div className="border border-border rounded-lg p-6 bg-surface-1/30 text-center">
        <p className="text-sm text-text-muted">No distribution data available</p>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg p-4 bg-surface-1/30">
      <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
        <BarChart3 size={14} />
        Return/DD Distribution (Random vs Real)
      </h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={bins} margin={{ top: 15, right: 10, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 9, fill: '#9ca3af' }}
            tickLine={false}
            interval={Math.max(0, Math.floor(bins.length / 5) - 1)}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            tickLine={false}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value) => [`${value} simulations`, 'Count']}
            labelFormatter={(label) => `Return/DD: ${label}`}
          />
          <Bar dataKey="count" radius={[2, 2, 0, 0]}>
            {bins.map((bin, i) => (
              <Cell
                key={i}
                fill={bin.binEnd <= realValue ? '#6b7280' : '#3b82f6'}
                fillOpacity={0.7}
              />
            ))}
          </Bar>
          {closestBinLabel(realValue) && (
            <ReferenceLine
              x={closestBinLabel(realValue)}
              stroke="#10b981"
              strokeWidth={2}
              label={{ value: 'Real Strategy', position: 'top', fill: '#10b981', fontSize: 10 }}
            />
          )}
        </BarChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-4 mt-2 text-xs text-text-muted justify-center">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: '#6b7280', opacity: 0.7 }} /> Below real strategy
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: '#3b82f6', opacity: 0.7 }} /> At/above real strategy
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-0.5 rounded" style={{ backgroundColor: '#10b981' }} /> Real Strategy
        </span>
      </div>
    </div>
  );
}

// ─── Summary Table ──────────────────────────────────────────────────

function MonkeySummaryTable({ monkey }: { monkey: MonkeyTestMetrics }) {
  const real = monkey.real_strategy;
  const dist = monkey.distribution;

  const rows = useMemo(() => {
    const p50NetProfit = computeP50(dist.net_profit);
    const p50MaxDD = 0; // max_drawdown not in distribution, skip ranking
    const p50RetDD = computeP50(dist.return_dd);
    const p50WinRate = computeP50(dist.win_rate);
    const p50PF = computeP50(dist.profit_factor);

    // Rank: percentile of real value within distribution (higher-is-better for most)
    const rankOf = (arr: number[], val: number) => {
      if (!arr || arr.length === 0) return null;
      const count = arr.filter(v => v <= val).length;
      return (count / arr.length) * 100;
    };

    return [
      {
        label: 'Net Profit',
        real: formatCurrency(real.net_profit),
        p50: formatCurrency(p50NetProfit),
        rank: rankOf(dist.net_profit, real.net_profit),
      },
      {
        label: 'Max Drawdown',
        real: formatCurrency(real.max_drawdown),
        p50: '—',
        rank: p50MaxDD ? null : null,
      },
      {
        label: 'Return / DD',
        real: real.return_dd.toFixed(2),
        p50: p50RetDD.toFixed(2),
        rank: rankOf(dist.return_dd, real.return_dd),
      },
      {
        label: 'Win Rate',
        real: formatPercent(real.win_rate),
        p50: formatPercent(p50WinRate),
        rank: rankOf(dist.win_rate, real.win_rate),
      },
      {
        label: 'Profit Factor',
        real: real.profit_factor.toFixed(2),
        p50: p50PF.toFixed(2),
        rank: rankOf(dist.profit_factor, real.profit_factor),
      },
    ];
  }, [real, dist]);

  return (
    <div className="border border-border rounded-lg bg-surface-1/30">
      <h3 className="text-sm font-semibold text-text-primary p-4 pb-2 flex items-center gap-2">
        <Table size={14} />
        Real Strategy vs Random (Monkey P50)
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-surface-2/50">
            <tr>
              <th className="text-left px-3 py-2 text-text-muted font-medium">Metric</th>
              <th className="text-right px-3 py-2 text-text-muted font-medium">Real Strategy</th>
              <th className="text-right px-3 py-2 text-text-muted font-medium">Monkey P50</th>
              <th className="text-right px-3 py-2 text-text-muted font-medium">Rank</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-border/50">
                <td className="px-3 py-2 text-text-secondary font-medium">{row.label}</td>
                <td className="px-3 py-2 text-right font-semibold text-text-primary">{row.real}</td>
                <td className="px-3 py-2 text-right text-text-secondary">{row.p50}</td>
                <td className="px-3 py-2 text-right font-semibold text-text-primary">
                  {row.rank != null ? `P${row.rank.toFixed(0)}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Simulation Info ────────────────────────────────────────────────

function MonkeySimulationInfo({ monkey }: { monkey: MonkeyTestMetrics }) {
  const modeDescription = monkey.mode === 'A'
    ? 'Mode A: Random entry dates, same holding periods'
    : monkey.mode === 'B'
    ? 'Mode B: Random entries and exits (fully random trades)'
    : `Mode ${monkey.mode}`;

  return (
    <div className="border border-green-500/30 bg-green-500/5 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
        <Shuffle size={14} />
        Simulation Info
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <p className="text-xs text-text-muted mb-1">Mode</p>
          <p className="text-sm font-bold text-text-primary">{modeDescription}</p>
        </div>
        <div>
          <p className="text-xs text-text-muted mb-1">Simulations</p>
          <p className="text-lg font-bold text-text-primary">{monkey.n_simulations}</p>
        </div>
        <div>
          <p className="text-xs text-text-muted mb-1">Trades Requested</p>
          <p className="text-lg font-bold text-text-primary">{monkey.n_trades_requested}</p>
        </div>
        <div>
          <p className="text-xs text-text-muted mb-1">Trades Actual</p>
          <p className={`text-lg font-bold ${monkey.n_trades_actual < monkey.n_trades_requested ? 'text-amber-400' : 'text-text-primary'}`}>
            {monkey.n_trades_actual}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Warnings ───────────────────────────────────────────────────────

function MonkeyWarnings({ warnings }: { warnings: string[] }) {
  if (!warnings || warnings.length === 0) return null;

  return (
    <div className="border border-amber-500/40 bg-amber-500/10 rounded-lg p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
        <div>
          <h3 className="text-sm font-semibold text-amber-400 mb-2">Warnings</h3>
          <ul className="space-y-1">
            {warnings.map((w, i) => (
              <li key={i} className="text-xs text-text-secondary">{w}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

export default function MonkeyTestReport({ monkey }: { monkey: MonkeyTestMetrics }) {
  return (
    <div className="space-y-6">
      {/* P-value Badge */}
      <PValueBadge pValue={monkey.p_value} percentile={monkey.percentile} />

      {/* Simulation Info */}
      <MonkeySimulationInfo monkey={monkey} />

      {/* Warnings */}
      <MonkeyWarnings warnings={monkey.warnings} />

      {/* Histogram */}
      <MonkeyHistogram monkey={monkey} />

      {/* Summary Table */}
      <MonkeySummaryTable monkey={monkey} />
    </div>
  );
}
