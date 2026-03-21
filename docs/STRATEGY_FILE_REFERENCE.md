# Strategy File Reference

Complete specification of strategy JSON files used by the IBKR Trading Engine. This document describes every field, every indicator, every condition type, and every configuration option available for strategy authoring.

---

## Table of Contents

1. [File Format & Discovery](#1-file-format--discovery)
2. [Qualification Flags](#2-qualification-flags)
3. [Complete Field Reference](#3-complete-field-reference)
4. [Indicators](#4-indicators)
5. [Conditions](#5-conditions)
6. [Stop Loss & Take Profit](#6-stop-loss--take-profit)
7. [Stop Loss Management](#7-stop-loss-management)
8. [Order Parameters](#8-order-parameters)
9. [Control Parameters (Backtest Metrics)](#9-control-parameters-backtest-metrics)
10. [Processing Pipeline Overview](#10-processing-pipeline-overview)
11. [Advanced Patterns](#11-advanced-patterns)
12. [Complete Annotated Example](#12-complete-annotated-example)
13. [Custom Indicators](#13-custom-indicators)
14. [Trade Filters](#14-trade-filters)

---

## 1. File Format & Discovery

### Location

Strategies live in a dedicated folder outside the main repository (default: `../Strategies/` relative to project root, configurable via `STRATEGIES_DIR` in `.env`).

### File Format

- **JSON** (preferred): Files with `.json` extension
- **Python** (legacy): Files with `.py` extension
- When both exist for the same strategy code, **JSON takes priority**

### Naming Convention

Files MUST be named with their `strat_code` number only:

```
1001.json     (valid)
1002.json     (valid)
my_strategy.json   (IGNORED - non-numeric name)
```

### Schema Validation

JSON files can reference the schema for IDE validation:

```json
{
  "$schema": "./schema.json",
  ...
}
```

The `schema.json` file lives in the Strategies folder and provides autocomplete and validation in editors like VS Code.

---

## 2. Qualification Flags

For a strategy to be loaded into the **live trading engine**, ALL THREE flags must be `true`:

| Flag | Purpose |
|------|---------|
| `active` | Strategy is active (false = completely skipped) |
| `tested` | Strategy has passed backtesting validation |
| `prod` | Strategy is approved for production trading |

Setting any flag to `false` excludes the strategy from live execution. This provides a three-gate safety mechanism.

---

## 3. Complete Field Reference

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `strat_code` | integer | Unique strategy ID. Also used as IB `clientId` for orders. Range: 1001+ |
| `strat_name` | string | Human-readable name (e.g., "BO_1_v2", "IBS_24_2") |
| `active` | boolean | Whether strategy is active |
| `tested` | boolean | Whether strategy passed backtesting |
| `prod` | boolean | Whether strategy is approved for production |
| `symbol` | string | Trading symbol (e.g., "MNQ", "ES", "MGC", "NQ") |
| `secType` | string | IB security type. One of: `"FUT"`, `"STK"`, `"OPT"`, `"CASH"` |
| `exchange` | string | Exchange code (e.g., "CME", "COMEX", "GLOBEX") |
| `currency` | string | Currency code (default: "USD") |
| `multiplier` | integer | Contract multiplier (e.g., 2 for MNQ, 5 for NQ, 10 for MGC) |
| `minTick` | number | Minimum price increment (e.g., 0.25 for MNQ, 0.1 for MGC) |
| `process_freq` | string | Primary bar timeframe. See [Supported Timeframes](#supported-timeframes) |
| `ind_list` | object | Indicators grouped by timeframe. See [Indicators](#4-indicators) |
| `long_conds` | array | Entry conditions for LONG positions. See [Conditions](#5-conditions) |
| `short_conds` | array | Entry conditions for SHORT positions (empty array `[]` = long-only) |
| `stop_loss_init` | object | Initial stop loss configuration. See [Stop Loss & Take Profit](#6-stop-loss--take-profit) |
| `take_profit_init` | object | Initial take profit configuration. See [Stop Loss & Take Profit](#6-stop-loss--take-profit) |
| `control_params` | object | Backtest reference metrics. See [Control Parameters](#9-control-parameters-backtest-metrics) |

### Optional Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `rolling_days` | integer | none | Days before expiry to roll to next futures contract |
| `UTC_tz` | integer | none | UTC timezone offset for the instrument (e.g., -6 for CT) |
| `trading_hours` | object/null | null | Entry/exit time window restrictions |
| `max_shift` | [int, string] | none | Maximum lookback shift as `[bars, timeframe]` |
| `max_timePeriod` | integer | none | Maximum indicator warmup period needed |
| `exit_conds` | array | [] | Exit conditions. See [Conditions](#5-conditions) |
| `stop_loss_mgmt` | object | none | Breakeven & trailing stop config. See [Stop Loss Management](#7-stop-loss-management) |
| `order_params` | object | none | Order execution constraints. See [Order Parameters](#8-order-parameters) |

### Supported Timeframes

Timeframe strings used in `process_freq`, `ind_list` keys, and condition references:

```
"1 min"     "2 mins"    "5 mins"    "10 mins"   "15 mins"   "20 mins"   "30 mins"
"1 hour"    "2 hours"   "4 hours"   "8 hours"
"1 day"
```

### Trading Hours

Controls when entries and exits are allowed. Three formats:

**Disabled (default):**
```json
"trading_hours": null
```

**Legacy format (same window for entries and exits):**
```json
"trading_hours": {
  "start": "08:00",
  "end": "17:00"
}
```

**Granular format (separate windows):**
```json
"trading_hours": {
  "mode": "granular",
  "entries": { "start": "08:00", "end": "16:00" },
  "exits":   { "start": "00:00", "end": "22:50" }
}
```

### max_shift

Tells the system how many bars of historical data conditions need to look back:

```json
"max_shift": [3, "4 hours"]
```

- First element: number of bars to look back
- Second element: the timeframe those bars belong to
- Must be >= the largest `shift_1` or `shift_2` used in any condition

### max_timePeriod

Maximum indicator lookback period across all indicators in the strategy. Used to calculate how many historical bars to fetch. Must be >= the largest `timePeriod_N` of any indicator:

```json
"max_timePeriod": 20
```

---

## 4. Indicators

Indicators are defined in the `ind_list` object, grouped by timeframe. Each entry specifies the indicator type and its parameters.

### Structure

```json
"ind_list": {
  "<timeframe>": [
    {
      "indicator": "<INDICATOR_NAME>",
      "params": {
        "<param_1>": <value>,
        "<param_2>": <value>,
        "indCode": "<unique_identifier>"
      }
    }
  ]
}
```

**Critical**: Every indicator MUST have a unique `indCode` in its params. This is the name used to reference the indicator output in conditions.

### Price Input Parameters

The `price_1`, `price_2`, `price_3` parameters accept:

- **OHLCV columns**: `"open"`, `"high"`, `"low"`, `"close"`, `"volume"`
- **Another indicator's indCode**: enables **indicator chaining** (e.g., RSI of a median price)

When using another indicator's indCode as price input, that indicator must be defined earlier in the same timeframe's list, or in a different timeframe (cross-timeframe dependency - resolved automatically via asof join).

---

### Single-Output Indicators

These produce one array of values, referenced directly by their `indCode`.

#### PRICE
Direct access to OHLCV data as an indicator column.

```json
{
  "indicator": "PRICE",
  "params": {
    "price_1": "close",       // "open", "high", "low", "close"
    "timePeriod_1": 10,        // used for warmup calculation
    "indCode": "CLOSE_4h"
  }
}
```

#### RSI (Relative Strength Index)
```json
{
  "indicator": "RSI",
  "params": {
    "price_1": "close",       // price source (or another indCode)
    "timePeriod_1": 14,        // lookback period
    "indCode": "RSI_14_4h"
  }
}
```

#### SMA (Simple Moving Average)
```json
{
  "indicator": "SMA",
  "params": {
    "price_1": "close",
    "timePeriod_1": 200,
    "indCode": "SMA_200_1D"
  }
}
```

#### EMA (Exponential Moving Average)
```json
{
  "indicator": "EMA",
  "params": {
    "price_1": "close",
    "timePeriod_1": 20,
    "indCode": "EMA_20_4h"
  }
}
```

#### ATR (Average True Range)
```json
{
  "indicator": "ATR",
  "params": {
    "price_1": "high",
    "price_2": "low",
    "price_3": "close",
    "timePeriod_1": 20,
    "indCode": "ATR_20_4h_SL"
  }
}
```

#### NATR (Normalized ATR)
```json
{
  "indicator": "NATR",
  "params": {
    "price_1": "high",
    "price_2": "low",
    "price_3": "close",
    "timePeriod_1": 14,
    "indCode": "NATR_14_4h"
  }
}
```

#### TRANGE (True Range)
```json
{
  "indicator": "TRANGE",
  "params": {
    "price_1": "high",
    "price_2": "low",
    "price_3": "close",
    "indCode": "TRANGE_4h"
  }
}
```
No `timePeriod` needed.

#### ADX (Average Directional Index)
```json
{
  "indicator": "ADX",
  "params": {
    "price_1": "high",
    "price_2": "low",
    "price_3": "close",
    "timePeriod_1": 20,
    "indCode": "ADX_20_4h"
  }
}
```

#### PLUS_DI (Plus Directional Indicator)
```json
{
  "indicator": "PLUS_DI",
  "params": {
    "price_1": "high",
    "price_2": "low",
    "price_3": "close",
    "timePeriod_1": 14,
    "indCode": "PLUS_DI_14_4h"
  }
}
```

#### MINUS_DI (Minus Directional Indicator)
```json
{
  "indicator": "MINUS_DI",
  "params": {
    "price_1": "high",
    "price_2": "low",
    "price_3": "close",
    "timePeriod_1": 14,
    "indCode": "MINUS_DI_14_4h"
  }
}
```

#### CCI (Commodity Channel Index)
```json
{
  "indicator": "CCI",
  "params": {
    "price_1": "high",
    "price_2": "low",
    "price_3": "close",
    "timePeriod_1": 14,
    "indCode": "CCI_14_4h"
  }
}
```

#### WILLR (Williams %R)
```json
{
  "indicator": "WILLR",
  "params": {
    "price_1": "high",
    "price_2": "low",
    "price_3": "close",
    "timePeriod_1": 14,
    "indCode": "WILLR_14_4h"
  }
}
```

#### ULTOSC (Ultimate Oscillator)
```json
{
  "indicator": "ULTOSC",
  "params": {
    "price_1": "high",
    "price_2": "low",
    "price_3": "close",
    "timePeriod_1": 7,        // short period
    "timePeriod_2": 14,       // medium period
    "timePeriod_3": 28,       // long period
    "indCode": "ULTOSC_4h"
  }
}
```

#### PMax (Period Maximum - Rolling High)
```json
{
  "indicator": "PMax",
  "params": {
    "price_1": "high",        // price source
    "timePeriod_1": 20,        // lookback window
    "indCode": "PMax_20_4h"
  }
}
```

#### PMin (Period Minimum - Rolling Low)
```json
{
  "indicator": "PMin",
  "params": {
    "price_1": "close",
    "timePeriod_1": 5,
    "indCode": "PMin_5_1D"
  }
}
```

#### BEARS_POWER
Bears Power = Low - EMA(Close)

```json
{
  "indicator": "BEARS_POWER",
  "params": {
    "price_1": "low",
    "timePeriod_1": 14,        // EMA period applied to close
    "indCode": "BP_14_1D"
  }
}
```

#### ULCER_INDEX
Measures downside risk (or upside risk).

```json
{
  "indicator": "ULCER_INDEX",
  "params": {
    "price_1": "close",
    "timePeriod_1": 169,
    "risk": "DOWN",            // "DOWN" = drawdown risk, "UP" = run-up risk
    "indCode": "ULCER_D_169_4h"
  }
}
```

#### price_formula (Custom Formula)
Execute arbitrary OHLC arithmetic expressions. Variables available: `open`, `high`, `low`, `close`.

```json
{
  "indicator": "price_formula",
  "params": {
    "formula": "(close-low)/(high-low)",
    "timePeriod_1": 1,
    "indCode": "IBS_1D"
  }
}
```

More formula examples:
- `"(high+low)/2"` -- Median price
- `"(high+low+close)/3"` -- Typical price
- `"close-open"` -- Body size
- `"high-low"` -- Bar range

#### SUPERTREND
Trend-following indicator based on ATR bands.

```json
{
  "indicator": "SUPERTREND",
  "params": {
    "price_1": "high",
    "price_2": "low",
    "price_3": "close",
    "timePeriod_1": 10,        // ATR period
    "multiplier": 3.0,         // band multiplier
    "indCode": "ST_10_3_4h"
  }
}
```

#### SRPERCENTRANK (Support/Resistance Percent Rank)
Ranks current close position within recent high-low range (0-100).

```json
{
  "indicator": "SRPERCENTRANK",
  "params": {
    "price_1": "close",
    "timePeriod_1": 20,        // lookback window
    "indCode": "SRPR_20_4h"
  }
}
```

#### DATA (Warmup Override)
Does NOT produce a column. Used only to force additional warmup bars when needed.

```json
{
  "indicator": "DATA",
  "params": {
    "timePeriod_1": 200,       // forces 200 bars of warmup data
    "indCode": "DATA_warmup"
  }
}
```

---

### Multi-Output Indicators

These produce multiple columns. The `indCode` MUST start with `"MULT_"` followed by a suffix. Output columns are named automatically using that suffix.

#### MACD (Moving Average Convergence Divergence)

```json
{
  "indicator": "MACD",
  "params": {
    "price_1": "close",
    "timePeriod_1": 12,        // fast period
    "timePeriod_2": 26,        // slow period
    "signalPeriod": 9,         // signal line period
    "indCode": "MULT_1D"       // suffix = "1D"
  }
}
```

**Output columns** (using suffix "1D"):
- `macd_1D` -- MACD line
- `macdsignal_1D` -- Signal line
- `macdhist_1D` -- Histogram

#### STOCH (Stochastic Oscillator)

```json
{
  "indicator": "STOCH",
  "params": {
    "price_1": "high",
    "price_2": "low",
    "price_3": "close",
    "timePeriod_1": 5,         // fast K period
    "timePeriod_2": 3,         // slow K period
    "periodType_1": 0,         // slow K MA type (0=SMA, 1=EMA)
    "timePeriod_3": 3,         // slow D period
    "periodType_2": 0,         // slow D MA type (0=SMA, 1=EMA)
    "indCode": "MULT_4h"       // suffix = "4h"
  }
}
```

**Output columns** (using suffix "4h"):
- `stoch_slowk_4h` -- Slow %K
- `stoch_slowd_4h` -- Slow %D

#### BBANDS (Bollinger Bands)

```json
{
  "indicator": "BBANDS",
  "params": {
    "price_1": "close",
    "timePeriod_1": 20,        // moving average period
    "nbdevup": 2,              // upper band standard deviations
    "nbdevdn": 2,              // lower band standard deviations
    "indCode": "MULT_1h"       // suffix = "1h"
  }
}
```

**Output columns** (using suffix "1h"):
- `BBAND_upperband_1h`
- `BBAND_middleband_1h`
- `BBAND_lowerband_1h`

#### KELTNER_CHANNELS

```json
{
  "indicator": "KELTNER_CHANNELS",
  "params": {
    "price_1": "high",
    "price_2": "low",
    "price_3": "close",
    "timePeriod_1": 37,        // EMA period (applied to typical price)
    "timePeriod_2": 37,        // ATR period
    "multiplier": 2.5,         // band width multiplier
    "indCode": "MULT_4h"       // suffix = "4h"
  }
}
```

**Output columns** (using suffix "4h"):
- `KC_middle_band_4h`
- `KC_upper_band_4h`
- `KC_lower_band_4h`

#### ICHIMOKU

```json
{
  "indicator": "ICHIMOKU",
  "params": {
    "price_1": "high",
    "price_2": "low",
    "price_3": "close",
    "timePeriod_1": 9,                 // Tenkan-sen period
    "timePeriod_2": 26,                // Kijun-sen period
    "senkou_span_b_period": 52,        // Senkou Span B period
    "senkou_span_a_shift": 26,         // Senkou Span A displacement
    "senkou_span_b_shift": 26,         // Senkou Span B displacement
    "chikou_span_shift": 26,           // Chikou Span displacement
    "indCode": "MULT_1D"              // suffix = "1D"
  }
}
```

**Output columns** (using suffix "1D"):
- `tenkan_sen_1D`
- `kijun_sen_1D`
- `senkou_span_a_1D`
- `senkou_span_b_1D`
- `chikou_span_1D`

---

### Summary: All Indicators

| Indicator | Category | Inputs | Outputs | Key Params |
|-----------|----------|--------|---------|------------|
| PRICE | Data | price_1 | 1 | timePeriod_1 |
| price_formula | Custom | formula | 1 | formula, timePeriod_1 |
| DATA | Warmup | - | 0 | timePeriod_1 |
| RSI | Momentum | price_1 | 1 | timePeriod_1 |
| SMA | Trend | price_1 | 1 | timePeriod_1 |
| EMA | Trend | price_1 | 1 | timePeriod_1 |
| ATR | Volatility | price_1,2,3 | 1 | timePeriod_1 |
| NATR | Volatility | price_1,2,3 | 1 | timePeriod_1 |
| TRANGE | Volatility | price_1,2,3 | 1 | - |
| ADX | Trend | price_1,2,3 | 1 | timePeriod_1 |
| PLUS_DI | Trend | price_1,2,3 | 1 | timePeriod_1 |
| MINUS_DI | Trend | price_1,2,3 | 1 | timePeriod_1 |
| CCI | Momentum | price_1,2,3 | 1 | timePeriod_1 |
| WILLR | Momentum | price_1,2,3 | 1 | timePeriod_1 |
| ULTOSC | Momentum | price_1,2,3 | 1 | timePeriod_1,2,3 |
| PMax | Custom | price_1 | 1 | timePeriod_1 |
| PMin | Custom | price_1 | 1 | timePeriod_1 |
| BEARS_POWER | Custom | price_1 | 1 | timePeriod_1 |
| ULCER_INDEX | Risk | price_1 | 1 | timePeriod_1, risk |
| SUPERTREND | Trend | price_1,2,3 | 1 | timePeriod_1, multiplier |
| SRPERCENTRANK | Custom | price_1 | 1 | timePeriod_1 |
| MACD | Momentum | price_1 | 3 | timePeriod_1,2, signalPeriod |
| STOCH | Momentum | price_1,2,3 | 2 | timePeriod_1,2,3, periodType_1,2 |
| BBANDS | Volatility | price_1 | 3 | timePeriod_1, nbdevup, nbdevdn |
| KELTNER_CHANNELS | Volatility | price_1,2,3 | 3 | timePeriod_1,2, multiplier |
| ICHIMOKU | Trend | price_1,2,3 | 5 | timePeriod_1,2, senkou/chikou params |

---

## 5. Conditions

Conditions define the logic that generates trading signals. They are placed in three arrays:

- `long_conds` -- ALL must be true to trigger a LONG entry
- `short_conds` -- ALL must be true to trigger a SHORT entry
- `exit_conds` -- Uses group logic (AND within group, OR across groups)

### Condition Object Structure

```json
{
  "cond_type": "<type>",           // REQUIRED
  "cond": "<expression>",         // REQUIRED
  "condCode": "<unique_id>",      // REQUIRED
  "shift_1": 0,                   // optional, default 0
  "shift_2": 0,                   // optional, default 0
  "group": 1,                     // optional, exit grouping
  "mode": "normal",               // optional, "normal" or "force"
  "strat": "1001"                 // optional, for num_bars only
}
```

### Shift Behavior

- `shift_1`: Lookback for the LEFT operand. `shift_1=3` means "value from 3 bars ago"
- `shift_2`: Lookback for the RIGHT operand. `shift_2=0` means "current bar value"
- Shift 0 actually reads position `[-1]` (most recent completed bar), shift 1 reads `[-2]`, etc.

### Entry Logic

```
LONG signal  = long_conds[0] AND long_conds[1] AND ... AND long_conds[N]
SHORT signal = short_conds[0] AND short_conds[1] AND ... AND short_conds[N]
```

All conditions must be true simultaneously. Use `[]` for either array to disable that direction.

### Exit Logic

Exit conditions support grouped evaluation:

1. **Force mode**: Any condition with `"mode": "force"` that evaluates to true triggers an immediate exit, regardless of groups
2. **Group logic**: Conditions within the same `group` number are ANDed together. Groups are ORed against each other
3. **Null group**: Conditions without a `group` act as standalone singleton groups (individual OR behavior)

```
EXIT signal = (force_cond_1 OR force_cond_2 OR ...)
              OR
              (group_1_cond_A AND group_1_cond_B)
              OR
              (group_2_cond_A)
              OR
              (singleton_cond)
```

---

### Condition Types

#### num_relation -- Indicator vs Numeric Threshold

Compares an indicator value against a fixed number.

```json
{
  "cond_type": "num_relation",
  "cond": "ADX_20_4h < 20",
  "shift_1": 3,
  "condCode": "long_1"
}
```

**Syntax**: `"<indCode> <operator> <number>"`
**Operators**: `>`, `<`, `>=`, `<=`, `==`, `!=`
**shift_1**: Applied to the indicator. shift_2 is ignored.

#### ind_relation -- Indicator vs Indicator

Compares two indicator values (or an indicator against another indicator from any timeframe).

```json
{
  "cond_type": "ind_relation",
  "cond": "CLOSE_4h > PMax_20_4h",
  "shift_1": 1,
  "shift_2": 2,
  "condCode": "long_2"
}
```

**Syntax**: `"<indCode_1> <operator> <indCode_2>"`
**Operators**: `>`, `<`, `>=`, `<=`, `==`, `!=`
**shift_1**: Applied to the LEFT indicator.
**shift_2**: Applied to the RIGHT indicator.

#### price_relation -- Indicator vs Raw Price

Compares an indicator against a raw OHLC price from a specific timeframe.

```json
{
  "cond_type": "price_relation",
  "cond": "EMA_20_4h > close_4h",
  "shift_1": 2,
  "shift_2": 2,
  "condCode": "long_3"
}
```

**Syntax**: `"<indCode> <operator> <priceType>_<timeframe>"`
- `priceType`: `open`, `high`, `low`, `close`
- `timeframe`: Must match a key in `ind_list` (e.g., `4h`, `1D`)
**shift_1**: Applied to the indicator.
**shift_2**: Applied to the price.

#### p2p_relation -- Price vs Price

Compares two raw OHLC prices, potentially from different timeframes.

```json
{
  "cond_type": "p2p_relation",
  "cond": "close_4h > high_1D",
  "shift_1": 2,
  "shift_2": 3,
  "condCode": "long_4"
}
```

**Syntax**: `"<priceType_1>_<tf_1> <operator> <priceType_2>_<tf_2>"`
**shift_1**: Applied to the LEFT price.
**shift_2**: Applied to the RIGHT price.

#### cross_num_relation -- Indicator Crosses Numeric Threshold

Detects when an indicator CROSSES a threshold value (was on one side, now on the other).

```json
{
  "cond_type": "cross_num_relation",
  "cond": "RSI_14_4h above 30",
  "shift_1": 2,
  "condCode": "long_5"
}
```

**Syntax**: `"<indCode> <above|bellow> <number>"`
**Operators**: `above` (crosses from below to above), `bellow` (crosses from above to below)
**Logic**: `past_value` was NOT above/below threshold AND `current_value` IS above/below threshold.
**Extra bars**: Reads 1 extra bar behind `shift_1` to detect the cross.

#### cross_ind_relation -- Indicator Crosses Indicator

Detects when one indicator crosses another indicator.

```json
{
  "cond_type": "cross_ind_relation",
  "cond": "macd_1D above macdsignal_1D",
  "shift_1": 2,
  "shift_2": 2,
  "condCode": "long_6"
}
```

**Syntax**: `"<indCode_1> <above|bellow> <indCode_2>"`
**Logic**: Previous bar: ind_1 was NOT above/below ind_2. Current bar: ind_1 IS above/below ind_2.
**Extra bars**: Reads 1 extra bar behind each shift to detect the cross.

#### cross_price_relation -- Indicator Crosses Price

Detects when an indicator crosses a raw OHLC price level.

```json
{
  "cond_type": "cross_price_relation",
  "cond": "EMA_20_4h above close_1D",
  "shift_1": 2,
  "shift_2": 2,
  "condCode": "long_7"
}
```

**Syntax**: `"<indCode> <above|bellow> <priceType>_<timeframe>"`
**Logic**: Same crossing detection as cross_ind_relation but with a raw price as the second operand.
**Extra bars**: Reads 1 extra bar behind each shift.

#### ind_direction -- Indicator Changes Direction

Detects when an indicator reverses direction (was going up, now going down, or vice versa).

```json
{
  "cond_type": "ind_direction",
  "cond": "RSI_MED_14_1D downwards",
  "shift_1": 4,
  "condCode": "exit_1b"
}
```

**Syntax**: `"<indCode> <upwards|downwards>"`
**Logic** for `upwards`: value[t-2] > value[t-1] (was falling) AND value[t-1] < value[t] (now rising)
**Logic** for `downwards`: value[t-2] < value[t-1] (was rising) AND value[t-1] > value[t] (now falling)
**Extra bars**: Reads 2 extra bars behind `shift_1` to detect direction change.
**shift_2**: Ignored (auto-set to 0).

#### num_bars -- Time-Based Exit

Triggers an exit after the position has been held for N bars. Only valid in `exit_conds`.

```json
{
  "cond_type": "num_bars",
  "cond": "12",
  "strat": "1001",
  "condCode": "exit_2",
  "group": 2
}
```

**Syntax**: `"<number_of_bars>"`
**`strat`**: Strategy code to check active bars for (should match the strategy's own `strat_code`).
**Logic**: Queries the database for how many bars the current position has been active. If `active_bars >= cond`, returns true.
**Shifts**: Both auto-set to 0.

---

### Conditions Summary Table

| cond_type | Operand 1 | Operator | Operand 2 | Extra Bars | Use Case |
|-----------|-----------|----------|-----------|------------|----------|
| num_relation | indicator | > < >= <= == != | number | 0 | Threshold filters (RSI < 30) |
| ind_relation | indicator | > < >= <= == != | indicator | 0 | Relative comparisons |
| price_relation | indicator | > < >= <= == != | raw price | 0 | Price vs indicator |
| p2p_relation | raw price | > < >= <= == != | raw price | 0 | Cross-timeframe price |
| cross_num_relation | indicator | above / bellow | number | 1 | Threshold crossovers |
| cross_ind_relation | indicator | above / bellow | indicator | 1 | Indicator crossovers |
| cross_price_relation | indicator | above / bellow | raw price | 1 | Price crossovers |
| ind_direction | indicator | upwards / downwards | - | 2 | Direction reversals |
| num_bars | bar_count | >= | number | 0 | Time-based exits |

---

## 6. Stop Loss & Take Profit

Both `stop_loss_init` and `take_profit_init` share the same structure. Exactly ONE method must be set to `true`.

### Structure

```json
{
  "indicator": false,
  "indicator_params": {},
  "pips": false,
  "pips_params": {},
  "percent": false,
  "percent_params": {}
}
```

### Method 1: Indicator-Based (Most Common)

Uses a calculated indicator value multiplied by a factor.

```json
{
  "indicator": true,
  "indicator_params": {
    "multiple": 1.1,           // multiplier applied to indicator value
    "tf": "4 hours",           // timeframe containing the indicator
    "col": "ATR_20_4h_SL"     // indCode of the indicator to use
  },
  "pips": false,
  "pips_params": {},
  "percent": false,
  "percent_params": {}
}
```

**Formulas**:
- LONG SL = Entry Price - (multiple x indicator_value)
- SHORT SL = Entry Price + (multiple x indicator_value)
- LONG TP = Entry Price + (multiple x indicator_value)
- SHORT TP = Entry Price - (multiple x indicator_value)

**Important**: The indicator referenced by `col` MUST be defined in `ind_list` under the timeframe specified by `tf`.

### Method 2: Pips-Based

Fixed distance in pips from entry.

```json
{
  "indicator": false,
  "indicator_params": {},
  "pips": true,
  "pips_params": {
    "pip_value": 50,           // number of pips
    "pip_size": 0.25           // size of one pip
  },
  "percent": false,
  "percent_params": {}
}
```

**Formulas**:
- LONG SL = Entry Price - (pip_value x pip_size)
- SHORT SL = Entry Price + (pip_value x pip_size)

### Method 3: Percent-Based

Percentage distance from entry.

```json
{
  "indicator": false,
  "indicator_params": {},
  "pips": false,
  "pips_params": {},
  "percent": true,
  "percent_params": {
    "percent": 0.02            // 2% from entry
  }
}
```

**Formulas**:
- LONG SL = Entry Price x (1 - percent)
- SHORT SL = Entry Price x (1 + percent)

### Tick Rounding

All SL/TP prices are automatically rounded to the nearest `minTick` increment before order placement.

---

## 7. Stop Loss Management

Optional dynamic stop loss adjustments after entry. Managed by the RiskManager component (runs every 5 seconds).

```json
"stop_loss_mgmt": {
  "breakeven": {
    "action": false,           // enable/disable breakeven
    "profitRatio": 0.2         // profit target ratio
  },
  "trailing": {
    "action": false,           // enable/disable trailing stop
    "trailingRatio": 0.8       // trailing aggressiveness
  }
}
```

### Breakeven

When enabled, moves the stop loss to entry price once the position reaches a certain profit threshold.

- `profitRatio`: Fraction of the distance to TP that triggers breakeven move
- Example: profitRatio=0.2 with TP 100 ticks away triggers breakeven when price moves 20 ticks in favor

### Trailing Stop

When enabled, progressively tightens the stop loss as price moves favorably.

- `trailingRatio`: Controls aggressiveness (exponential curve)
- Higher values = more aggressive trailing (stop moves closer to price faster)

---

## 8. Order Parameters

```json
"order_params": {
  "max_rpo": 1,                // max contracts per operation
  "min_volume": 1              // minimum contract units
}
```

- `max_rpo` (max risk per operation): Caps the number of contracts the position sizer can allocate to a single trade
- `min_volume`: Minimum number of contracts (floor for position sizing)

The actual position size is calculated by the PositionSizer using Half-Kelly criterion, then clamped between `min_volume` and `max_rpo`.

---

## 9. Control Parameters (Backtest Metrics)

Static reference data from backtesting. Used for:
- Performance deviation monitoring (comparing live vs backtest metrics)
- Strategy qualification and documentation
- Position sizing (Kelly fraction)

```json
"control_params": {
  "strategy": 1001,
  "strategy_filename": "1001.py",
  "symbol": "MNQ",
  "start_date": "2015-01-01",
  "end_date": "2024-01-01",
  "timestamp": "2026-02-05 18:12:46",
  "primary_timeframe": "4 hours",
  "slippage_amount": 0.5,
  "comm_per_contract": 0.62,
  "metrics": {
    "total_trades": 243,
    "winning_trades": 105,
    "losing_trades": 138,
    "breakeven_trades": 0,
    "win_rate": 43.21,
    "total_pnl": 5639.18,
    "total_gross_pnl": 6426.5,
    "total_slippage": 486.0,
    "total_commission": 301.32,
    "avg_win": 201.436,
    "avg_win_pct": 0.892,
    "avg_loss": -112.403,
    "avg_loss_pct": 0.498,
    "profit_factor": 1.364,
    "max_drawdown": 1555.54,
    "max_drawdown_pct": 6.887,
    "max_winning_streak": 7,
    "avg_winning_streak": 1.842,
    "max_losing_streak": 9,
    "avg_losing_streak": 2.464,
    "return_drawdown_ratio": 3.625,
    "ppr": 23.207,
    "avg_initial_risk": 119.208,
    "rr_percent": 19.467,
    "kelly_fraction": 0.115,
    "half_kelly": 0.058,
    "sqn": 1.716,
    "sharpe_ratio": 0.572,
    "sortino_ratio": 1.274,
    "avg_trades_year": 27.002,
    "avg_bars_active": 7.074,
    "annualized_return": 626.623,
    "annualized_return_pct": 2.774,
    "sl_exits": 130,
    "sl_be_exits": 0,
    "sl_tsl_exits": 0,
    "tp_exits": 23,
    "num_bars_exits": 90,
    "exit_condition_exits": 0,
    "backtest_end_exits": 0,
    "be_triggered_count": 0,
    "tsl_activated_count": 0,
    "avg_position_size": 1.0,
    "min_position_size": 1,
    "max_position_size": 1,
    "total_contracts_traded": 243
  }
}
```

### Key Metrics for Live Monitoring

| Metric | Live Use |
|--------|----------|
| `win_rate` | Compared against live win rate for deviation alerts |
| `max_losing_streak` | Triggers alert if live streak exceeds backtest |
| `kelly_fraction` / `half_kelly` | Used by PositionSizer for dynamic sizing |
| `sl_exits`, `tp_exits`, `num_bars_exits`, `exit_condition_exits` | Exit type ratios compared vs live |

---

## 10. Processing Pipeline Overview

Understanding how the engine processes a strategy file at each bar:

```
1. BarStreamer detects bar close
2. PipelineRunner creates async task per strategy
3. MarketManager checks: has open position?
   |
   NO position:                    YES position:
   Process ENTRIES only            Process EXITS only
   |                               |
4. INDICATORS class:               4. INDICATORS class:
   - Fetch market data per tf      - Same
   - Calculate all indicators      - Same
   - Resolve cross-tf deps         - Same
   |                               |
5. STRATEGIES class:               5. STRATEGIES class:
   - Evaluate long_conds           - Evaluate exit_conds
   - Evaluate short_conds          - Apply group/force logic
   - ALL must be true              |
   |                               6. If exit signal:
6. If entry signal:                   - Cancel existing TP/SL
   - Calculate SL/TP levels           - Place opposite market order
   - Calculate position size           - Record closure in DB
   - Place bracket order
   - Record opening in DB
```

### Bracket Order Structure

When an entry signal fires:
1. **Parent order**: Market order (entry) -- `transmit=False`
2. **Take Profit**: Limit order at TP level -- `transmit=False`
3. **Stop Loss**: Stop order at SL level -- `transmit=True` (arms the bracket)

All three are linked via an OCA (One Cancels All) group: `OCA_{strat_code}_{entry_order_id}`.

---

## 11. Advanced Patterns

### Indicator Chaining

Use one indicator's output as input to another by referencing its `indCode` in a `price_1` parameter:

```json
"ind_list": {
  "1 day": [
    {
      "indicator": "price_formula",
      "params": {
        "formula": "(high+low)/2",
        "timePeriod_1": 1,
        "indCode": "MEDIAN_1D"
      }
    },
    {
      "indicator": "RSI",
      "params": {
        "price_1": "MEDIAN_1D",    // <-- uses previous indicator's output
        "timePeriod_1": 14,
        "indCode": "RSI_MED_14_1D"
      }
    }
  ]
}
```

**Rule**: The source indicator must appear BEFORE the consumer in the same timeframe array. Cross-timeframe chaining is also supported (the system resolves dependencies automatically via asof join).

### Multi-Timeframe Strategies

A single strategy can use indicators from multiple timeframes. The `ind_list` simply has multiple keys:

```json
"ind_list": {
  "4 hours": [
    { "indicator": "ADX", "params": { ... "indCode": "ADX_20_4h" } },
    { "indicator": "ATR", "params": { ... "indCode": "ATR_20_4h_SL" } }
  ],
  "1 day": [
    { "indicator": "PRICE", "params": { ... "indCode": "LOW_1D" } }
  ]
}
```

Conditions can freely reference indicators from any timeframe. The system fetches data for each timeframe independently and makes all indicator columns available for condition evaluation.

### Cross-Timeframe Indicator Dependencies

An indicator on one timeframe can use an indicator from a different timeframe as input:

```json
"ind_list": {
  "1 day": [
    { "indicator": "SMA", "params": { "price_1": "close", "timePeriod_1": 200, "indCode": "SMA_200_1D" } }
  ],
  "4 hours": [
    { "indicator": "RSI", "params": { "price_1": "SMA_200_1D", "timePeriod_1": 14, "indCode": "RSI_SMA_14_4h" } }
  ]
}
```

The system automatically detects cross-timeframe dependencies, processes timeframes in topological order, and joins cross-timeframe columns using an asof (backward) join on the date column.

### Long-Only vs Long-Short Strategies

**Long-only** (most common):
```json
"long_conds": [ ... ],
"short_conds": []
```

**Long-short**:
```json
"long_conds": [ { ... entry conditions for longs ... } ],
"short_conds": [ { ... entry conditions for shorts ... } ]
```

Both directions are evaluated independently. Only one can fire per bar (long and short are mutually exclusive signals).

### Complex Exit Groups

Example: Exit when (IBS > 0.8 AND RSI reverses) OR (held for 23 bars):

```json
"exit_conds": [
  {
    "cond_type": "num_relation",
    "cond": "IBS_1D > 0.8",
    "shift_1": 2,
    "condCode": "exit_1a",
    "group": 1                     // group 1: AND-ed together
  },
  {
    "cond_type": "ind_direction",
    "cond": "RSI_MED_14_1D downwards",
    "shift_1": 4,
    "condCode": "exit_1b",
    "group": 1                     // group 1: AND-ed together
  },
  {
    "cond_type": "num_bars",
    "cond": "23",
    "strat": "1017",
    "condCode": "exit_2",
    "group": 2                     // group 2: OR-ed against group 1
  }
]
```

### Force Exit

An exit condition with `"mode": "force"` overrides all group logic:

```json
{
  "cond_type": "num_relation",
  "cond": "ATR_20_4h > 500",
  "shift_1": 0,
  "condCode": "exit_emergency",
  "mode": "force"
}
```

If this condition is true, the position exits immediately regardless of any other conditions.

---

## 12. Complete Annotated Example

A full strategy file with annotations:

```json
{
  "$schema": "./schema.json",

  // === IDENTIFICATION ===
  "strat_code": 1001,
  "strat_name": "BO_1_v2",
  "active": true,
  "tested": true,
  "prod": true,

  // === CONTRACT ===
  "symbol": "MNQ",
  "secType": "FUT",
  "exchange": "CME",
  "currency": "USD",
  "multiplier": 2,
  "minTick": 0.25,
  "rolling_days": 5,

  // === SCHEDULE ===
  "process_freq": "4 hours",
  "UTC_tz": -6,
  "trading_hours": null,

  // === DATA REQUIREMENTS ===
  "max_shift": [3, "4 hours"],
  "max_timePeriod": 20,

  // === INDICATORS ===
  "ind_list": {
    "4 hours": [
      {
        "indicator": "ADX",
        "params": {
          "price_1": "high", "price_2": "low", "price_3": "close",
          "timePeriod_1": 20,
          "indCode": "ADX_20_4h"
        }
      },
      {
        "indicator": "PMax",
        "params": {
          "price_1": "high",
          "timePeriod_1": 20,
          "indCode": "PMax_20_4h"
        }
      },
      {
        "indicator": "PRICE",
        "params": {
          "price_1": "close",
          "timePeriod_1": 10,
          "indCode": "CLOSE_4h"
        }
      },
      {
        "indicator": "ATR",
        "params": {
          "price_1": "high", "price_2": "low", "price_3": "close",
          "timePeriod_1": 20,
          "indCode": "ATR_20_4h_SL"
        }
      },
      {
        "indicator": "ATR",
        "params": {
          "price_1": "high", "price_2": "low", "price_3": "close",
          "timePeriod_1": 10,
          "indCode": "ATR_10_4h_TP"
        }
      }
    ],
    "1 day": [
      {
        "indicator": "PRICE",
        "params": {
          "price_1": "low",
          "timePeriod_1": 10,
          "indCode": "LOW_1D"
        }
      }
    ]
  },

  // === ENTRY CONDITIONS (ALL must be true for LONG) ===
  "long_conds": [
    {
      "cond_type": "num_relation",
      "cond": "ADX_20_4h < 20",
      "shift_1": 3,
      "condCode": "long_1"
    },
    {
      "cond_type": "ind_relation",
      "cond": "CLOSE_4h > PMax_20_4h",
      "shift_1": 1,
      "shift_2": 2,
      "condCode": "long_2"
    }
  ],

  // === NO SHORT ENTRIES ===
  "short_conds": [],

  // === EXIT CONDITIONS (group 1 OR group 2) ===
  "exit_conds": [
    {
      "cond_type": "ind_relation",
      "cond": "CLOSE_4h < LOW_1D",
      "shift_1": 2,
      "shift_2": 3,
      "condCode": "exit_1",
      "group": 1
    },
    {
      "cond_type": "num_bars",
      "cond": "12",
      "strat": "1001",
      "condCode": "exit_2",
      "group": 2
    }
  ],

  // === STOP LOSS (ATR-based, 1.1x ATR20) ===
  "stop_loss_init": {
    "indicator": true,
    "indicator_params": {
      "multiple": 1.1,
      "tf": "4 hours",
      "col": "ATR_20_4h_SL"
    },
    "pips": false, "pips_params": {},
    "percent": false, "percent_params": {}
  },

  // === TAKE PROFIT (ATR-based, 3.3x ATR10) ===
  "take_profit_init": {
    "indicator": true,
    "indicator_params": {
      "multiple": 3.3,
      "tf": "4 hours",
      "col": "ATR_10_4h_TP"
    },
    "pips": false, "pips_params": {},
    "percent": false, "percent_params": {}
  },

  // === SL MANAGEMENT (both disabled) ===
  "stop_loss_mgmt": {
    "breakeven": { "action": false, "profitRatio": 0.2 },
    "trailing": { "action": false, "trailingRatio": 0.8 }
  },

  // === ORDER PARAMETERS ===
  "order_params": {
    "max_rpo": 1,
    "min_volume": 1
  },

  // === BACKTEST METRICS ===
  "control_params": {
    "strategy": 1001,
    "strategy_filename": "1001.py",
    "symbol": "MNQ",
    "start_date": "2015-01-01",
    "end_date": "2024-01-01",
    "timestamp": "2026-02-05 18:12:46",
    "primary_timeframe": "4 hours",
    "slippage_amount": 0.5,
    "comm_per_contract": 0.62,
    "metrics": {
      "total_trades": 243,
      "winning_trades": 105,
      "losing_trades": 138,
      "win_rate": 43.21,
      "profit_factor": 1.364,
      "max_drawdown": 1555.54,
      "max_drawdown_pct": 6.887,
      "kelly_fraction": 0.115,
      "half_kelly": 0.058,
      "sqn": 1.716,
      "sharpe_ratio": 0.572,
      "sortino_ratio": 1.274,
      "avg_trades_year": 27.002,
      "sl_exits": 130,
      "tp_exits": 23,
      "num_bars_exits": 90,
      "exit_condition_exits": 0
    }
  }
}
```

**Strategy Logic Summary**:
- **Entry**: ADX below 20 (low trend strength) AND Close above 20-period high (breakout) -> LONG
- **Exit**: Close drops below daily low (group 1) OR position held for 12 bars (group 2)
- **SL**: 1.1 x ATR(20) below entry
- **TP**: 3.3 x ATR(10) above entry

---

## Appendix: Quick Reference Card

### Creating a New Strategy - Checklist

1. Choose a unique `strat_code` (next available number, e.g., 1018)
2. Name the file `<strat_code>.json` (e.g., `1018.json`)
3. Set `active: true`, `tested: false`, `prod: false` initially
4. Define the contract: symbol, secType, exchange, multiplier, minTick
5. Define indicators in `ind_list` grouped by timeframe
6. Set `max_timePeriod` >= largest `timePeriod_N` across all indicators
7. Define entry conditions in `long_conds` (and/or `short_conds`)
8. Set `max_shift` >= largest `shift_1`/`shift_2` across all conditions
9. Define exit conditions in `exit_conds` with group logic
10. Configure SL/TP using one of the three methods
11. Add `control_params` after backtesting
12. Set `tested: true` after backtest validation
13. Set `prod: true` after paper trading validation

### indCode Naming Convention (Recommended)

```
<INDICATOR>_<period>_<timeframe>[_<purpose>]

Examples:
  ATR_20_4h_SL     -- ATR(20) on 4h bars, used for stop loss
  RSI_14_1D        -- RSI(14) on daily bars
  CLOSE_4h         -- Close price on 4h bars
  IBS_1D           -- Internal Bar Strength on daily
  MULT_4h          -- Multi-output indicator on 4h (MACD, STOCH, etc.)
```

### Common Mistakes to Avoid

- Forgetting to add `"indCode"` to indicator params (causes silent failure)
- Using an `indCode` in a condition that is not defined in `ind_list`
- Setting `max_shift` lower than the actual shifts used in conditions
- Setting `max_timePeriod` lower than the actual indicator periods
- Referencing a SL/TP indicator `col` that does not exist in `ind_list`
- Using the same `indCode` for two different indicators (overwrites)
- For multi-output indicators: forgetting the `"MULT_"` prefix on indCode
- For cross conditions: using `"above"/"bellow"` (note: the system uses `"bellow"` not `"below"`)

---

## 13. Custom Indicators

When a strategy requires an indicator not available in the standard TA-Lib library, a custom indicator definition is embedded in the strategy JSON file.

### Field Schema

The `custom_indicators` field is an optional top-level object in the strategy JSON. Each key is the indicator name:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `module` | string | Yes | Python module path containing the indicator function |
| `function` | string | Yes | Function name to call (must follow standard interface) |
| `inputs` | array[string] | Yes | Input series names (e.g., `["close"]`, `["close", "volume"]`) |
| `outputs` | array[string] | Yes | Output series names (e.g., `["kama"]`, `["upper", "lower"]`) |

### Example Structure

```json
{
  "custom_indicators": {
    "KAMA": {
      "module": "custom_indicators.kama",
      "function": "calculate",
      "inputs": ["close"],
      "outputs": ["kama"]
    }
  }
}
```

### Standard Interface

Every custom indicator function must follow this contract:

- Accept a pandas DataFrame as first argument
- Accept keyword arguments for parameters
- Return a pandas DataFrame with named output columns
- Use vectorized operations (no row-by-row loops)
- Be deterministic (same input always produces same output)

### Registration and Discovery

Custom indicators are registered in the `custom_indicators` table in the Strategy Store:

| Column | Type | Description |
|--------|------|-------------|
| `name` | TEXT (UNIQUE) | Indicator name (e.g., "KAMA") |
| `description` | TEXT | What the indicator computes |
| `blocked_strategy_count` | INTEGER | Strategies waiting for this indicator |

When a strategy references an unknown indicator, the compiler:
1. Records the indicator in `custom_indicators` with status "missing"
2. Emits an `InfrastructureGapEvent` with `gap_type: "indicator"`
3. Sets the strategy status to "blocked"
4. After implementation, the indicator status updates to "implemented" and blocked strategies resume

### Allowlisting

Only indicators in the allowlist execute in the backtester sandbox. The `CustomIndicatorRegistry` validates each indicator module before loading. Indicators not in the registry are rejected at runtime.

---

## 14. Trade Filters

Trade filters are veto conditions that block trade signals before execution. They reduce false signals while preserving profitable trades.

### Field Schema

The `trade_filters` field is an optional top-level array in the strategy JSON:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `filter_type` | string | Yes | Filter type identifier (see Built-in Types below) |
| `filter_code` | string | Yes | Unique identifier for this filter instance (auto-generated if not provided) |
| `params` | object | Yes | Filter-specific parameters |

### Example Structure

```json
{
  "trade_filters": [
    {
      "filter_type": "time_filter",
      "filter_code": "time_filter_1",
      "params": {
        "allowed_hours": [9, 10, 11, 12, 13, 14],
        "blocked_days": [0, 4]
      }
    },
    {
      "filter_type": "volatility_filter",
      "filter_code": "vol_filter_1",
      "params": {
        "atr_period": 14,
        "max_atr_percentile": 90,
        "min_atr_percentile": 10
      }
    }
  ]
}
```

### Built-in Filter Types

#### time_filter

Restricts trading by time-of-day or day-of-week.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `allowed_hours` | array[int] | all hours | Hours when trading is allowed (0-23) |
| `blocked_hours` | array[int] | none | Hours when trading is blocked |
| `blocked_days` | array[int] | none | Days when trading is blocked (0=Mon, 6=Sun) |
| `session_start` | string | null | Session start time (HH:MM format) |
| `session_end` | string | null | Session end time (HH:MM format) |

#### volatility_filter

Blocks trades during extreme volatility conditions.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `atr_period` | int | 14 | ATR lookback period |
| `max_atr_percentile` | int | 95 | Block if ATR above this percentile |
| `min_atr_percentile` | int | 5 | Block if ATR below this percentile |
| `vix_max` | float | null | Block if VIX above threshold (equity only) |
| `vix_min` | float | null | Block if VIX below threshold |

#### trend_filter

Requires higher-timeframe trend alignment before entry.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `adx_period` | int | 14 | ADX lookback period |
| `adx_threshold` | float | 25.0 | Minimum ADX for trend confirmation |
| `ma_period` | int | 50 | Moving average period for slope detection |
| `require_alignment` | bool | true | Entry direction must match MA slope |

#### volume_filter

Ensures minimum liquidity conditions.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `min_volume` | int | null | Minimum bar volume |
| `volume_ma_period` | int | 20 | Volume moving average period |
| `min_relative_volume` | float | 0.5 | Minimum ratio vs volume MA |
| `spike_threshold` | float | 3.0 | Block on volume spikes above this multiplier |

### Custom Filter Authoring

To create a custom filter:

1. Define a filter class following the `TradeFilter` interface
2. Implement `evaluate(signal, market_data) -> bool` (True = allow, False = block)
3. Register the filter type in the filter registry
4. Reference via `filter_type` in the strategy JSON

Custom filters track statistics: `trades_blocked`, `trades_passed`, `effectiveness_ratio`.

### Effectiveness Metric

```
Effectiveness Ratio = (Reduction in Losing Trades) / (Reduction in Total Trades)
```

| Ratio | Assessment |
|-------|------------|
| > 2.0 | Excellent — removes losers disproportionately |
| > 1.5 | Good — acceptable for production use |
| 1.0-1.5 | Marginal — removes winners and losers equally |
| < 1.0 | Harmful — removes more winners than losers |

Quality gates: Only retain filters with effectiveness ratio > 1.5. Total trade reduction must not exceed 40%. Maximum 3 filters per strategy.
