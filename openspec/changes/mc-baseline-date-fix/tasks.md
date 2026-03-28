# Tasks: mc-baseline-date-fix

**Change:** Separate data loading for model fitting vs baseline backtest so that the baseline can cover dates before the fit_years window.

**Status:** DONE (Phase 1)

---

## Phase 1: Core Fix — Dual Data Load in mc_runner.py

**File:** `packages/montecarlo/runner/mc_runner.py`

**Problem:** Lines 184-199 load `hist_data_all` with `start_date=fit_start_date`. When the user's `start_date` is earlier than `fit_start_date` (e.g., start_date=2018-01-01 but fit_years=5 yields fit_start=2021-03-28), the baseline date-range filter at lines 229-252 operates on truncated data and returns fewer bars than expected (or raises "No data found").

**Tasks:**

- [x] **1.1** After the existing `hist_data_all` load (line 194-199), add a conditional second load when `start_date` is provided and falls before `fit_start_date`:
  ```python
  # After existing load (line 199)
  baseline_data_start = fit_start_date  # default: baseline uses same data
  if start_date and fit_start_date:
      if start_date < fit_start_date:
          print(f"  Baseline start {start_date} is before fit window {fit_start_date}, "
                f"loading extended data for baseline...")
          baseline_hist_data = preprocessor.load_and_resample(
              symbol=symbol,
              timeframes=timeframes,
              start_date=start_date,
              end_date=end_date,
          )
          baseline_data_start = start_date
      else:
          baseline_hist_data = hist_data_all
  elif start_date and not fit_start_date:
      # fit_years=0 (all data) — no truncation, reuse same data
      baseline_hist_data = hist_data_all
  else:
      baseline_hist_data = hist_data_all
  ```

- [x] **1.2** Update line 221 to use `baseline_hist_data` instead of `hist_data_all` for baseline slicing:
  ```python
  # Was: base_df_all = hist_data_all[base_tf]
  base_df_all = baseline_hist_data[base_tf]
  ```

- [x] **1.3** Similarly, update the multi-timeframe baseline filter loop (around lines 270-285) — wherever `hist_data_all[tf]` is used for baseline data, replace with `baseline_hist_data[tf]`.

- [x] **1.4** Ensure `hist_data_all` is still used for model fitting (line 206-212: `raw_1min` filtering and `generator.fit()` must remain unchanged).

- [x] **1.5** Add a warning log when the baseline range extends before the fit window:
  ```python
  if start_date and fit_start_date and start_date < fit_start_date:
      print(f"  WARNING: Baseline window ({start_date} to {end_date}) extends "
            f"before model fitting window ({fit_start_date}). Model was fitted "
            f"on different data than the baseline period.")
  ```

**Acceptance criteria:**
- When `start_date < fit_start_date`: baseline uses full date range, model fitting uses fit_years window.
- When `start_date >= fit_start_date` or no dates provided: behavior is identical to current code.
- No changes to model fitting, synthetic path generation, or aggregation logic.

---

## Phase 2: Verification

- [ ] **2.1** Run MC simulation with a strategy where `start_date` is well before `fit_start_date` (e.g., start=2018-01-01, fit_years=5). Confirm:
  - Baseline window in stdout shows the full requested date range (2018-01-01 to end_date).
  - No "No data found" error.
  - Model fitting log still shows the fit_years window.

- [ ] **2.2** Run MC simulation where `start_date` is within the fit window (e.g., start=2024-01-01, fit_years=5). Confirm:
  - No second data load occurs (no "loading extended data" message).
  - Behavior is identical to before the fix.

- [ ] **2.3** Run MC simulation without `--start`/`--end` args. Confirm:
  - Falls back to existing "last N bars" behavior.
  - No regression.

---

## Files Modified

| File | Change Type | Impact |
|------|------------|--------|
| `packages/montecarlo/runner/mc_runner.py` | Modified | Dual data load for baseline when start_date < fit_start_date |

## Risk Assessment

- **Risk:** LOW
- **Rationale:** Additive change within a single function. Model fitting path is untouched. Fallback behavior preserved for all existing call patterns.
