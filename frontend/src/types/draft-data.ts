// Interfaces for the parsed IBKR draft JSON structure

export interface IndicatorParams {
  price_1?: string;
  price_2?: string;
  price_3?: string;
  timePeriod_1?: number;
  nbdevup?: number;
  nbdevdn?: number;
  indCode: string;
  [key: string]: unknown;  // other params
}

export interface Indicator {
  indicator: string;  // PRICE, BBANDS, ATR, RSI, etc.
  params: IndicatorParams;
}

export interface IndList {
  [timeframe: string]: Indicator[];  // "1 day", "6 hours", etc.
}

export interface Condition {
  cond_type: string;  // cross_ind_relation, price_relation, ind_relation, num_relation
  cond: string;       // human-readable condition string
  shift_1: number;
  shift_2?: number;
  condCode: string;
  group?: number;
  mode?: string;
}

export interface StopLossParams {
  indicator: boolean;
  indicator_params: {
    multiple?: string | number;  // can be "_TODO"
    tf?: string;
    col?: string;
  };
  pips: boolean;
  pips_params: {
    pips?: number | string;
  };
  percent: boolean;
  percent_params: {
    percent?: number | string;
  };
}

export interface StopLossMgmt {
  breakeven: {
    action: boolean;
    profitRatio: number;
  };
  trailing: {
    action: boolean;
    trailingRatio: number;
  };
}

export interface ControlParams {
  strategy: number;
  strategy_filename: string;
  symbol: string;
  start_date: string;
  end_date: string;
  timestamp: string;
  primary_timeframe: string;
  slippage_amount: string | number;
  comm_per_contract: string | number;
}

export interface OrderParams {
  max_rpo: number;
  min_volume: number;
}

export interface DraftData {
  strat_code: number;
  strat_name: string;
  active: boolean;
  tested: boolean;
  prod: boolean;
  symbol: string;
  secType: string;
  exchange: string;
  currency: string;
  multiplier: number;
  minTick: number;
  rolling_days?: number;
  process_freq?: string;
  trading_hours?: string | null;
  UTC_tz?: number;
  ind_list: IndList;
  long_conds: Condition[];
  short_conds: Condition[];
  exit_conds: Condition[];
  max_shift?: [number, string];
  max_timePeriod?: number;
  stop_loss_init: StopLossParams;
  take_profit_init: StopLossParams;
  stop_loss_mgmt: StopLossMgmt;
  order_params: OrderParams;
  control_params: ControlParams;
  _notes?: Record<string, string>;
}
