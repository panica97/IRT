# IRT Backtest Worker Documentation

Complete reference for the IRT Backtest Worker, the host-side parallel job executor that polls the IRT API for pending backtest and Monte Carlo jobs, runs them as subprocesses against the trading engine, and reports results back to the API.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Configuration](#3-configuration)
4. [Components](#4-components)
5. [Job Lifecycle](#5-job-lifecycle)
6. [Data Flow](#6-data-flow)
7. [Running the Worker](#7-running-the-worker)
8. [Troubleshooting](#8-troubleshooting)
9. [API Communication](#9-api-communication)

---

## 1. Overview

### What is the Worker

The IRT Backtest Worker is a standalone Python process that runs on the **host machine** (not inside Docker). It acts as a job runner that continuously polls the IRT API for pending backtest requests, claims them, executes them by invoking the backtest engine or Monte Carlo runner as subprocesses, and posts results back to the API.

### What Problem It Solves

The IRT frontend allows users to queue backtest and Monte Carlo simulation jobs against their strategy drafts. These jobs are computationally intensive and must run outside the Docker container because:

- The backtest engine (`ibkr_core`) and its dependencies live on the host machine
- Historical market data files are stored on the host filesystem
- The engine requires direct access to the Python virtual environment with compiled dependencies
- Monte Carlo simulations with thousands of paths can run for extended periods

The worker bridges the gap between the Dockerized API/frontend and the host-resident engine by acting as a long-running daemon that processes jobs asynchronously.

### Supported Job Modes

The worker supports three execution modes:

| Mode | Description | Engine Used | Produces Trades | Timeout |
|------|-------------|-------------|-----------------|---------|
| `simple` | Basic backtest, metrics only | Backtest Engine | No (or legacy inline) | 300s (default) |
| `complete` | Full backtest with trade log | Backtest Engine | Yes (Parquet) | 300s (default) |
| `montecarlo` | Monte Carlo path-based simulation | MC Runner | No | 7200s (2 hours) |

### Key Design Decisions

- **Host-resident**: Runs outside Docker to access the engine and data files directly
- **Slot-based parallelism**: Configurable number of worker threads (default 3)
- **Fair sharing**: Dynamic per-job slot caps prevent one large job from starving others
- **Stateless**: The worker holds no persistent state; all state lives in the API database
- **Graceful shutdown**: Responds to SIGTERM/SIGINT, finishes active jobs before exiting
- **Fire-and-forget error handling**: All exceptions are caught, logged, and reported back to the API as job failures; the poll loop never crashes

---

## 2. Architecture

### System Context

```
  +===========================================+
  |           Docker Compose Stack            |
  |                                           |
  |  +-------------+     +----------------+  |
  |  |  React       |     |  FastAPI API   |  |
  |  |  Frontend    |---->|  (port 8000)   |  |
  |  |  (port 5173) |     |                |  |
  |  +-------------+     +-------+--------+  |
  |                               |           |
  +===========================================+
                                  |
                           HTTP polling
                                  |
  +-------------------------------v-----------+
  |            HOST MACHINE                   |
  |                                           |
  |  +--------------------------------------+ |
  |  |         IRT Backtest Worker          | |
  |  |                                      | |
  |  |  main.py (entry point)              | |
  |  |    |                                 | |
  |  |  orchestrator.py (poll + schedule)  | |
  |  |    |                                 | |
  |  |  executor.py (job lifecycle)        | |
  |  |    |         |                       | |
  |  |  engine.py  mc_engine.py            | |
  |  |    |         |                       | |
  |  |  bridge.py (draft export + remap)   | |
  |  +--------------------------------------+ |
  |         |                   |              |
  |  +------v------+    +------v-----------+  |
  |  | Backtest    |    | MC Runner        |  |
  |  | Engine      |    | (main_mc.py)     |  |
  |  | (ibkr_core) |    |                  |  |
  |  +------+------+    +------+-----------+  |
  |         |                   |              |
  |  +------v-------------------v-----------+  |
  |  |     Historical Market Data Files     |  |
  |  |     (HIST_DATA_PATH)                 |  |
  |  +--------------------------------------+  |
  +--------------------------------------------+
```

### Slot-Based Parallelism

The worker uses a thread pool model with N configurable slots (default 3). Each slot is a daemon thread that pulls work units from a shared FIFO queue.

```
                    +-------------------+
                    |   Orchestrator    |
                    |   (poll loop)     |
                    +--------+----------+
                             |
                     enqueue WorkUnits
                             |
                    +--------v----------+
                    |    FIFO Queue     |
                    +--------+----------+
                             |
              +--------------+--------------+
              |              |              |
       +------v------+ +----v-------+ +----v-------+
       |   Slot 0    | |   Slot 1   | |   Slot 2   |
       |   (thread)  | |   (thread) | |   (thread) |
       +------+------+ +----+-------+ +----+-------+
              |              |              |
          execute_       execute_       execute_
          backtest_job   backtest_job   backtest_job
```

### Fair Sharing Algorithm

The fair sharing system prevents a single job from monopolizing all slots when multiple jobs are queued. The algorithm works as follows:

1. Each active job has a counter tracking how many slots it currently occupies
2. The per-job cap is dynamically calculated as: `max(1, num_slots - num_active_jobs)`
3. When a slot thread dequeues a work unit, it checks if that job is already at its cap
4. If at cap, the unit is re-queued and the thread backs off for 200ms

**Behavior examples** (with `num_slots=3`):

| Active Jobs | Per-Job Cap | Effect |
|-------------|-------------|--------|
| 1 | 3 (`max(1, 3-1)`) | Single job gets all 3 slots |
| 2 | 2 (`max(1, 3-2)`) | Each job gets up to 2 slots |
| 3 | 1 (`max(1, 3-3)`) | Each job gets exactly 1 slot |
| 4+ | 1 (`max(1, ...)`) | Floor is always 1 slot per job |

Note: Currently all modes produce exactly 1 WorkUnit per job, so the fair sharing mainly governs how many different jobs can run concurrently rather than distributing units of a single job.

---

## 3. Configuration

### Environment Variables

All configuration is loaded from environment variables, with fallback to a `.env` file in the `worker/` directory.

| Variable | Default | Description |
|----------|---------|-------------|
| `IRT_API_URL` | `http://localhost:8000` | Base URL of the IRT FastAPI backend |
| `IRT_API_KEY` | `""` (empty) | API key for authentication; sent as `X-API-Key` header |
| `WORKER_POLL_INTERVAL` | `5` | Seconds between polling cycles for new pending jobs |
| `WORKER_JOB_TIMEOUT` | `300` | Maximum seconds for a backtest engine subprocess before timeout |
| `WORKER_NUM_SLOTS` | `3` | Number of parallel worker threads |
| `HIST_DATA_PATH` | `""` (empty) | Path to the directory containing historical market data files |
| `ENGINE_PATH` | `""` (empty) | Path to the backtest engine entry script (e.g., `backtest-engine/main.py`) |
| `MC_RUNNER_PATH` | `packages/montecarlo/runner/main_mc.py` | Path to the Monte Carlo runner entry script |
| `WORKER_DEBUG` | `""` (disabled) | Set to `1`, `true`, or `yes` to enable debug mode (saves remapped JSON to disk) |

### .env File Location

The worker loads its `.env` file from `worker/.env` (the same directory as `config.py`). This file is not committed to version control.

**Example `worker/.env`:**

```bash
IRT_API_URL=http://localhost:8000
IRT_API_KEY=my-secret-key-1234
WORKER_POLL_INTERVAL=5
WORKER_JOB_TIMEOUT=300
WORKER_NUM_SLOTS=3
HIST_DATA_PATH=D:/market-data/historical
ENGINE_PATH=D:/engines/backtest-engine/main.py
MC_RUNNER_PATH=packages/montecarlo/runner/main_mc.py
WORKER_DEBUG=false
```

### Config Class Details

The `Config` class (`worker/config.py`) performs several tasks at initialization:

1. Loads the `.env` file using `python-dotenv`
2. Reads all environment variables with their defaults
3. Creates a shared `requests.Session` with the `X-API-Key` header pre-configured
4. Strips trailing slashes from `api_url` to avoid double-slash issues in URL construction

The shared `requests.Session` is used throughout the worker for all HTTP communication with the API. This provides:
- Connection pooling (reuses TCP connections)
- Automatic header injection (API key)
- Consistent timeout handling

The `log_summary()` method returns a one-line string with all config values (API key partially masked) for startup logging.

### Timeout Behavior

There are two different timeout values:

| Context | Value | Source |
|---------|-------|--------|
| Backtest engine subprocess | `WORKER_JOB_TIMEOUT` (default 300s) | `config.job_timeout` |
| Monte Carlo subprocess | 7200s (2 hours, hardcoded) | `mc_engine.MC_TIMEOUT` |
| HTTP requests to API | 10-15s per request (hardcoded) | Various modules |

The MC timeout is intentionally much longer because Monte Carlo simulations with thousands of paths can take significant time. It is hardcoded in `mc_engine.py` as the `MC_TIMEOUT` constant.

---

## 4. Components

### 4.1 `__main__.py` — Module Entry Point

**File:** `worker/__main__.py`

A minimal shim that allows running the worker as a Python module:

```bash
python -m worker
```

It simply imports and calls `main()` from `worker.main`.

### 4.2 `main.py` — Process Entry Point

**File:** `worker/main.py`

The true entry point that sets up the process environment:

1. **Logging**: Configures `logging.basicConfig` with `INFO` level, timestamped format (`%Y-%m-%d %H:%M:%S [LEVEL] name: message`), and the logger name `irt-worker`
2. **Config**: Creates a `Config()` instance to load environment variables
3. **Orchestrator**: Creates an `Orchestrator(config)` instance
4. **Signal handlers**: Registers `SIGTERM` and `SIGINT` handlers that call `orch.stop()` for graceful shutdown
5. **Startup log**: Logs the full configuration summary
6. **Run**: Calls `orch.run()` which blocks until shutdown
7. **Shutdown log**: Logs graceful shutdown confirmation

### 4.3 `config.py` — Configuration

**File:** `worker/config.py`

See [Section 3: Configuration](#3-configuration) for full details.

### 4.4 `orchestrator.py` — Job Discovery, Claiming, and Dispatching

**File:** `worker/orchestrator.py`

The orchestrator is the core scheduler. It has three responsibilities:

#### Polling Loop (`run()`)

The main thread runs a continuous poll loop:

1. Call `_claim_all_pending()` to fetch and claim all available pending jobs from the API
2. For each claimed job, call `_decompose_job()` to create `WorkUnit` objects
3. Enqueue all work units into the shared FIFO queue
4. Sleep for `poll_interval` seconds (in 0.5s increments for responsive shutdown)
5. Repeat until `_shutdown_event` is set

**Connection resilience**: If the API is unreachable (`requests.ConnectionError`), the orchestrator logs an error and retries after the poll interval rather than crashing.

#### Job Claiming (`_claim_all_pending()`)

This method implements a drain loop:

1. `GET /api/backtests/pending` — returns the next pending job (or 204 No Content if none)
2. `PATCH /api/backtests/{id}/claim` — atomically transitions the job from `pending` to `running`
3. Repeat until 204 (no more pending jobs)

The claim is an atomic operation on the API side, preventing race conditions when multiple workers run. If a claim fails with HTTP 409 (conflict), the job was already claimed by another worker and is skipped.

#### Job Decomposition (`_decompose_job()`)

Converts a claimed job dict into one or more `WorkUnit` dataclasses. Currently, all three modes (`simple`, `complete`, `montecarlo`) produce exactly one work unit per job. The decomposition layer exists for future extensibility (e.g., splitting a job across multiple symbols or timeframes).

The `WorkUnit` dataclass contains:

| Field | Type | Description |
|-------|------|-------------|
| `job_id` | `int` | Database ID of the backtest job |
| `unit_id` | `str` | Unique identifier for this work unit (e.g., `simple_42`) |
| `job` | `dict` | Full job dict from the API |
| `label` | `str` | Human-readable label for logging (e.g., `simple:job-42`) |

#### Slot Worker Threads (`_slot_worker()`)

Each slot thread runs an infinite loop:

1. Dequeue a `WorkUnit` from the FIFO queue (1s timeout to check shutdown)
2. Check the fair-sharing gate: if this job is at its slot cap, re-queue the unit and back off
3. Increment the job's active count
4. Call `execute_backtest_job(unit.job, config)`
5. Decrement the job's active count (in a `finally` block)
6. Clean up the job from `_active_counts` when its count reaches zero

#### Graceful Shutdown (`stop()`)

Sets the `_shutdown_event` threading event. This causes:

- The poll loop to exit after the current sleep interval
- Slot threads to stop pulling new work after their current job completes
- The main thread to `join()` all slot threads with the job timeout as maximum wait

### 4.5 `executor.py` — Job Execution Lifecycle

**File:** `worker/executor.py`

The executor is the glue layer that ties together the bridge, engine, and API reporting. It provides a single public function: `execute_backtest_job(job, config)`.

#### Main Function: `execute_backtest_job()`

This function orchestrates the entire execution of a single job. It **never raises** -- all exceptions are caught, logged, and reported as job failures to the API.

**Step-by-step flow:**

1. **Export draft** (`bridge.export_draft_to_file`): Fetches the strategy draft JSON from the API and writes it to a temp file
2. **Timeframe remapping** (complete/montecarlo modes only): Reads the exported JSON, remaps all timeframe references using `bridge.remap_timeframe`, validates with `bridge.validate_remapped_json`, and overwrites the temp file
3. **Debug save** (optional): If `job.debug` flag or `WORKER_DEBUG` env var is set, saves the remapped JSON to `data/backtests/debug/` for inspection
4. **Engine execution**: Calls either `run_engine()` (simple/complete) or `run_montecarlo()` (montecarlo mode)
5. **Trade extraction** (complete mode only): Reads the `trades.parquet` file produced by the engine and converts it to a list of simplified trade dicts
6. **Report success**: Posts metrics and trades to `POST /api/backtests/{id}/results`
7. **Report failure** (on exception): Posts the error message to `PATCH /api/backtests/{id}/fail`
8. **Cleanup** (always): Removes the temp strategy JSON file and any parquet files

#### Helper Functions

**`_report_success(config, job_id, metrics, trades)`**
Posts results to the API. The payload contains `metrics` (dict) and `trades` (list of dicts).

**`_report_failure(config, job_id, error_message)`**
Marks the job as failed via the API. Error messages are truncated to 2000 characters to avoid unbounded storage. This function itself never raises -- failures in reporting are logged but swallowed.

**`_cleanup_temp_file(strat_code)`**
Removes the temp strategy JSON from `{TEMP}/irt-backtests/{strat_code}.json`. Failures are logged as warnings.

**`_read_parquet_trades(parquet_path)`**
Reads a Parquet trade log and returns a simplified list of trade dicts. Features:

- Tries `polars` first, falls back to `pandas` if polars is not installed
- Maps engine column names to standardized names (handles multiple naming conventions)
- Converts datetime objects to ISO 8601 strings
- Sanitizes `NaN`/`Inf` float values to `None`
- Coerces `bars_held` to `int`

The 9 standardized trade fields are:

| Field | Type | Description |
|-------|------|-------------|
| `entry_date` | `str` (ISO 8601) | Trade entry timestamp |
| `exit_date` | `str` (ISO 8601) | Trade exit timestamp |
| `side` | `str` | Trade direction (`long`/`short`) |
| `entry_fill_price` | `float` | Entry fill price |
| `exit_fill_price` | `float` | Exit fill price |
| `pnl` | `float` | Trade profit/loss |
| `exit_reason` | `str` | Reason for exit (stop, target, signal, etc.) |
| `bars_held` | `int` | Number of bars the trade was held |
| `cumulative_pnl` | `float` | Running cumulative P&L |

**`_save_debug_json(data, strat_code, timeframe)`**
Saves remapped strategy JSON to `data/backtests/debug/{strat_code}_{timeframe}_{timestamp}.json` for debugging. Never raises -- logs warning on failure.

### 4.6 `engine.py` — Backtest Engine Subprocess

**File:** `worker/engine.py`

This module invokes the backtest engine as a subprocess and parses its output.

#### Output Protocol

The engine communicates metrics back to the worker through stdout using a marker-delimited JSON protocol:

```
...engine logs and output...
###METRICS_JSON_START###{"net_pnl": 1234.5, "sharpe": 1.2, ...}###METRICS_JSON_END###
...more output...
```

The worker uses a regex to extract the JSON between the `###METRICS_JSON_START###` and `###METRICS_JSON_END###` markers.

#### Python Resolution (`_resolve_python()`)

The engine subprocess needs to run in the correct Python environment with `ibkr_core` and other dependencies. The resolution logic:

1. Look for `.venv/Scripts/python.exe` (Windows) or `.venv/bin/python` (Linux) at the IRT project root (parent of `worker/`)
2. If found, use the venv Python
3. If not found, fall back to `sys.executable` (the Python running the worker)

#### Command Construction

The engine is invoked with the following CLI arguments:

```bash
python <ENGINE_PATH> \
    --mode single \
    --strategy <strat_code> \
    --start <start_date> \
    --end <end_date> \
    --metrics-json \
    --hist-data-path <HIST_DATA_PATH> \
    --strategies-path <temp_dir>
    [--save]  # only in complete mode
```

| Argument | Source | Description |
|----------|--------|-------------|
| `--mode single` | Hardcoded | Run a single strategy backtest |
| `--strategy` | `job["draft_strat_code"]` | Strategy code identifier |
| `--start` | `job["start_date"]` | Backtest start date |
| `--end` | `job["end_date"]` | Backtest end date |
| `--metrics-json` | Hardcoded | Emit metrics using the marker protocol |
| `--hist-data-path` | `config.hist_data_path` | Directory with historical data files |
| `--strategies-path` | From bridge export | Temp directory with the strategy JSON |
| `--save` | Only in complete mode | Write trades to Parquet file |

#### Parquet File Location (`_find_parquet()`)

When `--save` is used, the engine writes trade data to:

```
{engine_root}/logs_backtest/{strategy}/{YYYYMMDD_XXX}/trades.parquet
```

The `_find_parquet()` function searches for the most recently modified `trades.parquet` file in:

1. `{engine_root}/logs_backtest/` (primary search path)
2. The strategies path directory (fallback)
3. The strategies path parent directory (second fallback)

Files are sorted by modification time (newest first) to pick the correct file when multiple backtests have run.

#### JSON Sanitization (`_sanitize_for_json()`)

Recursively walks the metrics dict and replaces `NaN` and `Inf` float values with `None`. This is necessary because:

- Python's `json.dumps` can produce `NaN`/`Infinity` which are not valid JSON
- The API stores metrics as JSONB in PostgreSQL which rejects non-standard values
- The frontend cannot reliably parse non-standard JSON floats

### 4.7 `mc_engine.py` — Monte Carlo Engine Subprocess

**File:** `worker/mc_engine.py`

This module invokes the Monte Carlo runner as a subprocess, using the same marker-delimited output protocol as the backtest engine.

#### Command Construction

```bash
python <MC_RUNNER_PATH> \
    --mode path_based \
    --strategy <strat_code> \
    --sim-bars <calculated> \
    --n-paths <n_paths> \
    --fit-years <fit_years> \
    --metrics-json \
    --save \
    --hist-data-path <HIST_DATA_PATH> \
    --strategies-path <temp_dir> \
    [--start <start_date> --end <end_date>]
```

| Argument | Source | Default | Description |
|----------|--------|---------|-------------|
| `--mode path_based` | Hardcoded | -- | Path-based Monte Carlo simulation |
| `--strategy` | `job["draft_strat_code"]` | -- | Strategy code |
| `--sim-bars` | Calculated from date range | 252 | Number of bars to simulate per path |
| `--n-paths` | `job["n_paths"]` | 1000 | Number of Monte Carlo paths |
| `--fit-years` | `job["fit_years"]` | 10 | Years of historical data for distribution fitting |
| `--metrics-json` | Hardcoded | -- | Emit metrics via marker protocol |
| `--save` | Hardcoded | -- | Save MC results to disk |
| `--hist-data-path` | `config.hist_data_path` | -- | Historical data directory |
| `--strategies-path` | From bridge export | -- | Temp directory with strategy JSON |
| `--start` / `--end` | `job["start_date"]` / `job["end_date"]` | -- | Date range (optional, added if present) |

#### Simulation Bars Calculation

The `sim_bars` parameter determines how many bars each MC path simulates. Instead of using a fixed default, the worker calculates it from the job's date range:

```
calendar_days = (end_date - start_date).days
sim_bars = max(1, int(calendar_days * 252 / 365))
```

This converts calendar days to approximate trading days (252 per year). If date parsing fails, it falls back to 252 (one trading year).

#### Timeout

The MC timeout is hardcoded at 7200 seconds (2 hours) via the `MC_TIMEOUT` constant. This is significantly longer than the backtest engine timeout because MC simulations with many paths are inherently more compute-intensive.

#### Shared Infrastructure

The MC engine reuses several components from `engine.py`:

- `METRICS_START` / `METRICS_END` marker constants
- `_resolve_python()` for Python executable resolution
- `_sanitize_for_json()` for NaN/Inf sanitization

### 4.8 `bridge.py` — Strategy File Handling

**File:** `worker/bridge.py`

The bridge module handles the translation layer between the IRT API's draft format (JSONB in PostgreSQL) and the backtest engine's expected input format (JSON files on disk).

#### Draft Export (`export_draft_to_file()`)

Fetches a strategy draft from the IRT API and writes it to a temporary file:

1. `GET /api/strategies/drafts/{strat_code}` to fetch the draft
2. Extracts the `data` field (the actual strategy JSON)
3. Ensures the `symbol` field has an `@` prefix (engine convention: `@MNQ` not `MNQ`)
4. Writes to `{TEMP}/irt-backtests/{strat_code}.json`
5. Returns the temp directory path (used as `--strategies-path`)

If the draft is not found (404), it raises a `RuntimeError` with a clear message suggesting the draft may have been deleted.

#### Timeframe Remapping (`remap_timeframe()`)

Remaps all timeframe-dependent references in a strategy JSON from one timeframe to another. This is essential for multi-timeframe backtesting where the same strategy is tested across different bar sizes.

The remapping affects 6 areas of the strategy JSON:

1. **`process_freq`**: The main processing frequency label (e.g., `"5 mins"` -> `"15 mins"`)
2. **`ind_list` keys and `indCode` values**: Indicator definitions carry timeframe suffixes in their codes (e.g., `SMA_20_5m` -> `SMA_20_15m`)
3. **Condition strings** (`long_conds`, `short_conds`, `exit_conds`): Indicator references in condition expressions have timeframe suffixes
4. **`max_shift`**: If stored as a list with a timeframe label, the label is remapped
5. **`stop_loss_init` / `take_profit_init`**: The `indicator_params.tf` and `indicator_params.col` fields carry timeframe references
6. **`control_params.primary_timeframe`**: The strategy's declared primary timeframe

**Timeframe mapping table:**

| Label | Engine Suffix |
|-------|---------------|
| `1 min` | `1m` |
| `2 mins` | `2m` |
| `3 mins` | `3m` |
| `5 mins` | `5m` |
| `10 mins` | `10m` |
| `15 mins` | `15m` |
| `20 mins` | `20m` |
| `30 mins` | `30m` |
| `1 hour` | `1H` |
| `2 hours` | `2H` |
| `3 hours` | `3H` |
| `4 hours` | `4H` |
| `8 hours` | `8H` |
| `1 day` | `1D` |
| `1 week` | `1W` |
| `1 month` | `1M` |

The function accepts both labels (`"5 mins"`) and suffixes (`"5m"`) as input and always produces a deep copy (never mutates the input).

#### Validation (`validate_remapped_json()`)

Performs two-layer validation on a remapped strategy JSON:

**Layer 1 -- Schema validation:**
- `process_freq` must be a non-empty string matching a known timeframe
- `ind_list` must be a non-empty dict
- Each indicator entry must have an `indCode`
- `max_shift` must be a positive integer (or list with positive int first element)

**Layer 2 -- Consistency validation** (only runs if Layer 1 passes):
- All `indCode` values must end with the suffix matching `process_freq`
- Condition strings must reference indicator codes that exist in `ind_list`
- `stop_loss_init` and `take_profit_init` timeframe fields must match `process_freq`

Returns a list of error strings. An empty list means the strategy is valid.

---

## 5. Job Lifecycle

### Step-by-Step Flow

The complete lifecycle of a backtest job, from creation to result:

```
  Frontend                   API                      Worker
  --------                   ---                      ------

  1. User clicks         2. Creates job
     "Run Backtest"   -->    status=pending
                             in database
                                  |
                                  |  3. Worker polls
                                  |     GET /pending
                                  |<------------------
                                  |
                                  |  4. Returns job
                                  |------------------>
                                  |
                                  |  5. Worker claims
                                  |     PATCH /claim
                                  |<------------------
                                  |
                                  |  6. status=running
                                  |------------------>
                                  |
                                  |                    7. Export draft
                                  |<---GET /drafts/{code}
                                  |--->draft JSON
                                  |
                                  |                    8. Remap timeframe
                                  |                       (if complete/mc)
                                  |
                                  |                    9. Run subprocess
                                  |                       (engine or MC)
                                  |
                                  |                    10. Parse metrics
                                  |                        from stdout
                                  |
                                  |                    11. Read trades
                                  |                        (if complete)
                                  |
                                  |  12. Report results
                                  |      POST /results
                                  |<------------------
                                  |
                                  |  13. status=done
  14. Frontend polls              |      or status=failed
      and shows results  <-----  |
```

### Detailed Step Breakdown

**Step 1-2: Job Creation**
The user triggers a backtest from the frontend. The API creates a job record with `status=pending`, storing the draft strategy code, symbol, date range, mode, and optional parameters (timeframe, n_paths, fit_years).

**Step 3-4: Job Discovery**
The worker's orchestrator polls `GET /api/backtests/pending`. The API returns the next pending job, or 204 if the queue is empty. The worker drains all pending jobs in a single poll cycle.

**Step 5-6: Job Claiming**
The worker claims each job via `PATCH /api/backtests/{id}/claim`. This is an atomic transition: only one worker can claim a job. If another worker already claimed it (409 Conflict), it is silently skipped.

**Step 7: Draft Export**
The executor fetches the full draft JSON from `GET /api/strategies/drafts/{strat_code}` and writes it to a temp file at `{TEMP}/irt-backtests/{strat_code}.json`. The `@` prefix is added to the symbol if missing.

**Step 8: Timeframe Remapping (complete/montecarlo only)**
If the job specifies a target timeframe different from the draft's `process_freq`, the bridge remaps all timeframe-dependent fields. The remapped JSON is validated and overwrites the temp file. If validation fails, the job is marked as failed.

**Step 9: Engine Execution**
The executor spawns a subprocess:
- For `simple`/`complete` modes: the backtest engine via `engine.run_engine()`
- For `montecarlo` mode: the MC runner via `mc_engine.run_montecarlo()`

The subprocess runs with the configured timeout. If it exceeds the timeout, a `RuntimeError` is raised.

**Step 10: Metrics Parsing**
The worker reads stdout from the subprocess and extracts the JSON between `###METRICS_JSON_START###` and `###METRICS_JSON_END###` markers. The JSON is parsed and sanitized (NaN/Inf replaced with null).

**Step 11: Trade Extraction (complete mode only)**
The worker locates the `trades.parquet` file written by the engine, reads it using polars (or pandas fallback), and converts it to a list of 9-field trade dicts.

**Step 12-13: Result Reporting**
On success: `POST /api/backtests/{id}/results` with `{metrics, trades}`
On failure: `PATCH /api/backtests/{id}/fail` with `{error_message}`

**Step 14: Cleanup**
Temp strategy JSON and parquet files are deleted regardless of outcome.

---

## 6. Data Flow

### ASCII Diagram

```
  +--------------------------------------------------+
  |                    IRT API                        |
  |                                                   |
  |  GET /api/backtests/pending                       |
  |       |                                           |
  |       v                                           |
  |  { id, draft_strat_code, symbol,                  |
  |    start_date, end_date, mode,                    |
  |    timeframe, n_paths, fit_years }                |
  |       |                                           |
  +-------|-----------+-------------------+-----------+
          |           ^                   ^
          |           |                   |
          v           |                   |
  +-------+-----------+---+     +---------+-----------+
  | bridge.py              |     | executor.py          |
  |                        |     |                      |
  | GET /drafts/{code}     |     | POST /results        |
  |       |                |     |   { metrics, trades } |
  |       v                |     |                      |
  | Draft JSON (JSONB)     |     | PATCH /fail          |
  |   {symbol, ind_list,   |     |   { error_message }  |
  |    long_conds, ...}    |     |                      |
  |       |                |     +----------^-----------+
  |       v                |                |
  | remap_timeframe()      |                |
  |       |                |                |
  |       v                |                |
  | validate_remapped()    |                |
  |       |                |                |
  |       v                |                |
  | {TEMP}/irt-backtests/  |                |
  |   {code}.json          |                |
  +-------+----------------+                |
          |                                 |
          v                                 |
  +-------+----------------+                |
  | engine.py / mc_engine  |                |
  |                        |                |
  | subprocess.run(        |                |
  |   python engine.py     |                |
  |   --strategies-path    |                |
  |   --hist-data-path     |                |
  |   --metrics-json       |                |
  | )                      |                |
  |       |                |                |
  |       v                |                |
  | stdout:                |                |
  | ###METRICS_JSON_START# |                |
  | ##{"net_pnl":...}###ME |                |
  | TRICS_JSON_END###      |                |
  |       |                |                |
  |       v                |                |
  | json.loads() +         |                |
  | _sanitize_for_json()   +--------------->+
  |                        |
  | (complete mode only):  |
  | trades.parquet ------->+ _read_parquet_trades()
  |                        |       |
  +------------------------+       |
                                   v
                            [ {entry_date, exit_date,
                               side, entry_fill_price,
                               exit_fill_price, pnl,
                               exit_reason, bars_held,
                               cumulative_pnl} ]
```

### Temp File Layout

```
{TEMP}/
  irt-backtests/
    {strat_code}.json          # Strategy JSON (created by bridge, consumed by engine)

{engine_root}/
  logs_backtest/
    {strategy}/
      {YYYYMMDD_XXX}/
        trades.parquet         # Trade log (created by engine in complete mode)

data/
  backtests/
    debug/
      {strat_code}_{tf}_{timestamp}.json   # Debug copies (only when debug enabled)
```

---

## 7. Running the Worker

### Starting the Worker

```bash
# From the IRT project root
python -m worker

# Or directly
python worker/main.py
```

### Startup Log Output

```
2026-03-28 10:00:00 [INFO] irt-worker: Worker started | api_url=http://localhost:8000, api_key=***1234, poll_interval=5s, job_timeout=300s, num_slots=3, hist_data_path=D:/data, engine_path=D:/engine/main.py, mc_runner_path=packages/montecarlo/runner/main_mc.py
2026-03-28 10:00:00 [INFO] irt-worker.orchestrator: Started 3 worker slots
```

### Stopping the Worker

The worker responds to:

- **Ctrl+C** (SIGINT): Triggers graceful shutdown
- **SIGTERM**: Triggers graceful shutdown (e.g., from process managers)

Graceful shutdown behavior:

1. The shutdown event is set
2. The poll loop exits after its current sleep interval
3. Active slot threads finish their current job (up to `job_timeout` seconds)
4. All threads are joined
5. The process exits with a "Worker shut down gracefully" log message

### Monitoring

The worker logs all significant events to stdout/stderr:

| Log Level | Events |
|-----------|--------|
| `INFO` | Worker start/stop, job claimed, job enqueued, engine start/complete, result reported |
| `WARNING` | Claim conflict (409), parquet not found, cleanup failures |
| `ERROR` | API unreachable, job decomposition failure, engine errors, report failures |
| `DEBUG` | Engine stderr lines, temp file cleanup, venv resolution |

### Running as a Background Service

For production use, the worker can be managed by a process supervisor:

**Using systemd (Linux):**

```ini
[Unit]
Description=IRT Backtest Worker
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/IRT
ExecStart=/path/to/IRT/.venv/bin/python -m worker
Restart=always
RestartSec=10
EnvironmentFile=/path/to/IRT/worker/.env

[Install]
WantedBy=multi-user.target
```

**Using a simple batch script (Windows):**

```batch
@echo off
cd /d C:\path\to\IRT
.venv\Scripts\python.exe -m worker
```

---

## 8. Troubleshooting

### Common Issues

#### Worker cannot reach the API

**Symptom:**
```
[ERROR] irt-worker.orchestrator: Cannot reach API at http://localhost:8000 -- retrying in 5s
```

**Cause:** The IRT API container is not running or not accessible from the host.

**Fix:**
1. Verify the Docker containers are running: `docker compose ps`
2. Check the API URL in your `.env` matches the actual API address
3. If the API is inside Docker, ensure port 8000 is mapped to the host

#### Engine subprocess not found

**Symptom:**
```
[ERROR] Engine exited with code 2: ...No such file or directory...
```

**Cause:** `ENGINE_PATH` points to a non-existent file.

**Fix:** Verify `ENGINE_PATH` in your `worker/.env` points to the correct backtest engine script.

#### No venv found

**Symptom:**
```
[INFO] No .venv found at /path/to/IRT, falling back to sys.executable
```

**Cause:** The worker cannot find the `.venv` directory at the IRT project root.

**Fix:** Ensure a virtual environment exists at `{IRT_ROOT}/.venv/` with all engine dependencies installed.

#### Metrics markers not found in stdout

**Symptom:**
```
RuntimeError: No metrics markers found in engine stdout. Tail: ...
```

**Cause:** The engine ran but did not produce the `###METRICS_JSON_START###...###METRICS_JSON_END###` output. This typically means:
- The engine crashed before producing metrics
- The `--metrics-json` flag is not supported by the engine version
- The engine printed too much output and the markers were lost

**Fix:**
1. Run the engine command manually to see its full output
2. Check engine stderr (logged at DEBUG level) for errors
3. Verify the engine version supports `--metrics-json`

#### Monte Carlo timeout

**Symptom:**
```
RuntimeError: Monte Carlo timed out after 7200s
```

**Cause:** The MC simulation took longer than 2 hours.

**Fix:**
1. Reduce `n_paths` (e.g., from 1000 to 500)
2. Reduce `fit_years`
3. Narrow the date range to reduce `sim_bars`

#### Timeframe remapping validation errors

**Symptom:**
```
ValueError: Remapped JSON validation failed: indCode 'SMA_20_5m' has suffix that doesn't match process_freq '15 mins'
```

**Cause:** The timeframe remapping did not correctly update all indicator references. This can happen with unusual indicator naming patterns.

**Fix:**
1. Enable `WORKER_DEBUG=true` to save the remapped JSON
2. Inspect the debug file at `data/backtests/debug/`
3. Check if the draft has non-standard `indCode` formats

#### Draft not found (404)

**Symptom:**
```
RuntimeError: Draft with strat_code=123 not found (deleted?)
```

**Cause:** The draft was deleted from the database between job creation and execution.

**Fix:** This is a data integrity issue. The draft must exist for the duration of the backtest. Ensure the frontend prevents draft deletion while jobs are pending/running.

### Debug Mode

Enable debug mode to save remapped strategy JSON files for inspection:

```bash
# In worker/.env
WORKER_DEBUG=true
```

Debug files are saved to `data/backtests/debug/` with the naming pattern:
```
{strat_code}_{timeframe}_{YYYYMMDD_HHMMSS}.json
```

---

## 9. API Communication

### Endpoints Used

The worker communicates with the IRT API using 5 HTTP endpoints:

| Method | Endpoint | Purpose | Caller |
|--------|----------|---------|--------|
| `GET` | `/api/backtests/pending` | Fetch next pending job | `orchestrator._claim_all_pending()` |
| `PATCH` | `/api/backtests/{id}/claim` | Claim a job (pending -> running) | `orchestrator._claim_all_pending()` |
| `GET` | `/api/strategies/drafts/{code}` | Fetch draft strategy JSON | `bridge.export_draft_to_file()` |
| `POST` | `/api/backtests/{id}/results` | Submit metrics and trades | `executor._report_success()` |
| `PATCH` | `/api/backtests/{id}/fail` | Mark job as failed | `executor._report_failure()` |

### Authentication

All requests include the `X-API-Key` header, pre-configured on the shared `requests.Session` in `Config.__init__()`. If `IRT_API_KEY` is empty, no header is sent.

### Request/Response Details

#### GET /api/backtests/pending

**Response 200:**
```json
{
  "id": 42,
  "draft_strat_code": 1001,
  "symbol": "MNQ",
  "start_date": "2024-01-01",
  "end_date": "2024-12-31",
  "mode": "complete",
  "timeframe": "15 mins",
  "status": "pending"
}
```

**Response 204:** No pending jobs (empty body).

#### PATCH /api/backtests/{id}/claim

**Response 200:** The claimed job dict (same shape as above, with `status: "running"`).

**Response 409:** Job already claimed by another worker.

#### GET /api/strategies/drafts/{code}

**Response 200:**
```json
{
  "strat_code": 1001,
  "data": {
    "symbol": "MNQ",
    "process_freq": "5 mins",
    "ind_list": { ... },
    "long_conds": [ ... ],
    "short_conds": [ ... ],
    "exit_conds": [ ... ],
    "max_shift": [20, "5 mins"],
    "stop_loss_init": { ... },
    "take_profit_init": { ... },
    "control_params": { ... }
  }
}
```

**Response 404:** Draft not found.

#### POST /api/backtests/{id}/results

**Request body:**
```json
{
  "metrics": {
    "net_pnl": 1234.56,
    "sharpe": 1.23,
    "max_drawdown": -500.00,
    "total_trades": 150,
    "win_rate": 0.55
  },
  "trades": [
    {
      "entry_date": "2024-01-15T09:30:00",
      "exit_date": "2024-01-15T10:15:00",
      "side": "long",
      "entry_fill_price": 17250.50,
      "exit_fill_price": 17275.25,
      "pnl": 24.75,
      "exit_reason": "target",
      "bars_held": 9,
      "cumulative_pnl": 24.75
    }
  ]
}
```

#### PATCH /api/backtests/{id}/fail

**Request body:**
```json
{
  "error_message": "Engine exited with code 1: ImportError: No module named 'ibkr_core'"
}
```

Error messages are truncated to 2000 characters by the worker before sending.

### Timeout Policy

| Request Type | Timeout | Rationale |
|--------------|---------|-----------|
| Poll for pending jobs | 10s | Lightweight query, should be fast |
| Claim a job | 10s | Lightweight state transition |
| Fetch draft | 15s | Draft JSON can be large |
| Report results | 15s | Results payload can be large (metrics + trades) |
| Report failure | 15s | Small payload but important to deliver |

### Retry Behavior

The worker does **not** implement explicit retry logic for individual HTTP requests. Instead:

- If the API is unreachable during polling, the orchestrator logs the error and retries on the next poll cycle (after `poll_interval` seconds)
- If a claim fails (409 or other HTTP error), the job is skipped
- If result reporting fails, the exception propagates to `execute_backtest_job` which catches it and attempts to report a failure; if that also fails, the error is logged and the job remains in `running` state in the database (requires manual intervention)

### Connection Pooling

The `requests.Session` object provides connection pooling. All HTTP calls reuse the same session, which keeps TCP connections alive between requests and reduces handshake overhead during frequent polling.
