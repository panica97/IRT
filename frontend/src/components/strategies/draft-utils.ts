import type { DraftData } from '../../types/draft-data';

/**
 * Safely parse the Record<string, unknown> from DraftDetail.data into DraftData.
 * Returns the typed data, or null if parsing fails.
 */
export function parseDraftData(data: Record<string, unknown>): DraftData | null {
  try {
    // The data already has the right shape from the API, just cast with basic validation
    const d = data as unknown as DraftData;
    if (!d.strat_code || !d.symbol) return null;
    return d;
  } catch {
    return null;
  }
}

/** Check if a value is a _TODO marker */
export function isTodo(value: unknown): boolean {
  return typeof value === 'string' && value.trim() === '_TODO';
}

/** Indicator type categories for color coding */
const INDICATOR_CATEGORIES: Record<string, string> = {
  // Trend
  SMA: 'trend', EMA: 'trend', DEMA: 'trend', TEMA: 'trend', WMA: 'trend', BBANDS: 'trend',
  // Oscillators
  RSI: 'oscillator', STOCH: 'oscillator', MACD: 'oscillator', CCI: 'oscillator', WILLR: 'oscillator', MFI: 'oscillator',
  // Volatility
  ATR: 'volatility', NATR: 'volatility', TRANGE: 'volatility',
  // Price
  PRICE: 'price',
};

export function getIndicatorCategory(type: string): string {
  return INDICATOR_CATEGORIES[type] ?? 'other';
}

/** Color classes by indicator category */
export function getIndicatorColors(category: string): string {
  switch (category) {
    case 'trend': return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
    case 'oscillator': return 'bg-purple-500/20 text-purple-300 border-purple-500/30';
    case 'volatility': return 'bg-orange-500/20 text-orange-300 border-orange-500/30';
    case 'price': return 'bg-slate-600/30 text-slate-300 border-slate-500/30';
    default: return 'bg-slate-600/30 text-slate-300 border-slate-500/30';
  }
}

/** Format stop-loss/take-profit in human-readable form */
export function formatStopLevel(params: DraftData['stop_loss_init']): string {
  if (params.indicator && params.indicator_params?.col) {
    const mult = params.indicator_params.multiple;
    const col = params.indicator_params.col;
    if (isTodo(mult)) return `${col} x _TODO`;
    return `${col} x ${mult}`;
  }
  if (params.pips && params.pips_params?.pips != null) {
    return `${params.pips_params.pips} pips`;
  }
  if (params.percent && params.percent_params?.percent != null) {
    return `${params.percent_params.percent}%`;
  }
  return 'No definido';
}

/** Sections that field paths map to, for TODO click-to-scroll */
type SectionId = 'instrument' | 'indicators' | 'conditions' | 'risk' | 'notes' | 'backtest';

export function fieldToSection(fieldPath: string): SectionId {
  if (fieldPath.startsWith('ind_list')) return 'indicators';
  if (fieldPath.startsWith('long_conds') || fieldPath.startsWith('short_conds') || fieldPath.startsWith('exit_conds')) return 'conditions';
  if (fieldPath.startsWith('stop_loss') || fieldPath.startsWith('take_profit')) return 'risk';
  if (fieldPath.startsWith('_notes')) return 'notes';
  if (fieldPath.startsWith('control_params') || fieldPath.startsWith('order_params')) return 'backtest';
  // Top-level fields like symbol, secType, etc.
  return 'instrument';
}

/** Get TODO fields that belong to a given section */
export function getTodoFieldsForSection(todoFields: string[] | null, sectionId: SectionId): string[] {
  if (!todoFields) return [];
  return todoFields.filter(f => fieldToSection(f) === sectionId);
}
